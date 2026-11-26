import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRoomCode, isValidRoomCode } from './roomCode';

test('extractRoomCode handles manual partial and full typing', () => {
  assert.equal(extractRoomCode('k7m'), 'K7M');
  assert.equal(extractRoomCode('k7m-9p2'), 'K7M9P2');
  assert.equal(extractRoomCode('  ab34cd  '), 'AB34CD');
  assert.equal(isValidRoomCode('K7M9P2'), true);
  assert.equal(isValidRoomCode('K7M9P'), false);
});

test('extractRoomCode extracts code from full share URLs', () => {
  assert.equal(
    extractRoomCode('https://ais-pre-2j7yod6eiwmlzm37yhuxdr-173763439507.asia-southeast1.run.app/?room=P7UHFA'),
    'P7UHFA',
  );
  assert.equal(
    extractRoomCode('https://example.com/?foo=1&room=k7m9p2#top'),
    'K7M9P2',
  );
});

test('extractRoomCode extracts code from copied multi-line invitation text', () => {
  const inviteText =
    'Join my POOL MASTER ONLINE match! Room Code: QZABCD\nhttps://example.com/?room=QZABCD';
  assert.equal(extractRoomCode(inviteText), 'QZABCD');

  const proseOnly = 'Join my POOL MASTER ONLINE match! Room Code: ABCDEF';
  assert.equal(extractRoomCode(proseOnly), 'ABCDEF');
});
