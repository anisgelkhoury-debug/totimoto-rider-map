# TRN 058I — Limited Nearby FCM Rollout Design

**Branch:** `feature/nearby-limited-rollout-design`  
**Starting HEAD:** `74a77e2` (`chore: disable nearby fcm after canary`)  
**Scope:** Design / audit / pure helpers only. **No production nearby FCM enablement.**

---

## Absolute safety (this task)

| Constraint | Status |
|---|---|
| `ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND` | **must remain `false`** |
| Canary allowlist | **empty** (`Set([])`) |
| Deploy Functions / Hosting / rules / indexes | **forbidden** |
| Real FCM / production data writes | **forbidden** |
| Push / merge | **forbidden** |

Production nearby real FCM remains **OFF**. Assistance lifecycle notification Functions remain untouched.

---

## 1. Branch

`feature/nearby-limited-rollout-design`

## 2. Starting HEAD

`74a77e2360f2a13d999bc9dc481c69cbf48c0fae` → short: **`74a77e2`**

## 3. 058H proven baseline

Verified first two-device nearby FCM canary (then mandatory shutdown):

| Fact | Value |
|---|---|
| Production HEAD after shutdown | `74a77e2` |
| Function | `onReportCreatedNearbyNotify` **ACTIVE** |
| Final revision | `onreportcreatednearbynotify-00003-zoz` |
| Final send gate | **`false`** |
| Final allowlist | **empty** |
| Real nearby FCM | **OFF** |
| Live result | Device B received **one** accident nearby notification |
| Counts | candidate=1, eligible=1, allowlistedEligible=1, attempted=1, success=1, failed=0, disabledTokens=0 |
| Events | exactly one nearby `notificationEvent`, state=`sent`, no duplicate, no non-allowlisted send |
| Deep link generated | `https://app.totimoto.com/?report=<reportId>&notification=nearby_accident` |
| Notification while map open | **yes** (observed) |
| Clickable | **yes** |
| Exact correct-report open | **NOT separately proven** — must not be claimed |
| Self-exclusion live | **NOT fully proven** (Device A lacked `nearbyAlerts`) |
| Assistance lifecycle Functions | unchanged / ACTIVE |
| `onReportConfirmationWritten` | ACTIVE / unchanged |

---

## 4. Current nearby sender architecture

**Trigger:** Firestore `onDocumentCreated` on `reports/{reportId}` → `onReportCreatedNearbyNotify` (`functions/src/index.ts`).

**Pipeline (`processNearbyReport.ts`):**

1. Parse report (`reportParse.ts`) — category, ownerUid, createdAt, parent trust fields.
2. Category must be nearby push category (`shared/nearbyNotificationRadii.ts`).
3. V1 send-capable check (`policy.ts`) — MEDIUM road intel deferred.
4. Report age freshness (`NEARBY_REPORT_MAX_AGE_MS`).
5. Trust gate (`passesNearbyTrustGate`) — skip `likelyGone` / disputed.
6. Build geohash query plan from report cell + category radius (`recipientGeoPlan`).
7. Query `notificationSubscriptions` with `enabled == true` + geohash ranges (index required).
8. Filter candidates: prefs, location freshness (30 min), self-reporter exclusion (`ownerUid` match).
9. **Send gate:** if `ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND === false` → `status: dry_run`, **zero FCM**, zero nearby events.
10. If gate true → canary allowlist filter (`sendGate.ts`). Empty allowlist ⇒ nobody.
11. Claim `notificationEvents` id `nearby_report:{reportId}:{subscriptionId}` (create-if-not-exists).
12. Send FCM; mark event `sent` / handle invalid tokens.

**Client:** opt-in `nearbyAlerts` (default false), category prefs, coarse geohash heartbeat via `myLocation` (no lat/lng stored for targeting), SW `onBackgroundMessage` + click → `TRN_NOTIFICATION_CLICK`. No Firebase `onMessage` foreground handler today.

**Assistance:** separate lifecycle Functions (request/offer status) — independent of nearby send gate.

---

## 5. Production-proven vs test-proven behavior

