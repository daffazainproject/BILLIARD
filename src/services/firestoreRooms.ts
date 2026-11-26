import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { createInitialRulesState, createRackForVariant } from '../game/rack.ts';
import type {
  BallState,
  GameVariant,
  MatchRulesState,
  PlayerSlot,
  ShotInput,
  UserProfile,
} from '../game/types.ts';
import { auth, db, handleFirestoreError, OperationType } from './firebase.ts';

export interface FirestoreParticipant {
  uid: string;
  username: string;
  avatar: string;
  frame: string;
  level: number;
  rating: number;
  equippedCue: string;
  equippedTable: string;
  equippedEffect: string;
  online: boolean;
  connected: boolean;
}

export interface FirestoreRoomDoc {
  roomId: string;
  roomCode: string;
  hostId: string;
  guestId: string;
  entryFee: number;
  gameVariant?: GameVariant;
  matchId: string;
  status: 'waiting' | 'playing' | 'finished' | 'cancelled';
  createdAt: string;
  expiresAt: string;
}

export interface FirestoreMatchAction {
  type: 'init' | 'aim' | 'place_cue_ball' | 'shot' | 'turn_resolved' | 'concede' | 'chat';
  actorSlot: PlayerSlot;
  seq: number;
  angle?: number;
  power?: number;
  spinX?: number;
  spinY?: number;
  cueId?: string;
  x?: number;
  y?: number;
  cueBallX?: number;
  cueBallY?: number;
  text?: string;
  emote?: string;
  senderUid?: string;
  senderName?: string;
  timestamp?: number;
}

export interface FirestoreMatchDoc {
  matchId: string;
  playerA: string;
  playerB: string;
  gameMode: 'private_room';
  gameVariant?: GameVariant;
  currentTurn: PlayerSlot;
  status: 'active' | 'completed' | 'cancelled';
  winnerId: string;
  createdAt: string;
  endedAt?: string;
  entryFee: number;
  seq: number;
  winReason: string;
  balls: BallState[];
  rules: MatchRulesState;
  lastAction: FirestoreMatchAction;
}

const participantCache = new Map<string, FirestoreParticipant>();

export function isFirebaseSessionActive(): boolean {
  return Boolean(auth.currentUser);
}

export async function fetchFirestoreParticipant(uid: string): Promise<FirestoreParticipant> {
  const cached = participantCache.get(uid);
  if (cached) return cached;

  const userPath = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      const p = snap.data() as Partial<UserProfile>;
      const participant: FirestoreParticipant = {
        uid,
        username: p.username || 'Player',
        avatar: p.avatar || 'avatar_ace',
        frame: p.frame || 'frame_bronze',
        level: typeof p.level === 'number' ? p.level : 1,
        rating: typeof p.rating === 'number' ? p.rating : 1000,
        equippedCue: p.equippedCue || 'cue_basic',
        equippedTable: p.equippedTable || 'table_emerald',
        equippedEffect: p.equippedEffect || 'effect_classic',
        online: true,
        connected: true,
      };
      participantCache.set(uid, participant);
      return participant;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  return {
    uid,
    username: 'Club Player',
    avatar: 'avatar_ace',
    frame: 'frame_bronze',
    level: 1,
    rating: 1000,
    equippedCue: 'cue_basic',
    equippedTable: 'table_emerald',
    equippedEffect: 'effect_classic',
    online: true,
    connected: true,
  };
}

