import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { AuthScreen } from './components/AuthScreen.tsx';
import { DailyRewardModal } from './components/DailyRewardModal.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { FriendsModal } from './components/FriendsModal.tsx';
import { GameView, type OnlineMatchInit } from './components/GameView.tsx';
import { LeaderboardModal } from './components/LeaderboardModal.tsx';
import { MainMenu } from './components/MainMenu.tsx';
import { PracticeSetupModal, type PracticeLaunchConfig } from './components/PracticeSetupModal.tsx';
import { PrivateRoomModal, type RoomStateView } from './components/PrivateRoomModal.tsx';
import { ProfileModal } from './components/ProfileModal.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import { ShopModal } from './components/ShopModal.tsx';
import { SplashScreen } from './components/SplashScreen.tsx';
import { DEFAULT_FREE_OWNED_ITEMS, SHOP_CATALOG } from './game/constants.ts';
import { extractRoomCode } from './game/roomCode.ts';
import type { AiDifficulty, GameVariant, ShopItemDef, UserProfile, UserSettings } from './game/types.ts';
import { audioEngine } from './services/audio.ts';
import {
  auth,
  DEFAULT_SETTINGS,
  loadFirestoreSettings,
  logoutFirebase,
  syncFirebaseUserProfile,
  testFirestoreConnection,
  updateFirestoreMatchStats,
  updateFirestoreProfileFields,
  updateFirestoreSettings,
  updateFirestoreShopPurchase,
} from './services/firebase.ts';
import { wsClient } from './services/wsClient.ts';

type AppScreen = 'splash' | 'auth' | 'menu' | 'playing';
type ActiveModal =
  | null
  | 'private_room'
  | 'practice_setup'
  | 'friends'
  | 'shop'
  | 'leaderboard'
  | 'profile'
  | 'settings'
  | 'daily_reward';

