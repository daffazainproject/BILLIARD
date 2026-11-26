import { initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { DEFAULT_FREE_OWNED_ITEMS } from '../game/constants.ts';
import type { UserProfile, UserSettings } from '../game/types.ts';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
} as const;
export type OperationTypeValue = (typeof OperationType)[keyof typeof OperationType];

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationTypeValue;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationTypeValue,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Firestore is offline. Please verify your Firebase configuration.');
      return false;
    }
    return true; // Permission denied / not-found still confirms server reachability
  }
}

export const DEFAULT_SETTINGS: UserSettings = {
  musicEnabled: false,
  sfxEnabled: true,
  vibrationEnabled: true,
  graphicsQuality: 'high',
  language: 'en',
  sensitivity: 1.0,
};

function sanitizeUsernameForRule(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_ .-]/g, '').trim().slice(0, 24);
  return cleaned.length >= 2 ? cleaned : 'Cueist_Pro';
}

export async function syncFirebaseUserProfile(user: User, preferredName?: string): Promise<UserProfile> {
  const userPath = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  const now = new Date().toISOString();

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return snap.data() as UserProfile;
    }

    const shortTag = user.uid.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6).padEnd(6, 'X');
    const initialProfile: UserProfile = {
      uid: user.uid,
      playerId: `PM-${shortTag}`,
      username: sanitizeUsernameForRule(preferredName || user.displayName || user.email?.split('@')[0] || `Cueist_${shortTag.slice(0, 4)}`),
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

    await setDoc(ref, initialProfile);

    const privRef = doc(db, 'users', user.uid, 'private', 'info');
    await setDoc(privRef, {
      uid: user.uid,
      ...(user.email ? { email: user.email.slice(0, 254) } : {}),
      ...DEFAULT_SETTINGS,
      updatedAt: now,
    });

    return initialProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function updateFirestoreProfileFields(
  uid: string,
  fields: Partial<Pick<UserProfile, 'username' | 'avatar' | 'frame' | 'equippedCue' | 'equippedTable' | 'equippedEffect'>>,
): Promise<void> {
  const path = `users/${uid}`;
  try {
    const payload: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (fields.username !== undefined) payload.username = sanitizeUsernameForRule(fields.username);
    if (fields.avatar !== undefined) payload.avatar = fields.avatar.slice(0, 64);
    if (fields.frame !== undefined) payload.frame = fields.frame.slice(0, 64);
    if (fields.equippedCue !== undefined) payload.equippedCue = fields.equippedCue.slice(0, 64);
    if (fields.equippedTable !== undefined) payload.equippedTable = fields.equippedTable.slice(0, 64);
    if (fields.equippedEffect !== undefined) payload.equippedEffect = fields.equippedEffect.slice(0, 64);
    await updateDoc(doc(db, 'users', uid), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateFirestoreMatchStats(
  uid: string,
  stats: Pick<UserProfile, 'level' | 'xp' | 'coins' | 'rating' | 'wins' | 'losses' | 'matches' | 'updatedAt'>,
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      level: stats.level,
      xp: stats.xp,
      coins: stats.coins,
      rating: stats.rating,
      wins: stats.wins,
      losses: stats.losses,
      matches: stats.matches,
      updatedAt: stats.updatedAt,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateFirestoreShopPurchase(
  uid: string,
  next: Pick<
    UserProfile,
    'coins' | 'ownedItems' | 'equippedCue' | 'equippedTable' | 'equippedEffect' | 'avatar' | 'frame' | 'updatedAt'
  >,
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      coins: next.coins,
      ownedItems: next.ownedItems,
      equippedCue: next.equippedCue,
      equippedTable: next.equippedTable,
      equippedEffect: next.equippedEffect,
      avatar: next.avatar,
      frame: next.frame,
      updatedAt: next.updatedAt,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateFirestoreSettings(uid: string, settings: UserSettings): Promise<void> {
  const path = `users/${uid}/private/info`;
  try {
    await updateDoc(doc(db, 'users', uid, 'private', 'info'), {
      musicEnabled: settings.musicEnabled,
      sfxEnabled: settings.sfxEnabled,
      vibrationEnabled: settings.vibrationEnabled,
      graphicsQuality: settings.graphicsQuality,
      language: settings.language,
      sensitivity: Math.max(0.2, Math.min(2.5, settings.sensitivity)),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function loadFirestoreSettings(uid: string): Promise<UserSettings> {
  const path = `users/${uid}/private/info`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'private', 'info'));
    if (snap.exists()) {
      const data = snap.data();
      return {
        musicEnabled: Boolean(data.musicEnabled),
        sfxEnabled: Boolean(data.sfxEnabled),
        vibrationEnabled: Boolean(data.vibrationEnabled),
        graphicsQuality: (data.graphicsQuality as UserSettings['graphicsQuality']) || 'high',
        language: (data.language as UserSettings['language']) || 'en',
        sensitivity: typeof data.sensitivity === 'number' ? data.sensitivity : 1.0,
      };
    }
    return DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function loginWithGoogle(): Promise<User> {
  const res = await signInWithPopup(auth, googleProvider);
  return res.user;
}

export async function loginWithEmail(email: string, password: string): Promise<User> {
  const res = await signInWithEmailAndPassword(auth, email, password);
  return res.user;
}

export async function registerWithEmail(email: string, password: string): Promise<User> {
  const res = await createUserWithEmailAndPassword(auth, email, password);
  return res.user;
}

export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email);
}

export async function loginAnonymouslyFirebase(): Promise<User> {
  const res = await signInAnonymously(auth);
  return res.user;
}

export async function logoutFirebase(): Promise<void> {
  await signOut(auth);
}
