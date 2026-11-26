import { DEFAULT_RULE_OPTIONS, FOOT_SPOT_X, FOOT_SPOT_Y, BALL_RADIUS, TABLE_WIDTH, TABLE_HEIGHT } from './constants.ts';
import { getBallGroup, getLowestObjectBallNumber } from './rack.ts';
import type { BallState, BallSuit, MatchRulesState, PlayerSlot, RuleOptions, ShotTelemetry } from './types.ts';

function otherPlayer(p: PlayerSlot): PlayerSlot {
  return p === 'A' ? 'B' : 'A';
}

export function getPlayerGroup(rules: MatchRulesState, player: PlayerSlot): BallSuit {
  return player === 'A' ? rules.groupA : rules.groupB;
}

function countRemaining(balls: BallState[], suit: 'solid' | 'stripe'): number {
  return balls.filter((b) => !b.pocketed && b.group === suit).length;
}

function respotBall(balls: BallState[], ballId: number): void {
  const target = balls.find((b) => b.id === ballId);
  if (!target) return;

  let sx = FOOT_SPOT_X;
  let sy = FOOT_SPOT_Y;
  const minDist = BALL_RADIUS * 2 + 1;
  // Shift cleanly toward foot rail if foot spot is occupied
  for (let offset = 0; offset <= TABLE_WIDTH - FOOT_SPOT_X - BALL_RADIUS - 4; offset += BALL_RADIUS * 2 + 2) {
    const cx = Math.min(TABLE_WIDTH - BALL_RADIUS - 4, FOOT_SPOT_X + offset);
    const blocked = balls.some((b) => b.id !== ballId && !b.pocketed && Math.hypot(b.x - cx, b.y - sy) < minDist);
    if (!blocked) {
      sx = cx;
      break;
    }
  }
  sy = Math.max(BALL_RADIUS + 4, Math.min(TABLE_HEIGHT - BALL_RADIUS - 4, sy));

  target.pocketed = false;
  target.pocketAnimProgress = 0;
  target.pocketedInPocketId = null;
  target.vx = 0;
  target.vy = 0;
  target.spinX = 0;
  target.spinY = 0;
  target.x = sx;
  target.y = sy;
}

