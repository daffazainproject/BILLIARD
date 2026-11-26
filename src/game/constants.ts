import type { CueStats, PocketDef, RuleOptions, ShopItemDef } from './types.ts';

export const TABLE_WIDTH = 1000;
export const TABLE_HEIGHT = 500;
export const HEADSTRING_X = 250;
export const FOOT_SPOT_X = 735;
export const FOOT_SPOT_Y = 250;

export const BALL_RADIUS = 13.5;
export const BALL_MASS = 1.0;

export const PHYSICS_PARAMS = {
  fixedDt: 1 / 60,
  substeps: 12,
  maxShotSpeed: 1360, // px/sec at 100% power
  minShotSpeed: 85,
  restitutionBall: 0.955,
  restitutionCushion: 0.8,
  rollingDecel: 128, // px/s^2
  linearDamping: 0.993, // applied per 60Hz frame
  stopThreshold: 5.5, // px/sec
  spinDecay: 0.985,
  followSpinFactor: 0.44,
  englishCushionFactor: 0.28,
  cornerJawRadius: 8,
} as const;

export const POCKETS: PocketDef[] = [
  { id: 0, x: 7, y: 7, radius: 26, isCorner: true },
  { id: 1, x: TABLE_WIDTH / 2, y: -5, radius: 24, isCorner: false },
  { id: 2, x: TABLE_WIDTH - 7, y: 7, radius: 26, isCorner: true },
  { id: 3, x: 7, y: TABLE_HEIGHT - 7, radius: 26, isCorner: true },
  { id: 4, x: TABLE_WIDTH / 2, y: TABLE_HEIGHT + 5, radius: 24, isCorner: false },
  { id: 5, x: TABLE_WIDTH - 7, y: TABLE_HEIGHT - 7, radius: 26, isCorner: true },
];

export const CORNER_POCKET_GAP = 35;
export const SIDE_POCKET_GAP = 29;

export const DEFAULT_RULE_OPTIONS: RuleOptions = {
  foulOnBreakScratchHeadstring: true,
  loseOnEarlyEightBall: true,
  loseOnEightBallScratch: true,
};

export const BALL_COLORS: Record<number, { base: string; label: string }> = {
  0: { base: '#f8fafc', label: 'Cue' },
  1: { base: '#eab308', label: 'Yellow Solid' },
  2: { base: '#2563eb', label: 'Blue Solid' },
  3: { base: '#dc2626', label: 'Red Solid' },
  4: { base: '#7c3aed', label: 'Purple Solid' },
  5: { base: '#ea580c', label: 'Orange Solid' },
  6: { base: '#15803d', label: 'Green Solid' },
  7: { base: '#7f1d1d', label: 'Burgundy Solid' },
  8: { base: '#111827', label: '8-Ball' },
  9: { base: '#eab308', label: 'Yellow Stripe' },
  10: { base: '#2563eb', label: 'Blue Stripe' },
  11: { base: '#dc2626', label: 'Red Stripe' },
  12: { base: '#7c3aed', label: 'Purple Stripe' },
  13: { base: '#ea580c', label: 'Orange Stripe' },
  14: { base: '#15803d', label: 'Green Stripe' },
  15: { base: '#7f1d1d', label: 'Burgundy Stripe' },
};

export const AVATAR_ASSETS: Record<string, string> = {
  avatar_ace: '/src/assets/images/avatar_ace_1795666735369.jpg',
  avatar_royale: '/src/assets/images/avatar_royale_1795666736035.jpg',
  avatar_shark: '/src/assets/images/avatar_shark_1795666735119.jpg',
  avatar_master: '/src/assets/images/avatar_master_1795666735925.jpg',
};

