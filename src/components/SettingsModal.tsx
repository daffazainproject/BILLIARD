import React from 'react';
import { LogOut, X } from 'lucide-react';
import type { UserSettings } from '../game/types.ts';
import { audioEngine } from '../services/audio.ts';
import { t } from '../services/i18n.ts';

interface SettingsModalProps {
  settings: UserSettings;
  isFirebaseAccount: boolean;
  onUpdateSettings: (next: UserSettings) => void;
  onLogout: () => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  isFirebaseAccount,
  onUpdateSettings,
  onLogout,
  onClose,
}) => {
  const lang = settings.language;

  const toggle = (key: 'musicEnabled' | 'sfxEnabled' | 'vibrationEnabled') => {
    audioEngine.playClick();
    onUpdateSettings({ ...settings, [key]: !settings[key] });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t(lang, 'settings')}
        className="w-full max-w-md bg-[#0b2117] border border-amber-500/35 rounded-2xl p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <h2 className="font-display text-xl font-bold text-amber-300">{t(lang, 'settings')}</h2>
          <button
            type="button"
            aria-label="Close Settings"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3.5">
          {(
            [
              { key: 'musicEnabled', label: t(lang, 'music') },
              { key: 'sfxEnabled', label: t(lang, 'soundEffects') },
              { key: 'vibrationEnabled', label: t(lang, 'vibration') },
            ] as const
          ).map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between p-3 rounded-xl bg-[#07150f] border border-white/10">
              <span className="text-sm font-medium text-slate-200">{label}</span>
              <button
                type="button"
                role="switch"
                aria-checked={settings[key]}
                onClick={() => toggle(key)}
                className={`px-3.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                  settings[key] ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {settings[key] ? 'ON' : 'OFF'}
              </button>
            </div>
          ))}

          {/* Graphics Quality */}
          <div className="p-3 rounded-xl bg-[#07150f] border border-white/10 space-y-2">
            <span className="block text-sm font-medium text-slate-200">{t(lang, 'graphicsQuality')}</span>
            <div className="grid grid-cols-3 gap-1.5">
              {(['low', 'medium', 'high'] as const).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    audioEngine.playClick();
                    onUpdateSettings({ ...settings, graphicsQuality: q });
                  }}
                  className={`py-1.5 rounded-lg text-xs font-bold capitalize ${
                    settings.graphicsQuality === q
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-white/5 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Language */}
          <div className="p-3 rounded-xl bg-[#07150f] border border-white/10 space-y-2">
            <span className="block text-sm font-medium text-slate-200">{t(lang, 'language')}</span>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { id: 'en' as const, label: 'English' },
                { id: 'id' as const, label: 'Bahasa Indonesia' },
              ].map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => {
                    audioEngine.playClick();
                    onUpdateSettings({ ...settings, language: l.id });
                  }}
                  className={`py-1.5 rounded-lg text-xs font-bold ${
                    settings.language === l.id
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-white/5 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          {/* Aiming Sensitivity */}
          <div className="p-3 rounded-xl bg-[#07150f] border border-white/10 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-slate-200">{t(lang, 'controlSensitivity')}</span>
              <span className="font-mono-tabular text-xs text-amber-300">{settings.sensitivity.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min={0.4}
              max={2.0}
              step={0.1}
              value={settings.sensitivity}
              onChange={(e) => onUpdateSettings({ ...settings, sensitivity: Number(e.target.value) })}
              className="w-full accent-amber-400"
            />
          </div>

          <div className="text-[11px] text-slate-400 px-1">
            Account Type: {isFirebaseAccount ? 'Firebase Cloud Account' : 'Guest Session'}
          </div>

          <button
            type="button"
            onClick={() => {
              audioEngine.playClick();
              onLogout();
            }}
            data-testid="logout-btn"
            className="w-full py-2.5 rounded-xl bg-red-950/70 hover:bg-red-900/80 border border-red-500/40 text-red-200 text-sm font-bold flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            <span>{t(lang, 'logout')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