| Behavior | Proven how |
|---|---|
| Gate false ⇒ dry_run, 0 FCM, 0 nearby events | **Production** (058F/G) + unit tests |
| Gate true + allowlist of 1 ⇒ one FCM | **Production** (058H) |
| Non-allowlisted eligible ⇒ no FCM | **Production** (058H pre-filter path) + tests |
| Shutdown gate false + empty allowlist | **Production** (`74a77e2`) |
| Accident category create-time notify | **Production** (058H) |
| notificationEvents claim / no duplicate | **Production** (058H) + unit tests |
| Deep link URL shape | **Production** (generated + clickable) |
| Exact report detail open from tap | **Not proven live** |
| Self-exclusion (ownerUid) | **Unit-test proven**; live not fully exercised |
| Preference / stale heartbeat reject | Unit tests + dry-run eligibility path |
| MEDIUM delayed categories | Unit / policy tests only (no live send) |
| Cooldown / rolling budget | **Not implemented** (`postponed_v1`) |
| Assistance lifecycle | Separate production path (pre-existing) |

---

## 6. Existing send gate / allowlist architecture

**File:** `functions/src/nearby/sendGate.ts`

```text
Real FCM requires BOTH:
  ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND === true
  AND subscriptionId ∈ NEARBY_NOTIFICATION_CANARY_SUBSCRIPTION_IDS
```

| Control | Current value | Semantics |
|---|---|---|
| Compile-time boolean gate | `false` | Fail-closed for all real nearby FCM |
| Canary allowlist | `new Set([])` | Empty ≠ everybody; empty = nobody |
| Redeploy required to change | Yes (today) | Fast enough for canary; slow for ops kill |

**Invariant:** gate true alone must never notify entire opted-in population. Empty allowlist remains fail-closed.

---

## 7. Current category / radius / freshness policy

**Authoritative source:** code (`nearbyNotificationRadii.ts`, `policy.ts`), not older architecture MD where they diverge.

| Category | Severity | Radius km | Max report age | V1 send-capable? |
|---|---|---|---|---|
| gunfire | CRITICAL | 6 | 10 min | yes (create-time) |
| explosionStrike | CRITICAL | 10 | 10 min | yes (create-time) |
| collapseDanger | HIGH | 6 | 15 min | yes (create-time) |
| accident | HIGH | 1.5 | 10 min | yes (create-time) |
| fire | HIGH | 3 | 15 min | yes (create-time) |
| checkpoint | MEDIUM | 2 | 15 min | **delayed** |
| road_closed | MEDIUM | 3 | 20 min | **delayed** |
| slippery_road | MEDIUM | 1.5 | 15 min | **delayed** |

**Not in nearby push:** traffic, other/unclassified, marketplace, stolen, weather.

**Location freshness (recipient):** heartbeat older than **30 minutes** rejected.

**No haversine refinement** after geohash range query (V1).

---

## 8. Recommended severity matrix

Preserve current severity labels; recommend **no severity reassignment** for V1 limited rollout.

| Category | Severity | Cooldown priority | Bypass ordinary interval? | Recommended rollout stage |
|---|---|---|---|---|
| gunfire | CRITICAL | highest | yes (with cap) | Stage 2+ (after Stage 1 accident proof) |
| explosionStrike | CRITICAL | highest | yes (with cap) | Stage 2+ |
| collapseDanger | HIGH | high | no | Stage 2+ |
| accident | HIGH | high | no | Stage 1 first |
| fire | HIGH | high | no | Stage 2 |
| checkpoint | MEDIUM | normal | no | Stage 3+ (after trust trigger) |
| road_closed | MEDIUM | normal | no | Stage 3+ |
| slippery_road | MEDIUM | normal | no | Stage 3+ |

---

## 9. Recommended trust matrix

| Category | Min trust at create | Confirmation required for V1? | likelyGone blocks? | disputed blocks? |
|---|---|---|---|---|
| accident / fire / gunfire / explosionStrike / collapseDanger | Parent aggregates OK (usually zeros) — notify as **بلاغ** | No for create-time V1 | **Yes** | **Yes** |
| checkpoint / road_closed / slippery_road | Stronger trust / confirmation architecture | **Yes** (recommend keep delayed) | **Yes** | **Yes** |

