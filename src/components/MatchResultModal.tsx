import React from 'react';
import { Clock, Coins, Home, RotateCcw, Trophy, UserPlus } from 'lucide-react';
import type { PlayerSlot } from '../game/types.ts';
import { audioEngine } from '../services/audio.ts';
import { PlayerAvatar } from './PlayerAvatar.tsx';

export interface MatchResultSummary {
  isPractice: boolean;
  winnerSlot: PlayerSlot;
  yourSlot: PlayerSlot;
  winReason: string;
  durationSec: number;
  playerA: { uid: string; username: string; avatar: string; frame: string; shots: number; potted: number };
  playerB: { uid: string; username: string; avatar: string; frame: string; shots: number; potted: number };
  xpEarned: number;
  coinsEarned: number;
  ratingDelta: number;
  rematchRequestedByOpponent: boolean;
  rematchRequestedByYou: boolean;
}

interface MatchResultModalProps {
  result: MatchResultSummary;
  onRematch: () => void;
  onBackHome: () => void;
  onInviteFriend?: () => void;
}

export const MatchResultModal: React.FC<MatchResultModalProps> = ({
  result,
  onRematch,
  onBackHome,
  onInviteFriend,
}) => {
  const youWon = result.winnerSlot === result.yourSlot;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Match Result"
        className="w-full max-w-lg bg-[#0b2117] border border-amber-500/45 rounded-2xl p-6 shadow-2xl space-y-5"
      >
        {/* Header */}
        <div className="text-center space-y-1.5">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-500/15 border border-amber-400/40 text-amber-300 mb-1">
            <Trophy className="w-6 h-6" />
          </div>
          <h2 className={`font-display text-2xl sm:text-3xl font-extrabold ${youWon ? 'text-amber-300' : 'text-slate-200'}`}>
            {result.isPractice
              ? `Player ${result.winnerSlot} Wins`
              : youWon
                ? 'VICTORY!'
                : 'DEFEAT'}
          </h2>
          <p className="text-xs sm:text-sm text-slate-300">{result.winReason}</p>
        </div>

        {/* Players Comparison */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { slot: 'A' as const, data: result.playerA },
            { slot: 'B' as const, data: result.playerB },
          ].map(({ slot, data }) => {
            const isWin = result.winnerSlot === slot;
            return (
              <div
                key={slot}
                className={`p-3.5 rounded-xl border text-center space-y-2 ${
                  isWin
                    ? 'bg-emerald-950/80 border-amber-400/60'
                    : 'bg-[#07150f] border-white/10'
                }`}
              >
                <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                  {isWin ? 'Winner' : 'Challenger'}
                </div>
                <div className="flex justify-center">
                  <PlayerAvatar avatarId={data.avatar} frameId={data.frame} username={data.username} size="md" />
                </div>
                <div className="text-sm font-bold text-white truncate">{data.username}</div>
                <div className="text-[11px] font-mono-tabular text-slate-300">
                  Potted {data.potted} · Shots {data.shots}
                </div>
              </div>
            );
          })}
        </div>

        {/* Rewards & Stats */}
        <div className="grid grid-cols-3 gap-2.5 text-center">
          <div className="p-3 rounded-xl bg-[#07150f] border border-white/10">
            <div className="text-[11px] text-slate-400 flex items-center justify-center gap-1">
              <Coins className="w-3.5 h-3.5 text-amber-400" />
              <span>Coins</span>
            </div>
            <div className="font-mono-tabular text-base font-bold text-amber-300 mt-0.5">
              +{result.coinsEarned}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-[#07150f] border border-white/10">
            <div className="text-[11px] text-slate-400">XP / Elo</div>
            <div className="font-mono-tabular text-base font-bold text-emerald-300 mt-0.5">
              +{result.xpEarned} ({result.ratingDelta >= 0 ? `+${result.ratingDelta}` : result.ratingDelta})
            </div>
          </div>
          <div className="p-3 rounded-xl bg-[#07150f] border border-white/10">
            <div className="text-[11px] text-slate-400 flex items-center justify-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              <span>Duration</span>
            </div>
            <div className="font-mono-tabular text-base font-bold text-white mt-0.5">
              {Math.floor(result.durationSec / 60)}:{String(result.durationSec % 60).padStart(2, '0')}
            </div>
          </div>
        </div>

        {result.rematchRequestedByOpponent && !result.rematchRequestedByYou && (
          <div className="p-2.5 rounded-lg bg-emerald-900/50 border border-emerald-400/40 text-center text-xs text-emerald-200 font-medium">
            Opponent requested a Rematch!
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5 pt-1">
          <button
            type="button"
            onClick={() => {
              audioEngine.playClick();
              onRematch();
            }}
            disabled={result.rematchRequestedByYou}
            data-testid="rematch-btn"
            className="flex-1 py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-55 text-slate-950 font-bold text-sm flex items-center justify-center gap-1.5 whitespace-nowrap"
          >
            <RotateCcw className="w-4 h-4" />
            <span>{result.rematchRequestedByYou ? 'Waiting Opponent...' : 'Rematch'}</span>
          </button>

          {!result.isPractice && onInviteFriend && (
            <button
              type="button"
              onClick={() => {
                audioEngine.playClick();
                onInviteFriend();
              }}
              className="py-2.5 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-semibold text-sm flex items-center justify-center gap-1.5 whitespace-nowrap"
            >
              <UserPlus className="w-4 h-4" />
              <span>Invite Friend</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              audioEngine.playClick();
              onBackHome();
            }}
            data-testid="back-home-btn"
            className="py-2.5 px-4 rounded-xl bg-white/10 hover:bg-white/15 text-slate-200 font-semibold text-sm flex items-center justify-center gap-1.5 whitespace-nowrap"
          >
            <Home className="w-4 h-4" />
            <span>Back to Home</span>
          </button>
        </div>
      </div>
    </div>
  );
};
