import React, { useEffect, useRef } from 'react';
import {
  BALL_COLORS,
  BALL_RADIUS,
  getCueStats,
  HEADSTRING_X,
  POCKETS,
  SHOP_CATALOG,
  TABLE_HEIGHT,
  TABLE_WIDTH,
} from '../game/constants.ts';
import { computeAimPrediction, isValidCueBallPlacement } from '../game/physics.ts';
import type { BallState, BallSuit, GameVariant, PhysicsEvent, UserSettings } from '../game/types.ts';

const RAIL_PAD = 56;
const LOGICAL_W = TABLE_WIDTH + RAIL_PAD * 2;
const LOGICAL_H = TABLE_HEIGHT + RAIL_PAD * 2;

interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export interface BilliardCanvasProps {
  ballsRef: React.MutableRefObject<BallState[]>;
  pendingEventsRef: React.MutableRefObject<PhysicsEvent[]>;
  aimAngle: number;
  onAimChange: (angle: number) => void;
  power: number;
  spinX: number;
  spinY: number;
  canShoot: boolean;
  isSimulating: boolean;
  ballInHand: boolean;
  headstringOnly: boolean;
  currentGroup: BallSuit;
  isBreakShot: boolean;
  gameVariant?: GameVariant;
  targetBallNumber?: number | null;
  equippedCueId: string;
  equippedTableId: string;
  equippedEffectId: string;
  settings: UserSettings;
  onPlaceCueBall: (x: number, y: number) => void;
  strikeFlashRef: React.MutableRefObject<number>;
  currentTurnLabel: string;
  phaseLabel: string;
}

