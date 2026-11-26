import React, { useEffect, useState } from 'react';
import { Loader2, X, Zap } from 'lucide-react';
import { audioEngine } from '../services/audio.ts';
import { wsClient } from '../services/wsClient.ts';

interface QuickMatchModalProps {
  mode: 'quick_match' | 'online_ranked';
  searching: boolean;
  error: string | null;
  playerCoins: number;
  wsStatus?: 'connected' | 'connecting' | 'disconnected';
  onClearError?: () => void;
  onClose: () => void;
}

export const QuickMatchModal: React.FC<QuickMatchModalProps> = ({
  mode,
  searching,
  error,
  playerCoins,
  wsStatus = 'connected',
  onClearError,
  onClose,
}) => {
  const [entryFee, setEntryFee] = useState(mode === 'online_ranked' ? 100 : 0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!searching) {
      setElapsed(0);
      return;
    }
    const timer = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [searching]);

  const handleStartSearch = () => {
    audioEngine.playClick();
    onClearError?.();
    const sent = wsClient.send({ type: 'queue:join', mode, entryFee });
    if (!sent) {
      onClose();
    }
  };

  const handleCancel = () => {
    audioEngine.playClick();
    wsClient.send({ type: 'queue:leave' });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Matchmaking"
        className="w-full max-w-md bg-[#0b2117] border border-amber-500/35 rounded-2xl p-6 shadow-2xl space-y-5"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <h2 className="font-display text-xl font-bold text-amber-300">
            {mode === 'online_ranked' ? 'Play Online (Ranked)' : 'Quick Match'}
          </h2>
          <button
            type="button"
            aria-label="Close Matchmaking"
            onClick={handleCancel}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-950/80 border border-red-500/50 text-xs text-red-200">
            {error}
          </div>
        )}

        {!searching ? (
          <div className="space-y-4">
            {mode === 'online_ranked' && (
              <div>
                <span className="block text-xs font-semibold text-slate-300 mb-2">
                  Select Table Entry Stake (Winner takes 2x)
                </span>
                <div className="grid grid-cols-4 gap-2">
                  {[0, 100, 500, 1000].map((fee) => (
                    <button
                      key={fee}
                      type="button"
                      disabled={playerCoins < fee}
                      onClick={() => setEntryFee(fee)}
                      className={`py-2.5 rounded-lg border text-xs font-mono-tabular font-bold transition-colors disabled:opacity-40 ${
                        entryFee === fee
                          ? 'bg-amber-500 text-slate-950 border-amber-300'
                          : 'bg-[#07150f] text-slate-200 border-white/15 hover:border-amber-500/40'
                      }`}
                    >
                      {fee === 0 ? 'Free' : `${fee}`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-slate-300 leading-relaxed">
              Matchmaking pairs you with a live online player near your Elo rating. No simulated bots are used.
            </p>

            <button
              type="button"
              onClick={handleStartSearch}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <Zap className="w-4 h-4" />
              <span>Find Opponent</span>
            </button>
          </div>
        ) : (
          <div className="py-4 text-center space-y-4">
            <Loader2 className="w-10 h-10 text-amber-400 animate-spin mx-auto" />
            <div className="space-y-1">
              <div className="text-base font-bold text-white">Searching Opponent...</div>
              <div className="text-xs text-slate-400 font-mono-tabular">
                Elapsed {elapsed}s · Stake {entryFee === 0 ? 'Free' : `${entryFee} Coins`}
              </div>
            </div>
            <p className="text-[11px] text-emerald-200/80">
              Tip: Open a second browser tab or invite a friend to play live over WebSockets!
            </p>
            <button
              type="button"
              onClick={handleCancel}
              className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-slate-200 font-semibold text-sm"
            >
              Cancel Search
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
