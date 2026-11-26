import {
  BALL_RADIUS,
  FOOT_SPOT_X,
  FOOT_SPOT_Y,
  HEADSTRING_X,
  POCKETS,
  TABLE_HEIGHT,
  TABLE_WIDTH,
} from './constants.ts';
import { findSafeCueBallSpot, isTargetBallLegal, isValidCueBallPlacement } from './physics.ts';
import { getPlayerGroup } from './rules.ts';
import type { AiDifficulty, BallState, MatchRulesState, PocketDef, ShotInput } from './types.ts';

function pointToSegmentDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < 1e-6) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lenSq));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function isSegmentClear(
  balls: BallState[],
  ax: number,
  ay: number,
  bx: number,
  by: number,
  excludeIds: number[],
): boolean {
  const minClear = BALL_RADIUS * 2 - 1.2;
  for (const b of balls) {
    if (b.pocketed || excludeIds.includes(b.id)) continue;
    if (pointToSegmentDist(b.x, b.y, ax, ay, bx, by) < minClear) {
      return false;
    }
  }
  return true;
}

function getPocketAimPoint(pocket: PocketDef): { x: number; y: number } {
  // Aim slightly inside the pocket mouth toward table center so corner balls drop cleanly
  const cx = TABLE_WIDTH / 2;
  const cy = TABLE_HEIGHT / 2;
  const dx = cx - pocket.x;
  const dy = cy - pocket.y;
  const len = Math.hypot(dx, dy) || 1;
  const pull = pocket.isCorner ? 4 : 3;
  return {
    x: pocket.x + (dx / len) * pull,
    y: pocket.y + (dy / len) * pull,
  };
}

function getLegalTargetBalls(balls: BallState[], rules: MatchRulesState): BallState[] {
  const group = getPlayerGroup(rules, rules.currentTurn);
  return balls.filter((b) => {
    if (b.id === 0 || b.pocketed) return false;
    return isTargetBallLegal(b.id, group, balls, rules.isBreakShot, rules.gameVariant);
  });
}

function willCueDeflectScratch(
  ghostX: number,
  ghostY: number,
  deflectX: number,
  deflectY: number,
): boolean {
  for (const p of POCKETS) {
    const toPx = p.x - ghostX;
    const toPy = p.y - ghostY;
    const dist = Math.hypot(toPx, toPy);
    if (dist < 1 || dist > 380) continue;
    const dot = (toPx / dist) * deflectX + (toPy / dist) * deflectY;
    if (dot > 0.965) return true;
  }
  return false;
}

export interface ScoredAiCandidate {
  angle: number;
  power: number;
  spinX: number;
  spinY: number;
  score: number;
  targetBallId: number;
  pocketId: number;
}

