# TRN 058J — Nearby Notification Rollout Control + Budget Foundation

**Branch:** `feature/nearby-rollout-control`  
**Starting HEAD:** `c4b0685` (058I tip)  
**Scope:** Foundation / wiring with production delivery **CLOSED**.

---

## Absolute safety

| Constraint | Status |
|---|---|
| `ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND` | **`false`** |
| Canary allowlist | **empty** |
| Default rollout | **Stage 0** |
| Real FCM / deploy / push / merge | **forbidden / not done** |

---

## 1. Branch

`feature/nearby-rollout-control`

## 2. Starting HEAD

`c4b0685` (`docs: fill 058I validation and commit hash sections`)  
058I design commit: `878fdd0`  
Production/main baseline: `74a77e2`

## 3. 058I architecture inherited

- Fail-closed staged rollout (0–4)
- Hard `nearby_report:{reportId}:{subscriptionId}` dedupe
- Hybrid F cooldown (subscription rolling budget)
- ~3/hour, ~12/day, MEDIUM ~20m, HIGH ~10m, CRITICAL ~2/30m
- Per-subscription budget (not uid-shared)
- No clustering V1
- Master gate alone must never mean everybody

## 4. Current production safety state

Gate **false**, canary **empty**, Stage 0 default config, no production ops config document, no deploy.

## 5. Existing sender audit

Unchanged core path: `onReportCreatedNearbyNotify` → `processNearbyReportCreated` → parse → category/freshness/trust → geohash recipients → prefs/staleness/self → **gate false ⇒ dry_run**.

**058J additions on send path only (gate true):** Stage rollout filter → legacy canary filter → optional budget reserve → event claim → FCM.

**Discrepancy vs 058I Stage 3:** 058I validation allowed category OR geography OR allowlist for config validity; 058J eligibility requires **BOTH** category allowlist **and** geography prefixes (prompt Part 4). Normalization fails closed unless both present.

## 6. Rollout config model

`functions/src/nearby/rolloutConfig.ts`

- Typed `NearbyNormalizedRolloutConfig`
- `normalizeNearbyRolloutConfig(raw)` fail-closed
- `NEARBY_ROLLOUT_DEFAULT_CONFIG` = Stage 0 / disabled
- `readNearbyRolloutConfigSafe(fetch)` — read failure ⇒ Stage 0 (no production doc)

## 7. Stage normalization behavior

| Input | Result |
|---|---|
| null / non-object | Stage 0 |
| `enabled: false` | Stage 0 |
| unknown stage | Stage 0 |
| Stage 1–2 empty allowlist | Stage 0 |
| Stage 3 missing category or geo | Stage 0 |
| Stage 4 percent ≤0 or >100 | Stage 0 |
| Valid Stage 1–4 | `normalizeReason: "ok"` |

## 8. Fail-closed behavior

Missing/malformed/disabled/unknown ⇒ nobody. Empty allowlist ≠ everybody. Invalid geography/category ⇒ reject recipient.

## 9. Two-key safety model

**KEY 1:** `ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND === true`  
**KEY 2:** valid rollout eligibility (Stage > 0, enabled, normalize ok, per-subscription rules)

**Plus** legacy canary allowlist (empty ⇒ nobody on send path).  
Gate true + Stage 0 ⇒ `no_rollout_recipients`, zero FCM.

## 10. Stage 0 behavior

Nobody. Default. Layers locked.

## 11. Stage 1 behavior

TEST allowlist only (`subscriptionAllowlist`). Unsupported category rejected.

## 12. Stage 2 behavior

LIMITED allowlist only (same mechanism; different ops intent/caps).

## 13. Stage 3 behavior

Must pass **approved category AND approved geohash prefix**. Invalid/missing geohash ⇒ reject.

## 14. Stage 4 behavior

Deterministic percent bucket (+ optional category/geo gates if configured).

## 15. Deterministic rollout bucketing

`nearbyRolloutHashBucket(stableId, seed)` — FNV-1a style, no `Math.random`. Missing subscription id fails closed. Ids never logged.

## 16. Budget data model

Server-owned nested map on `notificationSubscriptions`:

```text
nearbyNotificationBudget: {
  hourWindowStartMs, hourCount,
  dayWindowStartMs, dayCount,
  lastSentAtMs,
  criticalWindowStartMs, criticalCount
}
```

No history arrays. Server timestamps when persisted (future).

## 17. Hourly budget

Max **3** / rolling **60 minutes** / subscription.

## 18. Daily budget

Max **12** / rolling **24 hours** / subscription.

## 19. MEDIUM cooldown

Min **~20 minutes** since `lastSentAtMs`.

## 20. HIGH cooldown

Min **~10 minutes** since `lastSentAtMs`.

## 21. CRITICAL cooldown/bypass policy

**Safer fail-closed decision (058I ambiguous → closed):**

- May bypass MEDIUM/HIGH ordinary interval
- Does **NOT** bypass hourly or daily soft budgets
- Max **2** CRITICAL / rolling **30 minutes**
- Hard report×subscription dedupe unchanged

## 22. Atomic reservation architecture

Pure `reserveNearbyBudgetSlotAtomic` (in-memory store harness) simulates Firestore txn:

1. read state  
2. `decideNearbyBudget`  
3. write incremented counters in one step  

Production Firestore transaction wiring deferred (gate false ⇒ unused).

## 23. Concurrent-report behavior

