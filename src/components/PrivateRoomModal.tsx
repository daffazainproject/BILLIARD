import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Loader2, Play, Share2, UserPlus, X } from 'lucide-react';
import { extractRoomCode, isValidRoomCode } from '../game/roomCode.ts';
import type { GameVariant, UserProfile } from '../game/types.ts';
import { audioEngine } from '../services/audio.ts';
import { auth } from '../services/firebase.ts';
import {
  createFirestoreRoomDirectly,
  isFirebaseSessionActive,
  joinRoomViaFirestore,
  leaveFirestoreRoom,
  loadFirestoreMatch,
  mirrorCreatedRoomToFirestore,
  startFirestoreMatch,
  subscribeFirestoreRoom,
} from '../services/firestoreRooms.ts';
import { wsClient } from '../services/wsClient.ts';
import type { OnlineMatchInit } from './GameView.tsx';
import { PlayerAvatar } from './PlayerAvatar.tsx';

export interface RoomParticipant {
  uid: string;
  username: string;
  avatar: string;
  frame: string;
  level: number;
  rating: number;
  online: boolean;
}

export interface RoomStateView {
  roomId: string;
  roomCode: string;
  hostId: string;
  guestId: string | null;
  entryFee: number;
  gameVariant?: GameVariant;
  status: string;
  matchId?: string | null;
  host: RoomParticipant | null;
  guest: RoomParticipant | null;
  isFirestoreBridged?: boolean;
}

interface PrivateRoomModalProps {
  currentProfile: UserProfile;
  token: string;
  isFirebaseAccount: boolean;
  room: RoomStateView | null;
  initialJoinCode?: string;
  autoJoin?: boolean;
  error: string | null;
  onRoomChange: (room: RoomStateView | null) => void;
  onMatchStarted: (match: OnlineMatchInit) => void;
  onError: (msg: string | null) => void;
  onClose: () => void;
}

