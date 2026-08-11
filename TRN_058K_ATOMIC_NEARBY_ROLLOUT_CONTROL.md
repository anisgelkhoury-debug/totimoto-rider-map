# TRN 058K — Atomic Nearby Notification Rollout Control

**Branch:** `feature/nearby-rollout-firestore-control`  
**Starting HEAD:** `f1083c6`  
**058J commit:** `4025b1c`

---

## Absolute safety

| Item | Value |
|---|---|
| `ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND` | **`false`** |
| Default rollout | **Stage 0** |
| Canary allowlist | **empty** |
| Production ops config doc | **not created** |
| Deploy / push / merge | **not done** |

---

## 1. Branch

`feature/nearby-rollout-firestore-control`

## 2. Starting HEAD

`f1083c6`

## 3. Production safety state

Nearby real FCM **OFF**. Gate false. Stage 0. Empty canary. No production Firestore ops doc.

## 4. Current sender audit

`onReportCreatedNearbyNotify` → `processNearbyReportCreated`:

1. Parse / category / freshness / trust  
2. Geo recipient discovery + prefs / stale / self  
3. **Master gate false ⇒ dry_run** (no ops read, no budget write, no events, no FCM)  
4. Ops config read (fail-closed)  
5. Rollout eligibility  
6. Legacy canary filter (empty ⇒ nobody)  
7. Atomic budget reserve  
8. notificationEvents claim  
9. FCM → commit or release budget  

Assistance lifecycle Functions unchanged and isolated.

## 5. Budget storage decision

**A — nested on `notificationSubscriptions.nearbyNotificationBudget`**

Rationale: 058J recommendation; no extra collection reads; already server-owned in rules; one txn per subscription doc.

## 6. Exact budget schema

```text
nearbyNotificationBudget: {
  hourlyWindowStartedAt: number | null,
  hourlyCount: number,
  dailyWindowStartedAt: number | null,
  dailyCount: number,
  lastNearbySentAt: number | null,
  criticalWindowStartedAt: number | null,
  criticalCount: number,
  pending: {
    [reservationId]: {
      previous: { …counters… },
      reservedAtMs: number,
      severity: string
    }
  }
}
```

No arrays / history. Timestamps are Function `nowMs` (server clock). Malformed ⇒ reject.

## 7. Atomic reservation architecture

`reserveNearbyNotificationBudget` → Admin `runTransaction`:

- read subscription budget  
- normalize windows via pure helpers  
- decide cooldown  
- if reject → no write  
- if allow → write counters + `pending[reservationId]`  

Pure body: `applyReserveNearbyBudgetTransactionBody` (unit-tested).

## 8. Concurrency behavior

Two reports, hourlyCount=2, cap=3:

- **one ALLOW, one REJECT_HOURLY_BUDGET**  
- final hourlyCount = **3**  

**Proven on Firestore emulator** (`nearbyBudgetEmulator.test.ts`).

## 9. Reservation identity

Deterministic: `nearby_budget:{reportId}:{subscriptionId}`  
Aligned with events: `nearby_report:{reportId}:{subscriptionId}`.

## 10. Retry / idempotency

Same `reservationId` already in `pending` ⇒ **idempotent replay** (no second slot).  
Function retry after transient release can reserve again safely.

## 11. Send-failure reservation behavior

Transient FCM fail ⇒ **release** pending (restore previous counters) + release event claim.

## 12. Invalid-token reservation behavior

**Release** budget (never delivered) + disable subscription + mark event failed.

## 13. notificationEvents interaction

Claim after reserve. Duplicate claim ⇒ release budget. Success ⇒ `commit` clears pending (counters stay).

## 14. Operational config document model

Path: `systemConfig/nearbyNotifications` (Admin-only). **Not created in production.**

Fields (aliases supported): `enabled`, `stage`, allowlist / categories / geo prefixes, `percentage`/`percentOpen`, `seed`.

## 15. Config normalization

Reuses `normalizeNearbyRolloutConfig` via `mapNearbyOpsConfigRaw`. Missing/invalid/disabled ⇒ Stage 0.

## 16. Config caching

**V1: short in-memory TTL (45s).**

- cold start: miss until read  
- expiry + read failure ⇒ Stage 0  
- never keeps permissive config past TTL  
- failure caches Stage 0 briefly (no hammer, still closed)

## 17. Fail-closed behavior

Missing doc, read fail, malformed, disabled, empty Stage 1/2 allowlist, invalid percent, Stage 3 missing category∨geo ⇒ nobody.

## 18. Master gate precedence

Compile-time false ⇒ dry_run **before** ops config read and **before** any budget mutation.

## 19. Stage precedence

