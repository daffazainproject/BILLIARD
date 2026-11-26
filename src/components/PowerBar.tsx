import React, { useRef, useState } from 'react';

interface PowerBarProps {
  disabled: boolean;
  power: number; // 0..1
  onPowerChange: (power: number) => void;
  onShoot: (power: number) => void;
}

export const PowerBar: React.FC<PowerBarProps> = ({
  disabled,
  power,
  onPowerChange,
  onShoot,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const startYRef = useRef(0);

  const computePull = (clientY: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const height = track.getBoundingClientRect().height || 180;
    const delta = Math.max(0, clientY - startYRef.current);
    return Math.max(0, Math.min(1, delta / (height * 0.72)));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    startYRef.current = e.clientY;
    setDragging(true);
    onPowerChange(0.05);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || disabled) return;
    onPowerChange(computePull(e.clientY));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    const finalPower = computePull(e.clientY);
    onPowerChange(0);
    if (!disabled && finalPower >= 0.04) {
      onShoot(finalPower);
    }
  };

  const pct = Math.round(power * 100);

  return (
    <div className="flex flex-col items-center gap-2 select-none touch-none pointer-events-auto">
      <div className="text-[11px] font-mono-tabular font-bold text-amber-300 bg-[#0b1f16]/90 border border-amber-500/30 px-2 py-0.5 rounded">
        {pct}%
      </div>

      <div
        ref={trackRef}
        role="slider"
        aria-label="Shot Power"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        tabIndex={disabled ? -1 : 0}
        data-testid="power-bar"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onShoot(power > 0.05 ? power : 0.65);
            onPowerChange(0);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            onPowerChange(Math.min(1, power + 0.1));
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            onPowerChange(Math.max(0, power - 0.1));
          }
        }}
        className={`relative w-11 h-48 sm:h-60 rounded-xl border-2 overflow-hidden transition-colors cursor-grab active:cursor-grabbing ${
          disabled
            ? 'bg-slate-900/60 border-slate-700/60 opacity-45 cursor-not-allowed'
            : 'bg-[#081911] border-amber-500/50 shadow-lg'
        }`}
      >
        {/* Meter Fill */}
        <div
          className="absolute inset-x-0 top-0 transition-none pointer-events-none"
          style={{
            height: `${pct}%`,
            background:
              pct > 75
                ? 'linear-gradient(to bottom, #f59e0b, #dc2626)'
                : pct > 40
                  ? 'linear-gradient(to bottom, #10b981, #f59e0b)'
                  : 'linear-gradient(to bottom, #34d399, #10b981)',
          }}
        />

        {/* Tick marks */}
        <div className="absolute inset-0 flex flex-col justify-between py-3 px-2 pointer-events-none">
          {[0, 25, 50, 75, 100].map((mark) => (
            <div key={mark} className="w-full h-px bg-white/15" />
          ))}
        </div>

        {/* Miniature Cue Handle sliding down with pullback */}
        <div
          className="absolute inset-x-1 h-12 rounded-md border border-amber-300/60 bg-gradient-to-b from-amber-200 via-amber-500 to-amber-900 shadow-md pointer-events-none flex items-center justify-center"
          style={{
            transform: `translateY(${Math.min(130, power * 130)}px)`,
          }}
        >
          <div className="w-4 h-0.5 bg-slate-900/70 rounded" />
        </div>
      </div>

      <span className="text-[10px] uppercase tracking-wider text-slate-300 font-semibold">
        Pull
      </span>
    </div>
  );
};