export async function mirrorCreatedRoomToFirestore(params: {
  roomCode: string;
  hostId: string;
  entryFee: number;
  gameVariant?: GameVariant;
}): Promise<boolean> {
  const user = auth.currentUser;
  if (!user || user.uid !== params.hostId) return false;

  const roomId = `room_${params.roomCode}`;
  const path = `rooms/${roomId}`;
  const now = new Date();
  const expires = new Date(now.getTime() + 1000 * 60 * 30);
  const gameVariant: GameVariant = params.gameVariant === '9ball' ? '9ball' : '8ball';

  try {
    const existing = await getDoc(doc(db, 'rooms', roomId));
    if (existing.exists()) {
      return false;
    }

    const roomDoc: FirestoreRoomDoc = {
      roomId,
      roomCode: params.roomCode,
      hostId: user.uid,
      guestId: '',
      entryFee: [0, 100, 500, 1000].includes(params.entryFee) ? params.entryFee : 0,
      gameVariant,
      matchId: '',
      status: 'waiting',
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    };

    await setDoc(doc(db, 'rooms', roomId), roomDoc);
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function createFirestoreRoomDirectly(params: {
  hostProfile: UserProfile;
  entryFee: number;
  gameVariant: GameVariant;
}): Promise<{
  roomId: string;
  roomCode: string;
  hostId: string;
  guestId: string | null;
  entryFee: number;
  gameVariant: GameVariant;
  status: string;
  matchId: string;
  host: FirestoreParticipant;
  guest: null;
  isFirestoreBridged: true;
}> {
  const user = auth.currentUser;
  if (!user) throw new Error('Firebase session not active');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let roomCode = '';
  for (let i = 0; i < 6; i++) {
    roomCode += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  await mirrorCreatedRoomToFirestore({
    roomCode,
    hostId: user.uid,
    entryFee: params.entryFee,
    gameVariant: params.gameVariant,
  });
  const host = await fetchFirestoreParticipant(user.uid);
  return {
    roomId: `room_${roomCode}`,
    roomCode,
    hostId: user.uid,
    guestId: null,
    entryFee: params.entryFee,
    gameVariant: params.gameVariant,
    status: 'waiting',
    matchId: '',
    host,
    guest: null,
    isFirestoreBridged: true,
  };
}

export async function joinRoomViaFirestore(
  roomCode: string,
  currentProfile: UserProfile,
): Promise<
  | {
      ok: true;
      room: {
        roomId: string;
        roomCode: string;
        hostId: string;
        guestId: string | null;
        entryFee: number;
        gameVariant: GameVariant;
        status: string;
        matchId: string;
        host: FirestoreParticipant | null;
        guest: FirestoreParticipant | null;
        isFirestoreBridged: true;
      };
    }
  | { ok: false; code: string; error: string }
> {
  const user = auth.currentUser;
  if (!user) {
    return {
      ok: false,
      code: 'AUTH_REQUIRED',
      error: 'Sign in with Google to join cross-server room codes.',
    };
  }

  const roomId = `room_${roomCode}`;
  const path = `rooms/${roomId}`;
  let data: FirestoreRoomDoc;

  try {
    const snap = await getDoc(doc(db, 'rooms', roomId));
    if (!snap.exists()) {
      return { ok: false, code: 'INVALID_CODE', error: 'Invalid Room Code' };
    }
    data = snap.data() as FirestoreRoomDoc;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (data.status === 'cancelled' || data.status === 'finished') {
    return { ok: false, code: 'INVALID_CODE', error: 'Invalid Room Code' };
  }
  if (new Date(data.expiresAt).getTime() < Date.now()) {
    return { ok: false, code: 'EXPIRED', error: 'Room Code Expired' };
  }
  if (data.status !== 'waiting') {
    return { ok: false, code: 'IN_PROGRESS', error: 'Match already in progress' };
  }
  if (data.guestId && data.guestId !== user.uid && data.hostId !== user.uid) {
    return { ok: false, code: 'ROOM_FULL', error: 'Room Is Full' };
  }
  if (currentProfile.coins < data.entryFee) {
    return { ok: false, code: 'INSUFFICIENT_COINS', error: 'Insufficient coins for this room stake.' };
  }

  if (data.hostId !== user.uid && data.guestId === '') {
    try {
      await updateDoc(doc(db, 'rooms', roomId), { guestId: user.uid });
      data = { ...data, guestId: user.uid };
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  const host = await fetchFirestoreParticipant(data.hostId);
  const guest = data.guestId ? await fetchFirestoreParticipant(data.guestId) : null;

  return {
    ok: true,
    room: {
      roomId: data.roomId,
      roomCode: data.roomCode,
      hostId: data.hostId,
      guestId: data.guestId || null,
      entryFee: data.entryFee,
      gameVariant: data.gameVariant === '9ball' ? '9ball' : '8ball',
      status: data.status,
      matchId: data.matchId || '',
      host,
      guest,
      isFirestoreBridged: true,
    },
  };
}

export function subscribeFirestoreRoom(
  roomCode: string,
  onRoomChange: (room: {
    roomId: string;
    roomCode: string;
    hostId: string;
    guestId: string | null;
    entryFee: number;
    gameVariant: GameVariant;
    status: string;
    matchId: string;
    host: FirestoreParticipant | null;
    guest: FirestoreParticipant | null;
  }) => void,
): Unsubscribe {
  const roomId = `room_${roomCode}`;
  const path = `rooms/${roomId}`;

  return onSnapshot(
    doc(db, 'rooms', roomId),
    async (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as FirestoreRoomDoc;
      const host = await fetchFirestoreParticipant(data.hostId);
      const guest = data.guestId ? await fetchFirestoreParticipant(data.guestId) : null;
      onRoomChange({
        roomId: data.roomId,
        roomCode: data.roomCode,
        hostId: data.hostId,
        guestId: data.guestId || null,
        entryFee: data.entryFee,
        gameVariant: data.gameVariant === '9ball' ? '9ball' : '8ball',
        status: data.status,
        matchId: data.matchId || '',
        host,
        guest,
      });
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    },
  );
}

export async function leaveFirestoreRoom(roomCode: string, isHost: boolean): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  const roomId = `room_${roomCode}`;
  const path = `rooms/${roomId}`;

  try {
    const snap = await getDoc(doc(db, 'rooms', roomId));
    if (!snap.exists()) return;
    const data = snap.data() as FirestoreRoomDoc;
    if (data.status !== 'waiting') return;

    if (isHost && data.hostId === user.uid) {
      await updateDoc(doc(db, 'rooms', roomId), { status: 'cancelled' });
    } else if (!isHost && data.guestId === user.uid) {
      await updateDoc(doc(db, 'rooms', roomId), { guestId: '' });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function startFirestoreMatch(
  roomCode: string,
  hostProfile: UserProfile,
  guestUid: string,
  entryFee: number,
  gameVariant: GameVariant = '8ball',
): Promise<FirestoreMatchDoc & { playerAInfo: FirestoreParticipant; playerBInfo: FirestoreParticipant }> {
  const user = auth.currentUser;
  if (!user || user.uid !== hostProfile.uid) {
    throw new Error('Only the authenticated host can start this match.');
  }

  const matchId = `mf_${roomCode}_${Date.now().toString(36)}`;
  const matchPath = `matches/${matchId}`;
  const roomId = `room_${roomCode}`;
  const roomPath = `rooms/${roomId}`;

  const nowIso = new Date().toISOString();
  const initialMatch: FirestoreMatchDoc = {
    matchId,
    playerA: hostProfile.uid,
    playerB: guestUid,
    gameMode: 'private_room',
    gameVariant,
    currentTurn: 'A',
    status: 'active',
    winnerId: '',
    createdAt: nowIso,
    entryFee,
    seq: 1,
    winReason: '',
    balls: createRackForVariant(gameVariant),
    rules: createInitialRulesState('A', gameVariant),
    lastAction: {
      type: 'init',
      actorSlot: 'A',
      seq: 1,
      timestamp: Date.now(),
    },
  };

  try {
    await setDoc(doc(db, 'matches', matchId), initialMatch);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, matchPath);
  }

  try {
    await updateDoc(doc(db, 'rooms', roomId), {
      status: 'playing',
      matchId,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, roomPath);
  }

  const playerAInfo = await fetchFirestoreParticipant(hostProfile.uid);
  const playerBInfo = await fetchFirestoreParticipant(guestUid);

  return {
    ...initialMatch,
    playerAInfo,
    playerBInfo,
  };
}

export async function loadFirestoreMatch(
  matchId: string,
): Promise<(FirestoreMatchDoc & { playerAInfo: FirestoreParticipant; playerBInfo: FirestoreParticipant }) | null> {
  const path = `matches/${matchId}`;
  try {
    const snap = await getDoc(doc(db, 'matches', matchId));
    if (!snap.exists()) return null;
    const data = snap.data() as FirestoreMatchDoc;
    const [playerAInfo, playerBInfo] = await Promise.all([
      fetchFirestoreParticipant(data.playerA),
      fetchFirestoreParticipant(data.playerB),
    ]);
    return {
      ...data,
      playerAInfo,
      playerBInfo,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeFirestoreMatch(
  matchId: string,
  onMatchUpdate: (matchDoc: FirestoreMatchDoc) => void,
): Unsubscribe {
  const path = `matches/${matchId}`;
  return onSnapshot(
    doc(db, 'matches', matchId),
    (snap) => {
      if (!snap.exists()) return;
      onMatchUpdate(snap.data() as FirestoreMatchDoc);
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    },
  );
}

export async function pushFirestoreMatchAction(
  matchId: string,
  payload: Partial<
    Pick<
      FirestoreMatchDoc,
      'currentTurn' | 'status' | 'winnerId' | 'endedAt' | 'seq' | 'winReason' | 'balls' | 'rules' | 'lastAction'
    >
  >,
): Promise<void> {
  const path = `matches/${matchId}`;
  try {
    await updateDoc(doc(db, 'matches', matchId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function buildShotAction(
  actorSlot: PlayerSlot,
  seq: number,
  shot: ShotInput,
): FirestoreMatchAction {
  return {
    type: 'shot',
    actorSlot,
    seq,
    angle: shot.angle,
    power: shot.power,
    spinX: shot.spinX,
    spinY: shot.spinY,
    ...(shot.cueId ? { cueId: shot.cueId } : {}),
    ...(shot.cueBallPos ? { cueBallX: shot.cueBallPos.x, cueBallY: shot.cueBallPos.y } : {}),
    timestamp: Date.now(),
  };
}