function evaluateNineBallOutcome(
  prev: MatchRulesState,
  telemetry: ShotTelemetry,
  balls: BallState[],
): MatchRulesState {
  const next: MatchRulesState = { ...prev, gameVariant: '9ball' };
  const shooter = prev.currentTurn;
  const opponent = otherPlayer(shooter);

  if (shooter === 'A') next.shotCountA += 1;
  else next.shotCountB += 1;

  const cuePocketed = telemetry.pocketedBallIds.includes(0);
  const ninePocketed = telemetry.pocketedBallIds.includes(9);
  const objectPocketedIds = telemetry.pocketedBallIds.filter((id) => id !== 0);

  let lowestBefore = prev.targetBallNumber ?? 1;
  let computedMin = Infinity;
  for (const b of balls) {
    if (b.id > 0 && (!b.pocketed || telemetry.pocketedBallIds.includes(b.id))) {
      if (b.number < computedMin) computedMin = b.number;
    }
  }
  if (Number.isFinite(computedMin)) lowestBefore = computedMin;

  next.foulReason = null;
  next.lastEventMessage = null;

  if (prev.isBreakShot) {
    next.isBreakShot = false;
    let breakFoul: string | null = null;
    if (cuePocketed) {
      breakFoul = 'Scratch on the 9-Ball break! Ball in hand.';
    } else if (telemetry.firstContactBallId !== 1) {
      breakFoul = 'Foul on break! Must hit the 1-ball first.';
    } else if (objectPocketedIds.length === 0 && telemetry.cushionHitCount < 4) {
      breakFoul = 'Illegal break (fewer than 4 rails hit). Ball in hand.';
    }

    if (breakFoul) {
      if (ninePocketed) respotBall(balls, 9);
      next.phase = 'nine_ball';
      next.currentTurn = opponent;
      next.ballInHand = true;
      next.headstringOnly = false;
      next.foulReason = breakFoul;
      next.lastEventMessage = breakFoul;
      next.turnNumber += 1;
      next.targetBallNumber = getLowestObjectBallNumber(balls);
      return next;
    }

    if (ninePocketed) {
      if (shooter === 'A') next.pottedCountA += objectPocketedIds.length;
      else next.pottedCountB += objectPocketedIds.length;
      next.phase = 'gameover';
      next.winner = shooter;
      next.winReason = '9-Ball pocketed on a legal break! Victory!';
      next.lastEventMessage = next.winReason;
      next.targetBallNumber = null;
      return next;
    }

    next.phase = 'nine_ball';
    next.ballInHand = false;
    next.headstringOnly = false;
    next.targetBallNumber = getLowestObjectBallNumber(balls);
    if (objectPocketedIds.length > 0) {
      if (shooter === 'A') next.pottedCountA += objectPocketedIds.length;
      else next.pottedCountB += objectPocketedIds.length;
      next.currentTurn = shooter;
      next.lastEventMessage = `Break successful! Target: ${next.targetBallNumber}-Ball.`;
    } else {
      next.currentTurn = opponent;
      next.turnNumber += 1;
      next.lastEventMessage = `Break complete. Target: ${next.targetBallNumber}-Ball.`;
    }
    return next;
  }

  let foulReason: string | null = null;
  if (cuePocketed) {
    foulReason = 'Scratch! Cue ball pocketed.';
  } else if (telemetry.firstContactBallId === null) {
    foulReason = 'Foul! Cue ball failed to hit any ball.';
  } else if (telemetry.firstContactBallId !== lowestBefore) {
    foulReason = `Foul! Must hit the ${lowestBefore}-ball first.`;
  } else if (objectPocketedIds.length === 0 && !telemetry.railContactAfterFirstHit) {
    foulReason = 'Foul! No rail contact or ball pocketed after hit.';
  }

  if (foulReason) {
    if (ninePocketed) respotBall(balls, 9);
    next.phase = 'nine_ball';
    next.foulReason = foulReason;
    next.lastEventMessage = foulReason;
    next.currentTurn = opponent;
    next.ballInHand = true;
    next.headstringOnly = false;
    next.turnNumber += 1;
    next.targetBallNumber = getLowestObjectBallNumber(balls);
    return next;
  }

  if (ninePocketed) {
    if (shooter === 'A') next.pottedCountA += objectPocketedIds.length;
    else next.pottedCountB += objectPocketedIds.length;
    next.phase = 'gameover';
    next.winner = shooter;
    next.winReason = 'Legal 9-Ball pocket! Victory!';
    next.lastEventMessage = next.winReason;
    next.targetBallNumber = null;
    return next;
  }

  next.phase = 'nine_ball';
  next.ballInHand = false;
  next.headstringOnly = false;
  next.targetBallNumber = getLowestObjectBallNumber(balls);

  if (objectPocketedIds.length > 0) {
    if (shooter === 'A') next.pottedCountA += objectPocketedIds.length;
    else next.pottedCountB += objectPocketedIds.length;
    next.currentTurn = shooter;
    next.lastEventMessage = `Nice shot! Next target: ${next.targetBallNumber}-Ball.`;
  } else {
    next.currentTurn = opponent;
    next.turnNumber += 1;
    next.lastEventMessage = `Turn passes. Target: ${next.targetBallNumber}-Ball.`;
  }

  return next;
}

/**
 * Evaluates full American 8-Ball or 9-Ball outcome once all balls come to rest after a shot.
 */
