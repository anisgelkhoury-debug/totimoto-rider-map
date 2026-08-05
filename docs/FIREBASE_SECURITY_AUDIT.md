# Totimoto Rider Network — Firebase Security Audit

**Task ID:** TRN-002-FIREBASE-SECURITY-AUDIT  
**Date:** 2026-07-29  
**Scope:** Security and ownership model analysis  
**Status:** Report only — no code, config, data, packages, or env files were modified

---

## Executive summary

Totimoto’s current security model is **client-trust only**:

| Control | Status |
|---------|--------|
| Firebase Authentication | **Absent** (no Auth imports or sign-in flows) |
| `firestore.rules` in repo | **Absent** |
| `storage.rules` in repo | **Absent** |
| Rules referenced by `firebase.json` | **No** (Hosting only) |
| Server-side ownership checks | **None in application code** |
| Identity | `localStorage.deviceId` (spoofable) |
| Authorization | UI conditionals (`ownerId === deviceId`) |

**Confirmed vulnerability class:** if Firestore/Storage rules in the Firebase project are open (or weakly locked to “authenticated” without field checks), any person with the public web config can read PII, forge ownership, hijack helper claims, overwrite GPS, delete reports, and spam feedback — **bypassing the React UI entirely**.

Whether production rules are currently open **cannot be verified from this repository** and requires Firebase Console / CLI inspection.

---

# PART 1 — CURRENT TRUST MODEL

## 1.1 How `deviceId` is generated

In `src/App.tsx`, on first mount:

```ts
const [deviceId] = useState(() => {
  let id = localStorage.getItem("deviceId")
  if (!id) {
    id = Date.now().toString() + "-" + Math.random().toString(36).slice(2)
    localStorage.setItem("deviceId", id)
  }
  return id
})
```

Properties of this identifier:

| Property | Assessment |
|----------|------------|
| Cryptographic strength | Weak (timestamp + `Math.random`) |
| Server issuance | No |
| Tied to Firebase Auth | No |
| Stable across browsers/devices | No |
| Stable after “Clear site data” | No — new id generated |
| Verifiable by Firestore rules | No — rules cannot trust a client-written string |

## 1.2 Where it is stored

| Location | Key / field | Notes |
|----------|-------------|-------|
| Browser `localStorage` | `deviceId` | Sole source of truth for the session |
| React state | `deviceId` | Loaded once from localStorage |
| Firestore `reports` | `ownerId`, `helperId` | Copies of the string |
| Firestore `feedback` | `deviceId` | Attribution only |

Also stored locally (related identity surface):

| Key | Purpose |
|-----|---------|
| `contactName` | Display / contact gate |
| `contactPhone` | Copied onto reports / feedback |

## 1.3 Can a user change or impersonate another `deviceId`?

**Yes — trivially.**

| Attack | Method | Skill required |
|--------|--------|----------------|
| Become a new anonymous identity | Clear site data / private window | None |
| Impersonate a known owner | DevTools → Application → Local Storage → set `deviceId` to victim’s `ownerId` | Low |
| Impersonate without UI | Firestore REST/SDK write with forged `ownerId` / `helperId` | Low if rules open |
| Steal another user’s id | Read any report’s `ownerId`/`helperId` from the live collection (if readable) | Low if rules open |

There is **no signature**, **no rotation**, and **no binding** of `deviceId` to a secret only the browser holds that Firestore can verify.

## 1.4 Every place `deviceId` is used as ownership or authorization

### Written as ownership claims

| Location | Field set to `deviceId` |
|----------|-------------------------|
| `createUserReport` | `ownerId` |
| `submitStolenBikeReport` | `ownerId` |
| `addReport` | `ownerId` |
| `helperRespond` | `helperId` |
| `submitFeedback` | `deviceId` |
| Helper GPS effect | selects report where `helperId === deviceId` |

### Used as UI authorization gates (not security)