export const BilliardCanvas: React.FC<BilliardCanvasProps> = ({
  ballsRef,
  pendingEventsRef,
  aimAngle,
  onAimChange,
  power,
  spinX,
  spinY,
  canShoot,
  isSimulating,
  ballInHand,
  headstringOnly,
  currentGroup,
  isBreakShot,
  gameVariant = '8ball',
  targetBallNumber = null,
  equippedCueId,
  equippedTableId,
  equippedEffectId,
  settings,
  onPlaceCueBall,
  strikeFlashRef,
  currentTurnLabel,
  phaseLabel,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const feltPatternRef = useRef<CanvasPattern | null>(null);
  const feltPatternTableIdRef = useRef<string>('');
  const tableCacheCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const tableCacheKeyRef = useRef<string>('');
  const lastRenderSigRef = useRef<string>('');

  // Store live props in refs so RAF loop never tears down
  const propsRef = useRef({
    aimAngle,
    power,
    spinX,
    spinY,
    canShoot,
    isSimulating,
    ballInHand,
    headstringOnly,
    currentGroup,
    isBreakShot,
    gameVariant,
    targetBallNumber,
    equippedCueId,
    equippedTableId,
    equippedEffectId,
    settings,
    onAimChange,
    onPlaceCueBall,
  });
  propsRef.current = {
    aimAngle,
    power,
    spinX,
    spinY,
    canShoot,
    isSimulating,
    ballInHand,
    headstringOnly,
    currentGroup,
    isBreakShot,
    gameVariant,
    targetBallNumber,
    equippedCueId,
    equippedTableId,
    equippedEffectId,
    settings,
    onAimChange,
    onPlaceCueBall,
  };

  // Pooled zero-GC particle ring buffer
  const particlesRef = useRef<Particle[]>(
    Array.from({ length: 120 }, () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 0.4,
      size: 2,
      color: '#ffffff',
    })),
  );
  const particleCursorRef = useRef(0);

  // Pointer drag state for aiming or placing cue ball
  const dragStateRef = useRef<{
    mode: 'none' | 'aim' | 'place_cue';
    pointerId: number | null;
    lastAngle: number;
    cueCandidateX: number;
    cueCandidateY: number;
    cueCandidateValid: boolean;
  }>({
    mode: 'none',
    pointerId: null,
    lastAngle: 0,
    cueCandidateX: HEADSTRING_X - 40,
    cueCandidateY: TABLE_HEIGHT / 2,
    cueCandidateValid: true,
  });

  const screenToTable = (clientX: number, clientY: number): { tx: number; ty: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { tx: TABLE_WIDTH / 2, ty: TABLE_HEIGHT / 2 };
    const rect = canvas.getBoundingClientRect();
    const lx = ((clientX - rect.left) / Math.max(1, rect.width)) * LOGICAL_W;
    const ly = ((clientY - rect.top) / Math.max(1, rect.height)) * LOGICAL_H;
    return { tx: lx - RAIL_PAD, ty: ly - RAIL_PAD };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = propsRef.current;
    if (!p.canShoot || p.isSimulating) return;
    if (dragStateRef.current.pointerId !== null) return;

    const { tx, ty } = screenToTable(e.clientX, e.clientY);
    const cue = ballsRef.current.find((b) => b.id === 0);
    if (!cue) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    const distToCue = Math.hypot(tx - cue.x, ty - cue.y);

    if (p.ballInHand && distToCue <= BALL_RADIUS * 3.2) {
      dragStateRef.current = {
        mode: 'place_cue',
        pointerId: e.pointerId,
        lastAngle: p.aimAngle,
        cueCandidateX: cue.x,
        cueCandidateY: cue.y,
        cueCandidateValid: true,
      };
    } else {
      const startPointerAngle = Math.atan2(ty - cue.y, tx - cue.x);
      dragStateRef.current = {
        mode: 'aim',
        pointerId: e.pointerId,
        lastAngle: startPointerAngle,
        cueCandidateX: cue.x,
        cueCandidateY: cue.y,
        cueCandidateValid: true,
      };
      // Direct tap/drag snaps aim smoothly toward pointer
      p.onAimChange(startPointerAngle);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ds = dragStateRef.current;
    if (ds.mode === 'none' || ds.pointerId !== e.pointerId) return;

    const p = propsRef.current;
    const { tx, ty } = screenToTable(e.clientX, e.clientY);
    const cue = ballsRef.current.find((b) => b.id === 0);
    if (!cue) return;

    if (ds.mode === 'place_cue') {
      const maxX = p.headstringOnly ? HEADSTRING_X : TABLE_WIDTH - BALL_RADIUS - 2;
      const cx = Math.max(BALL_RADIUS + 2, Math.min(maxX, tx));
      const cy = Math.max(BALL_RADIUS + 2, Math.min(TABLE_HEIGHT - BALL_RADIUS - 2, ty));
      const valid = isValidCueBallPlacement(ballsRef.current, cx, cy, p.headstringOnly);
      ds.cueCandidateX = cx;
      ds.cueCandidateY = cy;
      ds.cueCandidateValid = valid;
      if (valid) {
        cue.x = cx;
        cue.y = cy;
      }
    } else if (ds.mode === 'aim') {
      const nextPointerAngle = Math.atan2(ty - cue.y, tx - cue.x);
      let delta = nextPointerAngle - ds.lastAngle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      ds.lastAngle = nextPointerAngle;
      const sens = Math.max(0.3, Math.min(2.2, p.settings.sensitivity));
      p.onAimChange(p.aimAngle + delta * sens);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ds = dragStateRef.current;
    if (ds.pointerId !== e.pointerId) return;
    if (ds.mode === 'place_cue') {
      const cue = ballsRef.current.find((b) => b.id === 0);
      if (cue) {
        propsRef.current.onPlaceCueBall(cue.x, cue.y);
      }
    }
    dragStateRef.current.mode = 'none';
    dragStateRef.current.pointerId = null;
  };

  // ResizeObserver for crisp DPR sizing
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const updateSize = () => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      if (cw <= 0 || ch <= 0) return;
      const aspect = LOGICAL_W / LOGICAL_H;
      let drawW = cw;
      let drawH = cw / aspect;
      if (drawH > ch) {
        drawH = ch;
        drawW = ch * aspect;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, propsRef.current.settings.graphicsQuality === 'low' ? 1 : 2);
      const nextW = Math.max(1, Math.floor(drawW * dpr));
      const nextH = Math.max(1, Math.floor(drawH * dpr));
      const nextStyleW = `${Math.floor(drawW)}px`;
      const nextStyleH = `${Math.floor(drawH)}px`;
      if (canvas.style.width !== nextStyleW) canvas.style.width = nextStyleW;
      if (canvas.style.height !== nextStyleH) canvas.style.height = nextStyleH;
      if (canvas.width !== nextW || canvas.height !== nextH) {
        canvas.width = nextW;
        canvas.height = nextH;
        lastRenderSigRef.current = '';
      }
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(container);
    window.addEventListener('resize', updateSize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  // Main 60fps Canvas Render Loop
  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();

    const spawnBurst = (x: number, y: number, count: number, color: string, speedScale = 1) => {
      const pool = particlesRef.current;
      for (let i = 0; i < count; i++) {
        const pt = pool[particleCursorRef.current];
        particleCursorRef.current = (particleCursorRef.current + 1) % pool.length;
        const a = Math.random() * Math.PI * 2;
        const sp = (25 + Math.random() * 90) * speedScale;
        pt.active = true;
        pt.x = x;
        pt.y = y;
        pt.vx = Math.cos(a) * sp;
        pt.vy = Math.sin(a) * sp;
        pt.life = 0;
        pt.maxLife = 0.25 + Math.random() * 0.25;
        pt.size = 1.6 + Math.random() * 2.4;
        pt.color = color;
      }
    };

    const getFeltPattern = (ctx: CanvasRenderingContext2D, tableId: string, baseColor: string) => {
      if (feltPatternRef.current && feltPatternTableIdRef.current === tableId) {
        return feltPatternRef.current;
      }
      const tile = document.createElement('canvas');
      tile.width = 48;
      tile.height = 48;
      const tctx = tile.getContext('2d');
      if (tctx) {
        tctx.fillStyle = baseColor;
        tctx.fillRect(0, 0, 48, 48);
        for (let y = 0; y < 48; y += 2) {
          for (let x = 0; x < 48; x += 2) {
            const noise = ((x * 37 + y * 17) % 13) - 6;
            tctx.fillStyle = noise > 0 ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.025)';
            tctx.fillRect(x, y, 1, 1);
          }
        }
        feltPatternRef.current = ctx.createPattern(tile, 'repeat');
        feltPatternTableIdRef.current = tableId;
      }
      return feltPatternRef.current;
    };

    const render = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const canvas = canvasRef.current;
      if (!canvas) {
        rafId = requestAnimationFrame(render);
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        rafId = requestAnimationFrame(render);
        return;
      }

      const p = propsRef.current;
      const tableItem = SHOP_CATALOG.find((i) => i.id === p.equippedTableId) || SHOP_CATALOG.find((i) => i.id === 'table_emerald')!;
      const cueItem = SHOP_CATALOG.find((i) => i.id === p.equippedCueId) || SHOP_CATALOG[0];
      const effectItem = SHOP_CATALOG.find((i) => i.id === p.equippedEffectId) || SHOP_CATALOG.find((i) => i.id === 'effect_classic')!;
      const highQuality = p.settings.graphicsQuality !== 'low';

      // Skip expensive redraw if completely stationary and unchanged
      let ballHash = 0;
      for (const b of ballsRef.current) {
        ballHash += b.x * 1.13 + b.y * 2.71 + (b.pocketed ? 777 : 0);
      }
      const hasParticles = particlesRef.current.some((pt) => pt.active);
      const hasPending = pendingEventsRef.current.length > 0;
      const isIdle = !p.isSimulating && !hasParticles && !hasPending && strikeFlashRef.current === 0;
      const sig = `${canvas.width}x${canvas.height}|${tableItem.id}|${cueItem.id}|${effectItem.id}|${p.settings.graphicsQuality}|${p.aimAngle.toFixed(4)}|${p.power.toFixed(3)}|${p.spinX.toFixed(2)}|${p.spinY.toFixed(2)}|${p.canShoot}|${p.ballInHand}|${p.headstringOnly}|${p.currentGroup}|${p.isBreakShot}|${p.gameVariant}|${p.targetBallNumber}|${ballHash.toFixed(2)}|${dragStateRef.current.mode}`;

      if (isIdle && sig === lastRenderSigRef.current) {
        rafId = requestAnimationFrame(render);
        return;
      }
      lastRenderSigRef.current = isIdle ? sig : '';

      // Process pending collision/pocket particle events
      while (pendingEventsRef.current.length > 0) {
        const ev = pendingEventsRef.current.shift()!;
        if (ev.type === 'cue') {
          spawnBurst(ev.x, ev.y, 10, effectItem.accentColor, 0.9);
        } else if (ev.type === 'ball' && ev.intensity > 0.35) {
          spawnBurst(ev.x, ev.y, 8, effectItem.primaryColor, ev.intensity);
        } else if (ev.type === 'pocket') {
          spawnBurst(ev.x, ev.y, 14, '#fbbf24', 1.1);
        }
      }

      if (strikeFlashRef.current > 0) {
        strikeFlashRef.current = Math.max(0, strikeFlashRef.current - dt * 5);
      }

      const scaleX = canvas.width / LOGICAL_W;
      const scaleY = canvas.height / LOGICAL_H;

      // Build/reuse offscreen static table cache for crisp 60fps performance
      const tableKey = `${canvas.width}x${canvas.height}|${tableItem.id}|${highQuality}`;
      if (!tableCacheCanvasRef.current) {
        tableCacheCanvasRef.current = document.createElement('canvas');
      }
      const cacheCanvas = tableCacheCanvasRef.current;
      if (tableCacheKeyRef.current !== tableKey || cacheCanvas.width !== canvas.width || cacheCanvas.height !== canvas.height) {
        cacheCanvas.width = canvas.width;
        cacheCanvas.height = canvas.height;
        const cctx = cacheCanvas.getContext('2d');
        if (cctx) {
          cctx.save();
          cctx.scale(scaleX, scaleY);
          cctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

          // 1. Outer Mahogany/Ebony Table Cabinet Frame using tableMeta
          const railTone = tableItem.tableMeta?.railTone || tableItem.secondaryColor;
          const feltGlow = tableItem.tableMeta?.feltGlow || tableItem.primaryColor;
          const trimTone = tableItem.tableMeta?.trimTone || '#fef3c7';

          const outerGrad = cctx.createLinearGradient(0, 0, LOGICAL_W, LOGICAL_H);
          outerGrad.addColorStop(0, tableItem.secondaryColor);
          outerGrad.addColorStop(0.5, railTone);
          outerGrad.addColorStop(1, tableItem.secondaryColor);
          cctx.fillStyle = outerGrad;
          cctx.beginPath();
          cctx.roundRect(4, 4, LOGICAL_W - 8, LOGICAL_H - 8, 28);
          cctx.fill();

          cctx.strokeStyle = 'rgba(255,255,255,0.1)';
          cctx.lineWidth = 2;
          cctx.beginPath();
          cctx.roundRect(6, 6, LOGICAL_W - 12, LOGICAL_H - 12, 26);
          cctx.stroke();

          // Brass/Chrome Corner & Side Pocket Plates
          const drawPlate = (x: number, y: number, w: number, h: number, r: number) => {
            const g = cctx.createLinearGradient(x, y, x + w, y + h);
            g.addColorStop(0, tableItem.accentColor);
            g.addColorStop(0.5, trimTone);
            g.addColorStop(1, tableItem.secondaryColor);
            cctx.fillStyle = g;
            cctx.beginPath();
            cctx.roundRect(x, y, w, h, r);
            cctx.fill();
          };
          drawPlate(4, 4, 62, 62, 22);
          drawPlate(LOGICAL_W - 66, 4, 62, 62, 22);
          drawPlate(4, LOGICAL_H - 66, 62, 62, 22);
          drawPlate(LOGICAL_W - 66, LOGICAL_H - 66, 62, 62, 22);
          drawPlate(LOGICAL_W / 2 - 26, 4, 52, 22, 6);
          drawPlate(LOGICAL_W / 2 - 26, LOGICAL_H - 26, 52, 22, 6);

          cctx.fillStyle = '#07120c';
          cctx.beginPath();
          cctx.roundRect(RAIL_PAD - 14, RAIL_PAD - 14, TABLE_WIDTH + 28, TABLE_HEIGHT + 28, 12);
          cctx.fill();

          // 2. Playing Surface (Felt Cloth)
          cctx.save();
          cctx.translate(RAIL_PAD, RAIL_PAD);
          const pattern = highQuality ? getFeltPattern(cctx, tableItem.id, tableItem.primaryColor) : null;
          cctx.fillStyle = pattern || tableItem.primaryColor;
          cctx.fillRect(0, 0, TABLE_WIDTH, TABLE_HEIGHT);

          if (highQuality) {
            const glowLight = cctx.createRadialGradient(
              TABLE_WIDTH * 0.5,
              TABLE_HEIGHT * 0.48,
              40,
              TABLE_WIDTH * 0.5,
              TABLE_HEIGHT * 0.5,
              TABLE_WIDTH * 0.65,
            );
            glowLight.addColorStop(0, feltGlow);
            glowLight.addColorStop(0.55, 'rgba(0,0,0,0)');
            glowLight.addColorStop(1, 'rgba(0,0,0,0.36)');
            cctx.globalAlpha = 0.42;
            cctx.fillStyle = glowLight;
            cctx.fillRect(0, 0, TABLE_WIDTH, TABLE_HEIGHT);
            cctx.globalAlpha = 1;
          }

          cctx.strokeStyle = 'rgba(0,0,0,0.45)';
          cctx.lineWidth = 8;
          cctx.strokeRect(-4, -4, TABLE_WIDTH + 8, TABLE_HEIGHT + 8);

          cctx.strokeStyle = 'rgba(255,255,255,0.18)';
          cctx.lineWidth = 1.5;
          cctx.beginPath();
          cctx.moveTo(HEADSTRING_X, 0);
          cctx.lineTo(HEADSTRING_X, TABLE_HEIGHT);
          cctx.stroke();

          cctx.fillStyle = 'rgba(255,255,255,0.22)';
          cctx.beginPath();
          cctx.arc(735, TABLE_HEIGHT / 2, 3.5, 0, Math.PI * 2);
          cctx.fill();

          // 3. Six Recessed Leather Pockets
          for (const pocket of POCKETS) {
            cctx.fillStyle = '#1c120d';
            cctx.beginPath();
            cctx.arc(pocket.x, pocket.y, pocket.radius + 5, 0, Math.PI * 2);
            cctx.fill();

            const wellGrad = cctx.createRadialGradient(
              pocket.x,
              pocket.y,
              4,
              pocket.x,
              pocket.y,
              pocket.radius,
            );
            wellGrad.addColorStop(0, '#020403');
            wellGrad.addColorStop(0.75, '#090d0b');
            wellGrad.addColorStop(1, '#1a241f');
            cctx.fillStyle = wellGrad;
            cctx.beginPath();
            cctx.arc(pocket.x, pocket.y, pocket.radius, 0, Math.PI * 2);
            cctx.fill();
          }

          // 4. Diamond Rail Sights on outer wood frame
          cctx.fillStyle = tableItem.accentColor;
          const sightXs = [125, 250, 375, 625, 750, 875];
          for (const sx of sightXs) {
            cctx.beginPath();
            cctx.arc(sx, -28, 3, 0, Math.PI * 2);
            cctx.arc(sx, TABLE_HEIGHT + 28, 3, 0, Math.PI * 2);
            cctx.fill();
          }
          const sightYs = [125, 250, 375];
          for (const sy of sightYs) {
            cctx.beginPath();
            cctx.arc(-28, sy, 3, 0, Math.PI * 2);
            cctx.arc(TABLE_WIDTH + 28, sy, 3, 0, Math.PI * 2);
            cctx.fill();
          }
          cctx.restore();
          cctx.restore();
          tableCacheKeyRef.current = tableKey;
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(cacheCanvas, 0, 0);

      ctx.save();
      ctx.scale(scaleX, scaleY);
      ctx.save();
      ctx.translate(RAIL_PAD, RAIL_PAD);

      // Highlight kitchen zone during headstring ball-in-hand
      if (p.canShoot && p.ballInHand && p.headstringOnly && !p.isSimulating) {
        ctx.fillStyle = 'rgba(16, 185, 129, 0.08)';
        ctx.fillRect(0, 0, HEADSTRING_X, TABLE_HEIGHT);
      }

      // 5. Render 16 Physics Balls
      const balls = ballsRef.current;
      for (const ball of balls) {
        if (ball.pocketed && ball.pocketAnimProgress >= 1) continue;

        const shrink = ball.pocketed ? Math.max(0.1, 1 - ball.pocketAnimProgress * 0.85) : 1;
        const alpha = ball.pocketed ? Math.max(0, 1 - ball.pocketAnimProgress) : 1;
        const r = BALL_RADIUS * shrink;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(ball.x, ball.y);

        // Contact drop shadow on felt
        if (!ball.pocketed) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.36)';
          ctx.beginPath();
          ctx.arc(3.2, 4.2, r * 1.02, 0, Math.PI * 2);
          ctx.fill();
        }

        // Base ball sphere clip
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.clip();

        const colorInfo = BALL_COLORS[ball.number] || { base: '#f8fafc', label: '' };

        if (ball.group === 'stripe') {
          // Ivory base + colored equatorial stripe shifted subtly by rollPhase
          ctx.fillStyle = '#f8fafc';
          ctx.fillRect(-r, -r, r * 2, r * 2);

          const stripeAngle = Math.atan2(ball.rollDirY, ball.rollDirX);
          ctx.save();
          ctx.rotate(stripeAngle);
          ctx.fillStyle = colorInfo.base;
          const shift = Math.sin(ball.rollPhase) * r * 0.22;
          ctx.fillRect(-r, -r * 0.56 + shift, r * 2, r * 1.12);
          ctx.restore();
        } else {
          ctx.fillStyle = colorInfo.base;
          ctx.fillRect(-r, -r, r * 2, r * 2);
        }

        // Number medallion for balls 1..15
        if (ball.number > 0) {
          const offsetX = Math.cos(ball.rollPhase) * ball.rollDirX * r * 0.18;
          const offsetY = Math.cos(ball.rollPhase) * ball.rollDirY * r * 0.18;

          ctx.fillStyle = '#f8fafc';
          ctx.beginPath();
          ctx.arc(offsetX, offsetY, r * 0.45, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#0f172a';
          ctx.font = `700 ${Math.max(8, Math.round(r * 0.62))}px "JetBrains Mono", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(ball.number), offsetX, offsetY + 0.5);
        } else if (Math.abs(p.spinX) > 0.05 || Math.abs(p.spinY) > 0.05) {
          // Subtle red chalk spin dot on cue ball when aiming
          if (!p.isSimulating) {
            ctx.fillStyle = 'rgba(220, 38, 38, 0.85)';
            ctx.beginPath();
            ctx.arc(p.spinX * r * 0.45, -p.spinY * r * 0.45, r * 0.18, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Spherical 3D ambient occlusion + glossy specular highlight
        const shade = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
        shade.addColorStop(0, 'rgba(255,255,255,0.45)');
        shade.addColorStop(0.28, 'rgba(255,255,255,0.08)');
        shade.addColorStop(0.75, 'rgba(0,0,0,0.08)');
        shade.addColorStop(1, 'rgba(0,0,0,0.46)');
        ctx.fillStyle = shade;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }

      // Highlight 9-Ball legal lowest object ball subtly when stationary
      if (p.gameVariant === '9ball' && p.targetBallNumber && !p.isSimulating) {
        const lowestBall = balls.find((b) => !b.pocketed && b.number === p.targetBallNumber);
        if (lowestBall) {
          ctx.save();
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.72)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(lowestBall.x, lowestBall.y, BALL_RADIUS + 5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      // 6. Ball-in-Hand Halo Indicator
      const cue = balls.find((b) => b.id === 0);
      if (cue && !cue.pocketed && p.canShoot && p.ballInHand && !p.isSimulating) {
        const ds = dragStateRef.current;
        const valid = ds.mode === 'place_cue' ? ds.cueCandidateValid : true;
        ctx.save();
        ctx.strokeStyle = valid ? '#34d399' : '#f87171';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(cue.x, cue.y, BALL_RADIUS + 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // 7. Aiming Lines & Cue Stick (when stationary)
      if (cue && !cue.pocketed && !p.isSimulating && (p.canShoot || p.power > 0)) {
        const cueStats = getCueStats(p.equippedCueId);
        const targetGuideLen = 45 + (cueStats.aim / 100) * 85;
        const deflectGuideLen = 30 + (cueStats.aim / 100) * 45;

        const pred = computeAimPrediction(
          balls,
          p.aimAngle,
          p.spinY,
          p.currentGroup,
          p.isBreakShot,
          p.gameVariant,
        );

        const lineColor = pred.isLegalTarget ? 'rgba(255, 255, 255, 0.78)' : 'rgba(248, 113, 113, 0.85)';

        // Primary sight line
        ctx.save();
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1.8;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(cue.x, cue.y);
        ctx.lineTo(pred.ghostX, pred.ghostY);
        ctx.stroke();

        // Ghost ball ring at impact point
        ctx.setLineDash([]);
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(pred.ghostX, pred.ghostY, BALL_RADIUS, 0, Math.PI * 2);
        ctx.stroke();

        if (!pred.isLegalTarget && pred.hitType === 'ball') {
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(pred.ghostX - 5, pred.ghostY - 5);
          ctx.lineTo(pred.ghostX + 5, pred.ghostY + 5);
          ctx.moveTo(pred.ghostX + 5, pred.ghostY - 5);
          ctx.lineTo(pred.ghostX - 5, pred.ghostY + 5);
          ctx.stroke();
        }

        // Target ball outgoing trajectory & cue ball deflection/bounce scaled by cue Aim spec
        if (pred.hitType === 'ball' && pred.targetBallId !== null) {
          const hitBall = balls.find((b) => b.id === pred.targetBallId);
          if (hitBall) {
            ctx.strokeStyle = pred.isLegalTarget ? 'rgba(251, 191, 36, 0.9)' : 'rgba(248, 113, 113, 0.6)';
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.moveTo(hitBall.x, hitBall.y);
            ctx.lineTo(
              hitBall.x + pred.targetDirX * targetGuideLen,
              hitBall.y + pred.targetDirY * targetGuideLen,
            );
            ctx.stroke();

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.52)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(pred.ghostX, pred.ghostY);
            ctx.lineTo(
              pred.ghostX + pred.cueDeflectX * deflectGuideLen,
              pred.ghostY + pred.cueDeflectY * deflectGuideLen,
            );
            ctx.stroke();
          }
        } else {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(pred.ghostX, pred.ghostY);
          ctx.lineTo(
            pred.ghostX + pred.bounceDirX * (deflectGuideLen + 14),
            pred.ghostY + pred.bounceDirY * (deflectGuideLen + 14),
          );
          ctx.stroke();
        }
        ctx.restore();

        // Draw Cue Stick behind cue ball
        const pullback = p.power * 105 - strikeFlashRef.current * 24;
        const tipDist = BALL_RADIUS + 10 + Math.max(-4, pullback);
        const cueLength = 320;

        ctx.save();
        ctx.translate(cue.x, cue.y);
        ctx.rotate(p.aimAngle + Math.PI);

        // Cue shadow
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.moveTo(tipDist, 3);
        ctx.lineTo(tipDist + cueLength, 7);
        ctx.lineTo(tipDist + cueLength, 11);
        ctx.lineTo(tipDist, 6);
        ctx.closePath();
        ctx.fill();

        // Cue body taper
        // Tip (chalk blue)
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(tipDist, -2.1, 4, 4.2);

        // Ferrule
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(tipDist + 4, -2.2, 8, 4.4);

        // Shaft
        const shaftGrad = ctx.createLinearGradient(tipDist + 12, 0, tipDist + 190, 0);
        shaftGrad.addColorStop(0, cueItem.primaryColor);
        shaftGrad.addColorStop(1, cueItem.accentColor);
        ctx.fillStyle = shaftGrad;
        ctx.beginPath();
        ctx.moveTo(tipDist + 12, -2.3);
        ctx.lineTo(tipDist + 190, -3.7);
        ctx.lineTo(tipDist + 190, 3.7);
        ctx.lineTo(tipDist + 12, 2.3);
        ctx.closePath();
        ctx.fill();

        // Butt / Handle
        ctx.fillStyle = cueItem.secondaryColor;
        ctx.beginPath();
        ctx.moveTo(tipDist + 190, -3.7);
        ctx.lineTo(tipDist + cueLength, -5.2);
        ctx.lineTo(tipDist + cueLength, 5.2);
        ctx.lineTo(tipDist + 190, 3.7);
        ctx.closePath();
        ctx.fill();

        // Decorative collar rings
        ctx.fillStyle = cueItem.accentColor;
        ctx.fillRect(tipDist + 188, -3.8, 6, 7.6);
        ctx.fillRect(tipDist + cueLength - 8, -5.2, 8, 10.4);

        ctx.restore();
      }

      // 8. Pooled Effect Particles
      const pool = particlesRef.current;
      for (let i = 0; i < pool.length; i++) {
        const pt = pool[i];
        if (!pt.active) continue;
        pt.life += dt;
        if (pt.life >= pt.maxLife) {
          pt.active = false;
          continue;
        }
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.vx *= 0.94;
        pt.vy *= 0.94;
        const a = 1 - pt.life / pt.maxLife;
        ctx.globalAlpha = a;
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      ctx.restore(); // end table coords
      ctx.restore(); // end logical scale

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [ballsRef, pendingEventsRef, strikeFlashRef]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex items-center justify-center select-none touch-none"
    >
      <canvas
        ref={canvasRef}
        data-testid="billiard-canvas"
        data-turn={currentTurnLabel}
        data-phase={phaseLabel}
        data-simulating={isSimulating ? 'true' : 'false'}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="rounded-2xl shadow-2xl cursor-crosshair touch-none"
      />
    </div>
  );
};