export const SHOP_CATALOG: ShopItemDef[] = [
  // Cues (with gameplay specs!)
  {
    id: 'cue_basic',
    category: 'cue',
    name: 'Basic Cue',
    description: 'Balanced club maple shaft for reliable everyday break and control.',
    price: 0,
    primaryColor: '#d6b48a',
    secondaryColor: '#3f2314',
    accentColor: '#cbd5e1',
    cueStats: { force: 58, aim: 54, spin: 50, control: 56, tier: 'Standard' },
  },
  {
    id: 'cue_wooden',
    category: 'cue',
    name: 'Wooden Cue',
    description: 'Hand-oiled American ash grain with dark walnut wrap and crisp feedback.',
    price: 250,
    primaryColor: '#e0b882',
    secondaryColor: '#5c2d16',
    accentColor: '#d97706',
    cueStats: { force: 68, aim: 64, spin: 62, control: 65, tier: 'Club' },
  },
  {
    id: 'cue_premium',
    category: 'cue',
    name: 'Premium Cue',
    description: 'Emerald-inlaid rosewood butt with brushed brass ferrule and high-grip wrap.',
    price: 600,
    primaryColor: '#f3d5a5',
    secondaryColor: '#064e3b',
    accentColor: '#d4af37',
    cueStats: { force: 76, aim: 74, spin: 72, control: 76, tier: 'Tour' },
  },
  {
    id: 'cue_gold',
    category: 'cue',
    name: 'Gold Cue',
    description: '24k gilded championship trim with ivory-tone seasoned hard maple shaft.',
    price: 1200,
    primaryColor: '#fef3c7',
    secondaryColor: '#78350f',
    accentColor: '#fbbf24',
    cueStats: { force: 84, aim: 82, spin: 80, control: 82, tier: 'Pro' },
  },
  {
    id: 'cue_carbon',
    category: 'cue',
    name: 'Carbon Cue',
    description: 'Low-deflection matte carbon fiber composite shaft built for sharp cuts.',
    price: 1800,
    primaryColor: '#475569',
    secondaryColor: '#0f172a',
    accentColor: '#38bdf8',
    cueStats: { force: 90, aim: 91, spin: 88, control: 92, tier: 'Master' },
  },
  {
    id: 'cue_legendary',
    category: 'cue',
    name: 'Legendary Cue',
    description: 'Master-crafted obsidian and royal gold heritage cue with tour precision.',
    price: 3000,
    primaryColor: '#312e81',
    secondaryColor: '#09090b',
    accentColor: '#f59e0b',
    cueStats: { force: 97, aim: 96, spin: 96, control: 98, tier: 'Grandmaster' },
  },
  // Tables (3 free starter tables + 3 luxury tables!)
  {
    id: 'table_emerald',
    category: 'table',
    name: 'Emerald Club Cloth',
    description: 'Signature dark tournament emerald wool with classic mahogany rails.',
    price: 0,
    primaryColor: '#0f5c3a',
    secondaryColor: '#3b1f12',
    accentColor: '#d4af37',
    tableMeta: { railTone: '#522c19', feltGlow: '#177d4f', trimTone: '#fef3c7' },
  },
  {
    id: 'table_tournament_blue',
    category: 'table',
    name: 'Championship Blue',
    description: 'Pro-tour Simonis royal sapphire worsted cloth with piano-ebony rails.',
    price: 0,
    primaryColor: '#0e4a7b',
    secondaryColor: '#171514',
    accentColor: '#e2e8f0',
    tableMeta: { railTone: '#2b2826', feltGlow: '#1a68a8', trimTone: '#f8fafc' },
  },
  {
    id: 'table_royal_teal',
    category: 'table',
    name: 'Royal Teal Lounge',
    description: 'Deep ocean-teal tournament felt paired with satin rosewood rails.',
    price: 0,
    primaryColor: '#0d5b5b',
    secondaryColor: '#3a1b18',
    accentColor: '#eab308',
    tableMeta: { railTone: '#542620', feltGlow: '#147d7d', trimTone: '#fde68a' },
  },
  {
    id: 'table_crimson_velvet',
    category: 'table',
    name: 'Crimson Parlour',
    description: 'Vintage private-lounge burgundy felt with antique brass corner plates.',
    price: 800,
    primaryColor: '#6b1426',
    secondaryColor: '#2c160d',
    accentColor: '#fbbf24',
    tableMeta: { railTone: '#452214', feltGlow: '#8f1b33', trimTone: '#fef3c7' },
  },
  {
    id: 'table_obsidian_gold',
    category: 'table',
    name: 'Obsidian Gold 24K',
    description: 'Stealth charcoal tournament cloth framed by smoked oak & 24k gold trim.',
    price: 1400,
    primaryColor: '#1f2933',
    secondaryColor: '#100e0d',
    accentColor: '#f59e0b',
    tableMeta: { railTone: '#26211e', feltGlow: '#2d3b4a', trimTone: '#fde047' },
  },
  {
    id: 'table_imperial_violet',
    category: 'table',
    name: 'Imperial Amethyst',
    description: 'High-stakes velvet amethyst cloth with dark walnut & champagne trim.',
    price: 1800,
    primaryColor: '#3f1d6b',
    secondaryColor: '#1a1118',
    accentColor: '#eab308',
    tableMeta: { railTone: '#2e1d2a', feltGlow: '#562991', trimTone: '#fef08a' },
  },
  // Avatars
  {
    id: 'avatar_ace',
    category: 'avatar',
    name: 'Ace Striker',
    description: 'Cool under pressure with precision sunglasses.',
    price: 0,
    primaryColor: '#064e3b',
    secondaryColor: '#0f172a',
    accentColor: '#d4af37',
    imageUrl: AVATAR_ASSETS.avatar_ace,
  },
  {
    id: 'avatar_royale',
    category: 'avatar',
    name: 'Lady Royale',
    description: 'Emerald jacket championship tactician.',
    price: 0,
    primaryColor: '#065f46',
    secondaryColor: '#111827',
    accentColor: '#fbbf24',
    imageUrl: AVATAR_ASSETS.avatar_royale,
  },
  {
    id: 'avatar_shark',
    category: 'avatar',
    name: 'Club Shark',
    description: 'Classic waistcoat and fedora lounge veteran.',
    price: 450,
    primaryColor: '#451a03',
    secondaryColor: '#1e293b',
    accentColor: '#d4af37',
    imageUrl: AVATAR_ASSETS.avatar_shark,
  },
  {
    id: 'avatar_master',
    category: 'avatar',
    name: 'Grandmaster',
    description: 'Black-tie world tournament finalist.',
    price: 1100,
    primaryColor: '#022c22',
    secondaryColor: '#09090b',
    accentColor: '#f59e0b',
    imageUrl: AVATAR_ASSETS.avatar_master,
  },
  // Frames
  {
    id: 'frame_bronze',
    category: 'frame',
    name: 'Classic Brass',
    description: 'Standard club brass portrait border.',
    price: 0,
    primaryColor: '#a16207',
    secondaryColor: '#422006',
    accentColor: '#eab308',
  },
  {
    id: 'frame_emerald_gold',
    category: 'frame',
    name: 'Emerald Sovereign',
    description: 'Double-beveled emerald and gold leaf crest.',
    price: 550,
    primaryColor: '#10b981',
    secondaryColor: '#064e3b',
    accentColor: '#fbbf24',
  },
  {
    id: 'frame_obsidian',
    category: 'frame',
    name: 'Obsidian Crown',
    description: 'Diamond-cut obsidian trim for elite cueists.',
    price: 1500,
    primaryColor: '#334155',
    secondaryColor: '#020617',
    accentColor: '#f59e0b',
  },
  // Ball Effects
  {
    id: 'effect_classic',
    category: 'effect',
    name: 'Classic Chalk',
    description: 'Clean white chalk burst on cue strike.',
    price: 0,
    primaryColor: '#e2e8f0',
    secondaryColor: '#94a3b8',
    accentColor: '#f8fafc',
  },
  {
    id: 'effect_gold_spark',
    category: 'effect',
    name: 'Gilded Impact',
    description: 'Warm gold sparks on heavy ball collisions and pockets.',
    price: 700,
    primaryColor: '#fbbf24',
    secondaryColor: '#d97706',
    accentColor: '#fef08a',
  },
  {
    id: 'effect_emerald_trail',
    category: 'effect',
    name: 'Emerald Vapor',
    description: 'Subtle emerald trail behind high-power break shots.',
    price: 1100,
    primaryColor: '#34d399',
    secondaryColor: '#059669',
    accentColor: '#a7f3d0',
  },
];

export const QUICK_CHAT_MESSAGES = [
  'Good Luck!',
  'Nice Shot!',
  'Well Played!',
  'Good Game!',
  'Sorry!',
  'Thanks!',
] as const;

export const BILLIARD_EMOTES = [
  '🎱',
  '🔥',
  '👏',
  '😎',
  '🤝',
  '🏆',
] as const;

export const DAILY_REWARD_SCHEDULE = [100, 150, 200, 300, 450, 600, 1000] as const;

export const DEFAULT_FREE_OWNED_ITEMS: string[] = SHOP_CATALOG
  .filter((i) => i.price === 0)
  .map((i) => i.id);

export function getCueStats(cueId?: string): CueStats {
  const cue = SHOP_CATALOG.find((i) => i.category === 'cue' && i.id === cueId);
  return cue?.cueStats ?? { force: 58, aim: 54, spin: 50, control: 56, tier: 'Standard' };
}

