# TRN 058L — Stage 1 Nearby FCM Canary Preparation

**Branch:** `feature/nearby-stage1-canary`  
**Phase:** A — preparation only. **No live canary. No gate flip. No deploy.**

---

## Absolute safety (Phase A end state)

| Item | Required |
|---|---|
| `ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND` | **`false`** |
| Stage | **0** (no production ops doc) |
| Canary allowlist | **empty** |
| Real nearby FCM | **OFF** |

---

## 1. Branch

`feature/nearby-stage1-canary`

## 2. Starting HEAD

`c8b282c` (058K tip)

## 3. Current production gate

`ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND = false` (source + must remain so through Phase A).

## 4. Current production Function revision

Not re-queried in Phase A. Last known from 058H shutdown era: `onreportcreatednearbynotify-00003-zoz` on main at `74a77e2` — **does not include 058K**. Confirm with `firebase functions:list` before Deploy 1.

## 5. 058K production adoption requirement

**YES.** Production must receive 058K/058L Function code **with gate false** before any Stage-1 activation. Current prod Function lacks ops config + atomic budget.

## 6. Rules deployment requirement

**YES before budget fields are written in production.** Local rules protect `nearbyNotificationBudget` and `systemConfig/*`. Deploy rules (or rules+indexes scope) **before** Deploy 1 Function that writes budget. Old clients remain compatible (prefs/location unchanged).

## 7. Exact deep-link code path

1. FCM data: `reportId`, `notificationType`, `deepLink` (`buildNearbyReportPayload`)  
2. SW `onBackgroundMessage` → system notification; click → `clients.openWindow(absoluteUrl)` + `postMessage({ type: TRN_NOTIFICATION_CLICK, reportId, deepLink })`  
3. URL: `https://app.totimoto.com/?report=<id>&notification=nearby_accident`  
4. App: `parseTrnSearchParams` and/or SW message → `pendingDeepLinkReportId`  
5. `applyDeepLinkReportId` → find report in `reports` by id → `setSelectedReport` → card UI  
6. Bounded mode: `selectedReportId` passed into geo query so forced report is retained  

## 8. Exact-report proof mechanism

- Unit: `evaluateDeepLinkReportSelection` + payload/URL tests  
- Live (Phase C): DEV console `[TRN deep-link proof]` with **report id prefix only** (`found` / `selected` / `reason`)  
- Operator checklist: tap → confirm selected card type/id matches Device A accident  

## 9. Self-exclusion code path

`isSelfReporterSubscription`: `subscription.uid === report.ownerUid` inside `filterNearbyNotificationRecipients`.

## 10. Self-exclusion ordering

Runs in recipient filter **before** gate/rollout/budget/event/FCM. Self-only ⇒ `no_recipients` with **zero** config reads, budget calls, claims, sends (proven in 058L tests).

## 11. Device A requirements

Notifications on; `nearbyAlerts` true; `accident` true; heartbeat ≤5 min preferred (≤30 hard); valid token; creates accident; **different UID from B**.

## 12. Device B requirements

Same prefs/heartbeat; physically in accident radius; **only** Stage-1 allowlisted subscription for receive.

## 13. Stage 1 config schema (DO NOT CREATE YET)

```json
{
  "enabled": true,
  "stage": 1,
  "allowlistedSubscriptionIds": ["<DEVICE_B_SUBSCRIPTION_ID_ONLY>"],
  "updatedAt": <server timestamp>
}
```

Path: `systemConfig/nearbyNotifications`

## 14. Allowlist handling

Empty allowlist ⇒ normalize Stage 0 / nobody. Stage 1 requires non-empty list. Device A must **not** be listed.

## 15. Secret / subscription-id handling

Never commit real subscription IDs. Operator supplies Device B id at canary time (console / private note). Not in source, not in report body as a real value.

## 16. Config cache behavior

45s TTL for **closed** configs. **Open (delivery-unlocked) configs always re-fetch** (058L kill-switch fix).

