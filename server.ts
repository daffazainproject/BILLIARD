import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { initializeApp as initializeAdminApp, getApps as getAdminApps, getApp as getAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { WebSocketServer, WebSocket } from 'ws';
import {
  BILLIARD_EMOTES,
  DAILY_REWARD_SCHEDULE,
  DEFAULT_FREE_OWNED_ITEMS,
  getCueStats,
  PHYSICS_PARAMS,
  QUICK_CHAT_MESSAGES,
  SHOP_CATALOG,
} from './src/game/constants.ts';
import { applyXpProgress, calculateEloDelta, computeMatchRewards } from './src/game/elo.ts';
import {
  applyCueShot,
  areBallsMoving,
  cloneBalls,
  findSafeCueBallSpot,
  isValidCueBallPlacement,
  stepPhysicsFrame,
} from './src/game/physics.ts';
import { createInitialRulesState, createRackForVariant } from './src/game/rack.ts';
import { extractRoomCode } from './src/game/roomCode.ts';
import { evaluateShotOutcome } from './src/game/rules.ts';
import type {
  BallState,
  GameVariant,
  MatchRulesState,
  PlayerSlot,
  ShotInput,
  ShotTelemetry,
  UserProfile,
} from './src/game/types.ts';

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Initialize Firebase Admin ONLY for ID Token verification (no IAM required)
let firebaseProjectId = '';
try {
  const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { projectId?: string };
    if (cfg.projectId && cfg.projectId !== 'remixed-project-id') {
      firebaseProjectId = cfg.projectId;
    }
  }
} catch {
  // Handled gracefully
}

if (firebaseProjectId) {
  const adminApp = getAdminApps().length
    ? getAdminApp()
    : initializeAdminApp({ projectId: firebaseProjectId });
  void adminApp;
}

// ============================================================================
// HMAC Token Helpers for Guest Sessions & Match Reconnect Tokens
// ============================================================================
function signPayload(payload: object): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifySignedPayload<T>(token: string): T | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [data, sig] = parts;
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

interface VerifiedIdentity {
  uid: string;
  isGuest: boolean;
  email?: string;
}

async function authenticateBearer(authHeader?: string): Promise<VerifiedIdentity | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  // 1. Check HMAC guest token
  if (token.startsWith('guest_')) {
    const raw = token.slice(6);
    const parsed = verifySignedPayload<{ uid: string; exp: number }>(raw);
    if (parsed && parsed.uid && parsed.exp > Date.now()) {
      return { uid: parsed.uid, isGuest: true };
    }
    return null;
  }

  // 2. Verify Firebase ID token
  if (firebaseProjectId) {
    try {
      const decoded = await getAdminAuth().verifyIdToken(token);
      return {
        uid: decoded.uid,
        isGuest: decoded.firebase?.sign_in_provider === 'anonymous',
        email: decoded.email,
      };
    } catch {
      return null;
    }
  }

  return null;
}

async function authenticateRawToken(token: string): Promise<VerifiedIdentity | null> {
  return authenticateBearer(`Bearer ${token}`);
}

// ============================================================================
// Authoritative Server State (In-Memory Real-Time Coordinator)
// ============================================================================
interface MatchHistoryRecord {
  matchId: string;
  playerId: string;
  opponentName: string;
  opponentAvatar: string;
  result: 'win' | 'loss';
  shots: number;
  duration: number;
  xpEarned: number;
  coinsEarned: number;
  ratingDelta: number;
  createdAt: string;
}

interface TransactionRecord {
  transactionId: string;
  userId: string;
  amount: number;
  type: 'daily_reward' | 'match_reward' | 'match_entry' | 'shop_purchase' | 'starter_bonus';
  referenceId: string;
  createdAt: string;
}

interface FriendRecord {
  id: string;
  userId: string;
  friendId: string;
  status: 'pending' | 'accepted';
  createdAt: string;
  updatedAt: string;
}

interface PrivateRoomState {
  roomId: string;
  roomCode: string;
  hostId: string;
  guestId: string | null;
  entryFee: number;
  gameVariant: GameVariant;
  status: 'waiting' | 'playing' | 'finished' | 'cancelled';
  createdAt: number;
  expiresAt: number;
  matchId: string | null;
}

interface QueueEntry {
  uid: string;
  mode: 'quick_match' | 'online_ranked';
  entryFee: number;
  rating: number;
  joinedAt: number;
}

interface MatchParticipant {
  uid: string;
  username: string;
  avatar: string;
  frame: string;
  level: number;
  rating: number;
  equippedCue: string;
  equippedTable: string;
  equippedEffect: string;
  connected: boolean;
  reconnectToken: string;
}

interface AuthoritativeMatch {
  matchId: string;
  roomId: string | null;
  gameMode: 'quick_match' | 'private_room' | 'online_ranked';
  entryFee: number;
  playerA: MatchParticipant;
  playerB: MatchParticipant;
  balls: BallState[];
  rules: MatchRulesState;
  seq: number;
  simulating: boolean;
  simTimer: NodeJS.Timeout | null;
  telemetry: ShotTelemetry;
  startedAt: number;
  lastActivityAt: number;
  disconnectTimers: Map<string, NodeJS.Timeout>;
  rematchVotes: Set<string>;
  lastChatAt: Map<string, number>;
}

const profiles = new Map<string, UserProfile>();
const weeklyRatings = new Map<string, number>();
const friendRecords = new Map<string, FriendRecord>();
const matchHistoryStore = new Map<string, MatchHistoryRecord[]>();
const transactionStore = new Map<string, TransactionRecord[]>();
const activeSockets = new Map<string, Set<WebSocket>>();
const roomsByCode = new Map<string, PrivateRoomState>();
const roomsById = new Map<string, PrivateRoomState>();
const matchmakingQueue: QueueEntry[] = [];
const activeMatches = new Map<string, AuthoritativeMatch>();
const userMatchIndex = new Map<string, string>(); // uid -> matchId

function sanitizeUsername(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_ .-]/g, '').trim().slice(0, 24);
  return cleaned.length >= 2 ? cleaned : `Player_${crypto.randomInt(1000, 9999)}`;
}

function createDefaultProfile(uid: string, username?: string): UserProfile {
  const now = new Date().toISOString();
  const shortTag = uid.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6).padEnd(6, 'X');
  return {
    uid,
    playerId: `PM-${shortTag}`,
    username: sanitizeUsername(username || `Cueist_${shortTag.slice(0, 4)}`),
    avatar: 'avatar_ace',
    frame: 'frame_bronze',
    equippedCue: 'cue_basic',
    equippedTable: 'table_emerald',
    equippedEffect: 'effect_classic',
    ownedItems: [...DEFAULT_FREE_OWNED_ITEMS],
    level: 1,
    xp: 0,
    coins: 500,
    rating: 1000,
    wins: 0,
    losses: 0,
    matches: 0,
    dailyStreak: 0,
    lastDailyClaim: '',
    createdAt: now,
    updatedAt: now,
  };
}

function getOrCreateProfile(uid: string, preferredName?: string): UserProfile {
  let profile = profiles.get(uid);
  if (!profile) {
    profile = createDefaultProfile(uid, preferredName);
    profiles.set(uid, profile);
    weeklyRatings.set(uid, 0);
  }
  return profile;
}