**Principle:** TRN reports what a rider reported — never official/authority confirmation. Arabic: **بلاغ**, **قريب من منطقتك**.

---

## 10. Create-time notification policy

**Recommend keep create-time send-capable for:**

- `accident`, `fire`, `gunfire`, `explosionStrike`, `collapseDanger`

**Rationale:** time-critical rider safety intel; 058H proved accident path; wording remains بلاغ (not guaranteed danger).

**Do not auto-change** without a dedicated task — this is recommendation only.

---

## 11. Confirmation-dependent notification policy

**Recommend keep delayed (no create-time FCM) for:**

- `checkpoint`, `road_closed`, `slippery_road`

Until a confirmation-trigger Function (or stronger parent-trust thresholds) exists. Do not add traffic/stolen/marketplace/weather.

---

## 12. likelyGone / disputed policy

**V1 (current + recommend preserve):**

- `likelyGoneSince` present → **block** notify
- disputed (`present >= 1 && gone >= 1 && gone >= present`) → **block**
- Later state changes do **not** retract already-sent FCM in V1 (no recall API); avoid re-notify via hard dedupe only

**Later:** optional “stale intel” suppression for same-area follow-ups when original becomes likelyGone.

---

## 13. Cooldown architecture options

| Option | Reads | Writes | Races | Multi-device | Retries | Privacy | Complexity | Scale |
|---|---|---|---|---|---|---|---|---|
| **A. Query notificationEvents history per candidate** | High (N+1) | Low | Weak without txn | Per subscription OK | OK with claim | Events Admin-only | Medium | Poor at 10k+ |
| **B. Rolling budget on subscription doc** | 1/candidate (already loaded) | +1/send | Need txn/field update | Per device/sub | Good with claim-first | Coarse counters only | Low–med | Good |
| **C. Dedicated `notificationBudget/{uid}`** | Extra doc | Extra | Txn needed | Shared across devices | Good | uid-keyed | Med | Good |
| **D. Counter txn model** | Contended | Contended | Strong | Flexible | Strong | OK | High | Hotspots |
| **E. In-memory Function state** | 0 | 0 | Lost on cold start | Broken | Broken | N/A | Low | **Reject** |
| **F. Hybrid: B + hard event claim** | Low | Low | Claim wins | Per sub; optional uid rollup later | Strong | Best V1 | Med | Best V1 |

---

## 14. Recommended cooldown architecture

**Recommend Option F (Hybrid) for V1:**

1. Keep **hard dedupe** `nearby_report:{reportId}:{subscriptionId}` (unchanged).
2. Store **rolling counters + lastNearbySentAt** on the **subscription document** already read in the pipeline (Option B fields).
3. Pure decision via `decideNearbyCooldown` (`rolloutDesign.ts`) — wire in **058J**, not 058I.
4. Update counters only after successful claim / send path (or claim+budget txn in 058J).
5. **Do not** N+1 query `notificationEvents` history per candidate.

Multi-device: V1 budgets are **per subscription** (per device token row). Optional later: uid-level budget doc (Option C) if one rider runs many devices.

---

## 15. Recommended hourly / daily budgets

Design lock (`NEARBY_BUDGET_PROPOSAL`):

| Budget | Value |
|---|---|
| Soft hourly max | **~3** nearby / 60 min / subscription |
| Soft daily max | **~12** nearby / 24 h / subscription |
| MEDIUM min interval | **~20 min** |
| HIGH min interval | **~10 min** |
| CRITICAL ordinary interval | may bypass |
| CRITICAL hard cap | **≤2 / 30 min** even with bypass |

Tune after Stage 2 observation; numbers are starting policy, not sacred.

---

## 16. Critical-alert bypass rules

- CRITICAL may bypass MEDIUM/HIGH interval.
- CRITICAL still subject to: hard report×sub dedupe, soft daily budget, critical 30-min cap, trust/likelyGone/disputed, rollout eligibility, send gate.
- Never bypass empty allowlist / Stage 0 / missing config.

---

## 17. Duplicate / retry protection

