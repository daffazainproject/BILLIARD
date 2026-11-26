import React from 'react';
import {
  ArrowRight,
  Bot,
  Coins,
  Gift,
  Palette,
  Settings,
  ShoppingBag,
  Sparkles,
  Trophy,
  User as UserIcon,
  Users,
} from 'lucide-react';
import { getCueStats, SHOP_CATALOG } from '../game/constants.ts';
import { xpRequiredForLevel } from '../game/elo.ts';
import type { ShopItemDef, UserProfile, UserSettings } from '../game/types.ts';
import { audioEngine } from '../services/audio.ts';
import { t } from '../services/i18n.ts';
import { PlayerAvatar } from './PlayerAvatar.tsx';

interface MainMenuProps {
  profile: UserProfile;
  settings: UserSettings;
  wsStatus: 'connected' | 'connecting' | 'disconnected';
  pendingInvite: { roomCode: string; entryFee: number; from: { uid: string; username: string; avatar: string } } | null;
  onAcceptInvite: (roomCode: string) => void;
  onDismissInvite: () => void;
  onOpenPrivateRoom: () => void;
  onOpenPracticeArena: () => void;
  onOpenFriends: () => void;
  onOpenShop: (initialTab?: ShopItemDef['category']) => void;
  onOpenLeaderboard: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenDailyReward: () => void;
}