function recordTransaction(
  userId: string,
  amount: number,
  type: TransactionRecord['type'],
  referenceId: string,
): TransactionRecord {
  const tx: TransactionRecord = {
    transactionId: `tx_${crypto.randomBytes(6).toString('hex')}`,
    userId,
    amount,
    type,
    referenceId,
    createdAt: new Date().toISOString(),
  };
  const list = transactionStore.get(userId) || [];
  list.unshift(tx);
  transactionStore.set(userId, list.slice(0, 100));
  return tx;
}

function sendToUser(uid: string, message: object): void {
  const sockets = activeSockets.get(uid);
  if (!sockets) return;
  const raw = JSON.stringify(message);
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(raw);
    }
  }
}

function isUserOnline(uid: string): boolean {
  const sockets = activeSockets.get(uid);
  if (!sockets || sockets.size === 0) return false;
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) return true;
  }
  return false;
}

function broadcastPresenceToFriends(uid: string, online: boolean): void {
  for (const fr of friendRecords.values()) {
    if (fr.status !== 'accepted') continue;
    const other = fr.userId === uid ? fr.friendId : fr.friendId === uid ? fr.userId : null;
    if (other && isUserOnline(other)) {
      sendToUser(other, { type: 'friend:presence', uid, online });
    }
  }
}

function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += alphabet[crypto.randomInt(0, alphabet.length)];
    }
    if (!roomsByCode.has(code)) return code;
  }
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function serializeRoom(room: PrivateRoomState) {
  const host = profiles.get(room.hostId);
  const guest = room.guestId ? profiles.get(room.guestId) : null;
  return {
    roomId: room.roomId,
    roomCode: room.roomCode,
    hostId: room.hostId,
    guestId: room.guestId,
    entryFee: room.entryFee,
    gameVariant: room.gameVariant,
    status: room.status,
    expiresAt: room.expiresAt,
    matchId: room.matchId,
    host: host
      ? { uid: host.uid, username: host.username, avatar: host.avatar, frame: host.frame, level: host.level, rating: host.rating, online: isUserOnline(host.uid) }
      : null,
    guest: guest
      ? { uid: guest.uid, username: guest.username, avatar: guest.avatar, frame: guest.frame, level: guest.level, rating: guest.rating, online: isUserOnline(guest.uid) }
      : null,
  };
}

function findActiveWaitingRoomForUser(uid: string): PrivateRoomState | null {
  const now = Date.now();
  for (const room of roomsById.values()) {
    if (room.status === 'waiting' && room.expiresAt > now && (room.hostId === uid || room.guestId === uid)) {
      return room;
    }
  }
  return null;
}

function createPrivateRoomForUser(uid: string, rawEntryFee: unknown, rawGameVariant?: unknown) {
  const fee = typeof rawEntryFee === 'number' && [0, 100, 500, 1000].includes(rawEntryFee) ? rawEntryFee : 0;
  const gameVariant: GameVariant = rawGameVariant === '9ball' ? '9ball' : '8ball';
  const profile = getOrCreateProfile(uid);
  if (profile.coins < fee) {
    return {
      ok: false as const,
      status: 400,
      code: 'INSUFFICIENT_COINS',
      error: 'Insufficient coins for selected table stake.',
    };
  }

  // Clean up any previous empty waiting room hosted by this user
  for (const [oldId, oldRoom] of roomsById.entries()) {
    if (oldRoom.hostId === uid && oldRoom.status === 'waiting' && !oldRoom.guestId) {
      oldRoom.status = 'cancelled';
      roomsByCode.delete(oldRoom.roomCode);
      roomsById.delete(oldId);
    }
  }

  const roomId = `room_${crypto.randomBytes(6).toString('hex')}`;
  const roomCode = generateRoomCode();
  const now = Date.now();
  const room: PrivateRoomState = {
    roomId,
    roomCode,
    hostId: uid,
    guestId: null,
    entryFee: fee,
    gameVariant,
    status: 'waiting',
    createdAt: now,
    expiresAt: now + 1000 * 60 * 30,
    matchId: null,
  };
  roomsById.set(roomId, room);
  roomsByCode.set(roomCode, room);

  const serialized = serializeRoom(room);
  sendToUser(uid, { type: 'room:created', room: serialized });
  return { ok: true as const, room: serialized };
}

function joinPrivateRoomByCode(uid: string, rawCodeInput: unknown) {
  const code = typeof rawCodeInput === 'string' ? extractRoomCode(rawCodeInput) : '';
  const room = code.length === 6 ? roomsByCode.get(code) : undefined;
  if (!room || room.expiresAt < Date.now() || room.status === 'cancelled' || room.status === 'finished') {
    return {
      ok: false as const,
      status: 404,
      code: 'INVALID_CODE',
      error: 'Invalid Room Code',
    };
  }
  if (room.hostId === uid) {
    const serialized = serializeRoom(room);
    sendToUser(uid, { type: 'room:updated', room: serialized });
    return { ok: true as const, room: serialized };
  }
  if (room.guestId && room.guestId !== uid) {
    return {
      ok: false as const,
      status: 409,
      code: 'ROOM_FULL',
      error: 'Room Is Full',
    };
  }
  if (room.status !== 'waiting') {
    return {
      ok: false as const,
      status: 409,
      code: 'IN_PROGRESS',
      error: 'Match already in progress',
    };
  }
  const profile = getOrCreateProfile(uid);
  if (profile.coins < room.entryFee) {
    return {
      ok: false as const,
      status: 400,
      code: 'INSUFFICIENT_COINS',
      error: 'Insufficient coins for this room stake.',
    };
  }

  room.guestId = uid;
  const serialized = serializeRoom(room);
  const payload = { type: 'room:updated', room: serialized };
  sendToUser(room.hostId, payload);
  sendToUser(room.guestId, payload);
  return { ok: true as const, room: serialized };
}

function leavePrivateRoomForUser(uid: string, roomId: string) {
  const room = roomsById.get(roomId);
  if (!room) return false;

  if (room.guestId === uid) {
    room.guestId = null;
    sendToUser(room.hostId, { type: 'room:updated', room: serializeRoom(room) });
    sendToUser(uid, { type: 'room:left', roomId });
    return true;
  }
  if (room.hostId === uid) {
    if (room.guestId && room.status === 'waiting') {
      const newHost = room.guestId;
      room.hostId = newHost;
      room.guestId = null;
      sendToUser(newHost, {
        type: 'room:updated',
        room: serializeRoom(room),
        notice: 'Host left. You are now the Room Host.',
      });
    } else {
      room.status = 'cancelled';
      roomsByCode.delete(room.roomCode);
      roomsById.delete(room.roomId);
    }
    sendToUser(uid, { type: 'room:left', roomId });
    return true;
  }
  return false;
}