| Risk | V1 protection |
|---|---|
| Same report retrigger / Function retry | `notificationEvents` claim (create-only) |
| Multiple devices same rider | Separate subscription ids → separate events; cooldown per sub |
| App open vs background | Same FCM delivery; UX see §29 |
| Report later likelyGone/disputed | No retract; no re-send (dedupe) |

---

## 18. Same-area alert-fatigue strategy

**V1 (do not build clustering):** budgets + intervals + category send-capable set + trust blocks.

**Defer:** geo clustering of “same accident”, category burst suppression beyond budgets, likelyGone follow-up mute.

---

## 19. Multi-device policy

- Eligibility and FCM are **per subscription document**.
- Hard dedupe is per `reportId × subscriptionId`.
- Soft budget V1: per subscription (accept that 2 devices ≈ 2 budgets).
- Self-exclusion: by `ownerUid` on report vs subscription uid (all devices of reporter excluded if uid matches).

---

## 20. Rollout Stage 0

| Field | Value |
|---|---|
| Eligibility | Nobody for real FCM |
| Allowlist | empty / ignored |
| Categories | n/a |
| Max population | 0 |
| Monitoring | Confirm dry_run only if Function fires |
| Success | Gate false; 0 attempted |
| Rollback | Already safe |
| Observe before expand | Current production state |

---

## 21. Rollout Stage 1

| Field | Value |
|---|---|
| Eligibility | Anis / explicit test subscription ids only |
| Allowlist | **required non-empty**; empty fails closed |
| Categories | Start with **accident** only in live canaries |
| Max population | ≤ 3 subscription ids |
| Monitoring | Full privacy-safe outcome log per send |
| Success | Self-exclusion + deep-link proof canaries pass |
| Rollback | Gate false OR clear allowlist + redeploy / config |
| Min observation | ≥ 24 h quiet + both canaries pass |

---

## 22. Rollout Stage 2

| Field | Value |
|---|---|
| Eligibility | Small manually approved **opted-in** riders |
| Allowlist | Explicit subscription ids (cap) |
| Categories | accident + fire; then CRITICAL after review |
| Max population | ≤ **25** subscriptions (hard cap in config) |
| Monitoring | Daily review of success/fail/cooldownReject |
| Success | <2% failed tokens; no spam complaints; budgets respected |
| Rollback | Stage→0 or clear allowlist |
| Min observation | ≥ **7 days** |

---

## 23. Rollout Stage 3

| Field | Value |
|---|---|
| Eligibility | Opted-in ∩ (geo prefix allow **or** category allow **or** small allowlist) |
| Allowlist | Optional; scope required (fail closed if none) |
| Categories | Add MEDIUM only if confirmation-trigger ready |
| Max population | ≤ **200** effective |
| Monitoring | Cost model vs actual reads |
| Success | Bottleneck within budget; fatigue OK |
| Rollback | Stage→0 / remove geo prefixes |
| Min observation | ≥ **14 days** |

---

## 24. Rollout Stage 4

| Field | Value |
|---|---|
| Eligibility | Opted-in ∩ deterministic percent bucket |
| Allowlist | Not required; **percentOpen > 0** required |
| Categories | Send-capable set only |
| Max population | percent of opted-in (start **5–10%**) |
| Monitoring | Alert on attempted spike |
| Success | Stable error rates; support load OK |
| Rollback | percentOpen→0 or Stage→0 |
| Min observation | ≥ **14 days** before raising percent |

---

## 25. Fail-closed rollout control

**Recommend dual control (never gate-alone):**

1. **Send gate** (compile-time or env) — master OFF.
2. **Rollout config** (`NearbyRolloutConfig`) — stage + allowlist / geo / percent.

| Failure | Behavior |
|---|---|
| Missing config | fail closed |
| Invalid stage | fail closed |
| Empty allowlist at Stage 1–2 | fail closed (**≠ everybody**) |
| Stage 4 percent ≤ 0 | fail closed |
| Stage 0 | fail closed |

Pure helpers: `validateNearbyRolloutConfig`, `emptyAllowlistMeansNobody` in `functions/src/nearby/rolloutDesign.ts` (**not wired to send in 058I**).

**Prefer:** Firestore ops config doc for stage/allowlist/percent **plus** compile-time/env master gate for kill (see §26).