| Condition | UI effect |
|-----------|-----------|
| `ownerId === deviceId` | Show cancel / resolve / “found bike”; hide some marker clicks; sort own reports first; owner-side call routing |
| `ownerId !== deviceId` | Show “أنا قريب” / help actions |
| `helperId === deviceId` | Show helper action panel; cancel help; GPS writer eligibility; “أنت استلمت هذا الطلب” |
| Contact gate `ensureContactInfo` | Blocks some flows until name/phone filled — **not** ownership |

**None of these conditions are re-checked inside the Firebase write helpers themselves** before `updateDoc` / `deleteDoc`.

## 1.5 Operations that depend only on client-side checks

| Operation | UI gate | Function-level ownership check | Server/rules check in repo |
|-----------|---------|--------------------------------|----------------------------|
| Create report | Soft (GPS / contact for some types) | Sets `ownerId` from local id | None in repo |
| Delete / cancel report | Buttons shown if `ownerId === deviceId` | **`cancelReport` has none** | None in repo |
| Resolve report | Owner UI | **`resolveReport` has none** | None in repo |
| Helper claim | Non-owner + assistance type + not claimed | **`helperRespond` has none** | None in repo |
| Cancel help | `helperId === deviceId` | **`cancelHelp` has none** | None in repo |
| Helper GPS update | Effect filters by `helperId === deviceId` | Writes if filter matches | None in repo |
| Read all reports | Always | Full `onSnapshot` | None in repo |
| Feedback create | Non-empty message | Attaches local contact | None in repo |
| Image upload | File picker / size check (general reports 2MB) | Client compress | None in repo |

## 1.6 Can direct Firestore access bypass those checks?

**Yes, if project rules allow the corresponding operation.**

Anyone can:

1. Extract the public Firebase web config from `src/firebase.ts` (or the built bundle).
2. Use Firebase JS SDK, REST API, or a script outside the React UI.
3. Call `getDocs` / `onSnapshot` / `updateDoc` / `deleteDoc` / `addDoc` / Storage uploads without ever satisfying `ownerId === deviceId` UI logic.

The React app is a **convenience client**, not a trust boundary.

```
┌──────────────────────┐
│  Totimoto UI checks  │  ← cosmetic authorization
│  ownerId === deviceId│
└──────────┬───────────┘
           │ can be skipped
           ▼
┌──────────────────────┐
│  Firestore / Storage │  ← real authorization MUST live here
│  Security Rules      │     (not present in this repo)
└──────────────────────┘
```

---

# PART 2 — FIRESTORE OPERATIONS

Severity scale used below:

| Severity | Meaning |
|----------|---------|
| **Critical** | Direct PII exposure, account takeover of reports, mass delete, or stalking via GPS if rules open |
| **High** | Significant abuse / integrity failure |
| **Medium** | Spam, cost, degraded trust |
| **Low** | Limited impact or self-only |

---

## 2.1 CREATE — general / assistance / shared-ride report

| Item | Detail |
|------|--------|
| **Function** | `createUserReport` (primary); legacy `addReport` also creates |
| **Collection** | `reports` |
| **Fields written (primary)** | `ownerId`, `phone`, `ownerPhone`, `ownerName`, `description`, `reportImageUrl`, spread of type config (`label` possible), `type`, `color`, `emoji`, `priority`, `expiry`, `helperComing`, `helperArrived`, `helpers`, `helpersList`, `resolved`, location fields, `lat`/`lng`, `createdAt` |
| **Ownership assumption** | Creator is whoever’s local `deviceId` is; trusted blindly |
| **Current validation** | Optional contact gate for assistance/sharedRide; image ≤2MB then compress; Nominatim for address; fallback lat/lng to Beirut if no GPS |
| **Abuse scenario** | Forge mass fake accidents/help requests; spoof `ownerId`; attach arbitrary phones; upload abusive images; place reports anywhere |
| **Severity** | **Critical** (integrity + PII injection) if create allowed publicly |

---

## 2.2 CREATE — stolen-bike report