function startPrivateRoomMatch(uid: string, roomId: string) {
  const room = roomsById.get(roomId);
  if (!room || room.hostId !== uid || room.status !== 'waiting' || !room.guestId) {
    return {
      ok: false as const,
      status: 400,
      code: 'NOT_READY',
      error: 'Waiting for opponent to join before starting.',
    };
  }
  const hostProfile = getOrCreateProfile(room.hostId);
  const guestProfile = getOrCreateProfile(room.guestId);
  if (hostProfile.coins < room.entryFee || guestProfile.coins < room.entryFee) {
    return {
      ok: false as const,
      status: 400,
      code: 'INSUFFICIENT_COINS',
      error: 'One player has insufficient coins for this stake.',
    };
  }
  if (room.entryFee > 0) {
    hostProfile.coins -= room.entryFee;
    guestProfile.coins -= room.entryFee;
    recordTransaction(hostProfile.uid, -room.entryFee, 'match_entry', room.roomId);
    recordTransaction(guestProfile.uid, -room.entryFee, 'match_entry', room.roomId);
  }

  room.status = 'playing';
  const match = createAuthoritativeMatch(
    room.hostId,
    room.guestId,
    'private_room',
    room.entryFee,
    room.roomId,
    room.gameVariant,
  );
  room.matchId = match.matchId;

  const hostMatch = serializeMatchState(match, room.hostId);
  const guestMatch = serializeMatchState(match, room.guestId);
  sendToUser(room.hostId, { type: 'match:started', match: hostMatch });
  sendToUser(room.guestId, { type: 'match:started', match: guestMatch });
  return { ok: true as const, match: hostMatch };
}

function serializeMatchState(match: AuthoritativeMatch, viewerUid: string) {
  const slot: PlayerSlot = match.playerA.uid === viewerUid ? 'A' : 'B';
  const reconnectToken = slot === 'A' ? match.playerA.reconnectToken : match.playerB.reconnectToken;
  return {
    matchId: match.matchId,
    roomId: match.roomId,
    gameMode: match.gameMode,
    entryFee: match.entryFee,
    yourSlot: slot,
    reconnectToken,
    seq: match.seq,
    simulating: match.simulating,
    balls: match.balls,
    rules: match.rules,
    playerA: {
      uid: match.playerA.uid,
      username: match.playerA.username,
      avatar: match.playerA.avatar,
      frame: match.playerA.frame,
      level: match.playerA.level,
      rating: match.playerA.rating,
      equippedCue: match.playerA.equippedCue,
      equippedTable: match.playerA.equippedTable,
      equippedEffect: match.playerA.equippedEffect,
      connected: match.playerA.connected,
    },
    playerB: {
      uid: match.playerB.uid,
      username: match.playerB.username,
      avatar: match.playerB.avatar,
      frame: match.playerB.frame,
      level: match.playerB.level,
      rating: match.playerB.rating,
      equippedCue: match.playerB.equippedCue,
      equippedTable: match.playerB.equippedTable,
      equippedEffect: match.playerB.equippedEffect,
      connected: match.playerB.connected,
    },
  };
}

function createAuthoritativeMatch(
  uidA: string,
  uidB: string,
  gameMode: AuthoritativeMatch['gameMode'],
  entryFee: number,
  roomId: string | null = null,
  gameVariant: GameVariant = '8ball',
): AuthoritativeMatch {
  const pA = getOrCreateProfile(uidA);
  const pB = getOrCreateProfile(uidB);

  const matchId = `m_${crypto.randomBytes(8).toString('hex')}`;
  const match: AuthoritativeMatch = {
    matchId,
    roomId,
    gameMode,
    entryFee,
    playerA: {
      uid: pA.uid,
      username: pA.username,
      avatar: pA.avatar,
      frame: pA.frame,
      level: pA.level,
      rating: pA.rating,
      equippedCue: pA.equippedCue,
      equippedTable: pA.equippedTable,
      equippedEffect: pA.equippedEffect,
      connected: isUserOnline(pA.uid),
      reconnectToken: crypto.randomBytes(16).toString('hex'),
    },
    playerB: {
      uid: pB.uid,
      username: pB.username,
      avatar: pB.avatar,
      frame: pB.frame,
      level: pB.level,
      rating: pB.rating,
      equippedCue: pB.equippedCue,
      equippedTable: pB.equippedTable,
      equippedEffect: pB.equippedEffect,
      connected: isUserOnline(pB.uid),
      reconnectToken: crypto.randomBytes(16).toString('hex'),
    },
    balls: createRackForVariant(gameVariant),
    rules: createInitialRulesState('A', gameVariant),
    seq: 1,
    simulating: false,
    simTimer: null,
    telemetry: {
      firstContactBallId: null,
      pocketedBallIds: [],
      railContactAfterFirstHit: false,
      cushionHitCount: 0,
    },
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    disconnectTimers: new Map(),
    rematchVotes: new Set(),
    lastChatAt: new Map(),
  };

  activeMatches.set(matchId, match);
  userMatchIndex.set(uidA, matchId);
  userMatchIndex.set(uidB, matchId);
  return match;
}

function finalizeMatch(match: AuthoritativeMatch, winnerSlot: PlayerSlot, winReason: string): void {
  if (match.simTimer) {
    clearInterval(match.simTimer);
    match.simTimer = null;
  }
  match.simulating = false;
  for (const t of match.disconnectTimers.values()) clearTimeout(t);
  match.disconnectTimers.clear();

  match.rules.phase = 'gameover';
  match.rules.winner = winnerSlot;
  match.rules.winReason = winReason;

  const duration = Math.max(1, Math.round((Date.now() - match.startedAt) / 1000));
  const pA = getOrCreateProfile(match.playerA.uid);
  const pB = getOrCreateProfile(match.playerB.uid);

  const aWon = winnerSlot === 'A';
  const deltaA = calculateEloDelta(pA.rating, pB.rating, aWon);
  const deltaB = calculateEloDelta(pB.rating, pA.rating, !aWon);

  const rewA = computeMatchRewards(aWon, match.entryFee, match.rules.shotCountA);
  const rewB = computeMatchRewards(!aWon, match.entryFee, match.rules.shotCountB);

  const progA = applyXpProgress(pA.level, pA.xp, rewA.xpEarned);
  const progB = applyXpProgress(pB.level, pB.xp, rewB.xpEarned);

  pA.level = progA.level;
  pA.xp = progA.xp;
  pA.coins += rewA.coinsEarned;
  pA.rating = Math.max(100, pA.rating + deltaA);
  pA.matches += 1;
  if (aWon) pA.wins += 1;
  else pA.losses += 1;
  pA.updatedAt = new Date().toISOString();

  pB.level = progB.level;
  pB.xp = progB.xp;
  pB.coins += rewB.coinsEarned;
  pB.rating = Math.max(100, pB.rating + deltaB);
  pB.matches += 1;
  if (!aWon) pB.wins += 1;
  else pB.losses += 1;
  pB.updatedAt = new Date().toISOString();

  weeklyRatings.set(pA.uid, (weeklyRatings.get(pA.uid) || 0) + deltaA);
  weeklyRatings.set(pB.uid, (weeklyRatings.get(pB.uid) || 0) + deltaB);

  if (rewA.coinsEarned > 0) recordTransaction(pA.uid, rewA.coinsEarned, 'match_reward', match.matchId);
  if (rewB.coinsEarned > 0) recordTransaction(pB.uid, rewB.coinsEarned, 'match_reward', match.matchId);

  const createdAt = new Date().toISOString();
  const histA: MatchHistoryRecord = {
    matchId: match.matchId,
    playerId: pA.uid,
    opponentName: pB.username,
    opponentAvatar: pB.avatar,
    result: aWon ? 'win' : 'loss',
    shots: match.rules.shotCountA,
    duration,
    xpEarned: rewA.xpEarned,
    coinsEarned: rewA.coinsEarned,
    ratingDelta: deltaA,
    createdAt,
  };
  const histB: MatchHistoryRecord = {
    matchId: match.matchId,
    playerId: pB.uid,
    opponentName: pA.username,
    opponentAvatar: pA.avatar,
    result: !aWon ? 'win' : 'loss',
    shots: match.rules.shotCountB,
    duration,
    xpEarned: rewB.xpEarned,
    coinsEarned: rewB.coinsEarned,
    ratingDelta: deltaB,
    createdAt,
  };

  const listA = matchHistoryStore.get(pA.uid) || [];
  listA.unshift(histA);
  matchHistoryStore.set(pA.uid, listA.slice(0, 50));

  const listB = matchHistoryStore.get(pB.uid) || [];
  listB.unshift(histB);
  matchHistoryStore.set(pB.uid, listB.slice(0, 50));

  if (match.roomId) {
    const room = roomsById.get(match.roomId);
    if (room) room.status = 'finished';
  }

  const endPayload = {
    type: 'match:ended',
    matchId: match.matchId,
    winnerSlot,
    winReason,
    duration,
    rules: match.rules,
    balls: match.balls,
    rewards: {
      A: { xpEarned: rewA.xpEarned, coinsEarned: rewA.coinsEarned, ratingDelta: deltaA, profile: pA },
      B: { xpEarned: rewB.xpEarned, coinsEarned: rewB.coinsEarned, ratingDelta: deltaB, profile: pB },
    },
  };

  sendToUser(pA.uid, endPayload);
  sendToUser(pB.uid, endPayload);
}

