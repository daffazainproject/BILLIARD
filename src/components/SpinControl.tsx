import React, { useRef } from 'react';

interface SpinControlProps {
  spinX: number; // -1..1
  spinY: number; // -1..1
  disabled: boolean;
  onChange: (spinX: number, spinY: number) => void;
}

export const SpinControl: React.FC<SpinControlProps> = ({
  spinX,
  spinY,
  disabled,
  onChange,
}) => {
  const padRef = useRef<HTMLDivElement>(null);

  const updateFromPointer = (clientX: number, clientY: number) => {
    const el = padRef.current;
    if (!el || disabled) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxR = rect.width * 0.36;
    let dx = (clientX - cx) / maxR;
    let dy = -(clientY - cy) / maxR;
    const mag = Math.hypot(dx, dy);
    if (mag > 1) {
      dx /= mag;
      dy /= mag;
    }
    onChange(Number(dx.toFixed(2)), Number(dy.toFixed(2)));
  };

  const label =
    Math.hypot(spinX, spinY) < 0.15
      ? 'Center'
      : [
          spinY > 0.25 ? 'Top' : spinY < -0.25 ? 'Back' : '',
          spinX < -0.25 ? 'Left' : spinX > 0.25 ? 'Right' : '',
        ]
          .filter(Boolean)
          .join(' ');

  return (
    <div className="flex flex-col items-center gap-1.5 select-none pointer-events-auto">
      <div
        ref={padRef}
        role="group"
        aria-label="Cue Ball Spin Control"
        data-testid="spin-control"
        onPointerDown={(e) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          updateFromPointer(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (disabled || e.buttons === 0) return;
          updateFromPointer(e.clientX, e.clientY);
        }}
        className={`relative w-16 h-16 sm:w-20 sm:h-20 rounded-full border-2 border-amber-500/40 shadow-inner cursor-pointer touch-none ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
        style={{
          background:
            'radial-gradient(circle at 35% 30%, #ffffff 0%, #e2e8f0 60%, #94a3b8 100%)',
        }}
      >
        {/* Crosshair */}
        <div className="absolute inset-x-3 top-1/2 h-px bg-slate-400/50 pointer-events-none" />
        <div className="absolute inset-y-3 left-1/2 w-px bg-slate-400/50 pointer-events-none" />

        {/* Strike Contact Dot */}
        <div
          className="absolute w-3.5 h-3.5 rounded-full bg-red-600 border-2 border-white shadow pointer-events-none"
          style={{
            left: `calc(50% + ${spinX * 32}% - 7px)`,
            top: `calc(50% - ${spinY * 32}% - 7px)`,
          }}
        />
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(0, 0)}
          className="text-[10px] font-semibold text-slate-200 bg-[#0b1f16]/90 border border-amber-500/30 px-2 py-0.5 rounded hover:border-amber-400 transition-colors"
        >
          {label}
        </button>
      </div>
    </div>
  );
};