| Item | Detail |
|------|--------|
| **Function** | `submitStolenBikeReport` |
| **Fields written** | Client numeric `id`, stolen classification fields, `ownerId`, location (currently hardcoded Beirut coords + geocode), helper defaults, `stolenBike*` fields, `stolenBikeImageUrls`, `createdAt` |
| **Ownership assumption** | `ownerId = deviceId` |
| **Current validation** | Client form only; images compressed (up to 5); **no enforced mandatory image in code path reviewed** beyond UI copy; fixed coordinates weaken location trust |
| **Abuse scenario** | Publish fake stolen alerts with victim phone numbers; doxxing; reputational harm; long TTL (43200 minutes ≈ 30 days) |
| **Severity** | **Critical** |

---

## 2.3 CREATE — feedback

| Item | Detail |
|------|--------|
| **Function** | `submitFeedback` |
| **Collection** | `feedback` |
| **Fields written** | `message`, `deviceId`, `contactName`, `contactPhone`, `createdAt`, `source: "beta-feedback"` |
| **Ownership assumption** | Attribution only; no read-back |
| **Current validation** | Non-empty message trim |
| **Abuse scenario** | Feedback spam; inject phone numbers; fill DB; if feedback is world-readable, leak contacts |
| **Severity** | **High** (spam/cost); **Critical** if feedback is publicly readable |

---

## 2.4 READ — live reports

| Item | Detail |
|------|--------|
| **Function** | `onSnapshot(collection(db, "reports"))` inside `App` `useEffect` |
| **Fields read** | Entire document for every report |
| **Ownership assumption** | All clients may see all reports |
| **Current validation** | None; client later hides `resolved` / expired for display only |
| **Abuse scenario** | Scrape all phones, names, GPS, stolen plate numbers, helper live locations; build rider tracking dataset |
| **Severity** | **Critical** if open read (current app design assumes open read for the product map) |

> Product note: a public map of road conditions may intentionally be world-readable. **Phones, plates, and live helper GPS should not ride on that same public document** without restriction.

---

## 2.5 UPDATE — helper claim

| Item | Detail |
|------|--------|
| **Function** | `helperRespond` |
| **Fields written** | `helperComing: true`, `helperStatus`, `helpers: 1`, `joined: true`, `helperId`, `helperPhone`, `helperName`, `helperLat`, `helperLng`, `helperLocationUpdatedAt`, `helperAcceptedAt` |
| **Ownership assumption** | UI: caller is not owner and request needs help; **function does not verify** |
| **Current validation** | None for “already claimed”, none for assistance family |
| **Abuse scenario** | Steal claim from real helper; overwrite helper phone; claim all open requests; grief owners |
| **Severity** | **Critical** |

---

## 2.6 UPDATE — live GPS

| Item | Detail |
|------|--------|
| **Function** | GPS `useEffect` → `updateHelperGps` → `updateDoc` |
| **Fields written** | `helperLat`, `helperLng`, `helperLocationUpdatedAt` |
| **Ownership assumption** | Only when local `helperId === deviceId` && `helperComing` && `!resolved` |
| **Current validation** | Client throttle 50m / 30s; **no server proof of helper identity** |
| **Abuse scenario** | Direct write spoofs helper position (stalking / fake approach); continuous writes burn quotas |
| **Severity** | **Critical** (safety/privacy); **High** (cost) |

---

## 2.7 UPDATE — resolve

| Item | Detail |
|------|--------|
| **Function** | `resolveReport` |
| **Fields written** | `resolved: true`, `solvedAt` |
| **Ownership assumption** | UI owner-only; **function unchecked** |
| **Current validation** | None |
| **Abuse scenario** | Close others’ help requests; disrupt assistance network |
| **Severity** | **High** |

---

## 2.8 UPDATE — cancel help

