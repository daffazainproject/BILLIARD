import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseAiCueBallPlacement, computeAiShot } from './ai.ts';
import { applyCueShot, areBallsMoving, isValidCueBallPlacement, stepPhysicsFrame } from './physics.ts';
import { createBall, createInitialRulesState } from './rack.ts';
import type { ShotTelemetry } from './types.ts';

test('Pro AI sinks a clean straight-in 8-ball pocket shot', () => {
  const cue = createBall(0, 720, 220);
  const one = createBall(1, 860, 120);
  const eight = createBall(8, 220, 380);
  const balls = [cue, one, eight];

  const rules = {
    ...createInitialRulesState('B', '8ball'),
    phase: 'assigned' as const,
    groupA: 'stripe' as const,
    groupB: 'solid' as const,
    isBreakShot: false,
    ballInHand: false,
    headstringOnly: false,
  };

  const shot = computeAiShot(balls, rules, 'pro', () => 0.5);
  applyCueShot(balls, shot, false);

  const telemetry: ShotTelemetry = {
    firstContactBallId: null,
    pocketedBallIds: [],
    railContactAfterFirstHit: false,
    cushionHitCount: 0,
  };

  for (let i = 0; i < 600; i++) {
    stepPhysicsFrame(balls, telemetry);
    if (!areBallsMoving(balls)) break;
  }

  assert.equal(telemetry.firstContactBallId, 1);
  assert.ok(telemetry.pocketedBallIds.includes(1), 'Expected Pro AI to pocket ball 1');
});

test('Pro AI in 9-ball targets lowest numbered ball and ignores higher balls', () => {
  const cue = createBall(0, 480, 250);
  const two = createBall(2, 660, 160);
  const nine = createBall(9, 600, 260);
  const balls = [cue, two, nine];

  const rules = {
    ...createInitialRulesState('B', '9ball'),
    phase: 'nine_ball' as const,
    targetBallNumber: 2,
    isBreakShot: false,
    ballInHand: false,
    headstringOnly: false,
  };

  const shot = computeAiShot(balls, rules, 'pro', () => 0.5);
  applyCueShot(balls, shot, false);

  const telemetry: ShotTelemetry = {
    firstContactBallId: null,
    pocketedBallIds: [],
    railContactAfterFirstHit: false,
    cushionHitCount: 0,
  };

  for (let i = 0; i < 600; i++) {
    stepPhysicsFrame(balls, telemetry);
    if (!areBallsMoving(balls)) break;
  }

  assert.equal(telemetry.firstContactBallId, 2);
});

test('Pro AI ball-in-hand placement picks a valid unobstructed spot', () => {
  const cue = createBall(0, 200, 250);
  const three = createBall(3, 820, 140);
  const balls = [cue, three];
  const rules = {
    ...createInitialRulesState('B', '9ball'),
    phase: 'nine_ball' as const,
    targetBallNumber: 3,
    isBreakShot: false,
    ballInHand: true,
    headstringOnly: false,
  };

  const pos = chooseAiCueBallPlacement(balls, rules, 'pro');
  assert.ok(isValidCueBallPlacement(balls, pos.x, pos.y, false));
});