export function evaluateBestDirectShots(
  balls: BallState[],
  rules: MatchRulesState,
  cueX: number,
  cueY: number,
): ScoredAiCandidate[] {
  const legalTargets = getLegalTargetBalls(balls, rules);
  const candidates: ScoredAiCandidate[] = [];
  const rSum = BALL_RADIUS * 2;

  for (const target of legalTargets) {
    for (const pocket of POCKETS) {
      const aimPt = getPocketAimPoint(pocket);
      const tx = aimPt.x - target.x;
      const ty = aimPt.y - target.y;
      const tDist = Math.hypot(tx, ty);
      if (tDist < 1) continue;

      const tDirX = tx / tDist;
      const tDirY = ty / tDist;

      // Ghost ball impact center
      const ghostX = target.x - tDirX * rSum;
      const ghostY = target.y - tDirY * rSum;

      if (
        ghostX < BALL_RADIUS + 2 ||
        ghostX > TABLE_WIDTH - BALL_RADIUS - 2 ||
        ghostY < BALL_RADIUS + 2 ||
        ghostY > TABLE_HEIGHT - BALL_RADIUS - 2
      ) {
        continue;
      }

      const cx = ghostX - cueX;
      const cy = ghostY - cueY;
      const cDist = Math.hypot(cx, cy);
      if (cDist < 1) continue;

      const cDirX = cx / cDist;
      const cDirY = cy / cDist;

      // Cut alignment: 1.0 = dead straight, 0 = 90-deg impossible thin cut
      const cutCos = cDirX * tDirX + cDirY * tDirY;
      if (cutCos < 0.24) continue;

      const cueClear = isSegmentClear(balls, cueX, cueY, ghostX, ghostY, [0, target.id]);
      const objClear = isSegmentClear(balls, target.x, target.y, aimPt.x, aimPt.y, [0, target.id]);
      if (!cueClear || !objClear) continue;

      // Natural cue tangent deflection
      const dot = cDirX * tDirX + cDirY * tDirY;
      const defX = cDirX - dot * tDirX;
      const defY = cDirY - dot * tDirY;
      const defLen = Math.hypot(defX, defY) || 1;
      const scratchDanger = willCueDeflectScratch(ghostX, ghostY, defX / defLen, defY / defLen);

      // Compute smart shot power scaled by travel distance & cut angle
      const totalDist = cDist + tDist;
      const basePower = 0.26 + Math.min(0.56, totalDist / 1350) + (1 - cutCos) * 0.16;
      const power = Math.max(0.26, Math.min(0.88, basePower));

      // Subtle follow or draw to steer cue away from pocket scratches
      let spinY = 0;
      if (scratchDanger) {
        spinY = cutCos > 0.72 ? -0.48 : 0.42;
      } else if (cutCos > 0.85 && cDist < 360) {
        spinY = -0.2;
      }

      const pocketBonus = pocket.isCorner ? 12 : 4;
      const distPenalty = totalDist * 0.055;
      const cutScore = Math.pow(cutCos, 1.5) * 110;
      const scratchPenalty = scratchDanger ? 45 : 0;
      const score = cutScore + pocketBonus - distPenalty - scratchPenalty;

      candidates.push({
        angle: Math.atan2(cDirY, cDirX),
        power,
        spinX: 0,
        spinY,
        score,
        targetBallId: target.id,
        pocketId: pocket.id,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

export function chooseAiCueBallPlacement(
  balls: BallState[],
  rules: MatchRulesState,
  difficulty: AiDifficulty = 'pro',
): { x: number; y: number } {
  const legalTargets = getLegalTargetBalls(balls, rules);
  const rSum = BALL_RADIUS * 2;
  let bestSpot: { x: number; y: number } | null = null;
  let bestScore = -Infinity;

  // Test clean setup positions aligned behind legal target balls toward pockets
  for (const target of legalTargets) {
    for (const pocket of POCKETS) {
      const aimPt = getPocketAimPoint(pocket);
      const tx = aimPt.x - target.x;
      const ty = aimPt.y - target.y;
      const tDist = Math.hypot(tx, ty);
      if (tDist < 1) continue;
      const tDirX = tx / tDist;
      const tDirY = ty / tDist;

      const objClear = isSegmentClear(balls, target.x, target.y, aimPt.x, aimPt.y, [0, target.id]);
      if (!objClear) continue;

      const distances = difficulty === 'pro' ? [115, 165, 220] : [150, 210];
      for (const setupDist of distances) {
        const cx = target.x - tDirX * (rSum + setupDist);
        const cy = target.y - tDirY * (rSum + setupDist);
        if (!isValidCueBallPlacement(balls, cx, cy, rules.headstringOnly)) continue;
        if (!isSegmentClear(balls, cx, cy, target.x - tDirX * rSum, target.y - tDirY * rSum, [0, target.id])) {
          continue;
        }
        const score = 120 - tDist * 0.06 - setupDist * 0.04 + (pocket.isCorner ? 10 : 0);
        if (score > bestScore) {
          bestScore = score;
          bestSpot = { x: cx, y: cy };
        }
      }
    }
  }

  return bestSpot ?? findSafeCueBallSpot(balls, rules.headstringOnly);
}

export function computeAiShot(
  balls: BallState[],
  rules: MatchRulesState,
  difficulty: AiDifficulty = 'pro',
  rng: () => number = Math.random,
): ShotInput {
  const cue = balls.find((b) => b.id === 0);
  if (!cue) {
    return { angle: 0, power: 0.6, spinX: 0, spinY: 0 };
  }

  // 1. Break Shot
  if (rules.isBreakShot) {
    const apex = balls.find((b) => b.id === 1) ?? { x: FOOT_SPOT_X, y: FOOT_SPOT_Y };
    const jitter = difficulty === 'pro' ? (rng() - 0.5) * 0.015 : (rng() - 0.5) * 0.04;
    const angle = Math.atan2(apex.y - cue.y, apex.x - cue.x) + jitter;
    return {
      angle,
      power: difficulty === 'pro' ? 0.96 : difficulty === 'semipro' ? 0.9 : 0.82,
      spinX: 0,
      spinY: 0.25,
    };
  }

  // 2. Evaluate unobstructed direct pocket shots
  const candidates = evaluateBestDirectShots(balls, rules, cue.x, cue.y);
  const jitterRadius =
    difficulty === 'pro' ? 0.004 : difficulty === 'semipro' ? 0.016 : 0.042;

  if (candidates.length > 0) {
    // Pro takes #1 optimal shot; Club occasionally picks #2
    const pickIdx =
      difficulty === 'club' && candidates.length > 1 && rng() < 0.35 ? 1 : 0;
    const chosen = candidates[pickIdx];
    const jitter = (rng() - 0.5) * 2 * jitterRadius;
    return {
      angle: chosen.angle + jitter,
      power: chosen.power,
      spinX: chosen.spinX,
      spinY: chosen.spinY,
    };
  }

  // 3. Fallback: Hit an unobstructed legal ball cleanly (bank/safety) to avoid foul
  const legalTargets = getLegalTargetBalls(balls, rules);
  let fallbackTarget: BallState | null = null;
  let bestDist = Infinity;

  for (const t of legalTargets) {
    const clear = isSegmentClear(balls, cue.x, cue.y, t.x, t.y, [0, t.id]);
    const dist = Math.hypot(t.x - cue.x, t.y - cue.y);
    if (clear && dist < bestDist) {
      bestDist = dist;
      fallbackTarget = t;
    }
  }

  if (!fallbackTarget && legalTargets.length > 0) {
    fallbackTarget = legalTargets[0];
  }

  if (fallbackTarget) {
    const angle =
      Math.atan2(fallbackTarget.y - cue.y, fallbackTarget.x - cue.x) +
      (rng() - 0.5) * jitterRadius;
    return {
      angle,
      power: 0.52,
      spinX: 0,
      spinY: 0,
    };
  }

  return { angle: 0, power: 0.5, spinX: 0, spinY: 0 };
}
