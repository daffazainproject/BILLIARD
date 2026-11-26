export type GameVariant = '8ball' | '9ball';
export type AiDifficulty = 'club' | 'semipro' | 'pro';
export type BallGroup = 'cue' | 'solid' | 'stripe' | 'eight';

export interface CueStats {
  force: number;   // 1..100 shot velocity bonus
  aim: number;     // 1..100 guideline length & ghost visibility
  spin: number;    // 1..100 spin curve & draw/follow response
  control: number; // 1..100 reduced squirt & precision
  tier: 'Standard' | 'Club' | 'Tour' | 'Pro' | 'Master' | 'Grandmaster';
}

export interface TableMeta {
  railTone: string;
  feltGlow: string;
  trimTone: string;
}

export interface BallState {
  id: number;
  number: number; // 0 = cue, 1..7 = solid, 8 = eight, 9..15 = stripe
  group: BallGroup;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spinX: number; // -1..1 (left/right english)
  spinY: number; // -1..1 (back/top spin)
  angularZ: number;
  pocketed: boolean;
  pocketAnimProgress: number; // 0 -> 1
  pocketedInPocketId: number | null;
  rollPhase: number;
  rollDirX: number;
  rollDirY: number;
}

export interface PocketDef {
  id: number;
  x: number;
  y: number;
  radius: number;
  isCorner: boolean;
}

export interface ShotInput {
  angle: number; // radians
  power: number; // 0..1
  spinX: number; // -1..1
  spinY: number; // -1..1
  cueBallPos?: { x: number; y: number };
  seq?: number;
  cueId?: string;
}

export interface PhysicsEvent {
  type: 'ball' | 'cushion' | 'pocket' | 'cue';
  intensity: number; // 0..1
  x: number;
  y: number;
  ballId?: number;
  pocketId?: number;
}

export interface ShotTelemetry {
  firstContactBallId: number | null;
  pocketedBallIds: number[];
  railContactAfterFirstHit: boolean;
  cushionHitCount: number;
}

export type GamePhase = 'break' | 'open' | 'assigned' | 'eight_ball' | 'nine_ball' | 'gameover';
export type PlayerSlot = 'A' | 'B';
export type BallSuit = 'solid' | 'stripe' | null;

export interface RuleOptions {
  foulOnBreakScratchHeadstring: boolean;
  loseOnEarlyEightBall: boolean;
  loseOnEightBallScratch: boolean;
}

export interface MatchRulesState {
  gameVariant: GameVariant;
  phase: GamePhase;
  currentTurn: PlayerSlot;
  groupA: BallSuit;
  groupB: BallSuit;
  targetBallNumber: number | null;
  ballInHand: boolean;
  headstringOnly: boolean;
  isBreakShot: boolean;
  foulReason: string | null;
  lastEventMessage: string | null;
  winner: PlayerSlot | null;
  winReason: string | null;
  shotCountA: number;
  shotCountB: number;
  pottedCountA: number;
  pottedCountB: number;
  turnNumber: number;
}

export interface AimPrediction {
  ghostX: number;
  ghostY: number;
  hitType: 'ball' | 'cushion';
  targetBallId: number | null;
  targetDirX: number;
  targetDirY: number;
  cueDeflectX: number;
  cueDeflectY: number;
  bounceDirX: number;
  bounceDirY: number;
  isLegalTarget: boolean;
}

export interface ShopItemDef {
  id: string;
  category: 'cue' | 'table' | 'avatar' | 'frame' | 'effect';
  name: string;
  description: string;
  price: number;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  imageUrl?: string;
  cueStats?: CueStats;
  tableMeta?: TableMeta;
}

export interface UserProfile {
  uid: string;
  playerId: string;
  username: string;
  avatar: string;
  frame: string;
  equippedCue: string;
  equippedTable: string;
  equippedEffect: string;
  ownedItems: string[];
  level: number;
  xp: number;
  coins: number;
  rating: number;
  wins: number;
  losses: number;
  matches: number;
  dailyStreak: number;
  lastDailyClaim: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserSettings {
  musicEnabled: boolean;
  sfxEnabled: boolean;
  vibrationEnabled: boolean;
  graphicsQuality: 'low' | 'medium' | 'high';
  language: 'en' | 'id';
  sensitivity: number;
}
