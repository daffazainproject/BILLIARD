import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  MessageSquare,
  Palette,
  RotateCcw,
  Send,
  Volume2,
  VolumeX,
  WifiOff,
} from 'lucide-react';
import {
  BALL_COLORS,
  BILLIARD_EMOTES,
  getCueStats,
  PHYSICS_PARAMS,
  QUICK_CHAT_MESSAGES,
  SHOP_CATALOG,
} from '../game/constants.ts';
import { chooseAiCueBallPlacement, computeAiShot } from '../game/ai.ts';
import {
  applyCueShot,
  areBallsMoving,
  findSafeCueBallSpot,
  stepPhysicsFrame,
} from '../game/physics.ts';
import {
  createInitialRulesState,
  createRackForVariant,
  getLowestObjectBallNumber,
} from '../game/rack.ts';
import { evaluateShotOutcome, getPlayerGroup } from '../game/rules.ts';
import type {
  BallState,
  BallSuit,
  MatchRulesState,
  PhysicsEvent,
  PlayerSlot,
  ShotInput,
  ShotTelemetry,
  UserProfile,
  UserSettings,
} from '../game/types.ts';
import { applyXpProgress, calculateEloDelta, computeMatchRewards } from '../game/elo.ts';
import { audioEngine, triggerHaptic } from '../services/audio.ts';
import { buildShotAction, pushFirestoreMatchAction, subscribeFirestoreMatch } from '../services/firestoreRooms.ts';
import { t } from '../services/i18n.ts';
import { wsClient } from '../services/wsClient.ts';
import { BilliardCanvas } from './BilliardCanvas.tsx';
import { MatchResultModal, type MatchResultSummary } from './MatchResultModal.tsx';
import { PlayerAvatar } from './PlayerAvatar.tsx';
import { PowerBar } from './PowerBar.tsx';
import type { PracticeLaunchConfig } from './PracticeSetupModal.tsx';
import { SpinControl } from './SpinControl.tsx';

export interface OnlineMatchInit {
  matchId: string;
  roomId: string | null;
  gameMode: 'quick_match' | 'private_room' | 'online_ranked';
  entryFee: number;
  yourSlot: PlayerSlot;
  reconnectToken: string;
  seq: number;
  simulating: boolean;
  balls: BallState[];
  rules: MatchRulesState;
  firestoreSync?: boolean;
  firestoreRoomCode?: string;
  playerA: {
    uid: string;
    username: string;
    avatar: string;
    frame: string;
    level: number;
    rating: number;
    equippedCue: string;
    equippedTable: string;
    equippedEffect: string;
    connected: boolean;
  };
  playerB: {
    uid: string;
    username: string;
    avatar: string;
    frame: string;
    level: number;
    rating: number;
    equippedCue: string;
    equippedTable: string;
    equippedEffect: string;
    connected: boolean;
  };
}

interface GameViewProps {
  profile: UserProfile;
  settings: UserSettings;
  onlineMatch: OnlineMatchInit | null;
  practiceConfig?: PracticeLaunchConfig;
  onQuickEquip?: (itemId: string) => void;
  onUpdateSettings: (next: UserSettings) => void;
  onProfileUpdate: (next: UserProfile) => void;
  onExitToMenu: () => void;
  onInviteFriendFromResult: () => void;
}

interface ChatBubble {
  senderUid: string;
  senderName: string;
  text: string;
  emote: string;
  timestamp: number;
}

