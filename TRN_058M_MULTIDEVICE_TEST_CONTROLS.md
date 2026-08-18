# TRN 058M — Multi-Device Nearby Notification Test Controls

**Branch:** `feature/nearby-multidevice-test-controls`  
**Phase:** test/control foundation only. **No live 058M. No gate flip. No deploy.**

---

## Absolute safety (this task end state)

| Item | Required |
|---|---|
| `ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND` | **`false`** |
| Stage | **0** |
| Ops `systemConfig/nearbyNotifications` | **disabled / empty allowlist** (do not write) |
| Compile-time canary Set | **empty** |
| Real nearby FCM | **OFF** |

Synthetic fixture ids are prefixed `trn058m-sub-` / `trn058m-uid-`. Full production subscription ids, tokens, and UIDs stay **local only** (never Git).

---

## Existing architecture reused (no duplicated business rules)

| Concern | Source |
|---|---|
| Recipient eligibility / self / stale / prefs | `filterNearbyNotificationRecipients` |
| Geo targeting | `planNotificationRecipientCells` + geohash ranges (no haversine) |
| Stage-1 allowlist | `normalizeNearbyRolloutConfig` + `filterNearbyRolloutEligible` |
| Canary allowlist | `filterNearbyCanaryRecipients` |
| Budget / HIGH interval | `decideNearbyBudget` / `NEARBY_BUDGET_POLICY` |
| Event dedupe | `nearby_report:{reportId}:{subscriptionId}` |
| Invalid token | `isPermanentInvalidTokenError` + `nearbyBudgetActionAfterSend` |
| Deep link | `buildNearbyReportPayload` / `buildNearbyReportDeepLink` |

Helpers live in `functions/src/nearby/multideviceTestControls.ts` (**not** imported by production send).

---

## Device fixture model (synthetic)

| Role | Meaning | Wave 1 expect |
|---|---|---|
| A_REPORTER | reporter, same uid as report owner | self-excluded; 0 FCM / event / budget |
| B_ELIGIBLE_1 | in-radius, fresh, opted in | 1 FCM, 1 sent event, hourly+1, daily+1, pending 0 |
| C_ELIGIBLE_2 | second eligible | same as B |
| D_OUTSIDE_RADIUS | ~5 km north | geo excluded; 0 send/event/budget |
| E_STALE | heartbeat >30 min | stale excluded; 0 |
| F_ALERTS_OFF | `nearbyAlerts` false | preference excluded; 0 |
| F_ACCIDENT_PREF_OFF | accident pref false (separate test) | 0 |
| G_INVALID_TOKEN | Wave 4 only | invalid-token path; budget released |

Accident radius is **1.5 km**. V1 geo uses **geohash query bounds**, not exact haversine. A 1.6 km fixture can still match a covering cell. **D is ~5 km north** so its precision-6 geohash is outside every accident range.

---

## Dual keys (future live only — not this task)

Real FCM still requires **both**:

1. Compile-time gate `true` **and** canary Set containing the test subscription ids  
2. Ops `enabled=true`, `stage=1`, same ids in the Stage-1 allowlist  

Empty either list ⇒ nobody. **Do not populate either in this task.**

---

## Operator checklist (future live 058M)

Keep a **local-only** map of physical device → logical role → subscription id prefix. Never commit full ids.

### Before enable

- [ ] Git on the approved 058M implementation commit; production gate **false**
- [ ] Ops **disabled**, Stage **0**, allowlists **empty**
- [ ] Rollback steps rehearsed (ops disable first, then gate false + empty Set + Function-only redeploy if a live enable had deployed gate-true code)
- [ ] A–F (and optional G) mapped; full ids local only
- [ ] B/C heartbeat **≤5 min**; E **>30 min** on purpose
- [ ] D clearly **≥4 km** from the planned accident (not ~1.6 km)
- [ ] F `nearbyAlerts` off **or** accident pref off, verified in settings
- [ ] A opted in + fresh (so live self-exclusion is a real proof)
- [ ] Budgets and nearby `notificationEvents` **baselined** (counts / prefixes only)
- [ ] Accident category only; one report per planned wave

### During live

- [ ] One accident per wave
- [ ] Stop immediately on any unexpected FCM, A receiving, duplicate, or `attempted` above expected
- [ ] Confirm tap on B and C opens **that** accident card
- [ ] Log only `nearby_report_outcome` counts (no tokens / uids / geohashes)

### After live (mandatory)

- [ ] Ops `enabled=false`, `stage=0`, allowlist empty
- [ ] Source gate **false**, canary Set empty
- [ ] Nearby Function matches closed source if a live enable deployed
- [ ] Owner-delete test reports via the app (not Admin)
- [ ] Real nearby FCM **OFF**

---

## Wave plan (future live; not executed here)

| Wave | Goal |
|---|---|
| 1 | Multi-recipient: B+C send; A/D/E/F zero |
| 2 | Same report retry: no second send/budget |
| 3 | Second accident **<10 min**: HIGH interval reject; hourly/daily unchanged |
| 4 | Disposable G invalid token only |
| 5 | Optional hourly budget soak — abort-sensitive |

**Same uid, two subscriptions:** V1 budget is **per subscription**. If both pass all gates and both are allowlisted, **both may receive**. Do not change this to per-UID without an explicit product task.

---

## Observability

**Logged today** (`nearby_report_outcome`): `candidateCount`, `eligibleCount`, `rolloutRejectedCount`, `cooldownRejectedCount`, `attempted`, `success`, `failed`, `disabledTokens`, `sendGate`, `rolloutStage`, …

**Gaps (do not invent in live review):**

- `selfExcludedCount` — helper-only; sender does not populate/log
- `staleLocationRejectedCount` — helper-only
- `preferenceRejectedCount` — helper-only
- HIGH interval reject increments **`cooldownRejectedCount` only**

`candidateCount` in production may exceed unique docs when geohash ranges overlap. Tests use a unique-first-range mock so Wave-1 `candidateCount === 5` is deterministic **in tests**, not a live guarantee.

---

## Rollback

1. Ops disable + Stage 0 + empty allowlist (no deploy)  
2. Gate false + empty canary Set  
3. Redeploy **only** `onReportCreatedNearbyNotify` if gate-true code was deployed  
4. Confirm dry-run / zero new nearby events  

Do not deploy Hosting, rules, indexes, Storage, or assistance Functions for 058M enable/rollback unless a real mismatch appears.
