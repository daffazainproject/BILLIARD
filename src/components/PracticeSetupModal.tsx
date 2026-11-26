import React, { useState } from 'react';
import { Bot, Cpu, Play, Sparkles, User, Users, X } from 'lucide-react';
import { getCueStats, SHOP_CATALOG } from '../game/constants.ts';
import type { AiDifficulty, GameVariant, UserProfile, UserSettings } from '../game/types.ts';
import { audioEngine } from '../services/audio.ts';
import { t } from '../services/i18n.ts';

export type PracticeSubMode = 'vs_ai' | 'solo' | 'local_2p';

export interface PracticeLaunchConfig {
  variant: GameVariant;
  subMode: PracticeSubMode;
  aiDifficulty: AiDifficulty;
}

interface PracticeSetupModalProps {
  profile: UserProfile;
  settings: UserSettings;
  onStart: (config: PracticeLaunchConfig) => void;
  onQuickEquip: (itemId: string) => void;
  onOpenArsenal: () => void;
  onClose: () => void;
}

export const PracticeSetupModal: React.FC<PracticeSetupModalProps> = ({
  profile,
  settings,
  onStart,
  onQuickEquip,
  onOpenArsenal,
  onClose,
}) => {
  const lang = settings.language;
  const [subMode, setSubMode] = useState<PracticeSubMode>('vs_ai');
  const [aiDifficulty, setAiDifficulty] = useState<AiDifficulty>('pro');
  const [variant, setVariant] = useState<GameVariant>('8ball');

  const ownedTables = SHOP_CATALOG.filter(
    (item) =>
      item.category === 'table' &&
      (item.price === 0 || profile.ownedItems.includes(item.id)),
  );
  const ownedCues = SHOP_CATALOG.filter(
    (item) =>
      item.category === 'cue' &&
      (item.price === 0 || profile.ownedItems.includes(item.id)),
  );
  const activeCue = SHOP_CATALOG.find((i) => i.id === profile.equippedCue) || ownedCues[0];
  const cueStats = getCueStats(activeCue?.id);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Solo & Pro AI Arena Setup"
        className="w-full max-w-2xl glass-panel rounded-3xl p-6 sm:p-7 space-y-5 max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-3.5">
          <div>
            <h2 className="font-display text-xl sm:text-2xl font-bold text-amber-300 tracking-wide">
              {t(lang, 'practiceArena')}
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              {lang === 'id'
                ? 'Pilih mode bermain, aturan Bola 8 / Bola 9, meja, dan stik favorit Anda.'
                : 'Choose opponent mode, 8-Ball or 9-Ball rules, table cloth, and cue stick.'}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close Arena Setup"
            onClick={onClose}
            className="p-2 rounded-xl neu-surface text-slate-300 hover:text-white shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 1. Play Mode Selector */}
        <div className="space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-200/80">
            {lang === 'id' ? 'Mode Permainan' : 'Play Mode'}
          </span>
          <div className="grid grid-cols-3 gap-2.5">
            {(
              [
                { id: 'vs_ai', label: t(lang, 'vsComputer'), icon: Bot, desc: 'Smart Pro AI' },
                { id: 'solo', label: t(lang, 'soloPractice'), icon: User, desc: 'Free Drill' },
                { id: 'local_2p', label: t(lang, 'localPassPlay'), icon: Users, desc: 'Same Screen' },
              ] as const
            ).map((opt) => {
              const Icon = opt.icon;
              const active = subMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  data-testid={`practice-submode-${opt.id}`}
                  onClick={() => {
                    audioEngine.playClick();
                    setSubMode(opt.id);
                  }}
                  className={`p-3 rounded-2xl text-left transition-all flex flex-col gap-1.5 ${
                    active
                      ? 'neu-surface border-amber-400/70 ring-1 ring-amber-400/50 text-white'
                      : 'neu-inset text-slate-300 hover:text-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <Icon className={`w-4 h-4 ${active ? 'text-amber-300' : 'text-slate-400'}`} />
                    <span className="text-[10px] font-mono-tabular text-emerald-300/90">
                      {opt.desc}
                    </span>
                  </div>
                  <div className="font-bold text-xs sm:text-sm whitespace-nowrap">{opt.label}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. AI Difficulty (only when VS Computer) */}
        {subMode === 'vs_ai' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-200/80 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-amber-400" />
                <span>{lang === 'id' ? 'Level Kecerdasan AI' : 'Pro AI Difficulty'}</span>
              </span>
              <span className="text-[11px] text-emerald-300 font-mono-tabular">
                {aiDifficulty === 'pro'
                  ? 'Elo 2150 · Precision Angles & Spin'
                  : aiDifficulty === 'semipro'
                    ? 'Elo 1550 · Tactical Cuts'
                    : 'Elo 1100 · Club Relaxed'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 p-1.5 rounded-2xl neu-inset">
              {(
                [
                  { id: 'club', label: t(lang, 'aiClub') },
                  { id: 'semipro', label: t(lang, 'aiSemiPro') },
                  { id: 'pro', label: t(lang, 'aiPro') },
                ] as const
              ).map((lvl) => (
                <button
                  key={lvl.id}
                  type="button"
                  data-testid={`ai-difficulty-${lvl.id}`}
                  onClick={() => {
                    audioEngine.playClick();
                    setAiDifficulty(lvl.id);
                  }}
                  className={`py-2 px-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                    aiDifficulty === lvl.id
                      ? 'neu-btn-gold'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {lvl.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 3. Game Variant: 8-Ball vs 9-Ball */}
        <div className="space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-200/80">
            {lang === 'id' ? 'Jenis Permainan' : 'Billiard Variant'}
          </span>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              data-testid="practice-variant-8ball"
              onClick={() => {
                audioEngine.playClick();
                setVariant('8ball');
              }}
              className={`p-3.5 rounded-2xl text-left flex items-center gap-3 transition-all ${
                variant === '8ball'
                  ? 'neu-surface border-amber-400/75 ring-1 ring-amber-400/50'
                  : 'neu-inset opacity-80 hover:opacity-100'
              }`}
            >
              <span className="w-9 h-9 rounded-full bg-zinc-950 border-2 border-amber-400/70 flex items-center justify-center font-mono-tabular font-extrabold text-sm text-white shrink-0">
                8
              </span>
              <div className="min-w-0">
                <div className="font-display font-bold text-sm text-white">
                  {t(lang, 'eightBall')}
                </div>
                <div className="text-[11px] text-slate-400">
                  15 Balls · Solids vs Stripes
                </div>
              </div>
            </button>

            <button
              type="button"
              data-testid="practice-variant-9ball"
              onClick={() => {
                audioEngine.playClick();
                setVariant('9ball');
              }}
              className={`p-3.5 rounded-2xl text-left flex items-center gap-3 transition-all ${
                variant === '9ball'
                  ? 'neu-surface border-amber-400/75 ring-1 ring-amber-400/50'
                  : 'neu-inset opacity-80 hover:opacity-100'
              }`}
            >
              <span
                className="w-9 h-9 rounded-full border-2 border-amber-400/70 flex items-center justify-center font-mono-tabular font-extrabold text-sm text-slate-950 shrink-0"
                style={{
                  background:
                    'linear-gradient(to bottom, #f8fafc 22%, #eab308 22%, #eab308 78%, #f8fafc 78%)',
                }}
              >
                9
              </span>
              <div className="min-w-0">
                <div className="font-display font-bold text-sm text-white">
                  {t(lang, 'nineBall')}
                </div>
                <div className="text-[11px] text-slate-400">
                  9 Balls · Lowest Ball First
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* 4. Quick Table & Cue Loadout */}
        <div className="neu-inset rounded-2xl p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>{lang === 'id' ? 'Meja & Stik Aktif' : 'Active Table & Cue'}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                audioEngine.playClick();
                onOpenArsenal();
              }}
              className="text-xs font-semibold text-amber-300 hover:text-amber-200 underline underline-offset-2"
            >
              {lang === 'id' ? 'Buka Arsenal Lengkap' : 'Open Full Arsenal'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Quick Table Switcher */}
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">
                Table Cloth
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ownedTables.map((tbl) => {
                  const active = profile.equippedTable === tbl.id;
                  return (
                    <button
                      key={tbl.id}
                      type="button"
                      title={tbl.name}
                      onClick={() => {
                        audioEngine.playClick();
                        onQuickEquip(tbl.id);
                      }}
                      className={`px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 text-[11px] font-semibold transition-all ${
                        active
                          ? 'neu-surface border-amber-400/70 text-amber-200'
                          : 'bg-black/25 border border-white/10 text-slate-300 hover:border-white/25'
                      }`}
                    >
                      <span
                        className="w-3.5 h-3.5 rounded-full border border-white/40 shrink-0"
                        style={{ backgroundColor: tbl.primaryColor }}
                      />
                      <span className="truncate max-w-[92px]">{tbl.name.split(' ')[0]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Active Cue Specs Summary */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-400">
                <span>{activeCue?.name}</span>
                <span className="text-amber-300 font-mono-tabular">
                  {cueStats.tier}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ownedCues.map((cue) => {
                  const active = profile.equippedCue === cue.id;
                  return (
                    <button
                      key={cue.id}
                      type="button"
                      onClick={() => {
                        audioEngine.playClick();
                        onQuickEquip(cue.id);
                      }}
                      className={`px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-all ${
                        active
                          ? 'neu-surface border-amber-400/70 text-amber-200'
                          : 'bg-black/25 border border-white/10 text-slate-300 hover:border-white/25'
                      }`}
                    >
                      {cue.name.replace(' Cue', '')}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-4 gap-1.5 pt-1 text-[10px] font-mono-tabular text-slate-300">
                <span>PWR {cueStats.force}</span>
                <span>AIM {cueStats.aim}</span>
                <span>SPN {cueStats.spin}</span>
                <span>CTL {cueStats.control}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer CTA */}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-3 rounded-2xl neu-surface text-sm font-semibold text-slate-200 hover:text-white whitespace-nowrap"
          >
            {lang === 'id' ? 'Batal' : 'Cancel'}
          </button>
          <button
            type="button"
            data-testid="start-practice-match-btn"
            onClick={() => {
              audioEngine.playClick();
              onStart({ variant, subMode, aiDifficulty });
            }}
            className="flex-1 py-3 px-5 rounded-2xl neu-btn-gold font-bold text-sm flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>
              {lang === 'id' ? 'Mulai Pertandingan' : 'Start Match'} ({variant === '9ball' ? '9-Ball' : '8-Ball'})
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
