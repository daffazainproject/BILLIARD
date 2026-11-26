import React, { useCallback, useEffect, useState } from 'react';
import { Check, Search, Trash2, UserPlus, X } from 'lucide-react';
import { audioEngine } from '../services/audio.ts';
import { PlayerAvatar } from './PlayerAvatar.tsx';

interface FriendPlayer {
  uid: string;
  playerId: string;
  username: string;
  avatar: string;
  frame: string;
  level: number;
  rating: number;
  online: boolean;
}

interface FriendEntry {
  friendshipId: string;
  status: 'pending' | 'accepted';
  direction: 'incoming' | 'outgoing';
  player: FriendPlayer;
}

interface FriendsModalProps {
  token: string;
  onInviteToPrivateRoom: () => void;
  onClose: () => void;
}

export const FriendsModal: React.FC<FriendsModalProps> = ({
  token,
  onInviteToPrivateRoom,
  onClose,
}) => {
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FriendPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadFriends = useCallback(async () => {
    try {
      const res = await fetch('/api/friends', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = (await res.json()) as { friends: FriendEntry[] };
        setFriends(data.friends || []);
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  const searchPlayers = useCallback(async (q: string) => {
    try {
      const res = await fetch(`/api/players/search?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { players: FriendPlayer[] };
        setSearchResults(data.players || []);
      }
    } catch {
      // Ignore network hiccup
    }
  }, [token]);

  useEffect(() => {
    void loadFriends();
    void searchPlayers('');
  }, [loadFriends, searchPlayers]);

  const handleAddFriend = async (friendId: string) => {
    audioEngine.playClick();
    setFeedback(null);
    const res = await fetch('/api/friends/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ friendId }),
    });
    if (res.ok) {
      setFeedback('Friend request sent.');
      void loadFriends();
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setFeedback(err.error || 'Could not send request.');
    }
  };

  const handleRespond = async (friendshipId: string, accept: boolean) => {
    audioEngine.playClick();
    await fetch('/api/friends/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ friendshipId, accept }),
    });
    void loadFriends();
  };

  const handleRemove = async (friendshipId: string) => {
    audioEngine.playClick();
    await fetch('/api/friends/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ friendshipId }),
    });
    void loadFriends();
  };

  const friendUids = new Set(friends.map((f) => f.player.uid));

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Friends"
        className="w-full max-w-2xl bg-[#0b2117] border border-amber-500/35 rounded-2xl p-6 shadow-2xl space-y-5 max-h-[88vh] flex flex-col"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <h2 className="font-display text-xl font-bold text-amber-300">Club Friends</h2>
          <button
            type="button"
            aria-label="Close Friends"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Players */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void searchPlayers(searchQuery);
          }}
          className="flex gap-2"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search username or Player ID (e.g. PM-...)..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#07150f] border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
          >
            Search
          </button>
        </form>

        {feedback && (
          <div className="text-xs text-emerald-300 bg-emerald-950/60 border border-emerald-500/30 rounded-lg px-3 py-2">
            {feedback}
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-5 pr-1">
          {/* Friend List & Requests */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Your Friends & Requests ({friends.length})
            </h3>
            {loading ? (
              <div className="text-xs text-slate-400 py-3">Loading friends...</div>
            ) : friends.length === 0 ? (
              <div className="text-xs text-slate-400 py-3 bg-[#07150f] rounded-xl p-4 text-center">
                No friends added yet. Search online players below to connect!
              </div>
            ) : (
              <div className="space-y-2">
                {friends.map((entry) => (
                  <div
                    key={entry.friendshipId}
                    className="flex items-center justify-between p-3 rounded-xl bg-[#07150f] border border-white/10"
                  >
                    <div className="flex items-center gap-3">
                      <PlayerAvatar
                        avatarId={entry.player.avatar}
                        frameId={entry.player.frame}
                        username={entry.player.username}
                        size="sm"
                        online={entry.player.online}
                      />
                      <div>
                        <div className="text-sm font-bold text-white flex items-center gap-2">
                          <span>{entry.player.username}</span>
                          <span className="text-[11px] font-mono-tabular text-amber-300">
                            Elo {entry.player.rating}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {entry.status === 'accepted'
                            ? entry.player.online
                              ? 'Online'
                              : 'Offline'
                            : entry.direction === 'incoming'
                              ? 'Incoming Friend Request'
                              : 'Request Pending'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {entry.status === 'pending' && entry.direction === 'incoming' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleRespond(entry.friendshipId, true)}
                            className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Accept</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRespond(entry.friendshipId, false)}
                            className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-slate-200 text-xs"
                          >
                            Reject
                          </button>
                        </>
                      )}

                      {entry.status === 'accepted' && (
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onInviteToPrivateRoom();
                          }}
                          className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold"
                        >
                          Invite to Play
                        </button>
                      )}

                      <button
                        type="button"
                        aria-label={`Remove ${entry.player.username}`}
                        onClick={() => handleRemove(entry.friendshipId)}
                        className="p-1.5 rounded-lg hover:bg-red-950/60 text-slate-400 hover:text-red-300"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Discovered Online / Searched Players */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Online & Discovered Players ({searchResults.length})
            </h3>
            {searchResults.length === 0 ? (
              <div className="text-xs text-slate-500 py-2">No matching players found right now.</div>
            ) : (
              <div className="space-y-2">
                {searchResults.map((player) => (
                  <div
                    key={player.uid}
                    className="flex items-center justify-between p-3 rounded-xl bg-[#07150f] border border-white/10"
                  >
                    <div className="flex items-center gap-3">
                      <PlayerAvatar
                        avatarId={player.avatar}
                        frameId={player.frame}
                        username={player.username}
                        size="sm"
                        online={player.online}
                      />
                      <div>
                        <div className="text-sm font-bold text-white">{player.username}</div>
                        <div className="text-[11px] font-mono-tabular text-slate-400">
                          {player.playerId} · Elo {player.rating} · {player.online ? 'Online' : 'Offline'}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={friendUids.has(player.uid)}
                      onClick={() => handleAddFriend(player.uid)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-45 text-white text-xs font-bold flex items-center gap-1"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>{friendUids.has(player.uid) ? 'Added' : 'Add Friend'}</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