After gate true: ops enabled + Stage > 0 + normalize ok, then per-recipient eligibility, then budget, then events.

## 20. Sender execution order

report filters → recipients → **gate** → ops config → rollout → canary → budget reserve → event claim → FCM → commit/release.

## 21. Dry-run behavior

Gate false: zero config reads (when using wired deps), zero budget writes, zero events, zero FCM. Counts still evaluated for eligibility.

## 22. Assistance isolation

Lifecycle modules do not import ops/budget. Regression tests assert this. Nearby kill does not affect assistance.

## 23. Firestore rules impact

Local only (**not deployed**):

- clients cannot create/mutate `nearbyNotificationBudget`  
- `systemConfig/{docId}` client read/write **denied**  
- preference/location updates remain allowed  

## 24. Operational config security

No client read/write. No subscription IDs in client bundle. Admin Function read only when gate true.

## 25. Privacy impact

No new lat/lng/token/uid logging. Outcomes use counts + reason codes only.

## 26. Observability

Extended nearby outcome log: rollout/budget/dedupe counts + `rolloutStage` + `sendGate`. Privacy-safe reasons in helpers (`rollout_config_*`, `budget_*`, etc.).

## 27. Cost — 100 riders

Ops config ≤1 cached read / 45s / instance. Budget: +1 txn read/write per attempted send (gate open only). Negligible vs geo queries.

## 28. Cost — 1,000 riders

Budget cost linear in sends; geo fan-out still larger in dense cells.

## 29. Cost — 10,000 riders

Budget txs meaningful but secondary to large-radius CRITICAL fan-out.

## 30. Cost — 100,000 riders

Heartbeat + geo fan-out dominate; budget txs secondary.

## 31. First expected bottleneck

Dense-city geohash recipient fan-out (large CRITICAL radii), not budget transactions.

## 32. Files changed

- `functions/src/nearby/budgetPersistence.ts`  
- `functions/src/nearby/firestoreBudget.ts`  
- `functions/src/nearby/opsRolloutConfig.ts`  
- `functions/src/nearby/processNearbyReport.ts`  
- `functions/src/index.ts`  
- `functions/src/test/nearbyFirestoreControl.test.ts`  
- `functions/src/test/nearbyBudgetEmulator.test.ts`  
- `functions/package.json`  
- `firestore.rules`  
- `tests/rules/rules.test.js`  
- `TRN_058K_ATOMIC_NEARBY_ROLLOUT_CONTROL.md` (this report)

## 33. Tests added

Ops cache/fail-closed, atomic reserve/release/commit/idempotency, concurrent race harness, gate short-circuit (zero config/budget/events), assistance isolation, rules deny for `systemConfig`, **emulator concurrency PASS**.

## 34. Emulator concurrency result

**PASS** — one ALLOW, one `REJECT_HOURLY_BUDGET`, final `hourlyCount = 3`.

## 35. Validation results

| Check | Result |
|---|---|
| `npm run test:notifications` | **114** pass |
| `npm run test:location` | **372** pass |
| `npm run test:rules` | **116** pass |
| `npm run build` | pass |
| `functions` `npm test` | **161** pass |
| `functions` `npm run lint` | pass |
| Emulator concurrency | **PASS** (1 ALLOW / 1 REJECT / count=3) |
| Production send gate | **`false`** |

## 36. Commit hash

`d4f602a` (`feat: add atomic nearby notification rollout control`)

## 37. Git status

```
On branch feature/nearby-rollout-firestore-control
058K tracked files committed.
Unrelated local dirty/untracked: .firebase cache, other architecture MDs, scripts/
```

## 38. Final send gate proof

`ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND: boolean = false`

## 39. GO / NO-GO for 058L

**GO** for 058L planning of controlled Stage 1 canary **with explicit gate flip task**.  
**NO-GO** to enable gate or create open ops config without a dedicated canary procedure.

## 40. Exact 058L scope (proposed)

1. Self-exclusion live canary design execution  
2. Deep-link exact report-open proof  
3. Optional temporary Stage 1 ops doc + gate true **only under canary SOP**  
4. Immediate shutdown checklist (gate false + Stage 0 / delete ops enable)

## 41. Exact blockers before any real rollout

- Gate must stay false until explicit canary task  
- Ops doc must not be enabled in production casually  
- Canary allowlist still empty (extra fail-closed layer)  
- Rules not deployed yet (deploy only with canary plan)  
- Live self-exclusion + deep-link report open still unproven  

## 42. Items intentionally deferred

- Production ops doc creation  
- Gate flip / real FCM  
- Deploy Functions/rules/Hosting  
- Retiring legacy canary Set  
- MEDIUM confirmation triggers  
- uid-shared budgets / clustering  
- Push / merge