export const MainMenu: React.FC<MainMenuProps> = ({
  profile,
  settings,
  wsStatus,
  pendingInvite,
  onAcceptInvite,
  onDismissInvite,
  onOpenPrivateRoom,
  onOpenPracticeArena,
  onOpenFriends,
  onOpenShop,
  onOpenLeaderboard,
  onOpenProfile,
  onOpenSettings,
  onOpenDailyReward,
}) => {
  const lang = settings.language;
  const xpNeeded = xpRequiredForLevel(profile.level);
  const xpPct = Math.min(100, Math.round((profile.xp / xpNeeded) * 100));
  const today = new Date().toISOString().slice(0, 10);
  const dailyAvailable = profile.lastDailyClaim !== today;

  const activeCue =
    SHOP_CATALOG.find((i) => i.id === profile.equippedCue) ||
    SHOP_CATALOG.find((i) => i.id === 'cue_basic')!;
  const activeTable =
    SHOP_CATALOG.find((i) => i.id === profile.equippedTable) ||
    SHOP_CATALOG.find((i) => i.id === 'table_emerald')!;
  const cueStats = getCueStats(activeCue.id);

  return (
    <div className="min-h-screen bg-[#06130d] text-slate-100 flex flex-col justify-between relative overflow-hidden">
      {/* Atmospheric Club Lounge Backdrop */}
      <div
        className="fixed inset-0 bg-cover bg-center opacity-28 pointer-events-none"
        style={{ backgroundImage: 'url(/src/assets/images/club_lounge_bg_1795666735542.jpg)' }}
      />
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 50% 20%, rgba(16, 125, 79, 0.22) 0%, rgba(5, 16, 11, 0.92) 68%, #040d09 100%)',
        }}
      />

      {/* Top Glassmorphic Player Bar */}
      <header className="relative z-10 max-w-6xl w-full mx-auto px-4 sm:px-6 pt-4 pb-2">
        <div className="glass-panel rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => {
              audioEngine.playClick();
              onOpenProfile();
            }}
            className="flex items-center gap-3 text-left hover:opacity-95 transition-opacity"
          >
            <PlayerAvatar
              avatarId={profile.avatar}
              frameId={profile.frame}
              username={profile.username}
              size="md"
              online={wsStatus === 'connected'}
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm sm:text-base text-white">{profile.username}</span>
                <span className="text-xs font-mono-tabular text-amber-300">Lv.{profile.level}</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono-tabular">
                <span>{profile.playerId}</span>
                <span aria-hidden="true">·</span>
                <span>Elo {profile.rating}</span>
              </div>
              <div className="w-28 sm:w-36 h-1.5 rounded-full neu-inset mt-1.5 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-400 to-amber-400"
                  style={{ width: `${xpPct}%` }}
                />
              </div>
            </div>
          </button>

          <div className="hidden md:flex flex-col items-center text-center">
            <span className="font-display text-xl font-extrabold tracking-[0.14em] text-amber-300 whitespace-nowrap">
              POOL MASTER ONLINE
            </span>
            <span className="text-[10px] uppercase tracking-[0.26em] text-emerald-300/75 font-semibold">
              VIP Club · 8-Ball &amp; 9-Ball
            </span>
          </div>

          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl neu-inset">
              <Coins className="w-4 h-4 text-amber-400" />
              <span className="font-mono-tabular font-bold text-sm text-amber-200" data-testid="player-coins">
                {profile.coins.toLocaleString()}
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                audioEngine.playClick();
                onOpenDailyReward();
              }}
              aria-label={t(lang, 'dailyReward')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                dailyAvailable ? 'neu-btn-gold' : 'neu-surface text-slate-200 hover:text-white'
              }`}
            >
              <Gift className="w-4 h-4" />
              <span className="hidden sm:inline">{t(lang, 'dailyReward')}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                audioEngine.playClick();
                onOpenSettings();
              }}
              aria-label={t(lang, 'settings')}
              className="p-2.5 rounded-xl neu-surface text-slate-200 hover:text-amber-300 transition-colors"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Live Friend Invitation Banner */}
      {pendingInvite && (
        <div className="relative z-20 max-w-2xl w-full mx-auto px-4 pt-3">
          <div className="glass-panel border-amber-400/50 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <PlayerAvatar avatarId={pendingInvite.from.avatar} username={pendingInvite.from.username} size="sm" online />
              <div className="text-xs sm:text-sm">
                <span className="font-bold text-amber-300">{pendingInvite.from.username}</span>{' '}
                <span className="text-slate-200">invited you to Mabar Room</span>{' '}
                <span className="font-mono-tabular font-bold text-white">{pendingInvite.roomCode}</span>
                {pendingInvite.entryFee > 0 && (
                  <span className="text-amber-300 ml-2">({pendingInvite.entryFee} coins)</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onAcceptInvite(pendingInvite.roomCode)}
                className="px-3.5 py-1.5 rounded-xl neu-btn-gold font-bold text-xs"
              >
                Join Room
              </button>
              <button
                type="button"
                onClick={onDismissInvite}
                className="px-3 py-1.5 rounded-xl neu-surface text-slate-200 text-xs"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Center 2-Mode VIP Arena Hub */}
      <main className="relative z-10 flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col justify-center gap-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
          {/* MODE 1: MABAR ONLINE (Anyone With Link / Room Code) */}
          <button
            type="button"
            onClick={() => {
              audioEngine.playClick();
              onOpenPrivateRoom();
            }}
            data-testid="mode-play-friends"
            className="group glass-card rounded-3xl p-6 sm:p-7 text-left flex flex-col justify-between min-h-[245px]"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-14 h-14 rounded-2xl neu-surface flex items-center justify-center text-emerald-300 group-hover:scale-105 transition-transform">
                  <Users className="w-7 h-7" />
                </div>
                <span className="text-[11px] font-mono-tabular font-bold uppercase tracking-wider text-amber-300">
                  8-Ball · 9-Ball
                </span>
              </div>

              <div>
                <h2 className="font-display text-xl sm:text-2xl font-bold text-white tracking-wide">
                  {t(lang, 'playWithFriends')}
                </h2>
                <p className="text-xs sm:text-sm text-emerald-100/80 mt-2 leading-relaxed">
                  {t(lang, 'playWithFriendsDesc')}
                </p>
              </div>
            </div>

            <div className="pt-4 mt-4 border-t border-white/10 flex items-center justify-between text-xs font-semibold text-emerald-300">
              <span>Invite Link · 6-Char Room Code</span>
              <span className="inline-flex items-center gap-1 text-amber-300 group-hover:translate-x-1 transition-transform">
                <span>Enter Room</span>
                <ArrowRight className="w-4 h-4" />
              </span>
            </div>
          </button>

          {/* MODE 2: SOLO & PRO AI ARENA (Solo / 2P Local / VS Pro Computer) */}
          <button
            type="button"
            onClick={() => {
              audioEngine.playClick();
              onOpenPracticeArena();
            }}
            data-testid="mode-practice"
            className="group glass-card rounded-3xl p-6 sm:p-7 text-left flex flex-col justify-between min-h-[245px]"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-14 h-14 rounded-2xl neu-surface flex items-center justify-center text-amber-300 group-hover:scale-105 transition-transform">
                  <Bot className="w-7 h-7" />
                </div>
                <span className="text-[11px] font-mono-tabular font-bold uppercase tracking-wider text-emerald-300">
                  8-Ball · 9-Ball
                </span>
              </div>

              <div>
                <h2 className="font-display text-xl sm:text-2xl font-bold text-amber-300 tracking-wide">
                  {t(lang, 'practiceArena')}
                </h2>
                <p className="text-xs sm:text-sm text-slate-300 mt-2 leading-relaxed">
                  {t(lang, 'practiceArenaDesc')}
                </p>
              </div>
            </div>

            <div className="pt-4 mt-4 border-t border-white/10 flex items-center justify-between text-xs font-semibold text-slate-300">
              <span>VS Pro AI · Solo · 2P Local</span>
              <span className="inline-flex items-center gap-1 text-amber-300 group-hover:translate-x-1 transition-transform">
                <span>Configure Match</span>
                <ArrowRight className="w-4 h-4" />
              </span>
            </div>
          </button>
        </div>

        {/* Interactive Armory Strip (Active Table & Active Cue with Live Specs) */}
        <section
          aria-label="Equipped Cue & Table Arsenal"
          className="glass-panel rounded-3xl p-4 sm:p-5 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center"
        >
          {/* Active Table Preview */}
          <button
            type="button"
            onClick={() => {
              audioEngine.playClick();
              onOpenShop('table');
            }}
            data-testid="armory-table-btn"
            className="lg:col-span-5 neu-inset rounded-2xl p-3.5 flex items-center gap-3.5 text-left hover:border-amber-400/40 transition-colors"
          >
            <div
              className="w-16 h-11 rounded-xl border-4 shrink-0 shadow-inner"
              style={{
                backgroundColor: activeTable.primaryColor,
                borderColor: activeTable.tableMeta?.railTone || activeTable.secondaryColor,
              }}
            />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 flex items-center gap-1">
                <Palette className="w-3 h-3 text-emerald-400" />
                <span>Equipped Table</span>
              </div>
              <div className="font-bold text-sm text-white truncate">{activeTable.name}</div>
              <div className="text-[11px] text-emerald-300">Tap to switch felt &amp; wood rails</div>
            </div>
          </button>

          {/* Active Cue & Specs */}
          <button
            type="button"
            onClick={() => {
              audioEngine.playClick();
              onOpenShop('cue');
            }}
            data-testid="armory-cue-btn"
            className="lg:col-span-5 neu-inset rounded-2xl p-3.5 flex flex-col justify-center gap-2 text-left hover:border-amber-400/40 transition-colors"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-amber-300 truncate">{activeCue.name}</span>
              <span className="text-[10px] font-mono-tabular text-emerald-300 shrink-0">
                {cueStats.tier} Tier
              </span>
            </div>
            {/* Sleek horizontal cue graphic */}
            <div className="w-full h-2.5 rounded-full flex overflow-hidden shadow-inner">
              <div className="w-2 bg-sky-400" />
              <div className="w-2.5 bg-white" />
              <div className="flex-1" style={{ backgroundColor: activeCue.primaryColor }} />
              <div className="w-3" style={{ backgroundColor: activeCue.accentColor }} />
              <div className="w-16" style={{ backgroundColor: activeCue.secondaryColor }} />
            </div>
            <div className="grid grid-cols-4 gap-2 text-[10px] font-mono-tabular text-slate-300">
              <span>Force {cueStats.force}</span>
              <span>Aim {cueStats.aim}</span>
              <span>Spin {cueStats.spin}</span>
              <span>Ctrl {cueStats.control}</span>
            </div>
          </button>

          {/* Quick Open Arsenal CTA */}
          <div className="lg:col-span-2 flex">
            <button
              type="button"
              onClick={() => {
                audioEngine.playClick();
                onOpenShop('cue');
              }}
              data-testid="armory-customize-btn"
              className="w-full py-3.5 px-4 rounded-2xl neu-btn-emerald font-bold text-xs flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <Sparkles className="w-4 h-4 text-amber-300" />
              <span>Customize</span>
            </button>
          </div>
        </section>
      </main>

      {/* Bottom Glassmorphic Navigation Dock */}
      <nav
        aria-label="Club Navigation"
        className="relative z-10 max-w-4xl w-full mx-auto px-4 pb-4"
      >
        <div className="glass-panel rounded-2xl p-1.5 grid grid-cols-5 gap-1">
          <button
            type="button"
            onClick={() => {
              audioEngine.playClick();
              onOpenFriends();
            }}
            className="flex flex-col sm:flex-row items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl text-xs font-semibold text-slate-200 hover:bg-white/5 hover:text-amber-300 transition-colors"
          >
            <Users className="w-4 h-4" />
            <span>{t(lang, 'friends')}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              audioEngine.playClick();
              onOpenShop('cue');
            }}
            data-testid="nav-shop-btn"
            className="flex flex-col sm:flex-row items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl text-xs font-semibold text-slate-200 hover:bg-white/5 hover:text-amber-300 transition-colors"
          >
            <ShoppingBag className="w-4 h-4" />
            <span>{t(lang, 'shop')}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              audioEngine.playClick();
              onOpenLeaderboard();
            }}
            className="flex flex-col sm:flex-row items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl text-xs font-semibold text-slate-200 hover:bg-white/5 hover:text-amber-300 transition-colors"
          >
            <Trophy className="w-4 h-4" />
            <span>{t(lang, 'leaderboard')}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              audioEngine.playClick();
              onOpenProfile();
            }}
            className="flex flex-col sm:flex-row items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl text-xs font-semibold text-slate-200 hover:bg-white/5 hover:text-amber-300 transition-colors"
          >
            <UserIcon className="w-4 h-4" />
            <span>{t(lang, 'profile')}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              audioEngine.playClick();
              onOpenSettings();
            }}
            className="flex flex-col sm:flex-row items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl text-xs font-semibold text-slate-200 hover:bg-white/5 hover:text-amber-300 transition-colors"
          >
            <Settings className="w-4 h-4" />
            <span>{t(lang, 'settings')}</span>
          </button>
        </div>
      </nav>
    </div>
  );
};