export const PrivateRoomModal: React.FC<PrivateRoomModalProps> = ({
  currentProfile,
  token,
  isFirebaseAccount,
  room,
  initialJoinCode = '',
  autoJoin = false,
  error,
  onRoomChange,
  onMatchStarted,
  onError,
  onClose,
}) => {
  const initialExtracted = extractRoomCode(initialJoinCode);
  const [tab, setTab] = useState<'create' | 'join'>(initialExtracted ? 'join' : 'create');
  const [entryFee, setEntryFee] = useState<number>(0);
  const [gameVariant, setGameVariant] = useState<GameVariant>('8ball');
  const [joinCode, setJoinCode] = useState(initialExtracted);
  const [busyAction, setBusyAction] = useState<'create' | 'join' | 'start' | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [friends, setFriends] = useState<Array<{ player: RoomParticipant; status: string }>>([]);
  const [invitedUids, setInvitedUids] = useState<Set<string>>(new Set());
  const autoJoinedCodeRef = useRef<string>('');
  const startingMatchLockRef = useRef(false);

  const getActiveAuthToken = useCallback(async () => {
    if (isFirebaseAccount && auth.currentUser) {
      try {
        return await auth.currentUser.getIdToken();
      } catch {
        return token;
      }
    }
    return token;
  }, [isFirebaseAccount, token]);

  // Keep joinCode synced if initialJoinCode prop changes (e.g. URL ?room= or Friends invite)
  useEffect(() => {
    const code = extractRoomCode(initialJoinCode);
    if (code) {
      setJoinCode(code);
      setTab('join');
    }
  }, [initialJoinCode]);

  // Load online friends when hosting a waiting room
  useEffect(() => {
    if (room && room.hostId === currentProfile.uid) {
      getActiveAuthToken()
        .then((authTok) =>
          fetch('/api/friends', { headers: { Authorization: `Bearer ${authTok}` } }),
        )
        .then((r) => (r.ok ? r.json() : { friends: [] }))
        .then((data: { friends?: Array<{ player: RoomParticipant; status: string }> }) => {
          setFriends((data.friends || []).filter((f) => f.status === 'accepted'));
        })
        .catch(() => {});
    }
  }, [room, currentProfile.uid, getActiveAuthToken]);

  const joinRoomByCode = useCallback(
    async (rawInput: string) => {
      const cleaned = extractRoomCode(rawInput);
      if (!isValidRoomCode(cleaned)) {
        onError('Please enter a valid 6-character room code.');
        return;
      }

      onError(null);
      setBusyAction('join');
      try {
        const authTok = await getActiveAuthToken();
        const res = await fetch('/api/rooms/join', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authTok}`,
          },
          body: JSON.stringify({ roomCode: cleaned }),
        });

        const data = (await res.json().catch(() => ({}))) as {
          room?: RoomStateView;
          code?: string;
          error?: string;
        };

        if (res.ok && data.room) {
          onRoomChange(data.room);
          return;
        }

        // Fallback to Firestore cross-instance room lookup for signed-in Firebase accounts
        if (data.code === 'INVALID_CODE') {
          if (isFirebaseSessionActive()) {
            const fsResult = await joinRoomViaFirestore(cleaned, currentProfile);
            if (fsResult.ok) {
              onRoomChange(fsResult.room);
              return;
            }
            onError(fsResult.error);
            return;
          }

          onError(
            'Room code not found on this server. Make sure both players use the same app link or sign in with Google.',
          );
          return;
        }

        onError(data.error || 'Could not join room.');
      } catch {
        onError('Connection error while joining room.');
      } finally {
        setBusyAction(null);
      }
    },
    [currentProfile, getActiveAuthToken, onError, onRoomChange],
  );

  // Trigger automatic join when opened from invite notification or ?room=CODE link
  useEffect(() => {
    const code = extractRoomCode(initialJoinCode);
    if (autoJoin && !room && isValidRoomCode(code) && autoJoinedCodeRef.current !== code) {
      autoJoinedCodeRef.current = code;
      void joinRoomByCode(code);
    }
  }, [autoJoin, initialJoinCode, joinRoomByCode, room]);

  // Redundant 2s polling backup for local-server rooms (catches guest join or match start even if WS dropped)
  useEffect(() => {
    if (!room || room.isFirestoreBridged) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const authTok = await getActiveAuthToken();
        const res = await fetch(`/api/rooms/${encodeURIComponent(room.roomId)}`, {
          headers: { Authorization: `Bearer ${authTok}` },
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          room?: RoomStateView;
          match?: OnlineMatchInit | null;
        };
        if (cancelled) return;
        if (data.match) {
          onMatchStarted(data.match);
          return;
        }
        if (data.room) {
          if (data.room.status === 'cancelled') {
            onRoomChange(null);
            onError('Room was closed.');
          } else if (
            data.room.guestId !== room.guestId ||
            data.room.hostId !== room.hostId ||
            data.room.status !== room.status
          ) {
            onRoomChange(data.room);
          }
        }
      } catch {
        // Ignore transient poll errors
      }
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [getActiveAuthToken, onError, onMatchStarted, onRoomChange, room]);

  // Firestore real-time bridge listener for cross-instance rooms (ais-dev <-> ais-pre)
  useEffect(() => {
    if (!room || !isFirebaseSessionActive()) return;

    const unsub = subscribeFirestoreRoom(room.roomCode, async (fsRoom) => {
      if (fsRoom.status === 'cancelled' && room.isFirestoreBridged) {
        onRoomChange(null);
        onError('Host closed the room.');
        return;
      }

      // Host receives guest from another Cloud Run instance via Firestore
      if (
        room.hostId === currentProfile.uid &&
        !room.guestId &&
        fsRoom.guestId &&
        fsRoom.guestId !== currentProfile.uid
      ) {
        onRoomChange({
          ...room,
          guestId: fsRoom.guestId,
          guest: fsRoom.guest,
          isFirestoreBridged: true,
        });
        return;
      }

      // Guest leaves on bridged room
      if (room.isFirestoreBridged && room.hostId === currentProfile.uid && room.guestId && !fsRoom.guestId) {
        onRoomChange({
          ...room,
          guestId: null,
          guest: null,
        });
        return;
      }

      // Guest launches into Firestore-synced match when Host clicks Start Match
      if (
        room.isFirestoreBridged &&
        fsRoom.status === 'playing' &&
        fsRoom.matchId &&
        !startingMatchLockRef.current
      ) {
        startingMatchLockRef.current = true;
        try {
          const loaded = await loadFirestoreMatch(fsRoom.matchId);
          if (loaded) {
            const slot = loaded.playerA === currentProfile.uid ? 'A' : 'B';
            onMatchStarted({
              matchId: loaded.matchId,
              roomId: fsRoom.roomId,
              gameMode: 'private_room',
              entryFee: loaded.entryFee,
              yourSlot: slot,
              reconnectToken: '',
              seq: loaded.seq,
              simulating: false,
              balls: loaded.balls,
              rules: loaded.rules,
              playerA: loaded.playerAInfo,
              playerB: loaded.playerBInfo,
              firestoreSync: true,
              firestoreRoomCode: fsRoom.roomCode,
            });
          }
        } finally {
          startingMatchLockRef.current = false;
        }
      }
    });

    return () => unsub();
  }, [currentProfile.uid, onError, onMatchStarted, onRoomChange, room]);

  const handleCreateRoom = async () => {
    audioEngine.playClick();
    onError(null);
    setBusyAction('create');
    try {
      const authTok = await getActiveAuthToken();
      const res = await fetch('/api/rooms/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authTok}`,
        },
        body: JSON.stringify({ entryFee, gameVariant }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        room?: RoomStateView;
        error?: string;
      };
      if (!res.ok || !data.room) {
        if (isFirebaseSessionActive()) {
          const direct = await createFirestoreRoomDirectly({
            hostProfile: currentProfile,
            entryFee,
            gameVariant,
          });
          onRoomChange(direct);
          return;
        }
        onError(data.error || 'Could not create room.');
        return;
      }

      onRoomChange(data.room);

      if (isFirebaseSessionActive()) {
        void mirrorCreatedRoomToFirestore({
          roomCode: data.room.roomCode,
          hostId: currentProfile.uid,
          entryFee: data.room.entryFee,
          gameVariant: data.room.gameVariant || gameVariant,
        }).catch(() => {});
      }
    } catch {
      if (isFirebaseSessionActive()) {
        try {
          const direct = await createFirestoreRoomDirectly({
            hostProfile: currentProfile,
            entryFee,
            gameVariant,
          });
          onRoomChange(direct);
          return;
        } catch {
          // fall through to connection error
        }
      }
      onError('Connection error while creating room.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    audioEngine.playClick();
    void joinRoomByCode(joinCode);
  };

  const handleLeaveRoom = async () => {
    audioEngine.playClick();
    if (room) {
      try {
        const authTok = await getActiveAuthToken();
        if (!room.isFirestoreBridged) {
          await fetch(`/api/rooms/${encodeURIComponent(room.roomId)}/leave`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${authTok}` },
          }).catch(() => {});
        }
        if (isFirebaseSessionActive()) {
          await leaveFirestoreRoom(room.roomCode, room.hostId === currentProfile.uid).catch(() => {});
        }
      } finally {
        onRoomChange(null);
      }
    }
    onClose();
  };

  const handleStartMatch = async () => {
    if (!room || !room.guestId || busyAction) return;
    audioEngine.playClick();
    onError(null);
    setBusyAction('start');

    try {
      if (room.isFirestoreBridged) {
        startingMatchLockRef.current = true;
        const created = await startFirestoreMatch(
          room.roomCode,
          currentProfile,
          room.guestId,
          room.entryFee,
          room.gameVariant || '8ball',
        );
        onMatchStarted({
          matchId: created.matchId,
          roomId: room.roomId,
          gameMode: 'private_room',
          entryFee: created.entryFee,
          yourSlot: 'A',
          reconnectToken: '',
          seq: created.seq,
          simulating: false,
          balls: created.balls,
          rules: created.rules,
          playerA: created.playerAInfo,
          playerB: created.playerBInfo,
          firestoreSync: true,
          firestoreRoomCode: room.roomCode,
        });
        return;
      }

      const authTok = await getActiveAuthToken();
      const res = await fetch(`/api/rooms/${encodeURIComponent(room.roomId)}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authTok}` },
      });
      const data = (await res.json().catch(() => ({}))) as {
        match?: OnlineMatchInit;
        error?: string;
      };
      if (!res.ok || !data.match) {
        onError(data.error || 'Could not start match.');
        return;
      }
      onMatchStarted(data.match);
    } catch {
      onError('Connection error while starting match.');
    } finally {
      startingMatchLockRef.current = false;
      setBusyAction(null);
    }
  };

  const handleCopyCode = async () => {
    if (!room) return;
    audioEngine.playClick();
    try {
      await navigator.clipboard.writeText(room.roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setShareNote(`Room Code: ${room.roomCode}`);
    }
  };

  const handleShareInvite = async () => {
    if (!room) return;
    audioEngine.playClick();
    const url = `${window.location.origin}/?room=${room.roomCode}`;
    const variantLabel = room.gameVariant === '9ball' ? '9-Ball' : '8-Ball';
    const text = `Join my POOL MASTER ONLINE (${variantLabel}) match! Room Code: ${room.roomCode}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'POOL MASTER ONLINE', text, url });
        return;
      } catch {
        // Fallback to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setShareNote('Invitation link copied to clipboard.');
      setTimeout(() => setShareNote(null), 2500);
    } catch {
      setShareNote(`Share Code: ${room.roomCode}`);
    }
  };

  const handleInviteFriend = (friendUid: string) => {
    if (!room) return;
    audioEngine.playClick();
    wsClient.send({ type: 'room:invite', roomId: room.roomId, friendId: friendUid });
    setInvitedUids((prev) => new Set(prev).add(friendUid));
  };

  const isHost = room?.hostId === currentProfile.uid;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Private Room"
        className="w-full max-w-lg glass-panel rounded-3xl p-6 space-y-5 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <h2 className="font-display text-xl font-bold text-amber-300">
            {room ? 'Private Waiting Room' : 'Mabar Online · Friend Room'}
          </h2>
          <button
            type="button"
            aria-label="Close Private Room"
            onClick={() => void handleLeaveRoom()}
            className="p-2 rounded-xl neu-surface text-slate-300 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div
            role="alert"
            data-testid="room-error-banner"
            className="p-3 rounded-xl bg-red-950/80 border border-red-500/50 text-xs text-red-200 font-medium"
          >
            {error}
          </div>
        )}

        {!room ? (
          <>
            <div className="grid grid-cols-2 gap-2 p-1.5 rounded-2xl neu-inset">
              <button
                type="button"
                onClick={() => {
                  setTab('create');
                  onError(null);
                }}
                className={`py-2 rounded-xl text-xs font-bold transition-all ${
                  tab === 'create' ? 'neu-btn-emerald' : 'text-slate-400 hover:text-white'
                }`}
              >
                CREATE ROOM
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab('join');
                  onError(null);
                }}
                className={`py-2 rounded-xl text-xs font-bold transition-all ${
                  tab === 'join' ? 'neu-btn-emerald' : 'text-slate-400 hover:text-white'
                }`}
              >
                JOIN ROOM
              </button>
            </div>

            {tab === 'create' ? (
              <div className="space-y-4">
                <div>
                  <span className="block text-xs font-semibold text-slate-300 mb-2">
                    Select Billiard Mode
                  </span>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      data-testid="room-variant-8ball"
                      onClick={() => setGameVariant('8ball')}
                      className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                        gameVariant === '8ball'
                          ? 'neu-btn-gold'
                          : 'neu-inset text-slate-300 hover:text-white'
                      }`}
                    >
                      <span className="w-4 h-4 rounded-full bg-zinc-950 text-white text-[10px] flex items-center justify-center border border-white/40">
                        8
                      </span>
                      <span>8-Ball Match</span>
                    </button>
                    <button
                      type="button"
                      data-testid="room-variant-9ball"
                      onClick={() => setGameVariant('9ball')}
                      className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                        gameVariant === '9ball'
                          ? 'neu-btn-gold'
                          : 'neu-inset text-slate-300 hover:text-white'
                      }`}
                    >
                      <span className="w-4 h-4 rounded-full bg-yellow-400 text-slate-950 text-[10px] flex items-center justify-center font-extrabold">
                        9
                      </span>
                      <span>9-Ball Match</span>
                    </button>
                  </div>
                </div>

                <div>
                  <span className="block text-xs font-semibold text-slate-300 mb-2">
                    Select Table Stake (Virtual Coins)
                  </span>
                  <div className="grid grid-cols-4 gap-2">
                    {[0, 100, 500, 1000].map((fee) => (
                      <button
                        key={fee}
                        type="button"
                        disabled={currentProfile.coins < fee}
                        onClick={() => setEntryFee(fee)}
                        className={`py-2.5 rounded-xl text-xs font-mono-tabular font-bold transition-all disabled:opacity-40 ${
                          entryFee === fee
                            ? 'neu-btn-gold'
                            : 'neu-inset text-slate-200 hover:border-amber-500/40'
                        }`}
                      >
                        {fee === 0 ? 'Friendly' : `${fee}`}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void handleCreateRoom()}
                  data-testid="create-room-btn"
                  className="w-full py-3 rounded-2xl neu-btn-emerald disabled:opacity-60 font-bold text-sm flex items-center justify-center gap-2"
                >
                  {busyAction === 'create' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Creating Room...</span>
                    </>
                  ) : (
                    <span>Generate 6-Character Room Code</span>
                  )}
                </button>
              </div>
            ) : (
              <form onSubmit={handleJoinSubmit} className="space-y-4">
                <div>
                  <label htmlFor="room-code-input" className="block text-xs font-semibold text-slate-300 mb-2">
                    Enter 6-Character Room Code or Paste Invite Link
                  </label>
                  <input
                    id="room-code-input"
                    type="text"
                    value={joinCode}
                    onChange={(e) => setJoinCode(extractRoomCode(e.target.value))}
                    placeholder="E.G. K7M9P2"
                    className="w-full px-4 py-3 rounded-2xl neu-inset text-center font-mono-tabular text-xl tracking-[0.25em] font-bold text-amber-300 uppercase focus:outline-none focus:border-amber-400"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!isValidRoomCode(joinCode) || busyAction !== null}
                  data-testid="join-room-btn"
                  className="w-full py-3 rounded-2xl neu-btn-gold disabled:opacity-50 font-bold text-sm flex items-center justify-center gap-2"
                >
                  {busyAction === 'join' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Joining Room...</span>
                    </>
                  ) : (
                    <span>JOIN ROOM</span>
                  )}
                </button>
              </form>
            )}
          </>
        ) : (
          <div className="space-y-5">
            {/* Room Code Display */}
            <div className="neu-inset rounded-2xl p-4 text-center space-y-2.5">
              <div className="text-xs text-slate-300 font-medium">
                {room.gameVariant === '9ball' ? '9-Ball' : '8-Ball'} ·{' '}
                {room.entryFee > 0 ? `Stake ${room.entryFee} Coins` : 'Friendly Match'}
              </div>
              <div
                data-testid="room-code-display"
                className="font-mono-tabular text-3xl font-extrabold tracking-[0.28em] text-amber-300"
              >
                {room.roomCode}
              </div>
              <div className="flex items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void handleCopyCode()}
                  className="px-3.5 py-1.5 rounded-xl neu-surface text-xs font-semibold flex items-center gap-1.5 text-slate-200 hover:text-white"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy Code'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleShareInvite()}
                  className="px-3.5 py-1.5 rounded-xl neu-surface text-xs font-semibold flex items-center gap-1.5 text-amber-200 hover:text-amber-100"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Share Link</span>
                </button>
              </div>
              {shareNote && <p className="text-[11px] text-emerald-300">{shareNote}</p>}
            </div>

            {/* Host vs Guest Cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="neu-surface rounded-2xl p-3.5 flex flex-col items-center text-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Host</span>
                {room.host && (
                  <>
                    <PlayerAvatar
                      avatarId={room.host.avatar}
                      frameId={room.host.frame}
                      username={room.host.username}
                      size="lg"
                      online={room.host.online}
                    />
                    <div className="text-xs font-bold text-white truncate max-w-full">{room.host.username}</div>
                    <div className="text-[11px] text-slate-400 font-mono-tabular">Elo {room.host.rating}</div>
                  </>
                )}
              </div>

              <div className="neu-surface rounded-2xl p-3.5 flex flex-col items-center justify-center text-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">Opponent</span>
                {room.guest ? (
                  <>
                    <PlayerAvatar
                      avatarId={room.guest.avatar}
                      frameId={room.guest.frame}
                      username={room.guest.username}
                      size="lg"
                      online={room.guest.online}
                    />
                    <div className="text-xs font-bold text-white truncate max-w-full">{room.guest.username}</div>
                    <div className="text-[11px] text-slate-400 font-mono-tabular">Elo {room.guest.rating}</div>
                  </>
                ) : (
                  <div className="py-5 space-y-1">
                    <div className="text-xs font-semibold text-slate-300">Waiting for Opponent</div>
                    <div className="text-[11px] text-slate-500">Share code above</div>
                  </div>
                )}
              </div>
            </div>

            {/* Invite Online Friends List */}
            {isHost && !room.guest && friends.length > 0 && !room.isFirestoreBridged && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-300">Invite Online Friends</div>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {friends.map((f) => (
                    <div
                      key={f.player.uid}
                      className="flex items-center justify-between p-2 rounded-lg bg-[#07150f] border border-white/10"
                    >
                      <div className="flex items-center gap-2">
                        <PlayerAvatar avatarId={f.player.avatar} username={f.player.username} size="sm" online={f.player.online} />
                        <span className="text-xs font-medium">{f.player.username}</span>
                      </div>
                      <button
                        type="button"
                        disabled={!f.player.online || invitedUids.has(f.player.uid)}
                        onClick={() => handleInviteFriend(f.player.uid)}
                        className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-45 text-white text-[11px] font-semibold flex items-center gap-1"
                      >
                        <UserPlus className="w-3 h-3" />
                        <span>{invitedUids.has(f.player.uid) ? 'Sent' : 'Invite'}</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action Footer */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => void handleLeaveRoom()}
                className="flex-1 py-2.5 rounded-2xl neu-surface text-slate-200 hover:text-white font-semibold text-sm"
              >
                Leave Room
              </button>

              {isHost ? (
                <button
                  type="button"
                  disabled={!room.guest || busyAction !== null}
                  onClick={() => void handleStartMatch()}
                  data-testid="start-room-match-btn"
                  className="flex-1 py-2.5 rounded-2xl neu-btn-gold disabled:opacity-45 font-bold text-sm flex items-center justify-center gap-1.5"
                >
                  {busyAction === 'start' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Starting...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      <span>Start Match</span>
                    </>
                  )}
                </button>
              ) : (
                <div className="flex-1 py-2.5 rounded-2xl neu-inset text-center text-xs text-emerald-300 font-medium">
                  Waiting for Host to start...
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