---

## 26. Kill-switch architecture

| Option | Speed | Risk | Assistance impact |
|---|---|---|---|
| 1. Compile-time constant + redeploy | minutes–tens of min | Redeploy lag | None if only nearby Function |
| 2. Function env/config | minutes | Ops access | None |
| 3. Firestore ops config doc | **seconds–1 min** | Doc ACL critical | None if nearby-only key |
| 4. Remote Config | minutes | Extra dependency | None |
| 5. **Combination** | best | Slight complexity | None |

**Recommend V1 long-term:**  
**Master kill = Function env `NEARBY_FCM_SEND_ENABLED=false` (default false)** read each invocation, **AND** Firestore `ops/nearbyNotificationRollout` stage.  
Short-term (until 058J): keep compile-time gate false; shutdown = redeploy nearby Function only (proven in 058H).

**Must not:** Hosting redeploy, preference wipe, subscription delete, or disable assistance lifecycle Functions.

---

## 27. Self-exclusion next-canary design

**Design only — do not execute in 058I.**

| Device | Setup |
|---|---|
| A | `nearbyAlerts` ON, accident ON, fresh heartbeat, creates accident report |
| B | `nearbyAlerts` ON, accident ON, fresh heartbeat, physically nearby, **on allowlist** |

**Expect:**

- A excluded (`ownerUid` match) → `selfExcludedCount ≥ 1`
- B eligible → exactly one FCM, one nearby event `sent`
- Gate true only for this canary window; allowlist = B’s subscription id only
- Immediate restore: gate false, allowlist empty

---

## 28. Deep-link next-canary design

**Acceptance (design only):**

1. Tap notification → `app.totimoto.com/?report=<id>&notification=nearby_accident`
2. App selects that report id
3. Report card/detail for **that** id opens
4. Bounded/full query mode must **not** drop forced selected report
5. Record pass/fail separately from “notification appeared”

Do **not** change geo query default in 058I.

---

## 29. Foreground notification UX recommendation

**Audit (code):**

- Service worker: `onBackgroundMessage` + system notification + click → `TRN_NOTIFICATION_CLICK`
- **No** `onMessage` foreground handler in app
- **No** dedicated in-app nearby toast for FCM

058H “notification while map open” is consistent with **browser/system notification** (PWA / SW path), not a custom in-app banner.

**Recommend V1:** **A** — keep normal system notification even while app open (simple, clickable, proven).  
**Defer:** lightweight in-app alert (B/C) until duplicate visual risk is measured; avoid D-suppress without data.

---

## 30. Cost model — 100 riders

Order-of-magnitude (opted-in, dense Beirut bias):

| Item | Rough daily order |
|---|---|
| Heartbeat writes | ~1k–2k |
| Report-trigger invocations | ~tens (accidents) |
| Geohash range queries | ~hundreds |
| Subscription reads | low hundreds |
| Budget R/W (future) | ≪ events |
| notificationEvents writes | ≪ eligible sends |
| FCM | ≪ eligible when gate open |

**Bottleneck risk:** negligible.

---

## 31. Cost model — 1,000 riders

| Item | Rough daily order |
|---|---|
| Heartbeats | ~10k–20k |
| Per accident candidate scans | tens–low hundreds docs in dense cells |
| Function CPU | still modest |
| FCM | low hundreds if gate+rollout open |

**Watch:** geohash hot cells in Beirut.

---

## 32. Cost model — 10,000 riders

| Item | Rough daily order |
|---|---|
| Heartbeats | ~100k–200k writes |
| Dense 10 km categories (explosionStrike) | **large** candidate fan-out |
| Index + query cost | first pressure point |
| Budget fields on subscription | cheap vs history queries |

**Watch:** CRITICAL 10 km radius in dense city.

---

## 33. Cost model — 100,000 riders

| Item | Rough daily order |
|---|---|
| Heartbeats | **millions**/day if always active |
| Fan-out per CRITICAL create | thousands of candidates possible |
| Function timeout / fan-out batching | required |
| FCM cost | material |

Requires sharding/batching, stricter radius, and rollout percent — not V1 limited rollout.

---

## 34. First expected scaling bottleneck

