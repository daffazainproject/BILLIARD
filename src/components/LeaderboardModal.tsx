import React, { useEffect, useState } from 'react';
import { Trophy, X } from 'lucide-react';
import { audioEngine } from '../services/audio.ts';
import { PlayerAvatar } from './PlayerAvatar.tsx';

interface RankingEntry {
  uid: string;
  playerId: string;
  username: string;
  avatar: string;
  frame: string;
  level: number;
  rating: number;
  wins: number;
  losses: number;
  matches: number;
  online: boolean;
}

interface LeaderboardModalProps {
  currentUid: string;
  token: string;
  onClose: () => void;
}

export const LeaderboardModal: React.FC<LeaderboardModalProps> = ({
  currentUid,
  token,
  onClose,
}) => {
  const [scope, setScope] = useState<'global' | 'weekly' | 'monthly' | 'friends'>('global');
  const [rankings, setRankings] = useState<RankingEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/leaderboard?scope=${scope}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : { rankings: [] }))
      .then((data: { rankings?: RankingEntry[] }) => {
        setRankings(data.rankings || []);
      })
      .finally(() => setLoading(false));
  }, [scope, token]);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Leaderboard"
        className="w-full max-w-2xl bg-[#0b2117] border border-amber-500/35 rounded-2xl p-6 shadow-2xl space-y-5 max-h-[88vh] flex flex-col"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2.5">
            <Trophy className="w-5 h-5 text-amber-400" />
            <h2 className="font-display text-xl font-bold text-amber-300">Elo Rankings</h2>
          </div>
          <button
            type="button"
            aria-label="Close Leaderboard"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl bg-[#07150f]">
          {(['global', 'weekly', 'monthly', 'friends'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                audioEngine.playClick();
                setScope(s);
              }}
              className={`py-2 rounded-lg text-xs font-bold capitalize transition-colors ${
                scope === s ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {loading ? (
            <div className="text-xs text-slate-400 py-8 text-center">Loading rankings...</div>
          ) : rankings.length === 0 ? (
            <div className="text-xs text-slate-400 py-8 text-center">No ranked matches recorded yet.</div>
          ) : (
            rankings.map((entry, idx) => {
              const winRate = entry.matches > 0 ? Math.round((entry.wins / entry.matches) * 100) : 0;
              const isMe = entry.uid === currentUid;
              return (
                <div
                  key={entry.uid}
                  className={`flex items-center justify-between p-3 rounded-xl border ${
                    isMe
                      ? 'bg-emerald-950/80 border-amber-400/60'
                      : 'bg-[#07150f] border-white/10'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-7 text-center font-mono-tabular font-bold text-sm ${
                        idx === 0
                          ? 'text-amber-300'
                          : idx === 1
                            ? 'text-slate-200'
                            : idx === 2
                              ? 'text-amber-600'
                              : 'text-slate-500'
                      }`}
                    >
                      #{idx + 1}
                    </span>
                    <PlayerAvatar
                      avatarId={entry.avatar}
                      frameId={entry.frame}
                      username={entry.username}
                      size="sm"
                      online={entry.online}
                    />
                    <div>
                      <div className="text-sm font-bold text-white">
                        {entry.username} {isMe && <span className="text-xs text-amber-300">(You)</span>}
                      </div>
                      <div className="text-[11px] font-mono-tabular text-slate-400">
                        {entry.wins}W / {entry.losses}L · {winRate}% WR · Lv.{entry.level}
                      </div>
                    </div>
                  </div>
                  <div className="text-right font-mono-tabular">
                    <div className="text-sm font-bold text-amber-300">{entry.rating}</div>
                    <div className="text-[10px] text-slate-400">ELO</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