export const GameView: React.FC<GameViewProps> = ({
  profile,
  settings,
  onlineMatch,
  practiceConfig,
  onQuickEquip,
  onUpdateSettings,
  onProfileUpdate,
  onExitToMenu,
  onInviteFriendFromResult,
}) => {
  const isOnline = Boolean(onlineMatch);
  const yourSlot: PlayerSlot = onlineMatch ? onlineMatch.yourSlot : 'A';
  const activeVariant = onlineMatch
    ? onlineMatch.rules.gameVariant
    : practiceConfig?.variant || '8ball';
  const subMode = isOnline ? 'online' : practiceConfig?.subMode || 'solo';
  const aiDifficulty = practiceConfig?.aiDifficulty || 'pro';

  const ballsRef = useRef<BallState[]>(
    onlineMatch
      ? onlineMatch.balls.map((b) => ({ ...b }))
      : createRackForVariant(activeVariant),
  );
  const pendingEventsRef = useRef<PhysicsEvent[]>([]);
  const strikeFlashRef = useRef<number>(0);

  const [rules, setRules] = useState<MatchRulesState>(() =>
    onlineMatch
      ? { ...onlineMatch.rules }
      : createInitialRulesState('A', activeVariant),
  );
  const [simulating, setSimulating] = useState<boolean>(
    onlineMatch ? onlineMatch.simulating : false,
  );
  const [aimAngle, setAimAngle] = useState(0);
  const [power, setPower] = useState(0);
  const [spinX, setSpinX] = useState(0);
  const [spinY, setSpinY] = useState(0);
  const [pocketedSnapshot, setPocketedSnapshot] = useState<number[]>([]);
  const [resultSummary, setResultSummary] = useState<MatchResultSummary | null>(null);
  const [practiceStartMs, setPracticeStartMs] = useState<number>(() => Date.now());
  const [customizerOpen, setCustomizerOpen] = useState(false);

  // VS Intro banner (1.8s on online match start)
  const [showVsBanner, setShowVsBanner] = useState<boolean>(Boolean(onlineMatch));

  // Online disconnect/reconnect UI
  const [opponentDisconnectSec, setOpponentDisconnectSec] = useState<number | null>(null);
  const [localWsStatus, setLocalWsStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connected');

  // Chat & Emote state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMuted, setChatMuted] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatBubble[]>([]);
  const [opponentBubble, setOpponentBubble] = useState<ChatBubble | null>(null);

  const localTelemetryRef = useRef<ShotTelemetry>({
    firstContactBallId: null,
    pocketedBallIds: [],
    railContactAfterFirstHit: false,
    cushionHitCount: 0,
  });

  const activeMatchIdRef = useRef<string | null>(onlineMatch?.matchId || null);
  const firestoreSeqRef = useRef<number>(onlineMatch?.seq || 1);
  const firestoreLastAimAtRef = useRef<number>(0);
  const firestoreMatchStartMsRef = useRef<number>(Date.now());
  const firestoreSettledRef = useRef<boolean>(false);

  useEffect(() => {
    if (onlineMatch) {
      activeMatchIdRef.current = onlineMatch.matchId;
      firestoreSeqRef.current = onlineMatch.seq || 1;
      firestoreMatchStartMsRef.current = Date.now();
      firestoreSettledRef.current = false;
      if (!onlineMatch.firestoreSync && onlineMatch.reconnectToken) {
        wsClient.setActiveReconnectInfo({
          matchId: onlineMatch.matchId,
          reconnectToken: onlineMatch.reconnectToken,
        });
      } else {
        wsClient.setActiveReconnectInfo(null);
      }
      ballsRef.current = onlineMatch.balls.map((b) => ({ ...b }));
      setRules({ ...onlineMatch.rules });
      setSimulating(onlineMatch.simulating);
      setResultSummary(null);
      setShowVsBanner(true);
      const tmr = window.setTimeout(() => setShowVsBanner(false), 1800);
      return () => window.clearTimeout(tmr);
    }
    return undefined;
  }, [onlineMatch]);

  useEffect(() => {
    const unsub = wsClient.onStatusChange(setLocalWsStatus);
    return unsub;
  }, []);

  // Countdown tick for opponent disconnect
  useEffect(() => {
    if (opponentDisconnectSec === null || opponentDisconnectSec <= 0) return;
    const tmr = window.setInterval(() => {
      setOpponentDisconnectSec((s) => (s !== null && s > 0 ? s - 1 : s));
    }, 1000);
    return () => window.clearInterval(tmr);
  }, [opponentDisconnectSec]);

  const lastPocketedKeyRef = useRef<string>('');
  const syncPocketedSnapshot = useCallback(() => {
    const ids = ballsRef.current.filter((b) => b.pocketed).map((b) => b.id);
    const key = ids.join(',');
    if (key !== lastPocketedKeyRef.current) {
      lastPocketedKeyRef.current = key;
      setPocketedSnapshot(ids);
    }
  }, []);

  // Reset practice rack
  const resetPracticeMatch = useCallback(() => {
    audioEngine.playClick();
    ballsRef.current = createRackForVariant(activeVariant);
    setRules(createInitialRulesState('A', activeVariant));
    setSimulating(false);
    setResultSummary(null);
    setAimAngle(0);
    setPower(0);
    setSpinX(0);
    setSpinY(0);
    setPracticeStartMs(Date.now());
    syncPocketedSnapshot();
  }, [activeVariant, syncPocketedSnapshot]);

  // Listen to WebSocket authoritative events during same-server online match
  useEffect(() => {
    if (!onlineMatch || onlineMatch.firestoreSync) return;
    const unsub = wsClient.subscribe((msg) => {
      const mId = msg.matchId as string | undefined;
      if (mId && mId !== activeMatchIdRef.current) return;

      switch (msg.type) {
        case 'match:state': {
          const m = msg.match as OnlineMatchInit;
          if (!m) return;
          ballsRef.current = m.balls.map((b) => ({ ...b }));
          setRules({ ...m.rules });
          setSimulating(m.simulating);
          syncPocketedSnapshot();
          break;
        }
        case 'match:aim_update': {
          if (typeof msg.angle === 'number') setAimAngle(msg.angle);
          if (typeof msg.spinX === 'number') setSpinX(msg.spinX);
          if (typeof msg.spinY === 'number') setSpinY(msg.spinY);
          if (typeof msg.power === 'number') setPower(msg.power);
          break;
        }
        case 'match:cue_placed': {
          const cue = ballsRef.current.find((b) => b.id === 0);
          if (cue && typeof msg.x === 'number' && typeof msg.y === 'number') {
            cue.x = msg.x;
            cue.y = msg.y;
            cue.pocketed = false;
            cue.pocketAnimProgress = 0;
          }
          break;
        }
        case 'match:shot_accepted': {
          const shot = msg.shot as ShotInput;
          const cue = ballsRef.current.find((b) => b.id === 0);
          if (cue) {
            pendingEventsRef.current.push({ type: 'cue', intensity: shot.power, x: cue.x, y: cue.y });
          }
          strikeFlashRef.current = 1;
          audioEngine.playCueHit(shot.power);
          triggerHaptic(settings.vibrationEnabled, Math.round(10 + shot.power * 25));
          applyCueShot(
            ballsRef.current,
            shot,
            rules.headstringOnly,
            getCueStats(shot.cueId || (rules.currentTurn === 'A' ? onlineMatch.playerA.equippedCue : onlineMatch.playerB.equippedCue)),
          );
          localTelemetryRef.current = {
            firstContactBallId: null,
            pocketedBallIds: [],
            railContactAfterFirstHit: false,
            cushionHitCount: 0,
          };
          setPower(0);
          setSimulating(true);
          break;
        }
        case 'match:snapshot': {
          const serverBalls = msg.balls as BallState[];
          if (Array.isArray(serverBalls)) {
            for (const sb of serverBalls) {
              const lb = ballsRef.current.find((b) => b.id === sb.id);
              if (!lb) continue;
              // Smooth reconciliation toward server authoritative coordinates
              const dist = Math.hypot(sb.x - lb.x, sb.y - lb.y);
              if (dist > 30 || sb.pocketed !== lb.pocketed) {
                lb.x = sb.x;
                lb.y = sb.y;
              } else {
                lb.x += (sb.x - lb.x) * 0.55;
                lb.y += (sb.y - lb.y) * 0.55;
              }
              lb.vx = sb.vx;
              lb.vy = sb.vy;
              lb.pocketed = sb.pocketed;
              lb.pocketAnimProgress = sb.pocketAnimProgress;
              lb.pocketedInPocketId = sb.pocketedInPocketId;
            }
            syncPocketedSnapshot();
          }
          break;
        }
        case 'match:turn_resolved': {
          const serverBalls = msg.balls as BallState[];
          const nextRules = msg.rules as MatchRulesState;
          if (Array.isArray(serverBalls)) {
            ballsRef.current = serverBalls.map((b) => ({ ...b }));
          }
          setRules(nextRules);
          setSimulating(false);
          setSpinX(0);
          setSpinY(0);
          syncPocketedSnapshot();
          break;
        }
        case 'match:ended': {
          const serverBalls = msg.balls as BallState[];
          const nextRules = msg.rules as MatchRulesState;
          const winnerSlot = msg.winnerSlot as PlayerSlot;
          const winReason = String(msg.winReason || 'Match Complete');
          const duration = Number(msg.duration || 0);
          const rewards = msg.rewards as {
            A: { xpEarned: number; coinsEarned: number; ratingDelta: number; profile: UserProfile };
            B: { xpEarned: number; coinsEarned: number; ratingDelta: number; profile: UserProfile };
          };
          if (Array.isArray(serverBalls)) {
            ballsRef.current = serverBalls.map((b) => ({ ...b }));
          }
          setRules(nextRules);
          setSimulating(false);
          syncPocketedSnapshot();
          wsClient.setActiveReconnectInfo(null);

          const myRew = yourSlot === 'A' ? rewards.A : rewards.B;
          onProfileUpdate(myRew.profile);

          if (winnerSlot === yourSlot) audioEngine.playVictory();
          else audioEngine.playDefeat();

          setResultSummary({
            isPractice: false,
            winnerSlot,
            yourSlot,
            winReason,
            durationSec: duration,
            playerA: {
              uid: onlineMatch.playerA.uid,
              username: onlineMatch.playerA.username,
              avatar: onlineMatch.playerA.avatar,
              frame: onlineMatch.playerA.frame,
              shots: nextRules.shotCountA,
              potted: nextRules.pottedCountA,
            },
            playerB: {
              uid: onlineMatch.playerB.uid,
              username: onlineMatch.playerB.username,
              avatar: onlineMatch.playerB.avatar,
              frame: onlineMatch.playerB.frame,
              shots: nextRules.shotCountB,
              potted: nextRules.pottedCountB,
            },
            xpEarned: myRew.xpEarned,
            coinsEarned: myRew.coinsEarned,
            ratingDelta: myRew.ratingDelta,
            rematchRequestedByOpponent: false,
            rematchRequestedByYou: false,
          });
          break;
        }
        case 'match:opponent_disconnected': {
          setOpponentDisconnectSec(Number(msg.countdownSec || 45));
          break;
        }
        case 'match:opponent_reconnected': {
          setOpponentDisconnectSec(null);
          break;
        }
        case 'match:chat_message': {
          const senderUid = String(msg.senderUid || '');
          const bubble: ChatBubble = {
            senderUid,
            senderName: String(msg.senderName || 'Player'),
            text: String(msg.text || ''),
            emote: String(msg.emote || ''),
            timestamp: Number(msg.timestamp || Date.now()),
          };
          if (chatMuted && senderUid !== profile.uid) break;
          setChatHistory((prev) => [...prev.slice(-24), bubble]);
          if (senderUid !== profile.uid) {
            audioEngine.playNotification();
            setOpponentBubble(bubble);
            window.setTimeout(() => {
              setOpponentBubble((cur) => (cur?.timestamp === bubble.timestamp ? null : cur));
            }, 3800);
          }
          break;
        }
        case 'match:rematch_requested': {
          setResultSummary((prev) => (prev ? { ...prev, rematchRequestedByOpponent: true } : prev));
          break;
        }
      }
    });
    return unsub;
  }, [onlineMatch, yourSlot, profile.uid, chatMuted, settings.vibrationEnabled, rules.headstringOnly, onProfileUpdate, syncPocketedSnapshot]);

  // Listen to Firestore match document during cross-instance bridged matches
  useEffect(() => {
    if (!onlineMatch || !onlineMatch.firestoreSync) return;

    const unsub = subscribeFirestoreMatch(onlineMatch.matchId, (docData) => {
      const action = docData.lastAction;
      if (action && action.seq > firestoreSeqRef.current) {
        firestoreSeqRef.current = action.seq;

        if (action.type === 'aim' && action.actorSlot !== yourSlot) {
          if (typeof action.angle === 'number') setAimAngle(action.angle);
          if (typeof action.spinX === 'number') setSpinX(action.spinX);
          if (typeof action.spinY === 'number') setSpinY(action.spinY);
          if (typeof action.power === 'number') setPower(action.power);
        } else if (action.type === 'place_cue_ball' && action.actorSlot !== yourSlot) {
          const cue = ballsRef.current.find((b) => b.id === 0);
          if (cue && typeof action.x === 'number' && typeof action.y === 'number') {
            cue.x = action.x;
            cue.y = action.y;
            cue.pocketed = false;
            cue.pocketAnimProgress = 0;
          }
        } else if (action.type === 'shot' && action.actorSlot !== yourSlot) {
          const shot: ShotInput = {
            angle: Number(action.angle || 0),
            power: Number(action.power || 0.5),
            spinX: Number(action.spinX || 0),
            spinY: Number(action.spinY || 0),
            cueBallPos:
              typeof action.cueBallX === 'number' && typeof action.cueBallY === 'number'
                ? { x: action.cueBallX, y: action.cueBallY }
                : undefined,
          };
          const cue = ballsRef.current.find((b) => b.id === 0);
          if (cue) {
            pendingEventsRef.current.push({ type: 'cue', intensity: shot.power, x: cue.x, y: cue.y });
          }
          strikeFlashRef.current = 1;
          audioEngine.playCueHit(shot.power);
          triggerHaptic(settings.vibrationEnabled, Math.round(10 + shot.power * 25));
          const oppCue =
            action.cueId ||
            (action.actorSlot === 'A' ? onlineMatch.playerA.equippedCue : onlineMatch.playerB.equippedCue);
          applyCueShot(ballsRef.current, shot, docData.rules.headstringOnly, getCueStats(oppCue));
          localTelemetryRef.current = {
            firstContactBallId: null,
            pocketedBallIds: [],
            railContactAfterFirstHit: false,
            cushionHitCount: 0,
          };
          setPower(0);
          setSimulating(true);
        } else if (action.type === 'turn_resolved' && action.actorSlot !== yourSlot) {
          ballsRef.current = docData.balls.map((b) => ({ ...b }));
          setRules({ ...docData.rules });
          setSimulating(false);
          setSpinX(0);
          setSpinY(0);
          syncPocketedSnapshot();
        } else if (action.type === 'chat') {
          const senderUid = String(action.senderUid || '');
          const bubble: ChatBubble = {
            senderUid,
            senderName: String(action.senderName || 'Player'),
            text: String(action.text || ''),
            emote: String(action.emote || ''),
            timestamp: Number(action.timestamp || Date.now()),
          };
          if (!chatMuted || senderUid === profile.uid) {
            setChatHistory((prev) => [...prev.slice(-24), bubble]);
            if (senderUid !== profile.uid) {
              audioEngine.playNotification();
              setOpponentBubble(bubble);
              window.setTimeout(() => {
                setOpponentBubble((cur) => (cur?.timestamp === bubble.timestamp ? null : cur));
              }, 3800);
            }
          }
        }
      }

      if (docData.status === 'completed' && !firestoreSettledRef.current) {
        firestoreSettledRef.current = true;
        ballsRef.current = docData.balls.map((b) => ({ ...b }));
        setRules({ ...docData.rules });
        setSimulating(false);
        syncPocketedSnapshot();

        const winnerSlot: PlayerSlot =
          docData.winnerId === onlineMatch.playerA.uid ? 'A' : 'B';
        const winReason = docData.winReason || docData.rules.winReason || 'Match Complete';
        const dur = Math.max(1, Math.round((Date.now() - firestoreMatchStartMsRef.current) / 1000));
        const won = winnerSlot === yourSlot;

        const oppRating = yourSlot === 'A' ? onlineMatch.playerB.rating : onlineMatch.playerA.rating;
        const myShots = yourSlot === 'A' ? docData.rules.shotCountA : docData.rules.shotCountB;
        const delta = calculateEloDelta(profile.rating, oppRating, won);
        const rew = computeMatchRewards(won, onlineMatch.entryFee, myShots);
        const prog = applyXpProgress(profile.level, profile.xp, rew.xpEarned);

        const nextProfile: UserProfile = {
          ...profile,
          level: prog.level,
          xp: prog.xp,
          coins: Math.max(0, profile.coins + rew.coinsEarned - onlineMatch.entryFee),
          rating: Math.max(100, profile.rating + delta),
          matches: profile.matches + 1,
          wins: profile.wins + (won ? 1 : 0),
          losses: profile.losses + (won ? 0 : 1),
          updatedAt: new Date().toISOString(),
        };
        onProfileUpdate(nextProfile);

        if (won) audioEngine.playVictory();
        else audioEngine.playDefeat();

        setResultSummary({
          isPractice: false,
          winnerSlot,
          yourSlot,
          winReason,
          durationSec: dur,
          playerA: {
            uid: onlineMatch.playerA.uid,
            username: onlineMatch.playerA.username,
            avatar: onlineMatch.playerA.avatar,
            frame: onlineMatch.playerA.frame,
            shots: docData.rules.shotCountA,
            potted: docData.rules.pottedCountA,
          },
          playerB: {
            uid: onlineMatch.playerB.uid,
            username: onlineMatch.playerB.username,
            avatar: onlineMatch.playerB.avatar,
            frame: onlineMatch.playerB.frame,
            shots: docData.rules.shotCountB,
            potted: docData.rules.pottedCountB,
          },
          xpEarned: rew.xpEarned,
          coinsEarned: rew.coinsEarned,
          ratingDelta: delta,
          rematchRequestedByOpponent: false,
          rematchRequestedByYou: false,
        });
      }
    });

    return () => unsub();
  }, [onlineMatch, yourSlot, profile, chatMuted, settings.vibrationEnabled, onProfileUpdate, syncPocketedSnapshot]);

  // Fixed-timestep Physics Simulation Loop when balls are moving
  useEffect(() => {
    if (!simulating) return;

    let rafId = 0;
    let lastTs = performance.now();
    let accumulator = 0;

    const tick = (now: number) => {
      const frameDt = Math.min(0.05, (now - lastTs) / 1000);
      lastTs = now;
      accumulator += frameDt;

      let stepped = false;
      while (accumulator >= PHYSICS_PARAMS.fixedDt) {
        const events = stepPhysicsFrame(ballsRef.current, localTelemetryRef.current, PHYSICS_PARAMS.fixedDt);
        accumulator -= PHYSICS_PARAMS.fixedDt;
        stepped = true;

        for (const ev of events) {
          pendingEventsRef.current.push(ev);
          if (ev.type === 'ball') audioEngine.playBallCollision(ev.intensity);
          else if (ev.type === 'cushion') audioEngine.playCushionHit(ev.intensity);
          else if (ev.type === 'pocket') {
            audioEngine.playPocketDrop();
            triggerHaptic(settings.vibrationEnabled, 20);
          }
        }
      }

      if (stepped) {
        syncPocketedSnapshot();
      }

      if (!areBallsMoving(ballsRef.current)) {
        if (!isOnline) {
          // Practice / Solo / 2P Local / VS Pro AI rules resolution
          setSimulating(false);
          const nextRules = evaluateShotOutcome(rules, localTelemetryRef.current, ballsRef.current);

          // In Solo Practice, keep active turn on player A unless game over
          if (subMode === 'solo' && nextRules.phase !== 'gameover') {
            nextRules.currentTurn = 'A';
          }

          const cue = ballsRef.current.find((b) => b.id === 0);
          if (cue && cue.pocketed && nextRules.phase !== 'gameover') {
            const safe = findSafeCueBallSpot(ballsRef.current, nextRules.headstringOnly);
            cue.x = safe.x;
            cue.y = safe.y;
            cue.vx = 0;
            cue.vy = 0;
            cue.pocketed = false;
            cue.pocketAnimProgress = 0;
            cue.pocketedInPocketId = null;
          }

          setRules(nextRules);
          setSpinX(0);
          setSpinY(0);
          syncPocketedSnapshot();

          if (nextRules.phase === 'gameover' && nextRules.winner) {
            if (nextRules.winner === 'A') audioEngine.playVictory();
            else audioEngine.playDefeat();
            const dur = Math.max(1, Math.round((Date.now() - practiceStartMs) / 1000));
            const aiName =
              aiDifficulty === 'pro'
                ? 'Pro AI (Grandmaster)'
                : aiDifficulty === 'semipro'
                  ? 'Pro AI (Semi-Pro)'
                  : 'Pro AI (Club)';
            setResultSummary({
              isPractice: true,
              winnerSlot: nextRules.winner,
              yourSlot: 'A',
              winReason: nextRules.winReason || `${activeVariant === '9ball' ? '9-Ball' : '8-Ball'} completed!`,
              durationSec: dur,
              playerA: {
                uid: profile.uid,
                username: subMode === 'local_2p' ? 'Player 1' : profile.username,
                avatar: profile.avatar,
                frame: profile.frame,
                shots: nextRules.shotCountA,
                potted: nextRules.pottedCountA,
              },
              playerB: {
                uid: 'local_p2',
                username: subMode === 'vs_ai' ? aiName : subMode === 'local_2p' ? 'Player 2' : 'Practice Table',
                avatar: subMode === 'vs_ai' ? 'avatar_master' : 'avatar_royale',
                frame: subMode === 'vs_ai' ? 'frame_emerald_gold' : 'frame_bronze',
                shots: nextRules.shotCountB,
                potted: nextRules.pottedCountB,
              },
              xpEarned: 0,
              coinsEarned: 0,
              ratingDelta: 0,
              rematchRequestedByOpponent: false,
              rematchRequestedByYou: false,
            });
          }
          return;
        }
        if (isOnline && onlineMatch?.firestoreSync) {
          setSimulating(false);
          if (rules.currentTurn === yourSlot) {
            const nextRules = evaluateShotOutcome(rules, localTelemetryRef.current, ballsRef.current);
            const cue = ballsRef.current.find((b) => b.id === 0);
            if (cue && cue.pocketed && nextRules.phase !== 'gameover') {
              const safe = findSafeCueBallSpot(ballsRef.current, nextRules.headstringOnly);
              cue.x = safe.x;
              cue.y = safe.y;
              cue.vx = 0;
              cue.vy = 0;
              cue.pocketed = false;
              cue.pocketAnimProgress = 0;
              cue.pocketedInPocketId = null;
            }
            const nextBalls = ballsRef.current.map((b) => ({ ...b }));
            setRules(nextRules);
            setSpinX(0);
            setSpinY(0);
            syncPocketedSnapshot();

            const nextSeq = firestoreSeqRef.current + 1;
            firestoreSeqRef.current = nextSeq;
            const isOver = nextRules.phase === 'gameover' && Boolean(nextRules.winner);
            const winnerId =
              isOver && nextRules.winner
                ? nextRules.winner === 'A'
                  ? onlineMatch.playerA.uid
                  : onlineMatch.playerB.uid
                : '';

            void pushFirestoreMatchAction(onlineMatch.matchId, {
              currentTurn: nextRules.currentTurn,
              seq: nextSeq,
              balls: nextBalls,
              rules: nextRules,
              ...(isOver
                ? {
                    status: 'completed',
                    winnerId,
                    winReason: nextRules.winReason || 'Match Complete',
                    endedAt: new Date().toISOString(),
                  }
                : {}),
              lastAction: {
                type: 'turn_resolved',
                actorSlot: yourSlot,
                seq: nextSeq,
                timestamp: Date.now(),
              },
            }).catch(() => {});
          }
          return;
        }
        // In server-authoritative WS online mode, keep rendering final settle until server emits match:turn_resolved
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [simulating, isOnline, onlineMatch, yourSlot, subMode, aiDifficulty, activeVariant, rules, profile, settings.vibrationEnabled, practiceStartMs, syncPocketedSnapshot]);

  // Pro Computer AI Turn Loop (smooth aiming & striking when rules.currentTurn === 'B')
  useEffect(() => {
    if (isOnline || subMode !== 'vs_ai' || rules.currentTurn !== 'B' || simulating || rules.phase === 'gameover') {
      return undefined;
    }

    let cancelled = false;
    let rafId = 0;
    const aiCueId =
      aiDifficulty === 'pro' ? 'cue_legendary' : aiDifficulty === 'semipro' ? 'cue_gold' : 'cue_wooden';

    const thinkTimer = window.setTimeout(() => {
      if (cancelled) return;

      if (rules.ballInHand) {
        const spot = chooseAiCueBallPlacement(ballsRef.current, rules, aiDifficulty);
        const cue = ballsRef.current.find((b) => b.id === 0);
        if (cue) {
          cue.x = spot.x;
          cue.y = spot.y;
          cue.pocketed = false;
          cue.pocketAnimProgress = 0;
        }
      }

      const aiShot = computeAiShot(ballsRef.current, rules, aiDifficulty);
      const startAngle = aimAngle;
      let angleDelta = aiShot.angle - startAngle;
      while (angleDelta > Math.PI) angleDelta -= Math.PI * 2;
      while (angleDelta < -Math.PI) angleDelta += Math.PI * 2;

      const animStart = performance.now();
      const animDuration = 620;

      const stepAiAim = (now: number) => {
        if (cancelled) return;
        const p = Math.min(1, (now - animStart) / animDuration);
        const eased = 1 - Math.pow(1 - p, 3);
        setAimAngle(startAngle + angleDelta * eased);
        setPower(p < 0.72 ? (p / 0.72) * aiShot.power : aiShot.power);
        setSpinX(aiShot.spinX);
        setSpinY(aiShot.spinY);

        if (p < 1) {
          rafId = requestAnimationFrame(stepAiAim);
        } else {
          const cue = ballsRef.current.find((b) => b.id === 0);
          if (cue) {
            pendingEventsRef.current.push({ type: 'cue', intensity: aiShot.power, x: cue.x, y: cue.y });
          }
          strikeFlashRef.current = 1;
          audioEngine.playCueHit(aiShot.power);
          applyCueShot(ballsRef.current, aiShot, rules.headstringOnly, getCueStats(aiCueId));
          localTelemetryRef.current = {
            firstContactBallId: null,
            pocketedBallIds: [],
            railContactAfterFirstHit: false,
            cushionHitCount: 0,
          };
          setPower(0);
          setSimulating(true);
        }
      };

      rafId = requestAnimationFrame(stepAiAim);
    }, 520);

    return () => {
      cancelled = true;
      window.clearTimeout(thinkTimer);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [isOnline, subMode, aiDifficulty, rules, simulating, aimAngle]);

  const canShoot =
    !simulating &&
    rules.phase !== 'gameover' &&
    (!isOnline || rules.currentTurn === yourSlot) &&
    !(subMode === 'vs_ai' && rules.currentTurn === 'B');

  const handleAimChange = (nextAngle: number) => {
    setAimAngle(nextAngle);
    if (isOnline && onlineMatch && canShoot) {
      if (onlineMatch.firestoreSync) {
        const now = Date.now();
        if (now - firestoreLastAimAtRef.current < 260) return;
        firestoreLastAimAtRef.current = now;
        const nextSeq = firestoreSeqRef.current + 1;
        firestoreSeqRef.current = nextSeq;
        void pushFirestoreMatchAction(onlineMatch.matchId, {
          seq: nextSeq,
          lastAction: {
            type: 'aim',
            actorSlot: yourSlot,
            seq: nextSeq,
            angle: nextAngle,
            spinX,
            spinY,
            power,
            timestamp: now,
          },
        }).catch(() => {});
        return;
      }

      wsClient.send({
        type: 'match:aim',
        matchId: onlineMatch.matchId,
        angle: nextAngle,
        spinX,
        spinY,
        power,
      });
    }
  };

  const handlePlaceCueBall = (x: number, y: number) => {
    if (isOnline && onlineMatch && canShoot && rules.ballInHand) {
      if (onlineMatch.firestoreSync) {
        const cue = ballsRef.current.find((b) => b.id === 0);
        if (cue) {
          cue.x = x;
          cue.y = y;
          cue.pocketed = false;
          cue.pocketAnimProgress = 0;
        }
        const nextSeq = firestoreSeqRef.current + 1;
        firestoreSeqRef.current = nextSeq;
        void pushFirestoreMatchAction(onlineMatch.matchId, {
          seq: nextSeq,
          lastAction: {
            type: 'place_cue_ball',
            actorSlot: yourSlot,
            seq: nextSeq,
            x,
            y,
            timestamp: Date.now(),
          },
        }).catch(() => {});
        return;
      }

      wsClient.send({
        type: 'match:place_cue_ball',
        matchId: onlineMatch.matchId,
        x,
        y,
      });
    }
  };

  const handleShoot = (shotPower: number) => {
    if (!canShoot) return;
    const cue = ballsRef.current.find((b) => b.id === 0);
    if (!cue) return;

    const activeShooterCue =
      rules.currentTurn === 'A'
        ? (onlineMatch ? onlineMatch.playerA.equippedCue : profile.equippedCue)
        : (onlineMatch ? onlineMatch.playerB.equippedCue : profile.equippedCue);

    const shot: ShotInput = {
      angle: aimAngle,
      power: shotPower,
      spinX,
      spinY,
      cueBallPos: rules.ballInHand ? { x: cue.x, y: cue.y } : undefined,
      cueId: activeShooterCue,
    };

    if (isOnline && onlineMatch && !onlineMatch.firestoreSync) {
      wsClient.send({
        type: 'match:shot',
        matchId: onlineMatch.matchId,
        ...shot,
      });
    } else {
      if (isOnline && onlineMatch?.firestoreSync) {
        const nextSeq = firestoreSeqRef.current + 1;
        firestoreSeqRef.current = nextSeq;
        void pushFirestoreMatchAction(onlineMatch.matchId, {
          seq: nextSeq,
          lastAction: buildShotAction(yourSlot, nextSeq, shot),
        }).catch(() => {});
      }

      pendingEventsRef.current.push({ type: 'cue', intensity: shotPower, x: cue.x, y: cue.y });
      strikeFlashRef.current = 1;
      audioEngine.playCueHit(shotPower);
      triggerHaptic(settings.vibrationEnabled, Math.round(10 + shotPower * 25));
      applyCueShot(ballsRef.current, shot, rules.headstringOnly, getCueStats(activeShooterCue));
      localTelemetryRef.current = {
        firstContactBallId: null,
        pocketedBallIds: [],
        railContactAfterFirstHit: false,
        cushionHitCount: 0,
      };
      setSimulating(true);
    }
  };

  const sendChat = (text: string, emote = '') => {
    if (!onlineMatch) return;
    if (onlineMatch.firestoreSync) {
      const nextSeq = firestoreSeqRef.current + 1;
      firestoreSeqRef.current = nextSeq;
      void pushFirestoreMatchAction(onlineMatch.matchId, {
        seq: nextSeq,
        lastAction: {
          type: 'chat',
          actorSlot: yourSlot,
          seq: nextSeq,
          text,
          emote,
          senderUid: profile.uid,
          senderName: profile.username,
          timestamp: Date.now(),
        },
      }).catch(() => {});
      return;
    }

    wsClient.send({
      type: 'match:chat',
      matchId: onlineMatch.matchId,
      text,
      emote,
    });
  };

  const currentSuit: BallSuit = getPlayerGroup(rules, rules.currentTurn);
  const currentTargetNumber =
    activeVariant === '9ball'
      ? rules.targetBallNumber ?? getLowestObjectBallNumber(ballsRef.current)
      : null;

  const renderRemainingBalls = (suit: BallSuit, isSlotTurn: boolean) => {
    if (activeVariant === '9ball') {
      const remaining9 = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(
        (n) => !pocketedSnapshot.includes(n),
      );
      if (!isSlotTurn) {
        return (
          <span className="text-[10px] text-slate-400 font-mono-tabular">
            9-Ball · Target #{currentTargetNumber ?? 9}
          </span>
        );
      }
      return (
        <div className="flex items-center gap-1">
          {remaining9.map((n) => {
            const color = BALL_COLORS[n]?.base || '#fff';
            const isTarget = n === currentTargetNumber;
            return (
              <span
                key={n}
                title={`Ball ${n}`}
                className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold ${
                  isTarget ? 'ring-2 ring-amber-400 scale-110' : 'border border-white/30 opacity-75'
                }`}
                style={{
                  background:
                    n === 9
                      ? `linear-gradient(to bottom, #f8fafc 22%, ${color} 22%, ${color} 78%, #f8fafc 78%)`
                      : color,
                  color: n === 9 || n === 1 ? '#09090b' : '#fff',
                }}
              >
                {n}
              </span>
            );
          })}
        </div>
      );
    }

    if (!suit) {
      return <span className="text-[10px] text-slate-400">Open</span>;
    }
    const nums = suit === 'solid' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
    const remaining = nums.filter((n) => !pocketedSnapshot.includes(n));
    if (remaining.length === 0 && !pocketedSnapshot.includes(8)) {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-300">
          <span className="w-3.5 h-3.5 rounded-full bg-zinc-950 border border-white/50 text-[8px] flex items-center justify-center text-white">
            8
          </span>
          <span>8-Ball</span>
        </span>
      );
    }
    return (
      <div className="flex items-center gap-1">
        {remaining.map((n) => {
          const color = BALL_COLORS[n]?.base || '#fff';
          return (
            <span
              key={n}
              title={`Ball ${n}`}
              className="w-3.5 h-3.5 rounded-full border border-white/30 flex items-center justify-center text-[8px] font-bold text-slate-950"
              style={{
                background:
                  n > 8
                    ? `linear-gradient(to bottom, #f8fafc 22%, ${color} 22%, ${color} 78%, #f8fafc 78%)`
                    : color,
                color: n <= 8 ? '#fff' : '#09090b',
              }}
            >
              {n}
            </span>
          );
        })}
      </div>
    );
  };

  const pAInfo = onlineMatch
    ? onlineMatch.playerA
    : {
        uid: profile.uid,
        username: subMode === 'local_2p' ? 'Player 1' : profile.username,
        avatar: profile.avatar,
        frame: profile.frame,
        level: profile.level,
        rating: profile.rating,
        equippedCue: profile.equippedCue,
        equippedTable: profile.equippedTable,
        equippedEffect: profile.equippedEffect,
      };

  const pBInfo = onlineMatch
    ? onlineMatch.playerB
    : {
        uid: 'practice_p2',
        username:
          subMode === 'vs_ai'
            ? `Pro AI (${aiDifficulty === 'pro' ? 'GM' : aiDifficulty === 'semipro' ? 'Semi' : 'Club'})`
            : subMode === 'local_2p'
              ? 'Player 2'
              : 'Practice Table',
        avatar: subMode === 'vs_ai' ? 'avatar_master' : 'avatar_royale',
        frame: subMode === 'vs_ai' ? 'frame_emerald_gold' : 'frame_bronze',
        level: aiDifficulty === 'pro' ? 40 : 12,
        rating: aiDifficulty === 'pro' ? 2150 : aiDifficulty === 'semipro' ? 1550 : 1100,
        equippedCue:
          subMode === 'vs_ai'
            ? aiDifficulty === 'pro'
              ? 'cue_legendary'
              : aiDifficulty === 'semipro'
                ? 'cue_gold'
                : 'cue_wooden'
            : profile.equippedCue,
        equippedTable: profile.equippedTable,
        equippedEffect: profile.equippedEffect,
      };

  const activeCueId = rules.currentTurn === 'A' ? pAInfo.equippedCue : pBInfo.equippedCue;
  const activeTableId = profile.equippedTable || pAInfo.equippedTable;
  const activeEffectId = rules.currentTurn === 'A' ? pAInfo.equippedEffect : pBInfo.equippedEffect;

  const lang = settings.language;
  const turnBanner =
    rules.phase === 'gameover'
      ? rules.winReason || 'Game Over'
      : isOnline
        ? rules.currentTurn === yourSlot
          ? rules.ballInHand
            ? t(lang, 'ballInHand')
            : t(lang, 'yourTurn')
          : t(lang, 'opponentTurn')
        : subMode === 'vs_ai'
          ? rules.currentTurn === 'B'
            ? t(lang, 'computerTurn')
            : rules.ballInHand
              ? t(lang, 'ballInHand')
              : rules.isBreakShot
                ? t(lang, 'breakShot')
                : t(lang, 'yourTurn')
          : subMode === 'local_2p'
            ? `Player ${rules.currentTurn} Turn${rules.ballInHand ? ' · Ball in Hand' : ''}`
            : rules.ballInHand
              ? t(lang, 'ballInHand')
              : rules.isBreakShot
                ? t(lang, 'breakShot')
                : t(lang, 'yourTurn');

  const ownedTables = SHOP_CATALOG.filter(
    (item) =>
      item.category === 'table' &&
      (item.price === 0 || profile.ownedItems.includes(item.id)),
  );
  const ownedCues = SHOP_CATALOG.filter(
    (item) =>
      item.category === 'cue' &&
      (item.price === 0 || profile.ownedItems.includes(item.id)),
  );

  return (
    <div className="h-screen w-screen bg-[#05100b] text-slate-100 flex flex-col overflow-hidden select-none">
      {/* Compact Glassmorphic Perimeter HUD Header */}
      <header className="relative z-20 px-3 sm:px-5 py-2 glass-panel border-x-0 border-t-0 flex items-center justify-between gap-2 shrink-0">
        {/* Left: Exit & Player A */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            type="button"
            aria-label="Exit to Main Menu"
            onClick={() => {
              audioEngine.playClick();
              if (isOnline && rules.phase !== 'gameover' && onlineMatch) {
                if (onlineMatch.firestoreSync) {
                  const winnerUid = yourSlot === 'A' ? onlineMatch.playerB.uid : onlineMatch.playerA.uid;
                  const nextSeq = firestoreSeqRef.current + 1;
                  void pushFirestoreMatchAction(onlineMatch.matchId, {
                    status: 'completed',
                    winnerId: winnerUid,
                    winReason: 'Opponent conceded the match.',
                    endedAt: new Date().toISOString(),
                    seq: nextSeq,
                    lastAction: {
                      type: 'concede',
                      actorSlot: yourSlot,
                      seq: nextSeq,
                      timestamp: Date.now(),
                    },
                  }).catch(() => {});
                } else {
                  wsClient.send({ type: 'match:concede', matchId: onlineMatch.matchId });
                }
              }
              wsClient.setActiveReconnectInfo(null);
              onExitToMenu();
            }}
            className="p-2 rounded-xl neu-surface text-slate-200 hover:text-white shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div
            className={`flex items-center gap-2 px-2.5 py-1 rounded-2xl border transition-colors ${
              rules.currentTurn === 'A'
                ? 'neu-surface border-amber-400/75'
                : 'neu-inset opacity-75'
            }`}
          >
            <PlayerAvatar avatarId={pAInfo.avatar} frameId={pAInfo.frame} username={pAInfo.username} size="sm" />
            <div className="hidden sm:block min-w-0">
              <div className="text-xs font-bold text-white truncate max-w-[110px]">{pAInfo.username}</div>
              {renderRemainingBalls(rules.groupA, rules.currentTurn === 'A')}
            </div>
          </div>
        </div>

        {/* Center Status / Foul / Turn Indicator */}
        <div className="flex flex-col items-center text-center min-w-0 px-2">
          <div
            data-testid="turn-indicator"
            className={`text-xs sm:text-sm font-bold truncate max-w-[260px] sm:max-w-md ${
              rules.foulReason ? 'text-rose-400' : 'text-amber-300'
            }`}
          >
            {rules.foulReason || turnBanner}
          </div>
          <div className="text-[10px] text-slate-400 font-mono-tabular truncate max-w-[260px]">
            {activeVariant === '9ball' ? '9-Ball' : '8-Ball'} ·{' '}
            {rules.foulReason && rules.lastEventMessage === rules.foulReason
              ? rules.ballInHand
                ? rules.headstringOnly
                  ? 'Ball in hand behind headstring'
                  : 'Ball in hand anywhere on table'
                : `Turn ${rules.turnNumber}`
              : rules.lastEventMessage || (rules.phase === 'open' ? t(lang, 'openTable') : `Turn ${rules.turnNumber}`)}
          </div>
        </div>

        {/* Right: Player B + Utility Buttons */}
        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          <div
            className={`flex items-center gap-2 px-2.5 py-1 rounded-2xl border transition-colors ${
              rules.currentTurn === 'B'
                ? 'neu-surface border-amber-400/75'
                : 'neu-inset opacity-75'
            }`}
          >
            <div className="hidden sm:block text-right min-w-0">
              <div className="text-xs font-bold text-white truncate max-w-[120px]">{pBInfo.username}</div>
              <div className="flex justify-end">{renderRemainingBalls(rules.groupB, rules.currentTurn === 'B')}</div>
            </div>
            <PlayerAvatar avatarId={pBInfo.avatar} frameId={pBInfo.frame} username={pBInfo.username} size="sm" />
          </div>

          {!isOnline && onQuickEquip && (
            <button
              type="button"
              aria-label="Customize Table & Cue"
              data-testid="ingame-customizer-btn"
              onClick={() => {
                audioEngine.playClick();
                setCustomizerOpen((v) => !v);
              }}
              className="p-2 rounded-xl neu-surface text-emerald-300 hover:text-amber-300"
            >
              <Palette className="w-4 h-4" />
            </button>
          )}

          {!isOnline && (
            <button
              type="button"
              aria-label="Re-rack Balls"
              onClick={resetPracticeMatch}
              data-testid="rerack-btn"
              className="p-2 rounded-xl neu-surface text-amber-300"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}

          {isOnline && (
            <button
              type="button"
              aria-label="Toggle Match Chat"
              onClick={() => {
                audioEngine.playClick();
                setChatOpen((o) => !o);
              }}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-amber-300"
            >
              <MessageSquare className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            aria-label={settings.sfxEnabled ? 'Mute Audio' : 'Unmute Audio'}
            onClick={() => onUpdateSettings({ ...settings, sfxEnabled: !settings.sfxEnabled })}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-200"
          >
            {settings.sfxEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Main Playfield Viewport (>=85% unobstructed area) */}
      <main className="relative flex-1 flex items-center justify-between p-2 sm:p-4 gap-2 sm:gap-4 overflow-hidden">
        {/* Left Spin Control Perimeter Dock */}
        <div className="hidden sm:flex flex-col items-center justify-center pl-1 z-10">
          <SpinControl
            spinX={spinX}
            spinY={spinY}
            disabled={!canShoot}
            onChange={(x, y) => {
              setSpinX(x);
              setSpinY(y);
            }}
          />
        </div>

        {/* Center Billiard Table Canvas */}
        <div className="flex-1 h-full flex items-center justify-center min-w-0 min-h-0">
          <BilliardCanvas
            ballsRef={ballsRef}
            pendingEventsRef={pendingEventsRef}
            aimAngle={aimAngle}
            onAimChange={handleAimChange}
            power={power}
            spinX={spinX}
            spinY={spinY}
            canShoot={canShoot}
            isSimulating={simulating}
            ballInHand={rules.ballInHand}
            headstringOnly={rules.headstringOnly}
            currentGroup={currentSuit}
            isBreakShot={rules.isBreakShot}
            gameVariant={activeVariant}
            targetBallNumber={currentTargetNumber}
            equippedCueId={activeCueId}
            equippedTableId={activeTableId}
            equippedEffectId={activeEffectId}
            settings={settings}
            onPlaceCueBall={handlePlaceCueBall}
            strikeFlashRef={strikeFlashRef}
            currentTurnLabel={rules.currentTurn}
            phaseLabel={rules.phase}
          />
        </div>

        {/* Live In-Game Table & Cue Customizer Popover */}
        {!isOnline && customizerOpen && onQuickEquip && (
          <div className="absolute top-3 right-4 z-30 w-72 glass-panel rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <span className="text-xs font-bold text-amber-300">Table &amp; Cue Switcher</span>
              <button
                type="button"
                onClick={() => setCustomizerOpen(false)}
                className="text-[11px] text-slate-400 hover:text-white"
              >
                Done
              </button>
            </div>
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Table Cloth</div>
              <div className="flex flex-wrap gap-1.5">
                {ownedTables.map((tbl) => (
                  <button
                    key={tbl.id}
                    type="button"
                    onClick={() => onQuickEquip(tbl.id)}
                    className={`px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 ${
                      profile.equippedTable === tbl.id
                        ? 'neu-btn-gold'
                        : 'neu-inset text-slate-200'
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-full border border-white/40"
                      style={{ backgroundColor: tbl.primaryColor }}
                    />
                    <span>{tbl.name.split(' ')[0]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Cue Stick</div>
              <div className="flex flex-wrap gap-1.5">
                {ownedCues.map((cue) => (
                  <button
                    key={cue.id}
                    type="button"
                    onClick={() => onQuickEquip(cue.id)}
                    className={`px-2 py-1 rounded-lg text-[11px] font-semibold ${
                      profile.equippedCue === cue.id
                        ? 'neu-btn-gold'
                        : 'neu-inset text-slate-200'
                    }`}
                  >
                    {cue.name.replace(' Cue', '')}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Right Power Bar Perimeter Dock */}
        <div className="flex flex-col items-center justify-center gap-3 pr-1 z-10">
          <PowerBar
            disabled={!canShoot}
            power={power}
            onPowerChange={setPower}
            onShoot={handleShoot}
          />
          <div className="sm:hidden">
            <SpinControl
              spinX={spinX}
              spinY={spinY}
              disabled={!canShoot}
              onChange={(x, y) => {
                setSpinX(x);
                setSpinY(y);
              }}
            />
          </div>
        </div>

        {/* Opponent Speech Bubble */}
        {opponentBubble && (
          <div className="absolute top-3 right-16 z-30 bg-[#0d271c] border border-amber-400/50 rounded-xl px-3.5 py-2 shadow-xl max-w-xs pointer-events-none">
            <div className="text-[10px] font-bold text-amber-300">{opponentBubble.senderName}</div>
            <div className="text-sm text-white">
              {opponentBubble.emote} {opponentBubble.text}
            </div>
          </div>
        )}

        {/* Reconnect / Opponent Disconnected Warning */}
        {isOnline && !onlineMatch?.firestoreSync && (localWsStatus !== 'connected' || opponentDisconnectSec !== null) && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 bg-amber-950/95 border border-amber-400/60 rounded-xl px-4 py-2 flex items-center gap-2 text-xs font-semibold text-amber-200 shadow-xl pointer-events-none">
            <WifiOff className="w-4 h-4 text-amber-400" />
            <span>
              {localWsStatus !== 'connected'
                ? 'Reconnecting to game server...'
                : `Opponent disconnected. Waiting ${opponentDisconnectSec}s to reconnect...`}
            </span>
          </div>
        )}

        {/* VS Splash Intro Overlay */}
        {showVsBanner && onlineMatch && (
          <div className="absolute inset-0 z-40 bg-black/75 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-[#0b2117] border-2 border-amber-400/60 rounded-2xl px-8 py-6 flex items-center gap-6 sm:gap-10 shadow-2xl">
              <div className="text-center space-y-2">
                <PlayerAvatar
                  avatarId={onlineMatch.playerA.avatar}
                  frameId={onlineMatch.playerA.frame}
                  username={onlineMatch.playerA.username}
                  size="lg"
                />
                <div className="text-sm font-bold text-white">{onlineMatch.playerA.username}</div>
                <div className="text-xs font-mono-tabular text-amber-300">Elo {onlineMatch.playerA.rating}</div>
              </div>
              <div className="font-display text-3xl sm:text-4xl font-extrabold text-amber-400">VS</div>
              <div className="text-center space-y-2">
                <PlayerAvatar
                  avatarId={onlineMatch.playerB.avatar}
                  frameId={onlineMatch.playerB.frame}
                  username={onlineMatch.playerB.username}
                  size="lg"
                />
                <div className="text-sm font-bold text-white">{onlineMatch.playerB.username}</div>
                <div className="text-xs font-mono-tabular text-amber-300">Elo {onlineMatch.playerB.rating}</div>
              </div>
            </div>
          </div>
        )}

        {/* Chat & Emote Drawer */}
        {isOnline && chatOpen && (
          <div className="absolute top-3 right-16 z-30 w-72 sm:w-80 bg-[#0b2117] border border-amber-500/40 rounded-2xl p-3.5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <span className="text-xs font-bold text-amber-300">Match Chat & Emotes</span>
              <button
                type="button"
                onClick={() => setChatMuted((m) => !m)}
                className={`text-[11px] px-2 py-0.5 rounded font-semibold ${
                  chatMuted ? 'bg-rose-900/70 text-rose-200' : 'bg-white/10 text-slate-300'
                }`}
              >
                {chatMuted ? 'Muted' : 'Mute Opponent'}
              </button>
            </div>

            {/* Emotes */}
            <div className="grid grid-cols-6 gap-1">
              {BILLIARD_EMOTES.map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => sendChat('', em)}
                  className="py-1.5 rounded-lg bg-[#07150f] hover:bg-white/10 text-base"
                >
                  {em}
                </button>
              ))}
            </div>

            {/* Quick Phrases */}
            <div className="grid grid-cols-2 gap-1.5">
              {QUICK_CHAT_MESSAGES.map((phrase) => (
                <button
                  key={phrase}
                  type="button"
                  onClick={() => sendChat(phrase)}
                  className="px-2 py-1.5 rounded-lg bg-[#07150f] hover:bg-emerald-900/60 border border-white/10 text-[11px] font-medium text-slate-200 truncate"
                >
                  {phrase}
                </button>
              ))}
            </div>

            {/* Recent Messages */}
            {chatHistory.length > 0 && (
              <div className="max-h-28 overflow-y-auto space-y-1 text-[11px] bg-[#07150f] rounded-lg p-2">
                {chatHistory.map((c, i) => (
                  <div key={`${c.timestamp}-${i}`} className="text-slate-200">
                    <span className="font-bold text-amber-300">{c.senderName}: </span>
                    <span>
                      {c.emote} {c.text}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Custom Short Message */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!chatInput.trim()) return;
                sendChat(chatInput.trim());
                setChatInput('');
              }}
              className="flex gap-1.5"
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                maxLength={64}
                placeholder="Say something..."
                className="flex-1 px-2.5 py-1.5 rounded-lg bg-[#07150f] border border-white/15 text-xs text-white focus:outline-none focus:border-amber-400"
              />
              <button
                type="submit"
                aria-label="Send message"
                className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        )}
      </main>

      {/* Mobile bottom warning if held in very narrow portrait? Still fully playable, plus gentle hint */}
      {rules.foulReason && !resultSummary && (
        <div className="sm:hidden px-3 py-1 bg-rose-950/90 border-t border-rose-500/40 text-[11px] text-rose-200 flex items-center justify-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
          <span>{rules.foulReason}</span>
        </div>
      )}

      {/* Match Result Modal */}
      {resultSummary && (
        <MatchResultModal
          result={resultSummary}
          onRematch={() => {
            if (!isOnline) {
              resetPracticeMatch();
            } else if (onlineMatch?.firestoreSync) {
              onInviteFriendFromResult();
            } else if (onlineMatch) {
              wsClient.send({ type: 'match:rematch', matchId: onlineMatch.matchId });
              setResultSummary((prev) => (prev ? { ...prev, rematchRequestedByYou: true } : prev));
            }
          }}
          onBackHome={() => {
            wsClient.setActiveReconnectInfo(null);
            onExitToMenu();
          }}
          onInviteFriend={isOnline ? onInviteFriendFromResult : undefined}
        />
      )}
    </div>
  );
};