Two simultaneous reports, one remaining hourly slot ⇒ only one reservation succeeds; second gets `REJECT_HOURLY_BUDGET`.

## 24. Retry semantics

Order: rollout → budget reserve → event claim → FCM → budget commit/release → event complete.

## 25. Failed-send budget behavior

Transient FCM failure ⇒ **release** reservation + release event claim (retryable).  
Do not permanently consume budget for undelivered pushes.

## 26. Invalid-token behavior

Release budget; disable subscription; mark event `failed_invalid_token`.

## 27. notificationEvents interaction

Hard claim unchanged. Duplicate claim after reserve ⇒ release budget.

## 28. Category policy

Unchanged create-time capable set; MEDIUM delayed; traffic/other/stolen/marketplace/weather never.

## 29. Trust/lifecycle policy

`likelyGone` / disputed reject preserved. No confirmation subcollection reads. No TTL/lifecycle mutation.

## 30. Self-exclusion status

`subscription.uid === report.ownerUid` still rejected. Live A+B proof deferred.

## 31. Deep-link status

Unchanged `https://app.totimoto.com/?report=<id>&notification=nearby_<category>`.

## 32. Foreground UX status

No `onMessage`, no toast, no SW change.

## 33. Kill-switch architecture

Precedence: compile-time gate false → ALWAYS OFF → ops `enabled: false` → Stage 0 → else evaluate eligibility. No production ops doc created.

## 34. Assistance isolation

Lifecycle Functions do not import nearby budget/rollout. Nearby kill does not throttle assistance. Regression asserted in tests.

## 35. Firestore security impact

Local rules only (not deployed): clients cannot create/mutate `nearbyNotificationBudget`; may keep existing map unchanged on other updates. Old clients compatible.

## 36. Privacy-safe observability

Extended counters; allowlisted keys only (no token/lat/lng/geohash/uid/subscriptionId fields).

## 37. Cost impact — 100 riders

Budget txn ≈ +1 read/+1 write per attempted send when wired. Dominated by existing geo queries. Negligible.

## 38. Cost impact — 1,000 riders

Budget cost linear in sends; still ≪ dense geo fan-out.

## 39. Cost impact — 10,000 riders

Budget txs grow with eligible sends; geo recipient fan-out for large radii remains larger cost center.

## 40. Cost impact — 100,000 riders

Heartbeat + geo fan-out dominate; budget txs secondary unless CRITICAL mass-notify.

## 41. First expected bottleneck

**Dense-city geohash recipient fan-out** (large-radius CRITICAL), not budget transactions.

## 42. Files changed

- `functions/src/nearby/rolloutConfig.ts` (new)
- `functions/src/nearby/rolloutEligibility.ts` (new)
- `functions/src/nearby/nearbyBudget.ts` (new)
- `functions/src/nearby/nearbyObservability.ts` (new)
- `functions/src/nearby/processNearbyReport.ts` (wire fail-closed)
- `functions/src/nearby/policy.ts` (cooldown mode note)
- `functions/src/test/nearbyRolloutControl.test.ts` (new)
- `functions/src/test/nearbyReportNotify.test.ts` (two-key test updates)
- `functions/src/test/nearbyRolloutDesign.test.ts` (mode assertion)
- `functions/package.json` (test script)
- `firestore.rules` (server-owned budget field; **not deployed**)
- `tests/rules/rules.test.js` (058J budget rules)
- `TRN_058J_NEARBY_ROLLOUT_CONTROL_AND_BUDGET.md` (this report)

## 43. Tests added

058J safety, stages, bucketing, budgets, atomic reservation, retry release, observability, assistance isolation, gate false dry_run, rules budget deny; plus gate true + Stage 0 two-key test.

## 44. Validation results

| Check | Result |
|---|---|
| `npm run test:notifications` | **114** pass |
| `npm run test:location` | **372** pass |
| `npm run test:rules` | **113** pass (+2 058J budget rules) |
| `npm run build` | pass |
| `functions` `npm test` | **152** pass |
| `functions` `npm run lint` | pass |
| `git diff --check` | clean for 058J sources |
| Production send gate | **`false`** |
| Canary allowlist | **empty** |
| Default rollout stage | **0** |

## 45. Commit hash

`4025b1c` (`feat: add nearby notification rollout controls`)

## 46. Git status

```
On branch feature/nearby-rollout-control
058J tracked files committed.
Unrelated local dirty/untracked: .firebase cache, other architecture MDs, scripts/
```

## 47. Production send gate final proof

`ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND: boolean = false` in `sendGate.ts`.

## 48. GO / NO-GO for 058K

**GO** for 058K to wire Firestore budget transaction + optional ops config reader **still default Stage 0 / gate false**.  
**NO-GO** to flip gate or populate production allowlists without an explicit canary task.

## 49. Exact 058K scope

1. Admin Firestore transaction for `nearbyNotificationBudget`  
2. Optional ops config document reader (fail-closed; no open defaults)  
3. Persist observability counters in Function logs  
4. Keep canary empty / gate false unless separate canary task  
5. Self-exclusion + deep-link live canary plans remain separate

## 50. Items intentionally deferred

- Real FCM enablement / canary  
- Production Firestore ops doc  
- Confirmation-trigger MEDIUM categories  
- uid-shared budgets / clustering  
- Foreground in-app toast  
- Deploy of rules/Functions/Hosting  
- Retiring legacy canary Set (kept as extra fail-closed layer)
