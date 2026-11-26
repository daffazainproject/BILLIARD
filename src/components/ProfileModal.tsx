import React, { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { AVATAR_ASSETS, SHOP_CATALOG } from '../game/constants.ts';
import type { UserProfile } from '../game/types.ts';
import { audioEngine } from '../services/audio.ts';
import { PlayerAvatar } from './PlayerAvatar.tsx';

interface MatchHistoryItem {
  matchId: string;
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

interface ProfileModalProps {
  profile: UserProfile;
  token: string;
  onSaveProfile: (username: string, avatar: string) => Promise<void>;
  onClose: () => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  profile,
  token,
  onSaveProfile,
  onClose,
}) => {
  const [username, setUsername] = useState(profile.username);
  const [avatar, setAvatar] = useState(profile.avatar);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<MatchHistoryItem[]>([]);

  useEffect(() => {
    fetch('/api/history', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : { matches: [] }))
      .then((d: { matches?: MatchHistoryItem[] }) => setHistory(d.matches || []))
      .catch(() => {});
  }, [token]);

  const winRate = profile.matches > 0 ? Math.round((profile.wins / profile.matches) * 100) : 0;
  const ownedAvatars = SHOP_CATALOG.filter(
    (i) => i.category === 'avatar' && profile.ownedItems.includes(i.id),
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    audioEngine.playClick();
    setError(null);
    setSavedMsg(null);
    const trimmed = username.trim();
    if (!/^[a-zA-Z0-9_ .-]{2,24}$/.test(trimmed)) {
      setError('Username must be 2–24 characters using letters, numbers, spaces, _, ., or -.');
      return;
    }
    setSaving(true);
    try {
      await onSaveProfile(trimmed, avatar);
      setSavedMsg('Profile updated.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Player Profile"
        className="w-full max-w-2xl bg-[#0b2117] border border-amber-500/35 rounded-2xl p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <h2 className="font-display text-xl font-bold text-amber-300">Player Profile</h2>
          <button
            type="button"
            aria-label="Close Profile"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Top Summary */}
        <div className="flex flex-wrap items-center gap-4 p-4 rounded-xl bg-[#07150f] border border-white/10">
          <PlayerAvatar avatarId={avatar} frameId={profile.frame} username={profile.username} size="xl" />
          <div className="flex-1 min-w-[180px] space-y-1">
            <div className="text-lg font-bold text-white">{profile.username}</div>
            <div className="text-xs font-mono-tabular text-slate-400">
              {profile.playerId} · Level {profile.level} · {profile.xp} XP
            </div>
            <div className="text-xs font-mono-tabular text-amber-300">
              Elo Rating: {profile.rating}
            </div>
          </div>
        </div>

        {/* Career Stats Grid */}
        <div className="grid grid-cols-4 gap-2.5 text-center">
          <div className="p-3 rounded-xl bg-[#07150f] border border-white/10">
            <div className="text-[11px] text-slate-400">Wins</div>
            <div className="font-mono-tabular text-lg font-bold text-emerald-300">{profile.wins}</div>
          </div>
          <div className="p-3 rounded-xl bg-[#07150f] border border-white/10">
            <div className="text-[11px] text-slate-400">Losses</div>
            <div className="font-mono-tabular text-lg font-bold text-rose-300">{profile.losses}</div>
          </div>
          <div className="p-3 rounded-xl bg-[#07150f] border border-white/10">
            <div className="text-[11px] text-slate-400">Matches</div>
            <div className="font-mono-tabular text-lg font-bold text-white">{profile.matches}</div>
          </div>
          <div className="p-3 rounded-xl bg-[#07150f] border border-white/10">
            <div className="text-[11px] text-slate-400">Win Rate</div>
            <div className="font-mono-tabular text-lg font-bold text-amber-300">{winRate}%</div>
          </div>
        </div>

        {/* Edit Username & Avatar */}
        <form onSubmit={handleSave} className="space-y-4 pt-2 border-t border-white/10">
          <div>
            <label htmlFor="profile-username" className="block text-xs font-semibold text-slate-300 mb-1.5">
              Edit Username
            </label>
            <input
              id="profile-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={24}
              className="w-full px-3.5 py-2 rounded-lg bg-[#07150f] border border-white/15 text-sm text-white focus:outline-none focus:border-amber-400"
            />
          </div>

          <div>
            <span className="block text-xs font-semibold text-slate-300 mb-2">Select Owned Avatar</span>
            <div className="flex flex-wrap gap-2.5">
              {ownedAvatars.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-label={item.name}
                  onClick={() => setAvatar(item.id)}
                  className={`p-1 rounded-full border-2 transition-transform ${
                    avatar === item.id ? 'border-amber-400 scale-105' : 'border-transparent opacity-70 hover:opacity-100'
                  }`}
                >
                  <img
                    src={AVATAR_ASSETS[item.id]}
                    alt={item.name}
                    referrerPolicy="no-referrer"
                    className="w-12 h-12 rounded-full object-cover"
                  />
                </button>
              ))}
            </div>
          </div>

          {error && <div className="text-xs text-red-300">{error}</div>}
          {savedMsg && <div className="text-xs text-emerald-300">{savedMsg}</div>}

          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5"
          >
            <Check className="w-4 h-4" />
            <span>{saving ? 'Saving...' : 'Save Profile'}</span>
          </button>
        </form>

        {/* Match History */}
        <div className="space-y-2 pt-2 border-t border-white/10">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Recent Match History ({history.length})
          </h3>
          {history.length === 0 ? (
            <div className="text-xs text-slate-500 py-3">No completed online matches yet.</div>
          ) : (
            <div className="space-y-2 max-h-44 overflow-y-auto">
              {history.map((m) => (
                <div
                  key={m.matchId}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-[#07150f] border border-white/10 text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`font-bold uppercase ${
                        m.result === 'win' ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {m.result}
                    </span>
                    <span className="text-slate-200">vs {m.opponentName}</span>
                  </div>
                  <div className="font-mono-tabular text-slate-400">
                    {m.shots} shots · {m.ratingDelta >= 0 ? `+${m.ratingDelta}` : m.ratingDelta} Elo
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