| Item | Detail |
|------|--------|
| **Function** | `cancelHelp` |
| **Fields written** | `helperComing: false`, `helperStatus: ""`, `helpers: 0`, `joined: false`, `helperId: ""`, `helperAcceptedAt: null` |
| **Not cleared in Firestore** | `helperPhone`, `helperName`, `helperLat`, `helperLng`, `helperLocationUpdatedAt` (stale PII/GPS remain) |
| **Ownership assumption** | UI helper-only; **function unchecked** |
| **Abuse scenario** | Kick legitimate helper; leave phones/GPS residue for scrapers |
| **Severity** | **High** (+ privacy residue **Medium–High**) |

---

## 2.9 DELETE — cancel report / found bike

| Item | Detail |
|------|--------|
| **Function** | `cancelReport` (also used for stolen “تم العثور على الدراجة”) |
| **Action** | `deleteDoc`; attempts Storage delete for `reportImageUrl` only |
| **Ownership assumption** | UI owner-only; **function unchecked** |
| **Current validation** | None |
| **Abuse scenario** | Mass-delete community reports; erase stolen alerts; evidence destruction |
| **Severity** | **Critical** |

---

## 2.10 EXPIRE — soft client expiry

| Item | Detail |
|------|--------|
| **Function** | `setInterval` filter on React `reports` state |
| **Fields written** | **None to Firestore** |
| **Ownership assumption** | N/A |
| **Current validation** | `(now - createdAt)/60000 < expiry` |
| **Abuse scenario** | Attacker sets huge `expiry` on create → immortal spam docs stay in DB and in every listener |
| **Severity** | **High** (retention / listen cost); integrity **Medium** |

---

## 2.11 Stolen-bike report changes (update/delete surface)

| Change | How | Risk |
|--------|-----|------|
| Create | `submitStolenBikeReport` | Fake alerts, phone injection |
| View / call / WhatsApp | Any client reading the doc | Public contact exposure by design today |
| Mark found / delete | `cancelReport` if UI thinks user is owner | Unauthorized delete if rules open |
| Field updates after create | **No dedicated update API** in app | Direct SDK can still patch any field if rules allow |

---

## 2.12 Operations summary table

| Operation | Function | Client ownership | Bypassable via SDK? |
|-----------|----------|------------------|---------------------|
| Create report | `createUserReport` / `addReport` / `submitStolenBikeReport` | Self-asserted `ownerId` | Yes |
| Read all | `onSnapshot` | Public by design in UI | Yes |
| Helper claim | `helperRespond` | UI only | Yes |
| GPS update | GPS effect | UI/effect only | Yes |
| Resolve | `resolveReport` | UI only | Yes |
| Cancel help | `cancelHelp` | UI only | Yes |
| Delete | `cancelReport` | UI only | Yes |
| Expire | local filter | N/A | Expiry not enforced server-side |
| Feedback create | `submitFeedback` | Self-asserted | Yes |
| Feedback read/update/delete | — | App does not | Unknown in Console |

---

# PART 3 — SENSITIVE DATA

## 3.1 Inventory

| Data | Where stored | Where exposed in UI |
|------|--------------|---------------------|
| **Phone numbers** | `reports.phone`, `ownerPhone`, `helperPhone`, `stolenBikePhone`; `feedback.contactPhone`; `localStorage.contactPhone` | Call/WhatsApp buttons; stolen detail sheet shows number in plaintext |
| **Owner contact name** | `reports.ownerName`; `feedback.contactName`; localStorage | Indirectly via flows; not always prominent |
| **Helper name** | `reports.helperName` | Status messaging |
| **Helper location** | `helperLat`, `helperLng`, `helperLocationUpdatedAt` | Map helper marker; Google Maps link for owner |
| **Report location** | `lat`, `lng`, address fields | Map markers, lists, Maps deep links |
| **Device identifiers** | localStorage + `ownerId` / `helperId` / `feedback.deviceId` | Not shown as such; readable from every report doc if collection readable |
| **Uploaded images** | Storage + URLs on report | `<img>`, full-screen viewer; URLs are durable if guessable/listed |
| **Feedback content** | `feedback.message` (+ contact) | Not shown in app; may be readable in Console / if rules allow client read |

## 3.2 Who can read / modify (code + likely config)

### Confirmed from code