## 17. Emergency ops kill-switch behavior

Set `enabled: false` or `stage: 0` on ops doc → next Function invocation re-reads (because prior open cache bypassed) → Stage 0. No Hosting redeploy.

## 18. 45-second cache risk

Mitigated for open configs: no 45s permissive sticky cache. Closed Stage 0 may stick ≤45s (still fail-closed).

## 19. Hard gate rollback

Set compile-time gate `false` + redeploy **only** `onReportCreatedNearbyNotify`. Prefer ops kill first, then hard gate.

## 20. Recommended deployment order

Two-deploy strategy (preferred).

## 21. Deploy 1 scope

1. Merge/push 058K+058L (gate false)  
2. Deploy **Firestore rules** (budget + systemConfig deny)  
3. Deploy **nearby Function only**, gate **false**  
4. Production dry-run / Stage 0 proof: 0 FCM  

**THEN STOP for approval.**

## 22. Deploy 2 scope (only after explicit Anis approval)

1. Create Stage-1 ops doc (Device B only)  
2. Flip gate **true** in source  
3. Redeploy nearby Function only  
4. Verify ACTIVE revision + Stage 1 + allowlist size 1  
5. Anis creates **one accident**  
6. Immediately: ops `enabled:false` → then gate false redeploy  

## 23. Canary category

**accident only.**

## 24. Heartbeat requirements

A and B: prefer ≤5 min; must ≤30 min. Else STOP.

## 25. Expected candidates

Possibly A+B (and others) in geo query.

## 26. Expected self exclusions

Device A excluded (ownerUid match).

## 27. Expected eligible recipients

Device B (after prefs/fresh/self + Stage 1 + canary if still used).

## 28. Expected FCM count

**Exactly 1** (Device B).

## 29. Expected Device A budget delta

**0**

## 30. Expected Device B budget delta

hourly +1, daily +1, lastNearbySentAt set, **pending cleared** after success.

## 31. Expected notificationEvents

Exactly one: `nearby_report:{reportId}:{DeviceBSubId}` → `sent`. No A event. No duplicate B.

## 32. Retry expectation

Same reservation id / event claim ⇒ no second budget, no second FCM (unit/emulator proven).

## 33. Deep-link expected result

Tap → app opens → exact Device A accident selected → report card visible.

## 34. Exact live success criteria

- A: no notification  
- B: one notification  
- B tap → exact report card  
- one event `sent`  
- B budget +1, pending clear  
- A budget unchanged  

## 35. Exact abort criteria

Stale heartbeat; wrong allowlist; >1 FCM; A receives push; wrong report opens; budget pending stuck; gate/config mismatch; any panic category.

## 36. Files changed

(See commit.)

## 37. Tests added

Self-exclusion ordering; Stage 1 B-only; gate/Stage 0 override; deep-link proof; kill-switch open-cache bypass; retry budget/event.

## 38. Validation

| Check | Result |
|---|---|
| `npm run test:notifications` | **119** pass |
| `npm run test:location` | **372** pass |
| `npm run test:rules` | **116** pass |
| `vite build` | pass |
| `functions` `npm test` | **170** pass |
| `functions` `npm run lint` | pass |
| Production send gate | **`false`** |

## 39. Commit hash

(Filled after commit.)

## 40. Git status

(Filled after commit.)

## 41. GO / NO-GO for infrastructure adoption

**GO** for Deploy 1 (gate false + rules + nearby Function) after merge approval.

## 42. GO / NO-GO for live Stage-1 canary

**NO-GO until** Deploy 1 verified + Anis/strategist **explicit** Phase C approval.

## 43. Exact blockers

- 058K not in production Function yet  
- Rules for budget/systemConfig not deployed  
- Live self-exclusion not proven  
- Exact deep-link report open not proven live  
- No Phase C approval  

## 44. Exact operator steps after approval

See Deploy 1 → stop → approval → Deploy 2 canary → ops kill → gate false. Never skip Deploy 1 dry-run proof.