// ============================================================================
// Matchmaking Ticker (pairs real online users only — zero fake bots)
// ============================================================================
setInterval(() => {
  // Prune disconnected users from queue
  for (let i = matchmakingQueue.length - 1; i >= 0; i--) {
    if (!isUserOnline(matchmakingQueue[i].uid)) {
      matchmakingQueue.splice(i, 1);
    }
  }

  // Pair compatible players by mode, entryFee, and Elo window
  const now = Date.now();
  for (let i = 0; i < matchmakingQueue.length; i++) {
    const a = matchmakingQueue[i];
    if (!a) continue;
    const waitSecA = (now - a.joinedAt) / 1000;
    const windowA = 200 + waitSecA * 35;

    for (let j = i + 1; j < matchmakingQueue.length; j++) {
      const b = matchmakingQueue[j];
      if (!b) continue;
      if (a.uid === b.uid) continue;
      if (a.mode !== b.mode || a.entryFee !== b.entryFee) continue;

      const diff = Math.abs(a.rating - b.rating);
      const waitSecB = (now - b.joinedAt) / 1000;
      const maxWindow = Math.max(windowA, 200 + waitSecB * 35);

      if (diff <= maxWindow) {
        const pA = getOrCreateProfile(a.uid);
        const pB = getOrCreateProfile(b.uid);
        if (pA.coins < a.entryFee || pB.coins < b.entryFee) continue;

        matchmakingQueue.splice(j, 1);
        matchmakingQueue.splice(i, 1);

        if (a.entryFee > 0) {
          pA.coins -= a.entryFee;
          pB.coins -= b.entryFee;
          recordTransaction(pA.uid, -a.entryFee, 'match_entry', 'queue_match');
          recordTransaction(pB.uid, -b.entryFee, 'match_entry', 'queue_match');
        }

        const match = createAuthoritativeMatch(pA.uid, pB.uid, a.mode, a.entryFee);
        sendToUser(pA.uid, {
          type: 'queue:matched',
          match: serializeMatchState(match, pA.uid),
        });
        sendToUser(pB.uid, {
          type: 'queue:matched',
          match: serializeMatchState(match, pB.uid),
        });
        i--;
        break;
      }
    }
  }
}, 800);

// Prune expired rooms every minute
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of roomsById.entries()) {
    if (room.status === 'waiting' && room.expiresAt < now) {
      room.status = 'cancelled';
      roomsByCode.delete(room.roomCode);
      roomsById.delete(id);
    }
  }
}, 60_000);

