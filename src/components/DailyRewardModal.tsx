import React, { useState } from 'react';
import { Check, Coins, Gift, X } from 'lucide-react';
import { DAILY_REWARD_SCHEDULE } from '../game/constants.ts';
import type { UserProfile } from '../game/types.ts';
import { audioEngine } from '../services/audio.ts';

interface DailyRewardModalProps {
  profile: UserProfile;
  token: string;
  onProfileUpdate: (profile: UserProfile) => void;
  onClose: () => void;
}

export const DailyRewardModal: React.FC<DailyRewardModalProps> = ({
  profile,
  token,
  onProfileUpdate,
  onClose,
}) => {
  const [claiming, setClaiming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const alreadyClaimed = profile.lastDailyClaim === today;

  const handleClaim = async () => {
    audioEngine.playClick();
    setClaiming(true);
    setMessage(null);
    try {
      const res = await fetch('/api/rewards/daily', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as { profile?: UserProfile; rewardCoins?: number; error?: string };
      if (res.ok && data.profile) {
        audioEngine.playVictory();
        onProfileUpdate(data.profile);
        setMessage(`Claimed +${data.rewardCoins} coins!`);
      } else {
        setMessage(data.error || 'Already claimed today.');
      }
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Daily Login Rewards"
        className="w-full max-w-lg bg-[#0b2117] border border-amber-500/35 rounded-2xl p-6 shadow-2xl space-y-5"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <Gift className="w-5 h-5 text-amber-400" />
            <h2 className="font-display text-xl font-bold text-amber-300">Daily Club Rewards</h2>
          </div>
          <button
            type="button"
            aria-label="Close Daily Rewards"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {DAILY_REWARD_SCHEDULE.map((coins, idx) => {
            const day = idx + 1;
            const claimed = day <= profile.dailyStreak;
            const isNext = !alreadyClaimed && day === (profile.dailyStreak % 7) + 1;

            return (
              <div
                key={day}
                className={`p-2.5 rounded-xl border text-center space-y-1.5 ${
                  isNext
                    ? 'bg-emerald-900/70 border-amber-400'
                    : claimed
                      ? 'bg-[#07150f] border-emerald-500/40 opacity-75'
                      : 'bg-[#07150f] border-white/10'
                }`}
              >
                <div className="text-[10px] font-bold text-slate-400">Day {day}</div>
                <Coins className="w-4 h-4 text-amber-400 mx-auto" />
                <div className="font-mono-tabular text-xs font-bold text-amber-200">{coins}</div>
                {claimed && <Check className="w-3.5 h-3.5 text-emerald-400 mx-auto" />}
              </div>
            );
          })}
        </div>

        {message && (
          <div className="p-2.5 rounded-lg bg-emerald-950/70 border border-emerald-500/40 text-xs text-emerald-200 text-center font-medium">
            {message}
          </div>
        )}

        <button
          type="button"
          disabled={alreadyClaimed || claiming}
          onClick={handleClaim}
          data-testid="claim-daily-btn"
          className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-sm"
        >
          {alreadyClaimed ? 'Already Claimed Today' : claiming ? 'Claiming...' : 'Claim Daily Bonus'}
        </button>
      </div>
    </div>
  );
};
