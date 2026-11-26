# Security Specification — POOL MASTER ONLINE

## Data Invariants
1. Public user profiles (`/users/{userId}`) contain zero PII (`email`, `phone`, `address`). Private metadata lives strictly in `/users/{userId}/private/info` readable and writable only by `request.auth.uid == userId`.
2. Users may only create their own `/users/{userId}` document with initial starter bounds (`coins == 500`, `level == 1`, `xp == 0`, `rating == 1000`, `wins == 0`, `losses == 0`, `matches == 0`), and cannot forge another UID or inject shadow fields.
3. Friendships (`/friends/{friendshipId}`) can only be read by `userId` or `friendId`, created by `userId == request.auth.uid` with `status == 'pending'`, accepted only by `friendId == request.auth.uid`, and deleted by either participant.
4. Rooms (`/rooms/{roomId}`) have a strict 2-player cap (`hostId`, `guestId`), cannot be joined once `status != 'waiting'` or `guestId != ''`, and reach terminal locking on `finished` / `cancelled`.
5. Matches (`/matches/{matchId}`) can only be read by `playerA` or `playerB`, and once `status == 'completed'` or `'cancelled'`, no further updates are permitted.
6. Match history (`/match_history/{historyId}`) and transactions (`/transactions/{transactionId}`) are immutable after creation (no update or delete) and scoped strictly to `playerId == request.auth.uid` / `userId == request.auth.uid`.

## Dirty Dozen Adversarial Payloads (Must Return PERMISSION_DENIED)
1. Unauthenticated read/write to `/users/uid1`.
2. Creating `/users/uid1` as `uid2` (Identity Spoofing).
3. Creating `/users/uid1` with `coins: 9999999` or `rating: 9000` (Progression Poisoning).
4. Updating `/users/uid1` with an undeclared ghost field `isAdmin: true` (Shadow Update).
5. Reading `/users/uid1/private/info` as `uid2` (PII Blanket Leak).
6. Updating `/users/uid1` with a 5KB username or invalid `userId` path variable (Resource Poisoning).
7. Creating `/friends/f1` with `userId: 'other'` or `status: 'accepted'` directly (Friend Spoofing).
8. Accepting `/friends/f1` as the original sender `userId` instead of `friendId` (State Shortcutting).
9. Joining `/rooms/r1` as a 3rd user when `guestId` is already occupied (Room Overflow).
10. Updating `/rooms/r1` after `status == 'finished'` (Terminal State Violation).
11. Updating `/matches/m1` as a non-participant `uid3` (Match Tampering).
12. Deleting or updating an existing `/transactions/t1` or `/match_history/h1` record (Ledger Tampering).