| Field group | App read | App write | Restricted by Auth in code? |
|-------------|----------|-----------|------------------------------|
| All `reports` fields | Every connected client via snapshot | Create/update/delete helpers as above | **No** |
| Helper GPS | Every client (markers for any claimed report) | Claiming helper’s device (UI) | **No** |
| Phones on reports | Every client that opens UI / scrapes snapshot | Creator / claiming helper | **No** |
| Feedback | Not read by app | Any client can `addDoc` | **No** |
| Storage objects | Anyone with download URL | Upload on create; weak delete | **No** |

### Likely risks (if Console rules are permissive — common for early betas)

| Risk | Implication |
|------|-------------|
| `allow read, write: if true` on Firestore | Full database compromise |
| `allow read: if true; allow write: if request.auth != null` without Auth enabled | Writes fail OR Auth later opens broad writes |
| Storage `allow read, write: if true` | Public bucket abuse, malware hosting |
| Feedback world-readable | Support inbox becomes public dump of phones + messages |

### Cannot verify from repository

- Exact deployed Firestore rules text  
- Exact deployed Storage rules text  
- Whether App Check is enforced  
- Whether API key HTTP referrer restrictions exist in Google Cloud Console  
- Whether unused Google Maps key in `.env` has API restrictions  

**Do not treat absence of rules files as proof that Console rules are open** — only as proof they are **not version-controlled here**.

---

# PART 4 — RULES STATUS

## 4.1 Confirmed facts (from repository)

| Fact | Evidence |
|------|----------|
| No `firestore.rules` file | Not in workspace; not in `git ls-files` |
| No `storage.rules` file | Same |
| No `firestore.indexes.json` | Same |
| `firebase.json` configures **Hosting only** | `"public": "dist"`, SPA rewrite; **no** `firestore` or `storage` keys |
| `.firebaserc` points at `totimoto-rider-network` | Project binding only |
| App initializes Firestore + Storage, **not** Auth | `src/firebase.ts` |
| No App Check initialization | No matches for App Check APIs in `src/` |
| Firebase web config is hardcoded in client source | Normal for Firebase web apps; must be paired with rules |
| `.env` holds a Vite Google Maps key and is tracked | Out of band API risk; value intentionally **not** reprinted here |

## 4.2 Likely risks

| Risk | Why likely |
|------|------------|
| Rules never deployed via CI/repo | No rules artifacts or deploy hooks in repo |
| Beta may be running with Console defaults / test-mode leftovers | Common for early Firebase apps that “just work” with client writes |
| Hosting-only `firebase deploy` never updates rules | Even if someone edited Console once, repo cannot reproduce it |
| Full-collection listen implies product expects broad read | Encourages overly open `read` rules |

## 4.3 Cannot be verified from the repository

| Unknown | How to verify |
|---------|----------------|
| Currently deployed Firestore rules | Firebase Console → Firestore → Rules, or `firebase firestore:rules get` with project access |
| Currently deployed Storage rules | Console → Storage → Rules |
| Rules history / who last published | Console release history |
| Whether anonymous Auth is enabled unused | Console → Authentication |
| Billing / quota alerts | Firebase / GCP Console |
| Whether data is already being scraped | Logs, App Check, anomalous read volume |

## 4.4 Distinction statement

> **Confirmed:** the application does not implement cryptographic identity or server-enforced authorization; rules files are absent from the repo; `firebase.json` does not reference rules.  
> **Likely:** production may be under-protected relative to the sensitivity of phones + live GPS.  
> **Unverified:** the exact live rules text and whether the beta is currently exploitable from the public internet.

---

# PART 5 — PRODUCTION SECURITY DESIGN

Minimum safe architecture (**design only — not implemented**).

## 5.1 Authentication options

| Option | Fit for Totimoto | Notes |
|--------|------------------|-------|
| **Anonymous Auth** | Good first step | Gives `request.auth.uid` for rules without login friction |
| Phone Auth | Strong for riders | Matches contact culture; higher friction + cost |
| Google / Apple | Optional upgrade | Better recovery; good for PWA later |
| Custom token (backend) | Later | If you add Cloud Functions + private matching |

