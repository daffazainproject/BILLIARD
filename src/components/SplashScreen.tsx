import React, { useEffect, useState } from 'react';

interface SplashScreenProps {
  onComplete: (networkOk: boolean) => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {
  const [progress, setProgress] = useState(12);
  const [statusText, setStatusText] = useState('Checking network connection...');

  useEffect(() => {
    let cancelled = false;

    const runChecks = async () => {
      setProgress(32);
      setStatusText('Verifying multiplayer server...');

      let ok = navigator.onLine;
      try {
        const res = await fetch('/api/health');
        if (res.ok) ok = true;
      } catch {
        // Offline or server still booting
      }

      if (cancelled) return;
      setProgress(70);
      setStatusText('Checking player session...');

      setTimeout(() => {
        if (cancelled) return;
        setProgress(100);
        setStatusText('Ready for break');
        setTimeout(() => {
          if (!cancelled) onComplete(ok);
        }, 260);
      }, 320);
    };

    void runChecks();
    return () => {
      cancelled = true;
    };
  }, [onComplete]);

  return (
    <div className="min-h-screen bg-[#07150f] text-slate-100 flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-25 bg-cover bg-center"
        style={{ backgroundImage: 'url(/src/assets/images/club_lounge_bg_1795666735542.jpg)' }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-[#07150f]/80 via-[#07150f]/85 to-[#07150f]" />

      <div className="relative z-10 flex flex-col items-center max-w-md w-full text-center space-y-6">
        {/* Custom Inline SVG Emblem */}
        <div className="animate-subtle-float">
          <svg viewBox="0 0 140 140" className="w-28 h-28 drop-shadow-2xl" aria-hidden="true">
            <defs>
              <radialGradient id="eightBallGrad" cx="35%" cy="30%" r="70%">
                <stop offset="0%" stopColor="#475569" />
                <stop offset="50%" stopColor="#0f172a" />
                <stop offset="100%" stopColor="#020617" />
              </radialGradient>
            </defs>
            {/* Crossed Cues */}
            <line x1="20" y1="120" x2="120" y2="20" stroke="#d4af37" strokeWidth="6" strokeLinecap="round" />
            <line x1="20" y1="20" x2="120" y2="120" stroke="#92400e" strokeWidth="6" strokeLinecap="round" />
            {/* Emerald Crest Ring */}
            <circle cx="70" cy="70" r="46" fill="#064e3b" stroke="#d4af37" strokeWidth="3.5" />
            {/* 8-Ball */}
            <circle cx="70" cy="70" r="34" fill="url(#eightBallGrad)" />
            <circle cx="70" cy="70" r="14" fill="#f8fafc" />
            <text
              x="70"
              y="75"
              textAnchor="middle"
              fill="#09090b"
              fontSize="18"
              fontWeight="800"
              fontFamily="JetBrains Mono, monospace"
            >
              8
            </text>
          </svg>
        </div>

        <div className="space-y-1.5">
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-wide text-amber-300">
            POOL MASTER ONLINE
          </h1>
          <p className="text-sm text-emerald-200/80">
            Championship 8-Ball Billiards Club
          </p>
        </div>

        {/* Loading Progress */}
        <div className="w-full space-y-2 pt-2">
          <div className="w-full h-2 rounded-full bg-emerald-950/90 border border-amber-500/30 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 via-amber-400 to-amber-300 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono-tabular">
            <span>{statusText}</span>
            <span>{progress}%</span>
          </div>
        </div>
      </div>
    </div>
  );
};