export function AppContent() {
  const params = new URLSearchParams(window.location.search);
  const autoStart = params.get('autostart') === '1';
  const inviteRoomParam = extractRoomCode(params.get('room') || '');

  const initialVariant: GameVariant = params.get('variant') === '9ball' ? '9ball' : '8ball';
  const rawSub = params.get('submode');
  const initialSubMode: PracticeLaunchConfig['subMode'] =
    rawSub === 'solo' || rawSub === 'local_2p' || rawSub === 'vs_ai' ? rawSub : 'vs_ai';
  const rawAi = params.get('ai');
  const initialAiDiff: AiDifficulty =
    rawAi === 'club' || rawAi === 'semipro' || rawAi === 'pro' ? rawAi : 'pro';

  const [screen, setScreen] = useState<AppScreen>(autoStart ? 'playing' : 'splash');
  const [token, setToken] = useState<string>('');
  const [isFirebaseAccount, setIsFirebaseAccount] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(
    autoStart
      ? {
          uid: 'practice_autostart',
          playerId: 'PM-AUTO01',
          username: 'Practice_Pro',
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
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      : null,
  );
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [modal, setModal] = useState<ActiveModal>(null);
  const [shopTab, setShopTab] = useState<ShopItemDef['category']>('cue');
  const [practiceConfig, setPracticeConfig] = useState<PracticeLaunchConfig>({
    variant: initialVariant,
    subMode: initialSubMode,
    aiDifficulty: initialAiDiff,
  });
  const [wsStatus, setWsStatus] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');

  // Multiplayer Room / Active Match State
  const [room, setRoom] = useState<RoomStateView | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [pendingRoomCode, setPendingRoomCode] = useState<string>(inviteRoomParam);
  const [autoJoinRoom, setAutoJoinRoom] = useState<boolean>(Boolean(inviteRoomParam));
  const [activeOnlineMatch, setActiveOnlineMatch] = useState<OnlineMatchInit | null>(null);
  const [pendingInvite, setPendingInvite] = useState<{
    roomCode: string;
    entryFee: number;
    from: { uid: string; username: string; avatar: string };
  } | null>(null);

  // Sync body[data-state] for observability
  useEffect(() => {
    document.body.dataset.state = screen;
  }, [screen]);

  // Startup Firestore connection check
  useEffect(() => {
    void testFirestoreConnection();
  }, []);

  // Keep audio engine synced with user settings
  useEffect(() => {
    audioEngine.setSfxEnabled(settings.sfxEnabled);
    audioEngine.setMusicEnabled(settings.musicEnabled);
  }, [settings.sfxEnabled, settings.musicEnabled]);

  // Track WebSocket status
  useEffect(() => {
    return wsClient.onStatusChange(setWsStatus);
  }, []);

  // Subscribe to global WebSocket events (rooms, matchmaking, match start, invites)
  useEffect(() => {
    const unsub = wsClient.subscribe((msg) => {
      switch (msg.type) {
        case 'auth:ok': {
          if (msg.profile) {
            setProfile((prev) => prev || (msg.profile as UserProfile));
          }
          if (msg.activeMatch) {
            setActiveOnlineMatch(msg.activeMatch as OnlineMatchInit);
            setModal(null);
            setScreen('playing');
          } else if (msg.activeRoom) {
            setRoom(msg.activeRoom as RoomStateView);
            setModal('private_room');
          }
          break;
        }
        case 'auth:error':
        case 'error': {
          const errText = String(msg.error || 'Real-time server error.');
          setRoomError(errText);
          break;
        }
        case 'room:created':
        case 'room:updated': {
          setRoomError(null);
          setRoom(msg.room as RoomStateView);
          setModal('private_room');
          break;
        }
        case 'room:left': {
          setRoom(null);
          break;
        }
        case 'room:error': {
          setRoomError(String(msg.error || 'Room action failed.'));
          break;
        }
        case 'room:invitation': {
          audioEngine.playNotification();
          setPendingInvite({
            roomCode: String(msg.roomCode || ''),
            entryFee: Number(msg.entryFee || 0),
            from: msg.from as { uid: string; username: string; avatar: string },
          });
          break;
        }
        case 'queue:matched':
        case 'match:started': {
          setRoom(null);
          setAutoJoinRoom(false);
          setModal(null);
          setActiveOnlineMatch(msg.match as OnlineMatchInit);
          setScreen('playing');
          break;
        }
      }
    });
    return unsub;
  }, []);

  const finishAuthentication = useCallback(
    async (authToken: string, initialProfile: UserProfile, firebaseBacked: boolean) => {
      setToken(authToken);
      setIsFirebaseAccount(firebaseBacked);

      // Sync profile with authoritative server coordinator
      let syncedProfile = initialProfile;
      try {
        const res = await fetch('/api/profile/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify(initialProfile),
        });
        if (res.ok) {
          const data = (await res.json()) as { profile?: UserProfile };
          if (data.profile) syncedProfile = data.profile;
        }
      } catch {
        // Fallback to local profile if coordinator offline
      }

      if (firebaseBacked) {
        const loadedSettings = await loadFirestoreSettings(syncedProfile.uid);
        setSettings(loadedSettings);
      }

      setProfile(syncedProfile);
      wsClient.connect(
        authToken,
        firebaseBacked
          ? async () => (auth.currentUser ? auth.currentUser.getIdToken() : null)
          : undefined,
      );
      setScreen('menu');

      if (inviteRoomParam) {
        setPendingRoomCode(inviteRoomParam);
        setAutoJoinRoom(true);
        setModal('private_room');
      }
    },
    [inviteRoomParam],
  );

  // Handle splash completion & check active Firebase session
  const handleSplashComplete = useCallback(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      unsub();
      if (user) {
        try {
          const idToken = await user.getIdToken();
          const prof = await syncFirebaseUserProfile(user);
          await finishAuthentication(idToken, prof, true);
          return;
        } catch {
          // Fall through to auth screen
        }
      }
      setScreen((cur) => (cur === 'splash' ? 'auth' : cur));
    });
  }, [finishAuthentication]);

  const handleUpdateSettings = (next: UserSettings) => {
    setSettings(next);
    if (isFirebaseAccount && profile) {
      void updateFirestoreSettings(profile.uid, next).catch(() => {});
    }
  };

  const handleSaveProfile = async (newUsername: string, newAvatar: string) => {
    if (!profile) return;
    const next = { ...profile, username: newUsername, avatar: newAvatar };
    if (token) {
      const res = await fetch('/api/profile/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ username: newUsername, avatar: newAvatar }),
      });
      if (res.ok) {
        const data = (await res.json()) as { profile?: UserProfile };
        if (data.profile) {
          setProfile(data.profile);
        }
      }
    } else {
      setProfile(next);
    }

    if (isFirebaseAccount) {
      await updateFirestoreProfileFields(profile.uid, { username: newUsername, avatar: newAvatar });
    }
  };

  const handleQuickEquip = useCallback(
    (itemId: string) => {
      const item = SHOP_CATALOG.find((entry) => entry.id === itemId);
      if (!item) return;

      setProfile((prev) => {
        if (!prev) return prev;
        if (item.price > 0 && !prev.ownedItems.includes(item.id)) return prev;
        const ownedItems = prev.ownedItems.includes(item.id)
          ? prev.ownedItems
          : [...prev.ownedItems, item.id];
        const next: UserProfile = { ...prev, ownedItems };
        if (item.category === 'cue') next.equippedCue = item.id;
        if (item.category === 'table') next.equippedTable = item.id;
        if (item.category === 'avatar') next.avatar = item.id;
        if (item.category === 'frame') next.frame = item.id;
        if (item.category === 'effect') next.equippedEffect = item.id;

        if (isFirebaseAccount) {
          void updateFirestoreProfileFields(next.uid, {
            avatar: next.avatar,
            frame: next.frame,
            equippedCue: next.equippedCue,
            equippedTable: next.equippedTable,
            equippedEffect: next.equippedEffect,
          }).catch(() => {});
        }
        return next;
      });

      if (token) {
        void fetch('/api/shop/equip', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ itemId }),
        }).catch(() => {});
      }
    },
    [isFirebaseAccount, token],
  );

  const handleLogout = async () => {
    wsClient.disconnect();
    if (isFirebaseAccount) {
      await logoutFirebase();
    }
    setToken('');
    setProfile(null);
    setActiveOnlineMatch(null);
    setRoom(null);
    setModal(null);
    setScreen('auth');
  };

  if (screen === 'splash') {
    return <SplashScreen onComplete={handleSplashComplete} />;
  }

  if (screen === 'auth' || !profile) {
    return <AuthScreen onAuthenticated={finishAuthentication} />;
  }

  if (screen === 'playing') {
    return (
      <GameView
        profile={profile}
        settings={settings}
        onlineMatch={activeOnlineMatch}
        practiceConfig={practiceConfig}
        onQuickEquip={handleQuickEquip}
        onUpdateSettings={handleUpdateSettings}
        onProfileUpdate={(next) => {
          setProfile(next);
          if (isFirebaseAccount && activeOnlineMatch?.firestoreSync && next.matches > profile.matches) {
            void updateFirestoreMatchStats(next.uid, next).catch(() => {});
          }
        }}
        onExitToMenu={() => {
          setActiveOnlineMatch(null);
          setScreen('menu');
        }}
        onInviteFriendFromResult={() => {
          setActiveOnlineMatch(null);
          setScreen('menu');
          setAutoJoinRoom(false);
          setModal('private_room');
        }}
      />
    );
  }

  return (
    <>
      <MainMenu
        profile={profile}
        settings={settings}
        wsStatus={wsStatus}
        pendingInvite={pendingInvite}
        onAcceptInvite={(code) => {
          setPendingInvite(null);
          setRoomError(null);
          setPendingRoomCode(extractRoomCode(code));
          setAutoJoinRoom(true);
          setModal('private_room');
        }}
        onDismissInvite={() => setPendingInvite(null)}
        onOpenPrivateRoom={() => {
          setRoomError(null);
          setAutoJoinRoom(false);
          setModal('private_room');
        }}
        onOpenPracticeArena={() => {
          setModal('practice_setup');
        }}
        onOpenFriends={() => setModal('friends')}
        onOpenShop={(initialTab = 'cue') => {
          setShopTab(initialTab);
          setModal('shop');
        }}
        onOpenLeaderboard={() => setModal('leaderboard')}
        onOpenProfile={() => setModal('profile')}
        onOpenSettings={() => setModal('settings')}
        onOpenDailyReward={() => setModal('daily_reward')}
      />

      {modal === 'private_room' && (
        <PrivateRoomModal
          currentProfile={profile}
          token={token}
          isFirebaseAccount={isFirebaseAccount}
          room={room}
          initialJoinCode={pendingRoomCode}
          autoJoin={autoJoinRoom}
          error={roomError}
          onRoomChange={setRoom}
          onMatchStarted={(match) => {
            setRoom(null);
            setAutoJoinRoom(false);
            setPendingRoomCode('');
            setModal(null);
            setActiveOnlineMatch(match);
            setScreen('playing');
          }}
          onError={setRoomError}
          onClose={() => {
            setRoom(null);
            setPendingRoomCode('');
            setAutoJoinRoom(false);
            setModal(null);
          }}
        />
      )}

      {modal === 'practice_setup' && (
        <PracticeSetupModal
          profile={profile}
          settings={settings}
          onStart={(cfg) => {
            setPracticeConfig(cfg);
            setActiveOnlineMatch(null);
            setModal(null);
            setScreen('playing');
          }}
          onQuickEquip={handleQuickEquip}
          onOpenArsenal={() => {
            setShopTab('cue');
            setModal('shop');
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'friends' && (
        <FriendsModal
          token={token}
          onInviteToPrivateRoom={() => {
            setRoomError(null);
            setAutoJoinRoom(false);
            setModal('private_room');
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'shop' && (
        <ShopModal
          profile={profile}
          token={token}
          initialCategory={shopTab}
          onProfileUpdate={(next, purchasedNew) => {
            setProfile(next);
            if (isFirebaseAccount) {
              if (purchasedNew) {
                void updateFirestoreShopPurchase(next.uid, next).catch(() => {});
              } else {
                void updateFirestoreProfileFields(next.uid, {
                  avatar: next.avatar,
                  frame: next.frame,
                  equippedCue: next.equippedCue,
                  equippedTable: next.equippedTable,
                  equippedEffect: next.equippedEffect,
                }).catch(() => {});
              }
            }
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'leaderboard' && (
        <LeaderboardModal
          currentUid={profile.uid}
          token={token}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'profile' && (
        <ProfileModal
          profile={profile}
          token={token}
          onSaveProfile={handleSaveProfile}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'settings' && (
        <SettingsModal
          settings={settings}
          isFirebaseAccount={isFirebaseAccount}
          onUpdateSettings={handleUpdateSettings}
          onLogout={handleLogout}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'daily_reward' && (
        <DailyRewardModal
          profile={profile}
          token={token}
          onProfileUpdate={(next) => setProfile(next)}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