**Recommendation:** start with **Anonymous Auth immediately**, then offer **Phone Auth link** when user enters contact for assistance (upgrade anonymous → phone).

### Anonymous vs account-based

| | Anonymous | Account-based (phone/social) |
|--|-----------|------------------------------|
| Friction | Very low | Higher |
| Spoof resistance | Strong vs random localStorage | Strong + recoverable |
| Cross-device | Lost on reinstall unless linked | Recoverable |
| Rules | `request.auth.uid` works | Same + richer claims |

**Do not** keep `localStorage.deviceId` as the security principal after Auth ships.

## 5.2 Ownership fields

| Field | Rule |
|-------|------|
| `ownerId` | Must equal `request.auth.uid` on create; immutable afterward |
| `helperId` | Set only by claim transition; clearable by helper or owner under rules |
| Remove trust in client `deviceId` | Keep temporarily as `legacyDeviceId` for migration only |

## 5.3 Trusted timestamps

| Field | Source |
|-------|--------|
| `createdAt` | `request.time` / `serverTimestamp()` — reject client-only clocks for security decisions |
| `solvedAt`, `helperAcceptedAt`, `helperLocationUpdatedAt` | Server timestamp on allowed updates |
| `expiresAt` | Computed server-side or validated: `createdAt + expiryMinutes` with capped minutes |

## 5.4 Report creation validation (rules + optional Functions)

Allow create only if:

- `request.auth != null`
- `ownerId == request.auth.uid`
- Required fields present and typed
- `lat`/`lng` in Lebanon bounding box (or configured service area)
- `expiry` within allowlist per `reportCategory`
- `description` length capped
- No unexpected fields (or ignore unknown via schema validation in Functions)

## 5.5 Update field allowlists

Example policy:

| Role | Allowed fields |
|------|----------------|
| Owner | `resolved`, `solvedAt`, maybe `description`; **not** `ownerId`, not forging helper |
| Helper (assigned) | `helperLat`, `helperLng`, `helperLocationUpdatedAt`; cancel-help clear set |
| Claimant (unassigned report) | Single transition: `helperComing false→true` + set helper identity fields **only if** currently unclaimed |
| Anyone else | Deny |

Use `request.resource.data.diff(resource.data).affectedKeys()` style allowlists in rules.

## 5.6 Helper GPS permissions

- Only `helperId == request.auth.uid` && `helperComing == true` && `resolved != true`
- Rate-limit via Cloud Function **or** accept rules + App Check + throttle; rules alone cannot perfectly rate-limit
- Consider separate `liveHelperLocations/{reportId}` doc with short retention to avoid rewriting full PII-bearing report docs

## 5.7 Phone-number visibility

**Minimum safe product split:**

| Audience | Can see phones? |
|----------|-----------------|
| Public map readers | **No** |
| Counterpart after successful claim | **Yes** (owner ↔ helper only) |
| Stolen reports | Prefer reveal-on-action via Callable Function, not full-collection field |

Implementation patterns:

1. Store phones in `reportPrivate/{id}` readable only by `ownerId` or `helperId`, **or**
2. Cloud Function `getContactForReport` that checks claim state and returns phone once.

Public docs keep: type, coarse location, expiry, non-PII status flags.

## 5.8 Feedback permissions

| Op | Policy |
|----|--------|
| Create | Auth required; length limit; App Check |
| Read/Update/Delete | Admin only (`request.auth.token.admin == true`) |
| Fields | Strip or avoid storing phone unless necessary |

## 5.9 Storage upload restrictions

```
match /report-images/{uid}/{fileName} {
  allow write: if request.auth.uid == uid
    && request.resource.size < 2_000_000
    && request.resource.contentType.matches('image/.*');
  allow read: if true; // or tighter if images are sensitive
}
```

Same pattern for `stolen-bikes/{uid}/**`.  
Store **storage paths** in Firestore, not only download URLs, so deletes work.