export function evaluateShotOutcome(
  prev: MatchRulesState,
  telemetry: ShotTelemetry,
  balls: BallState[],
  options: RuleOptions = DEFAULT_RULE_OPTIONS,
): MatchRulesState {
  if (prev.gameVariant === '9ball') {
    return evaluateNineBallOutcome(prev, telemetry, balls);
  }

  const next: MatchRulesState = { ...prev };
  const shooter = prev.currentTurn;
  const opponent = otherPlayer(shooter);

  if (shooter === 'A') {
    next.shotCountA += 1;
  } else {
    next.shotCountB += 1;
  }

  const cuePocketed = telemetry.pocketedBallIds.includes(0);
  const eightPocketed = telemetry.pocketedBallIds.includes(8);
  const solidsPocketed = telemetry.pocketedBallIds.filter((id) => getBallGroup(id) === 'solid');
  const stripesPocketed = telemetry.pocketedBallIds.filter((id) => getBallGroup(id) === 'stripe');
  const objectPocketedCount = solidsPocketed.length + stripesPocketed.length;

  next.foulReason = null;
  next.lastEventMessage = null;

  // 1. BREAK SHOT RULES
  if (prev.isBreakShot) {
    next.isBreakShot = false;

    if (eightPocketed) {
      if (cuePocketed) {
        next.phase = 'gameover';
        next.winner = opponent;
        next.winReason = 'Scratch while pocketing the 8-ball on the break.';
        next.lastEventMessage = next.winReason;
        return next;
      }
      // Standard WPA rule: re-spot 8-ball if pocketed legally on break, play continues
      respotBall(balls, 8);
      next.lastEventMessage = '8-Ball pocketed on break and re-spotted.';
    }

    if (cuePocketed) {
      next.phase = 'open';
      next.currentTurn = opponent;
      next.ballInHand = true;
      next.headstringOnly = options.foulOnBreakScratchHeadstring;
      next.foulReason = 'Scratch on the break! Ball in hand.';
      next.lastEventMessage = next.foulReason;
      next.turnNumber += 1;
      return next;
    }

    // Break requires either pocketing a ball or >= 4 cushion contacts
    if (objectPocketedCount === 0 && telemetry.cushionHitCount < 4) {
      next.phase = 'open';
      next.currentTurn = opponent;
      next.ballInHand = false;
      next.headstringOnly = false;
      next.foulReason = 'Illegal break (fewer than 4 rails hit). Turn passes.';
      next.lastEventMessage = next.foulReason;
      next.turnNumber += 1;
      return next;
    }

    // Table remains open after break in American 8-Ball
    next.phase = 'open';
    next.ballInHand = false;
    next.headstringOnly = false;
    if (objectPocketedCount > 0) {
      if (shooter === 'A') next.pottedCountA += objectPocketedCount;
      else next.pottedCountB += objectPocketedCount;
      next.currentTurn = shooter;
      next.lastEventMessage = 'Break successful! Table is open.';
    } else {
      next.currentTurn = opponent;
      next.lastEventMessage = 'Break complete. Table is open.';
      next.turnNumber += 1;
    }
    return next;
  }

  // 2. REGULAR SHOT FOUL DETECTION
  const shooterGroup = getPlayerGroup(prev, shooter);
  const shooterRemainingBefore =
    shooterGroup === null
      ? 7
      : countRemaining(balls, shooterGroup) +
        (shooterGroup === 'solid' ? solidsPocketed.length : stripesPocketed.length);

  let foulReason: string | null = null;

  if (cuePocketed) {
    foulReason = 'Scratch! Cue ball pocketed.';
  } else if (telemetry.firstContactBallId === null) {
    foulReason = 'Foul! Cue ball failed to hit any object ball.';
  } else {
    const firstGroup = getBallGroup(telemetry.firstContactBallId);
    if (shooterGroup === null) {
      if (firstGroup === 'eight') {
        foulReason = 'Foul! Cannot hit the 8-ball first on an open table.';
      }
    } else if (shooterRemainingBefore > 0 && firstGroup !== shooterGroup) {
      foulReason = `Foul! Must strike a ${shooterGroup} ball first.`;
    } else if (shooterRemainingBefore === 0 && firstGroup !== 'eight') {
      foulReason = 'Foul! Must strike the 8-ball first.';
    }

    if (!foulReason && objectPocketedCount === 0 && !eightPocketed && !telemetry.railContactAfterFirstHit) {
      foulReason = 'Foul! No rail contact or ball pocketed after hit.';
    }
  }

  // 3. 8-BALL POCKET EVALUATION
  if (eightPocketed) {
    if (shooterGroup === null || shooterRemainingBefore > 0) {
      if (options.loseOnEarlyEightBall) {
        next.phase = 'gameover';
        next.winner = opponent;
        next.winReason = '8-Ball pocketed before clearing assigned group.';
        next.lastEventMessage = next.winReason;
        return next;
      }
    }
    if (foulReason && options.loseOnEightBallScratch) {
      next.phase = 'gameover';
      next.winner = opponent;
      next.winReason = `Loss on 8-ball foul (${foulReason})`;
      next.lastEventMessage = next.winReason;
      return next;
    }
    if (!foulReason && shooterGroup !== null && shooterRemainingBefore === 0) {
      next.phase = 'gameover';
      next.winner = shooter;
      next.winReason = 'Legal 8-ball pocket! Victory!';
      next.lastEventMessage = next.winReason;
      if (shooter === 'A') next.pottedCountA += 1;
      else next.pottedCountB += 1;
      return next;
    }
  }

  // 4. APPLY FOUL IF ANY
  if (foulReason) {
    next.foulReason = foulReason;
    next.lastEventMessage = foulReason;
    next.currentTurn = opponent;
    next.ballInHand = true;
    next.headstringOnly = false;
    next.turnNumber += 1;
    // Update phase if opponent now has 8-ball
    const oppGroup = getPlayerGroup(next, opponent);
    if (oppGroup && countRemaining(balls, oppGroup) === 0) {
      next.phase = 'eight_ball';
    }
    return next;
  }

  // 5. OPEN TABLE GROUP ASSIGNMENT
  next.ballInHand = false;
  next.headstringOnly = false;

  if (shooterGroup === null) {
    if (solidsPocketed.length > 0 && stripesPocketed.length === 0) {
      if (shooter === 'A') {
        next.groupA = 'solid';
        next.groupB = 'stripe';
      } else {
        next.groupB = 'solid';
        next.groupA = 'stripe';
      }
      next.phase = countRemaining(balls, 'solid') === 0 ? 'eight_ball' : 'assigned';
      if (shooter === 'A') next.pottedCountA += solidsPocketed.length;
      else next.pottedCountB += solidsPocketed.length;
      next.currentTurn = shooter;
      next.lastEventMessage = `Solids assigned to Player ${shooter}!`;
      return next;
    }

    if (stripesPocketed.length > 0 && solidsPocketed.length === 0) {
      if (shooter === 'A') {
        next.groupA = 'stripe';
        next.groupB = 'solid';
      } else {
        next.groupB = 'stripe';
        next.groupA = 'solid';
      }
      next.phase = countRemaining(balls, 'stripe') === 0 ? 'eight_ball' : 'assigned';
      if (shooter === 'A') next.pottedCountA += stripesPocketed.length;
      else next.pottedCountB += stripesPocketed.length;
      next.currentTurn = shooter;
      next.lastEventMessage = `Stripes assigned to Player ${shooter}!`;
      return next;
    }

    // Both solid and stripe pocketed on open table -> assign based on first pocketed object ball
    if (solidsPocketed.length > 0 && stripesPocketed.length > 0) {
      const firstObjectId = telemetry.pocketedBallIds.find((id) => id !== 0 && id !== 8)!;
      const chosen = getBallGroup(firstObjectId) as 'solid' | 'stripe';
      const oppSuit = chosen === 'solid' ? 'stripe' : 'solid';
      if (shooter === 'A') {
        next.groupA = chosen;
        next.groupB = oppSuit;
      } else {
        next.groupB = chosen;
        next.groupA = oppSuit;
      }
      next.phase = countRemaining(balls, chosen) === 0 ? 'eight_ball' : 'assigned';
      if (shooter === 'A') next.pottedCountA += objectPocketedCount;
      else next.pottedCountB += objectPocketedCount;
      next.currentTurn = shooter;
      next.lastEventMessage = `${chosen === 'solid' ? 'Solids' : 'Stripes'} assigned to Player ${shooter}!`;
      return next;
    }

    // No ball pocketed on open table -> pass turn
    next.currentTurn = opponent;
    next.lastEventMessage = 'Table remains open.';
    next.turnNumber += 1;
    return next;
  }

  // 6. ASSIGNED TABLE CONTINUATION
  const ownPocketed = shooterGroup === 'solid' ? solidsPocketed.length : stripesPocketed.length;
  if (ownPocketed > 0) {
    if (shooter === 'A') next.pottedCountA += ownPocketed;
    else next.pottedCountB += ownPocketed;
    next.currentTurn = shooter;
    const rem = countRemaining(balls, shooterGroup);
    next.phase = rem === 0 ? 'eight_ball' : 'assigned';
    next.lastEventMessage = rem === 0 ? 'Group cleared! Aim for the 8-Ball.' : 'Nice shot! Shoot again.';
    return next;
  }

  // Turn passes cleanly
  next.currentTurn = opponent;
  next.turnNumber += 1;
  const oppGroup = getPlayerGroup(next, opponent);
  if (oppGroup && countRemaining(balls, oppGroup) === 0) {
    next.phase = 'eight_ball';
    next.lastEventMessage = `Player ${opponent} is on the 8-Ball.`;
  } else {
    next.lastEventMessage = 'Turn passes.';
  }
  return next;
}