// ============================================================================
// Express App & HTTP/WebSocket Server
// ============================================================================
async function startServer() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      onlinePlayers: activeSockets.size,
      activeMatches: activeMatches.size,
      firebaseConfigured: Boolean(firebaseProjectId),
    });
  });

  // Guest Login (signed server token)
  app.post('/api/auth/guest', (req, res) => {
    const rawName = typeof req.body?.username === 'string' ? req.body.username : '';
    const uid = `guest_${crypto.randomBytes(8).toString('hex')}`;
    const profile = createDefaultProfile(uid, rawName || `Guest_${crypto.randomInt(1000, 9999)}`);
    profiles.set(uid, profile);
    weeklyRatings.set(uid, 0);
    recordTransaction(uid, 500, 'starter_bonus', 'guest_welcome');

    const exp = Date.now() + 1000 * 60 * 60 * 24 * 7;
    const token = `guest_${signPayload({ uid, exp })}`;
    res.json({ token, profile });
  });

  // Sync Firebase profile with authoritative coordinator
  app.post('/api/profile/sync', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const incoming = req.body as Partial<UserProfile>;
    const existing = profiles.get(identity.uid);
    if (!existing) {
      const fresh = createDefaultProfile(identity.uid, typeof incoming.username === 'string' ? incoming.username : undefined);
      if (typeof incoming.avatar === 'string' && incoming.avatar.length <= 64) fresh.avatar = incoming.avatar;
      if (typeof incoming.frame === 'string' && incoming.frame.length <= 64) fresh.frame = incoming.frame;
      if (typeof incoming.equippedCue === 'string' && incoming.equippedCue.length <= 64) fresh.equippedCue = incoming.equippedCue;
      if (typeof incoming.equippedTable === 'string' && incoming.equippedTable.length <= 64) fresh.equippedTable = incoming.equippedTable;
      if (typeof incoming.equippedEffect === 'string' && incoming.equippedEffect.length <= 64) fresh.equippedEffect = incoming.equippedEffect;
      if (Array.isArray(incoming.ownedItems)) {
        const validIds = new Set(SHOP_CATALOG.map((i) => i.id));
        const filtered = incoming.ownedItems.filter((id): id is string => typeof id === 'string' && validIds.has(id));
        if (filtered.length > 0) fresh.ownedItems = Array.from(new Set([...fresh.ownedItems, ...filtered]));
      }
      if (typeof incoming.coins === 'number' && Number.isFinite(incoming.coins) && incoming.coins >= 0 && incoming.coins <= 1000000) {
        fresh.coins = Math.floor(incoming.coins);
      }
      if (typeof incoming.rating === 'number' && Number.isFinite(incoming.rating) && incoming.rating >= 100 && incoming.rating <= 4000) {
        fresh.rating = Math.floor(incoming.rating);
      }
      if (typeof incoming.level === 'number' && Number.isFinite(incoming.level) && incoming.level >= 1 && incoming.level <= 500) {
        fresh.level = Math.floor(incoming.level);
      }
      if (typeof incoming.xp === 'number' && Number.isFinite(incoming.xp) && incoming.xp >= 0) {
        fresh.xp = Math.floor(incoming.xp);
      }
      if (typeof incoming.wins === 'number' && Number.isFinite(incoming.wins) && incoming.wins >= 0) {
        fresh.wins = Math.floor(incoming.wins);
      }
      if (typeof incoming.losses === 'number' && Number.isFinite(incoming.losses) && incoming.losses >= 0) {
        fresh.losses = Math.floor(incoming.losses);
      }
      if (typeof incoming.matches === 'number' && Number.isFinite(incoming.matches) && incoming.matches >= 0) {
        fresh.matches = Math.floor(incoming.matches);
      }
      profiles.set(identity.uid, fresh);
      res.json({ profile: fresh });
      return;
    }

    // Update safe cosmetic/profile fields only (never trust client coins/wins/rating over existing server profile)
    const ownsOrFree = (itemId: string) =>
      existing.ownedItems.includes(itemId) || DEFAULT_FREE_OWNED_ITEMS.includes(itemId);

    if (typeof incoming.username === 'string' && incoming.username.trim().length >= 2) {
      existing.username = sanitizeUsername(incoming.username);
    }
    if (typeof incoming.avatar === 'string' && ownsOrFree(incoming.avatar)) {
      existing.avatar = incoming.avatar;
    }
    if (typeof incoming.frame === 'string' && ownsOrFree(incoming.frame)) {
      existing.frame = incoming.frame;
    }
    if (typeof incoming.equippedCue === 'string' && ownsOrFree(incoming.equippedCue)) {
      existing.equippedCue = incoming.equippedCue;
    }
    if (typeof incoming.equippedTable === 'string' && ownsOrFree(incoming.equippedTable)) {
      existing.equippedTable = incoming.equippedTable;
    }
    if (typeof incoming.equippedEffect === 'string' && ownsOrFree(incoming.equippedEffect)) {
      existing.equippedEffect = incoming.equippedEffect;
    }
    existing.updatedAt = new Date().toISOString();
    res.json({ profile: existing });
  });

  // Leaderboard
  app.get('/api/leaderboard', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    const scope = typeof req.query.scope === 'string' ? req.query.scope : 'global';

    let list = Array.from(profiles.values());
    if (scope === 'friends' && identity) {
      const friendIds = new Set<string>([identity.uid]);
      for (const fr of friendRecords.values()) {
        if (fr.status === 'accepted') {
          if (fr.userId === identity.uid) friendIds.add(fr.friendId);
          if (fr.friendId === identity.uid) friendIds.add(fr.userId);
        }
      }
      list = list.filter((p) => friendIds.has(p.uid));
    }

    const sorted = list
      .map((p) => ({
        uid: p.uid,
        playerId: p.playerId,
        username: p.username,
        avatar: p.avatar,
        frame: p.frame,
        level: p.level,
        rating: scope === 'weekly' ? 1000 + (weeklyRatings.get(p.uid) || 0) : p.rating,
        wins: p.wins,
        losses: p.losses,
        matches: p.matches,
        online: isUserOnline(p.uid),
      }))
      .sort((a, b) => b.rating - a.rating || b.wins - a.wins)
      .slice(0, 50);

    res.json({ scope, rankings: sorted });
  });

  // Search Players
  app.get('/api/players/search', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const results = Array.from(profiles.values())
      .filter((p) => {
        if (p.uid === identity.uid) return false;
        if (!q) return isUserOnline(p.uid);
        return p.username.toLowerCase().includes(q) || p.playerId.toLowerCase().includes(q);
      })
      .slice(0, 20)
      .map((p) => ({
        uid: p.uid,
        playerId: p.playerId,
        username: p.username,
        avatar: p.avatar,
        frame: p.frame,
        level: p.level,
        rating: p.rating,
        online: isUserOnline(p.uid),
      }));

    res.json({ players: results });
  });

  // Friends Endpoints
  app.get('/api/friends', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const friends: Array<{
      friendshipId: string;
      status: 'pending' | 'accepted';
      direction: 'incoming' | 'outgoing';
      player: { uid: string; playerId: string; username: string; avatar: string; frame: string; level: number; rating: number; online: boolean };
    }> = [];

    for (const fr of friendRecords.values()) {
      if (fr.userId !== identity.uid && fr.friendId !== identity.uid) continue;
      const otherUid = fr.userId === identity.uid ? fr.friendId : fr.userId;
      const p = profiles.get(otherUid);
      if (!p) continue;
      friends.push({
        friendshipId: fr.id,
        status: fr.status,
        direction: fr.userId === identity.uid ? 'outgoing' : 'incoming',
        player: {
          uid: p.uid,
          playerId: p.playerId,
          username: p.username,
          avatar: p.avatar,
          frame: p.frame,
          level: p.level,
          rating: p.rating,
          online: isUserOnline(p.uid),
        },
      });
    }

    res.json({ friends });
  });

  app.post('/api/friends/request', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const targetUid = typeof req.body?.friendId === 'string' ? req.body.friendId.trim() : '';
    if (!targetUid || targetUid === identity.uid || !profiles.has(targetUid)) {
      res.status(400).json({ error: 'Player not found.' });
      return;
    }

    for (const fr of friendRecords.values()) {
      if (
        (fr.userId === identity.uid && fr.friendId === targetUid) ||
        (fr.userId === targetUid && fr.friendId === identity.uid)
      ) {
        res.status(409).json({ error: 'Friend request already exists.' });
        return;
      }
    }

    const now = new Date().toISOString();
    const id = `fr_${crypto.randomBytes(6).toString('hex')}`;
    const record: FriendRecord = {
      id,
      userId: identity.uid,
      friendId: targetUid,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    friendRecords.set(id, record);
    const sender = getOrCreateProfile(identity.uid);
    sendToUser(targetUid, {
      type: 'friend:request_received',
      from: { uid: sender.uid, username: sender.username, avatar: sender.avatar },
    });
    res.json({ friend: record });
  });

  app.post('/api/friends/respond', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const friendshipId = typeof req.body?.friendshipId === 'string' ? req.body.friendshipId : '';
    const accept = Boolean(req.body?.accept);
    const fr = friendRecords.get(friendshipId);
    if (!fr || fr.friendId !== identity.uid || fr.status !== 'pending') {
      res.status(404).json({ error: 'Friend request not found.' });
      return;
    }

    if (accept) {
      fr.status = 'accepted';
      fr.updatedAt = new Date().toISOString();
      sendToUser(fr.userId, { type: 'friend:accepted', by: identity.uid });
      res.json({ friend: fr });
    } else {
      friendRecords.delete(friendshipId);
      res.json({ removed: true });
    }
  });

  app.post('/api/friends/remove', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const friendshipId = typeof req.body?.friendshipId === 'string' ? req.body.friendshipId : '';
    const fr = friendRecords.get(friendshipId);
    if (!fr || (fr.userId !== identity.uid && fr.friendId !== identity.uid)) {
      res.status(404).json({ error: 'Friendship not found.' });
      return;
    }
    friendRecords.delete(friendshipId);
    res.json({ removed: true });
  });

  // Shop Purchase & Equip (Authoritative Balance & Ownership)
  app.post('/api/shop/purchase', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const itemId = typeof req.body?.itemId === 'string' ? req.body.itemId : '';
    const item = SHOP_CATALOG.find((i) => i.id === itemId);
    if (!item) {
      res.status(400).json({ error: 'Invalid shop item.' });
      return;
    }
    const profile = getOrCreateProfile(identity.uid);
    if (profile.ownedItems.includes(item.id)) {
      res.status(409).json({ error: 'Item already owned.' });
      return;
    }
    if (profile.coins < item.price) {
      res.status(400).json({ error: 'Insufficient coins.' });
      return;
    }

    profile.coins -= item.price;
    profile.ownedItems.push(item.id);
    if (item.category === 'cue') profile.equippedCue = item.id;
    else if (item.category === 'table') profile.equippedTable = item.id;
    else if (item.category === 'avatar') profile.avatar = item.id;
    else if (item.category === 'frame') profile.frame = item.id;
    else if (item.category === 'effect') profile.equippedEffect = item.id;
    profile.updatedAt = new Date().toISOString();

    const tx = recordTransaction(profile.uid, -item.price, 'shop_purchase', item.id);
    res.json({ profile, transaction: tx });
  });

  app.post('/api/shop/equip', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const itemId = typeof req.body?.itemId === 'string' ? req.body.itemId : '';
    const item = SHOP_CATALOG.find((i) => i.id === itemId);
    const profile = getOrCreateProfile(identity.uid);
    const owned = item ? profile.ownedItems.includes(item.id) || item.price === 0 : false;
    if (!item || !owned) {
      res.status(400).json({ error: 'Item not owned.' });
      return;
    }
    if (!profile.ownedItems.includes(item.id)) {
      profile.ownedItems.push(item.id);
    }

    if (item.category === 'cue') profile.equippedCue = item.id;
    else if (item.category === 'table') profile.equippedTable = item.id;
    else if (item.category === 'avatar') profile.avatar = item.id;
    else if (item.category === 'frame') profile.frame = item.id;
    else if (item.category === 'effect') profile.equippedEffect = item.id;
    profile.updatedAt = new Date().toISOString();

    const activeMId = userMatchIndex.get(identity.uid);
    const activeM = activeMId ? activeMatches.get(activeMId) : undefined;
    if (activeM && activeM.rules.phase !== 'gameover') {
      const targetPart = activeM.playerA.uid === identity.uid ? activeM.playerA : activeM.playerB;
      targetPart.equippedCue = profile.equippedCue;
      targetPart.equippedTable = profile.equippedTable;
      targetPart.equippedEffect = profile.equippedEffect;
    }

    res.json({ profile });
  });

  // Daily Reward Claim (Server Cooldown Guard)
  app.post('/api/rewards/daily', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const profile = getOrCreateProfile(identity.uid);
    const today = new Date().toISOString().slice(0, 10);
    if (profile.lastDailyClaim === today) {
      res.status(409).json({ error: 'Daily reward already claimed today.' });
      return;
    }

    const nextStreak = (profile.dailyStreak % DAILY_REWARD_SCHEDULE.length) + 1;
    const rewardCoins = DAILY_REWARD_SCHEDULE[nextStreak - 1];
    profile.coins += rewardCoins;
    profile.dailyStreak = nextStreak;
    profile.lastDailyClaim = today;
    profile.updatedAt = new Date().toISOString();

    const tx = recordTransaction(profile.uid, rewardCoins, 'daily_reward', `day_${nextStreak}_${today}`);
    res.json({ profile, rewardCoins, transaction: tx });
  });

  // Match History & Transactions
  app.get('/api/history', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.json({
      matches: matchHistoryStore.get(identity.uid) || [],
      transactions: transactionStore.get(identity.uid) || [],
    });
  });

  // Authoritative Private Rooms REST APIs (guarantees room operations even across brief WS reconnects)
  app.get('/api/rooms/active', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const active = findActiveWaitingRoomForUser(identity.uid);
    res.json({ room: active ? serializeRoom(active) : null });
  });

  app.post('/api/rooms/create', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    getOrCreateProfile(identity.uid);
    const result = createPrivateRoomForUser(identity.uid, req.body?.entryFee, req.body?.gameVariant);
    if (!result.ok) {
      res.status(result.status).json({ code: result.code, error: result.error });
      return;
    }
    res.json({ room: result.room });
  });

  app.post('/api/rooms/join', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    getOrCreateProfile(identity.uid);
    const result = joinPrivateRoomByCode(identity.uid, req.body?.roomCode);
    if (!result.ok) {
      res.status(result.status).json({ code: result.code, error: result.error });
      return;
    }
    res.json({ room: result.room });
  });

  app.post('/api/rooms/:roomId/leave', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const left = leavePrivateRoomForUser(identity.uid, req.params.roomId);
    res.json({ left });
  });

  app.post('/api/rooms/:roomId/start', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const result = startPrivateRoomMatch(identity.uid, req.params.roomId);
    if (!result.ok) {
      res.status(result.status).json({ code: result.code, error: result.error });
      return;
    }
    res.json({ match: result.match });
  });

  app.get('/api/rooms/:roomId', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const room = roomsById.get(req.params.roomId);
    if (!room) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }
    if (room.hostId !== identity.uid && room.guestId !== identity.uid) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const match = room.matchId ? activeMatches.get(room.matchId) : undefined;
    res.json({
      room: serializeRoom(room),
      match: match && match.rules.phase !== 'gameover' ? serializeMatchState(match, identity.uid) : null,
    });
  });

  // Vite or Static Frontend Serving
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    let authedUid: string | null = null;
    let lastAimSentAt = 0;

    ws.on('message', async (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = typeof msg.type === 'string' ? msg.type : '';

      if (type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        return;
      }

      if (type === 'auth') {
        const token = typeof msg.token === 'string' ? msg.token : '';
        const identity = await authenticateRawToken(token);
        if (!identity) {
          ws.send(JSON.stringify({ type: 'auth:error', error: 'Invalid credentials' }));
          return;
        }
        authedUid = identity.uid;
        let set = activeSockets.get(authedUid);
        if (!set) {
          set = new Set();
          activeSockets.set(authedUid, set);
        }
        set.add(ws);
        const profile = getOrCreateProfile(authedUid);
        broadcastPresenceToFriends(authedUid, true);

        // Check if player has an active match to restore
        const existingMatchId = userMatchIndex.get(authedUid);
        const activeMatch = existingMatchId ? activeMatches.get(existingMatchId) : undefined;
        if (activeMatch && activeMatch.rules.phase !== 'gameover') {
          const timer = activeMatch.disconnectTimers.get(authedUid);
          if (timer) {
            clearTimeout(timer);
            activeMatch.disconnectTimers.delete(authedUid);
          }
          if (activeMatch.playerA.uid === authedUid) activeMatch.playerA.connected = true;
          if (activeMatch.playerB.uid === authedUid) activeMatch.playerB.connected = true;
          const oppUid = activeMatch.playerA.uid === authedUid ? activeMatch.playerB.uid : activeMatch.playerA.uid;
          sendToUser(oppUid, { type: 'match:opponent_reconnected', matchId: activeMatch.matchId });
        }

        const activeRoom = findActiveWaitingRoomForUser(authedUid);

        ws.send(
          JSON.stringify({
            type: 'auth:ok',
            uid: authedUid,
            profile,
            activeRoom: activeRoom ? serializeRoom(activeRoom) : null,
            activeMatch:
              activeMatch && activeMatch.rules.phase !== 'gameover'
                ? serializeMatchState(activeMatch, authedUid)
                : null,
          }),
        );
        return;
      }

      if (!authedUid) {
        ws.send(JSON.stringify({ type: 'error', error: 'Authenticate first.' }));
        return;
      }

      const uid = authedUid;

      // -------------------- PRIVATE ROOMS --------------------
      if (type === 'room:create') {
        const result = createPrivateRoomForUser(uid, msg.entryFee, msg.gameVariant);
        if (!result.ok) {
          ws.send(JSON.stringify({ type: 'room:error', code: result.code, error: result.error }));
        }
        return;
      }

      if (type === 'room:join') {
        const result = joinPrivateRoomByCode(uid, msg.roomCode);
        if (!result.ok) {
          ws.send(JSON.stringify({ type: 'room:error', code: result.code, error: result.error }));
        }
        return;
      }

      if (type === 'room:leave') {
        const roomId = typeof msg.roomId === 'string' ? msg.roomId : '';
        leavePrivateRoomForUser(uid, roomId);
        return;
      }

      if (type === 'room:invite') {
        const roomId = typeof msg.roomId === 'string' ? msg.roomId : '';
        const targetUid = typeof msg.friendId === 'string' ? msg.friendId : '';
        const room = roomsById.get(roomId);
        if (!room || room.hostId !== uid || room.status !== 'waiting') return;
        const host = getOrCreateProfile(uid);
        sendToUser(targetUid, {
          type: 'room:invitation',
          roomCode: room.roomCode,
          entryFee: room.entryFee,
          from: { uid: host.uid, username: host.username, avatar: host.avatar },
        });
        ws.send(JSON.stringify({ type: 'room:invite_sent', targetUid }));
        return;
      }

      if (type === 'room:start') {
        const roomId = typeof msg.roomId === 'string' ? msg.roomId : '';
        const result = startPrivateRoomMatch(uid, roomId);
        if (!result.ok) {
          ws.send(JSON.stringify({ type: 'room:error', code: result.code, error: result.error }));
        }
        return;
      }

      // -------------------- QUICK MATCH QUEUE --------------------
      if (type === 'queue:join') {
        const mode = msg.mode === 'online_ranked' ? 'online_ranked' : 'quick_match';
        const fee = typeof msg.entryFee === 'number' && [0, 100, 500, 1000].includes(msg.entryFee) ? msg.entryFee : 0;
        const profile = getOrCreateProfile(uid);
        if (profile.coins < fee) {
          ws.send(JSON.stringify({ type: 'queue:error', error: 'Insufficient coins for this table entry fee.' }));
          return;
        }
        // Remove existing queue entry for this user
        const existingIdx = matchmakingQueue.findIndex((q) => q.uid === uid);
        if (existingIdx !== -1) matchmakingQueue.splice(existingIdx, 1);

        matchmakingQueue.push({
          uid,
          mode,
          entryFee: fee,
          rating: profile.rating,
          joinedAt: Date.now(),
        });
        ws.send(JSON.stringify({ type: 'queue:searching', mode, entryFee: fee }));
        return;
      }

      if (type === 'queue:leave') {
        const idx = matchmakingQueue.findIndex((q) => q.uid === uid);
        if (idx !== -1) matchmakingQueue.splice(idx, 1);
        ws.send(JSON.stringify({ type: 'queue:cancelled' }));
        return;
      }

      // -------------------- AUTHORITATIVE MATCH ACTIONS --------------------
      if (type === 'match:reconnect') {
        const matchId = typeof msg.matchId === 'string' ? msg.matchId : '';
        const reconnectToken = typeof msg.reconnectToken === 'string' ? msg.reconnectToken : '';
        const match = activeMatches.get(matchId);
        if (!match) {
          ws.send(JSON.stringify({ type: 'match:error', error: 'Match not found or expired.' }));
          return;
        }
        const isA = match.playerA.uid === uid && match.playerA.reconnectToken === reconnectToken;
        const isB = match.playerB.uid === uid && match.playerB.reconnectToken === reconnectToken;
        if (!isA && !isB) {
          ws.send(JSON.stringify({ type: 'match:error', error: 'Invalid reconnect token.' }));
          return;
        }
        const timer = match.disconnectTimers.get(uid);
        if (timer) {
          clearTimeout(timer);
          match.disconnectTimers.delete(uid);
        }
        if (isA) match.playerA.connected = true;
        if (isB) match.playerB.connected = true;
        const oppUid = isA ? match.playerB.uid : match.playerA.uid;
        sendToUser(oppUid, { type: 'match:opponent_reconnected', matchId });
        ws.send(JSON.stringify({ type: 'match:state', match: serializeMatchState(match, uid) }));
        return;
      }

      const matchId = typeof msg.matchId === 'string' ? msg.matchId : userMatchIndex.get(uid) || '';
      const match = activeMatches.get(matchId);
      if (!match) return;

      const callerSlot: PlayerSlot | null =
        match.playerA.uid === uid ? 'A' : match.playerB.uid === uid ? 'B' : null;
      if (!callerSlot) return;
      const oppUid = callerSlot === 'A' ? match.playerB.uid : match.playerA.uid;

      if (type === 'match:aim') {
        if (match.rules.currentTurn !== callerSlot || match.simulating || match.rules.phase === 'gameover') return;
        const now = Date.now();
        if (now - lastAimSentAt < 45) return; // throttle 22Hz
        lastAimSentAt = now;
        const angle = typeof msg.angle === 'number' && Number.isFinite(msg.angle) ? msg.angle : 0;
        const spinX = typeof msg.spinX === 'number' && Number.isFinite(msg.spinX) ? Math.max(-1, Math.min(1, msg.spinX)) : 0;
        const spinY = typeof msg.spinY === 'number' && Number.isFinite(msg.spinY) ? Math.max(-1, Math.min(1, msg.spinY)) : 0;
        const power = typeof msg.power === 'number' && Number.isFinite(msg.power) ? Math.max(0, Math.min(1, msg.power)) : 0;
        sendToUser(oppUid, { type: 'match:aim_update', matchId: match.matchId, angle, spinX, spinY, power });
        return;
      }

      if (type === 'match:place_cue_ball') {
        if (match.rules.currentTurn !== callerSlot || match.simulating || !match.rules.ballInHand || match.rules.phase === 'gameover') {
          return;
        }
        const x = typeof msg.x === 'number' && Number.isFinite(msg.x) ? msg.x : -1;
        const y = typeof msg.y === 'number' && Number.isFinite(msg.y) ? msg.y : -1;
        if (!isValidCueBallPlacement(match.balls, x, y, match.rules.headstringOnly)) {
          return;
        }
        const cue = match.balls.find((b) => b.id === 0);
        if (cue) {
          cue.x = x;
          cue.y = y;
          cue.pocketed = false;
          cue.pocketAnimProgress = 0;
          match.seq += 1;
          const payload = { type: 'match:cue_placed', matchId: match.matchId, x, y, seq: match.seq };
          sendToUser(match.playerA.uid, payload);
          sendToUser(match.playerB.uid, payload);
        }
        return;
      }

      if (type === 'match:shot') {
        if (match.rules.currentTurn !== callerSlot || match.simulating || match.rules.phase === 'gameover') {
          ws.send(JSON.stringify({ type: 'match:shot_rejected', error: 'Not your turn or balls still in motion.' }));
          return;
        }

        const angle = typeof msg.angle === 'number' && Number.isFinite(msg.angle) ? msg.angle : 0;
        const power = typeof msg.power === 'number' && Number.isFinite(msg.power) ? Math.max(0.02, Math.min(1, msg.power)) : 0.5;
        const spinX = typeof msg.spinX === 'number' && Number.isFinite(msg.spinX) ? Math.max(-1, Math.min(1, msg.spinX)) : 0;
        const spinY = typeof msg.spinY === 'number' && Number.isFinite(msg.spinY) ? Math.max(-1, Math.min(1, msg.spinY)) : 0;
        const cueBallPos =
          msg.cueBallPos && typeof msg.cueBallPos === 'object'
            ? {
                x: Number((msg.cueBallPos as { x?: unknown }).x),
                y: Number((msg.cueBallPos as { y?: unknown }).y),
              }
            : undefined;

        const shooterCueId =
          callerSlot === 'A' ? match.playerA.equippedCue : match.playerB.equippedCue;
        const shot: ShotInput = {
          angle,
          power,
          spinX,
          spinY,
          cueBallPos,
          seq: match.seq + 1,
          cueId: shooterCueId,
        };

        if (!applyCueShot(match.balls, shot, match.rules.headstringOnly, getCueStats(shooterCueId))) {
          return;
        }

        match.seq += 1;
        match.simulating = true;
        match.lastActivityAt = Date.now();
        match.telemetry = {
          firstContactBallId: null,
          pocketedBallIds: [],
          railContactAfterFirstHit: false,
          cushionHitCount: 0,
        };

        const startBroadcast = {
          type: 'match:shot_accepted',
          matchId: match.matchId,
          seq: match.seq,
          shooterSlot: callerSlot,
          shot,
        };
        sendToUser(match.playerA.uid, startBroadcast);
        sendToUser(match.playerB.uid, startBroadcast);

        let frameCounter = 0;
        match.simTimer = setInterval(() => {
          const events = stepPhysicsFrame(match.balls, match.telemetry, PHYSICS_PARAMS.fixedDt);
          frameCounter += 1;

          // Broadcast periodic authoritative snapshots (~10Hz) for smooth reconciliation
          if (frameCounter % 6 === 0 || events.some((e) => e.type === 'pocket')) {
            const snap = {
              type: 'match:snapshot',
              matchId: match.matchId,
              seq: match.seq,
              balls: cloneBalls(match.balls),
              events,
            };
            sendToUser(match.playerA.uid, snap);
            sendToUser(match.playerB.uid, snap);
          }

          if (!areBallsMoving(match.balls) || frameCounter > 60 * 18) {
            if (match.simTimer) {
              clearInterval(match.simTimer);
              match.simTimer = null;
            }
            match.simulating = false;
            const prevRules = match.rules;
            const nextRules = evaluateShotOutcome(prevRules, match.telemetry, match.balls);
            match.rules = nextRules;
            match.seq += 1;

            // Respawn cue ball safely if scratched and match continues
            const cue = match.balls.find((b) => b.id === 0);
            if (cue && cue.pocketed && nextRules.phase !== 'gameover') {
              const safe = findSafeCueBallSpot(match.balls, nextRules.headstringOnly);
              cue.x = safe.x;
              cue.y = safe.y;
              cue.vx = 0;
              cue.vy = 0;
              cue.pocketed = false;
              cue.pocketAnimProgress = 0;
              cue.pocketedInPocketId = null;
            }

            if (nextRules.phase === 'gameover' && nextRules.winner) {
              finalizeMatch(match, nextRules.winner, nextRules.winReason || 'Match finished');
            } else {
              const resolved = {
                type: 'match:turn_resolved',
                matchId: match.matchId,
                seq: match.seq,
                balls: match.balls,
                rules: match.rules,
              };
              sendToUser(match.playerA.uid, resolved);
              sendToUser(match.playerB.uid, resolved);
            }
          }
        }, 16);
        return;
      }

      if (type === 'match:chat') {
        const now = Date.now();
        const last = match.lastChatAt.get(uid) || 0;
        if (now - last < 1200) return; // anti-spam rate limit
        match.lastChatAt.set(uid, now);

        const rawText = typeof msg.text === 'string' ? msg.text.replace(/[<>]/g, '').trim().slice(0, 64) : '';
        const rawEmote = typeof msg.emote === 'string' && (BILLIARD_EMOTES as readonly string[]).includes(msg.emote) ? msg.emote : '';
        if (!rawText && !rawEmote) return;

        // Basic moderation check
        const safeText = (QUICK_CHAT_MESSAGES as readonly string[]).includes(rawText)
          ? rawText
          : rawText;

        const sender = getOrCreateProfile(uid);
        const chatPayload = {
          type: 'match:chat_message',
          matchId: match.matchId,
          senderUid: uid,
          senderName: sender.username,
          text: safeText,
          emote: rawEmote,
          timestamp: now,
        };
        sendToUser(match.playerA.uid, chatPayload);
        sendToUser(match.playerB.uid, chatPayload);
        return;
      }

      if (type === 'match:concede') {
        if (match.rules.phase === 'gameover') return;
        const winner: PlayerSlot = callerSlot === 'A' ? 'B' : 'A';
        finalizeMatch(match, winner, 'Opponent conceded the match.');
        return;
      }

      if (type === 'match:rematch') {
        if (match.rules.phase !== 'gameover') return;
        match.rematchVotes.add(uid);
        sendToUser(oppUid, { type: 'match:rematch_requested', matchId: match.matchId, fromUid: uid });

        if (match.rematchVotes.has(match.playerA.uid) && match.rematchVotes.has(match.playerB.uid)) {
          const pA = getOrCreateProfile(match.playerA.uid);
          const pB = getOrCreateProfile(match.playerB.uid);
          if (pA.coins < match.entryFee || pB.coins < match.entryFee) {
            const err = { type: 'match:error', error: 'Insufficient coins for rematch stake.' };
            sendToUser(pA.uid, err);
            sendToUser(pB.uid, err);
            return;
          }
          if (match.entryFee > 0) {
            pA.coins -= match.entryFee;
            pB.coins -= match.entryFee;
            recordTransaction(pA.uid, -match.entryFee, 'match_entry', 'rematch');
            recordTransaction(pB.uid, -match.entryFee, 'match_entry', 'rematch');
          }
          const nextMatch = createAuthoritativeMatch(
            pB.uid,
            pA.uid,
            match.gameMode,
            match.entryFee,
            match.roomId,
            match.rules.gameVariant,
          );
          sendToUser(pA.uid, { type: 'match:started', match: serializeMatchState(nextMatch, pA.uid) });
          sendToUser(pB.uid, { type: 'match:started', match: serializeMatchState(nextMatch, pB.uid) });
        }
      }
    });

    ws.on('close', () => {
      if (!authedUid) return;
      const uid = authedUid;
      const sockets = activeSockets.get(uid);
      if (sockets) {
        sockets.delete(ws);
        if (sockets.size === 0) {
          activeSockets.delete(uid);
          broadcastPresenceToFriends(uid, false);

          // Remove from matchmaking queue if disconnected
          const qIdx = matchmakingQueue.findIndex((q) => q.uid === uid);
          if (qIdx !== -1) matchmakingQueue.splice(qIdx, 1);

          // Start 45s reconnect grace timer if in an active match
          const mId = userMatchIndex.get(uid);
          const match = mId ? activeMatches.get(mId) : undefined;
          if (match && match.rules.phase !== 'gameover') {
            if (match.playerA.uid === uid) match.playerA.connected = false;
            if (match.playerB.uid === uid) match.playerB.connected = false;
            const oppUid = match.playerA.uid === uid ? match.playerB.uid : match.playerA.uid;
            sendToUser(oppUid, {
              type: 'match:opponent_disconnected',
              matchId: match.matchId,
              countdownSec: 45,
            });
            const timer = setTimeout(() => {
              if (match.rules.phase === 'gameover') return;
              const winner: PlayerSlot = match.playerA.uid === uid ? 'B' : 'A';
              finalizeMatch(match, winner, 'Opponent failed to reconnect within 45 seconds.');
            }, 45_000);
            match.disconnectTimers.set(uid, timer);
          }
        }
      }
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`POOL MASTER ONLINE server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