## 5.10 Abuse prevention

| Control | Purpose |
|---------|---------|
| Claim transaction | Prevent double-claim races |
| Per-uid create quotas | Functions / Extension / counting docs |
| Content moderation queue for stolen | Human or AI review before wide publish |
| Blocklists | Abusive uids |
| Delete soft-first | `status: cancelled` instead of hard delete for audit |

## 5.11 Rate limiting

| Layer | Mechanism |
|-------|-----------|
| App Check | Reduce bots |
| Cloud Functions Callable for create/claim | Enforce per-uid rate limits |
| GPS | Min interval server-side (reject updates &lt; N seconds) |
| Feedback | Max N / hour / uid |

Firestore rules alone are insufficient for robust rate limits.

## 5.12 App Check

Enforce App Check for Firestore and Storage (and Functions) before public launch so random scripts using only the API key face friction (not perfect security, but critical botnet mitigation).

## 5.13 Server-side cleanup

| Job | Action |
|-----|--------|
| TTL / scheduled Function | Delete or archive where `expiresAt < now` |
| Resolved archival | Move to `reports_archive` after N hours |
| Orphan Storage GC | Delete unused images |
| Stale helper GPS | Clear helper fields if no heartbeat |

## 5.14 Recommendation ranking

### Critical before public launch

1. Inspect and harden **live** Firestore + Storage rules in Console (immediate).  
2. Add **Firebase Auth** (anonymous minimum) and bind `ownerId`/`helperId` to `uid`.  
3. Lock writes to field allowlists; prevent foreign deletes/resolves/claims.  
4. **Remove phones / plates from world-readable report documents** (or gate via Functions).  
5. Enable **App Check**.  
6. Stop trusting `localStorage.deviceId` for authorization.  
7. Version-control `firestore.rules` + `storage.rules` and wire `firebase.json`.

### High priority

8. Transactional helper claim.  
9. Server timestamps + capped `expiresAt`.  
10. Feedback admin-only read; create auth + limits.  
11. Storage path-per-uid + size/type checks; fix deletes.  
12. Separate live GPS document / reduce full-collection PII churn.  
13. Soft-delete + scheduled TTL cleanup.

### Medium priority

14. Phone Auth linking for assistance users.  
15. Abuse reporting + admin tooling.  
16. Coarser public locations (geohash precision reduction) for non-claimed intel.  
17. API key HTTP referrer / app restrictions in Google Cloud.  
18. Remove secrets/env keys from git history hygiene process.

### Later improvement

19. Full account system, reputation, bans.  
20. End-to-end encrypted contact exchange (usually unnecessary if rules + claim gating done well).  
21. Multi-helper queues, audited event log.  
22. Regional data retention policy / legal hold for stolen reports.

---

# PART 6 — MIGRATION RISK

## 6.1 Impact of adding Firebase Auth on existing `deviceId` records

Existing `reports` documents use:

- `ownerId: "<timestamp>-<random>"`
- optional `helperId` with same scheme

After Auth:

- New users get `request.auth.uid` like `aZ8f...` (anonymous) or phone uid  
- Old docs **will not match** new uids  
- UI checks `ownerId === deviceId` would fail for creators who reinstall **or** who sign in with Auth while localStorage still has old id  
- Strict rules `ownerId == auth.uid` would block legacy owners from managing old reports  
- Orphaned reports remain publicly readable if reads stay open  

## 6.2 Migration approach (preserve reports where possible)

### Phase A — Dual-write / dual-accept (compat window)

1. Ship Auth (anonymous on launch).  
2. Persist mapping:

```text
users/{uid}:
  legacyDeviceIds: string[]   // claimable
  contact...
```

3. On first authenticated session, if `localStorage.deviceId` present, write it into `users/{uid}.legacyDeviceIds` (one-time claim).  
4. Rules allow owner actions if:

```text
resource.data.ownerId == auth.uid
OR resource.data.ownerId in userDoc.legacyDeviceIds
```