**Dense-city geohash recipient fan-out for large-radius CRITICAL categories (especially ~10 km explosionStrike), not FCM itself and not notificationEvents writes.**

Secondary: heartbeat write volume at high opted-in counts.

---

## 35. Privacy-safe observability

Log/metric fields only (see `buildNearbyObservabilityPayload`):

- category, sendGate, rolloutStage  
- candidateCount, eligibleCount, rolloutEligibleCount  
- cooldownRejectedCount, staleLocationRejectedCount, preferenceRejectedCount  
- selfExcludedCount, dedupeRejectedCount  
- attempted, success, failed, disabledTokens  

**Never log:** tokens, raw lat/lng, full geohashes, phones, personal identifiers.

---

## 36. Operational alert thresholds (limited rollout)

| Signal | Alert |
|---|---|
| `failed / attempted` > 20% (n≥5) | Token / FCM health |
| `attempted` spike ≫ Stage max population | Possible gate/allowlist misconfig |
| `success > 0` while Stage 0 / gate false | **P0 — impossible / bug** |
| `disabledTokens` rising fast | Client token refresh issues |
| `cooldownRejectedCount` ≫ success in Stage 2 | Budget too tight or spam reports |
| Any log containing token/lat/lng | Privacy incident |

---

## 37. Files changed (058I)

- `TRN_058_LIMITED_NEARBY_FCM_ROLLOUT_DESIGN.md` (this report)
- `functions/src/nearby/rolloutDesign.ts` (pure helpers — **not wired to send**)
- `functions/src/test/nearbyRolloutDesign.test.ts`

## 38. Tests added

- Fail-closed missing/invalid config, empty allowlist, Stage 0
- Gate remains false; allowlist empty
- Cooldown decision budgets
- Hash bucket determinism; Stage 4 percent 0 closed
- Observability payload key hygiene
- `processNearbyReport` / `index` do **not** import `rolloutDesign`
- traffic/stolen/marketplace remain out of send-capable policy source

## 39. Validation results

| Check | Result |
|---|---|
| `npm run test:notifications` | **114** pass |
| `npm run test:location` | **372** pass |
| `npm run test:rules` | **111** pass |
| `npm run build` (root) | pass |
| `functions` `npm test` | **134** pass (includes 10 new 058I) |
| `functions` `npm run build` | pass |
| `functions` `npm run lint` | pass |
| Production send gate | **`false`** |
| Canary allowlist | **empty** |
| `rolloutDesign` wired to send | **no** |

## 40. Commit hash

(Filled after local commit.)

## 41. Git status

(Filled after local commit.)

## 42. GO / NO-GO for 058J implementation

**GO for 058J design-implementation** of:

- wire rollout config + dual control (gate + stage) **still default Stage 0 / gate false**
- subscription rolling budget fields + `decideNearbyCooldown`
- privacy-safe metrics expansion
- self-exclusion + deep-link **canary execution plans** as separate controlled tasks

**NO-GO** to flip production send gate or expand allowlist in 058J without an explicit canary task.

## 43. Exact 058J scope (proposed)

1. Persist fail-closed `NearbyRolloutConfig` reader (Firestore ops doc and/or env) — default Stage 0.
2. Wire eligibility after preference filter: allowlist / percent / geo — **without** enabling gate.
3. Add subscription budget fields + pure cooldown check; unit + Functions tests.
4. Expand outcome logging to new counters (still no PII).
5. Kill-switch: prefer env master OFF readable without Hosting deploy.
6. **Do not** enable real FCM; **do not** deploy with gate true.

## 44. Items intentionally deferred

- Same-area clustering / multi-report dedupe
- Confirmation-triggered MEDIUM categories
- uid-level shared budget across devices
- In-app foreground toast
- Remote Config
- Haversine post-filter
- Bounded geo query production switch
- traffic / stolen / marketplace / weather push
- Retracting notifications when likelyGone
- 100k-scale fan-out batching

---

## Discrepancies noted vs older docs

`TRN_058_SMART_RIDER_NOTIFICATION_ARCHITECTURE.md` may list different radii/ages/copy. **Shipped code is authoritative** for 058I design baseline.