(Implement via `get()` to user doc, carefully — watch hot-path costs.)

### Phase B — Re-key documents

Background job (Admin SDK):

1. For each report where `ownerId` matches a claimed legacy device id → set `ownerId = uid`, keep `legacyOwnerId`.  
2. Same for active `helperId` if needed.  
3. Prefer **update in place** to preserve map history and image URLs.

### Phase C — Freeze legacy

1. Stop accepting creates with non-uid `ownerId`.  
2. After window (e.g. 30–60 days), remove legacy rule branch.  
3. Unclaimed legacy reports: remain readable as community data; owner actions disabled or admin-only cleanup.

### Phase D — Contact / PII migration

1. Move phones off public docs as part of same campaign.  
2. For active assistance only, copy phone into private subdoc readable by uid pair.

### Risks to communicate to users

| Risk | Mitigation |
|------|------------|
| User clears storage before linking | Cannot prove legacy ownership → lose edit/delete on old reports |
| Attacker claims victim’s leaked `deviceId` during Phase A | Short claim window; require recent local presence; optional phone verify before linking legacy ids |
| Helper mid-trip during cutover | Dual-accept helperId legacy + uid during window |

### Data preservation principle

> Prefer **re-owning** existing report documents over deleting them. Road intel history and stolen alerts should survive Auth launch; only the security principal behind `ownerId` changes.

---

# Confirmed vulnerabilities (application-layer)

These are **confirmed from code**, independent of Console rules:

1. **Spoofable identity** — `deviceId` is client-minted and mutable.  
2. **UI-only authorization** — mutate/delete functions do not verify caller ownership.  
3. **World-readable sensitive fields by app design** — full report documents (including phones & helper GPS) are streamed to every client.  
4. **No Auth / App Check / rules-as-code** in the repository.  
5. **Helper claim race / overwrite** — blind `updateDoc` without transaction or unclaimed precondition.  
6. **Cancel-help leaves PII/GPS residue** on the document.  
7. **Client-controlled expiry** — no server TTL enforcement.  
8. **Storage delete fragility** — URL used as ref; stolen images not cleaned on delete.  
9. **Feedback write path unauthenticated** with optional phone attached.

If Console rules are permissive, each of the above becomes **remotely exploitable without using the UI**.

---

# Unknowns requiring Firebase Console inspection

1. Live Firestore rules text and last publish time.  
2. Live Storage rules text.  
3. Whether test mode / open rules are still active.  
4. Auth providers enabled (even if unused by app).  
5. App Check status.  
6. API key application restrictions.  
7. Actual data volume / evidence of abuse in logs.  
8. Whether admins already rely on Console-only lockouts not reflected in git.

---

# Minimum production security architecture (one-page)

```
Client (PWA)
  ├─ Firebase Auth (Anonymous → optional Phone link)
  ├─ App Check token on all requests
  └─ Writes only through allowlisted fields / Callables for claim & contact reveal

Firestore
  ├─ reports_public: non-PII map layer (world read; auth create)
  ├─ report_private/{id}: phones (owner/helper only)
  ├─ feedback: create by auth; read admin
  └─ Rules: uid ownership, claim transitions, GPS allowlist, server timestamps

Storage
  └─ {type}/{uid}/{file}: auth write + size/type; controlled read

Functions / scheduled
  ├─ claimReport (transaction)
  ├─ getContact (authorized reveal)
  ├─ TTL cleanup / archive
  └─ rate limits

Migration
  └─ legacyDeviceIds claim → re-key ownerId/helperId → freeze legacy
```

---

# Audit closure

**TRN-002-FIREBASE-SECURITY-AUDIT** complete.

| Deliverable | Location |
|-------------|----------|
| Current trust model | Part 1 |
| Operation abuse analysis | Part 2 |
| Sensitive data exposure | Part 3 |
| Rules status / unknowns | Part 4 |
| Production security design + ranking | Part 5 |
| Auth migration plan | Part 6 |

**No code or configuration was modified.**  
**Stop.**
