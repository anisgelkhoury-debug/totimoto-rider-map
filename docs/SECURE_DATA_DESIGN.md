# Totimoto Rider Network — Secure Production Data Design

**Task ID:** TRN-003-SECURE-DATA-DESIGN  
**Date:** 2026-07-29  
**Status:** Report only — no code, Firebase config, rules, data, or packages modified  
**Inputs:** `docs/FIRESTORE_SCHEMA.md`, `docs/FIREBASE_SECURITY_AUDIT.md`

---

## How to read this document

| Label | Meaning |
|-------|---------|
| **Confirmed current behavior** | Observed in the application repository today |
| **Proposed architecture** | Target design for production (not implemented) |
| **Assumption / Console verification** | Depends on live Firebase project state not visible in git |

---

## Confirmed current behavior (baseline)

| Area | Today |
|------|--------|
| Auth | None |
| Identity | `localStorage.deviceId` |
| Collections | `reports`, `feedback` |
| PII on public docs | Phones, names, helper GPS on every `reports` doc |
| Authorization | UI-only (`ownerId === deviceId`) |
| Rules in repo | Absent; `firebase.json` is Hosting-only |
| Live rules | **Unknown** — Console verification required |

---

## Proposed architecture (target)

```
┌─────────────────────────────────────────────────────────────────┐
│ Client PWA                                                       │
│  Firebase Auth (Anonymous → optional Phone / Email link)         │
│  App Check                                                       │
│  Reads: reports (public) + allowed private docs                  │
│  Writes: allowlisted fields OR Callables (claim / contact)       │
└───────────────┬─────────────────────────────┬───────────────────┘
                │                             │
                ▼                             ▼
        Cloud Firestore                 Cloud Functions
   users/{uid}                        claimAssistance
   reports/{id}          public       releaseClaim
   reportPrivate/{id}    private      revealContact (optional)
   assistanceSessions/{id}            scheduled TTL / GPS GC
   liveHelperLocations/{reportId}     rate limits / moderation hooks
   feedback/{id}
   migrationClaims/{uid} (temp)
                │
                ▼
        Firebase Storage
   report-images/{uid}/{fileId}
   stolen-bikes/{uid}/{fileId}
```

**Design principles**

1. Public map data stays world-readable; **PII does not**.  
2. `request.auth.uid` is the only security principal.  
3. Helper claim is a **single-winner state transition**, preferably transactional.  
4. Live GPS is a **short-lived side document**, not a field on the public report.  
5. Server timestamps and TTL own lifecycle — not the browser clock alone.

---

# 1. Recommended Firebase Authentication model

## 1.1 Chosen model

| Stage | Mechanism | When |
|-------|-----------|------|
| Default | **Anonymous Auth** on first app open | Every user before any friction |
| Upgrade (assistance / stolen contact) | **Phone Auth link** to the same uid | When user saves contact for help flows |
| Optional later | Email link or Google/Apple | Account recovery / multi-device preference |

**Do not** continue using `localStorage.deviceId` as authorization after Phase 1.

## 1.2 Why this fits TRN

| TRN need | Why Anonymous + optional Phone works |
|----------|--------------------------------------|
| Map browsing with low friction | Anonymous Auth is silent; riders can view intel immediately |
| Arabic / Lebanon rider reality | Phone is the natural identity; WhatsApp already central |
| Assistance requires contact | Phone link happens at the moment contact becomes necessary |
| Security rules need `auth.uid` | Anonymous provides a real, unforgeable uid without a signup wall |
| PWA / iPhone install | Avoids forcing Apple/Google SSO on day one |

## 1.3 Account recovery implications

| Scenario | Outcome |
|----------|---------|
| Anonymous only, user clears site data | **New uid**; cannot prove ownership of old reports unless legacy claim window still open |
| Phone linked | Same uid recoverable on new device via Phone Auth |
| Email/social linked later | Cross-device recovery without SMS if preferred |
| User refuses phone forever | Can browse + post non-contact intel; cannot receive/accept assistance that needs reveal |

**Product rule (proposed):** road-intel reports may be created by anonymous users; assistance, shared-ride, and stolen contact flows require **linked phone** (or at least a verified contact path via Callable).

## 1.4 Assumptions requiring Console verification

- Whether Authentication is already enabled in project `totimoto-rider-network`
- Whether Phone Auth / billing / reCAPTCHA is configured
- Anonymous Auth quota and region settings

---

# 2. Proposed Firestore collections and structures

## 2.1 Collection map

| Collection | Sensitivity | Purpose |
|------------|-------------|---------|
| `users` | Private (self + admin) | Profile, linked legacy ids, contact preference flags |
| `reports` | **Public read** | Map-visible report cards (no phones, no live GPS) |
| `reportPrivate` | Private | Phones, names, plate detail, storage paths |
| `assistanceSessions` | Semi-private | Claim state machine for help / shared ride |
| `liveHelperLocations` | Private (owner ↔ helper) | Throttled live GPS |
| `feedback` | Create by user; read admin | Beta / support messages |
| `migrationClaims` | Private (self) | Temporary legacy `deviceId` linking (Phase 1–2 only) |
| `reportsArchive` (optional) | Restricted | Cold storage after expiry |

Stolen-bike **map presence** stays in `reports` with `reportFamily: "stolen"`. Sensitive stolen fields (phone, plate, exact private notes) live in `reportPrivate`.

## 2.2 Entity relationships

```
users/{uid}
   │
   ├── owns → reports/{reportId}           (ownerId)
   ├── private → reportPrivate/{reportId}  (same id)
   ├── session → assistanceSessions/{reportId}
   └── location ↔ liveHelperLocations/{reportId}  (as helper)

reports/{reportId}  1:1  reportPrivate/{reportId}
reports/{reportId}  1:1  assistanceSessions/{reportId}   (assistance | sharedRide only)
reports/{reportId}  1:1  liveHelperLocations/{reportId}  (while claimed & active)
```

---

# 3. Collection specifications

Conventions used below:

- Timestamps are Firestore `timestamp` (server) unless noted
- `ownerId` / `helperId` always mean Firebase Auth `uid`
- Soft status preferred over hard delete for auditability

---

## 3.1 `users/{uid}`

| Field | Type | Public? | Notes |
|-------|------|---------|-------|
| `displayName` | string | self | Optional rider name |
| `phoneE164` | string \| null | self | Set only after Phone Auth link |
| `phoneVerified` | bool | self | Derived from Auth provider data |
| `createdAt` | timestamp | self | Server |
| `updatedAt` | timestamp | self | Server |
| `legacyDeviceIds` | string[] | self | Migration only; max 1–3 |
| `legacyLinkedAt` | timestamp \| null | self | When deviceId was claimed |
| `role` | string | admin-set | `"user"` \| `"admin"` \| `"moderator"` |
| `banned` | bool | admin-set | Block creates/claims |
| `contactShareDefault` | bool | self | UX preference |

| Dimension | Policy |
|-----------|--------|
| **Ownership field** | Document id `uid` == `request.auth.uid` |
| **Allowed creators** | Client may create own doc on first login (`uid == auth.uid`); or Admin SDK / `onAuth` Function |
| **Allowed readers** | Owner; admins |
| **Allowed updates** | Owner: allowlisted profile fields only; cannot set `role`/`banned`; `legacyDeviceIds` append only via Callable during migration |
| **Allowed deletes** | Admin only (or account-deletion Function) |
| **Retention** | Keep while account exists; purge PII on account deletion request |

---

## 3.2 `reports/{reportId}` — public map document

**Contains no phones, no helper GPS, no raw deviceIds, no private plates.**

| Field | Type | Public? | Notes |
|-------|------|---------|-------|
| `ownerId` | string | yes (uid, not legacy device) | Immutable after create |
| `reportFamily` | string | yes | `intelligence` \| `assistance` \| `sharedRide` \| `stolen` |
| `reportCategory` | string | yes | e.g. `traffic`, `fuel`, `stolen` |
| `type` | string | yes | Arabic display label |
| `emoji` | string | yes | |
| `color` | string | yes | |
| `priority` | string | yes | `high` \| `medium` \| `low` |
| `lat` | number | yes | Validated bbox |
| `lng` | number | yes | Validated bbox |
| `area` | string | yes | |
| `street` | string | yes | |
| `city` | string | yes | |
| `district` | string | yes | |
| `locationName` | string | yes | |
| `description` | string | yes | Max length (e.g. 120–300) |
| `imagePath` | string \| null | yes | Storage path under owner uid (not phone) |
| `imageUrl` | string \| null | yes | Optional cached download URL |
| `status` | string | yes | `active` \| `claimed` \| `resolved` \| `expired` \| `cancelled` \| `removed` |
| `helperPresent` | bool | yes | Denormalized flag only — **not** helper identity/GPS |
| `createdAt` | timestamp | yes | Server |
| `expiresAt` | timestamp | yes | Server-computed |
| `resolvedAt` | timestamp \| null | yes | |
| `updatedAt` | timestamp | yes | |
| `schemaVersion` | number | yes | Start at `2` |

Stolen **public** extras (non-PII):

| Field | Type | Notes |
|-------|------|-------|
| `stolenBikeType` | string | Model/type free text |
| `stolenBikeColor` | string | |
| `stolenPlaceLabel` | string | Public place text |
| `stolenAtDate` | string \| timestamp | Date of theft (non-contact) |
| `stolenImagePaths` | string[] | Paths only; max 5 |
| `hasPrivateContact` | bool | True if private phone exists |

| Dimension | Policy |
|-----------|--------|
| **Ownership** | `ownerId` |
| **Creators** | Authenticated, not banned; optional phone-verified for assistance/stolen |
| **Readers** | **Public** (`status in [active, claimed]` or including recently resolved — product choice) |
| **Updates** | Owner: limited fields (`description`?, soft cancel); system/Functions: `status`, `expiresAt`, `helperPresent`; **no client write of PII fields** (they must not exist here) |
| **Deletes** | Prefer `status: cancelled/removed`; hard delete via Admin/TTL only |
| **Retention** | TTL: family-based (intel minutes–hours; stolen up to ~30 days); then archive or delete |

**Removed from public docs vs today:** `phone`, `ownerPhone`, `ownerName`, `helperPhone`, `helperName`, `helperLat`, `helperLng`, `helperLocationUpdatedAt`, `stolenBikePhone`, `stolenBikePlate` (plate → private), `deviceId`, client numeric `id`.

---

## 3.3 `reportPrivate/{reportId}`

Same document id as the public report.

| Field | Type | Public? | Notes |
|-------|------|---------|-------|
| `reportId` | string | no | Mirror of doc id |
| `ownerId` | string | no | Must match public report |
| `ownerName` | string | no | |
| `ownerPhoneE164` | string | no | |
| `stolenBikePhoneE164` | string \| null | no | Stolen contact |
| `stolenBikePlate` | string \| null | no | Sensitive identifier |
| `helperId` | string \| null | no | Copied when claimed |
| `helperName` | string \| null | no | |
| `helperPhoneE164` | string \| null | no | |
| `createdAt` | timestamp | no | |
| `updatedAt` | timestamp | no | |

| Dimension | Policy |
|-----------|--------|
| **Ownership** | `ownerId`; helper gains read when session active |
| **Creators** | Same transaction/Callable as public report create (owner only) |
| **Readers** | `auth.uid == ownerId` OR (`auth.uid == helperId` AND assistance session `status == active`) OR admin |
| **Updates** | Owner: own contact fields before/during active; Helper: none directly (session Callable writes helper contact); clear helper fields on release |
| **Deletes** | With report TTL / owner cancel via Admin or Cascading Function |
| **Retention** | Delete or scrub phones when report archived/expired |

---

## 3.4 `assistanceSessions/{reportId}`

Used for `reportFamily in [assistance, sharedRide]` (and optionally stolen “watcher” later — out of scope).

| Field | Type | Public? | Notes |
|-------|------|---------|-------|
| `reportId` | string | semi | |
| `ownerId` | string | semi | |
| `helperId` | string \| null | semi | |
| `status` | string | yes-ish | `open` \| `claimed` \| `released` \| `resolved` \| `expired` |
| `claimedAt` | timestamp \| null | | |
| `releasedAt` | timestamp \| null | | |
| `resolvedAt` | timestamp \| null | | |
| `lastHelperHeartbeatAt` | timestamp \| null | | From GPS updates / session ping |
| `claimVersion` | number | | Increment on each claim/release for sanity |
| `createdAt` | timestamp | | |
| `updatedAt` | timestamp | | |

Expose to clients carefully:

- Public report only shows `helperPresent` / `status: claimed`
- Full session doc readable by **owner and helper** (and maybe `open` status readable by authenticated users who need to know it’s claimable — or keep claimability on public `status`)

| Dimension | Policy |
|-----------|--------|
| **Ownership** | `ownerId`; assignee `helperId` |
| **Creators** | Created with report (status `open`) by owner/system |
| **Readers** | Owner + assigned helper; optionally authenticated users may read `status` only via public report denormalization |
| **Updates** | **Claim/release/resolve via Callable or tightly constrained rules transactions** — see §5 |
| **Deletes** | TTL with report |
| **Retention** | Keep briefly after resolve for dispute (e.g. 7 days), then delete |

---

## 3.5 `liveHelperLocations/{reportId}`

| Field | Type | Public? | Notes |
|-------|------|---------|-------|
| `reportId` | string | no | |
| `helperId` | string | no | Must match session |
| `ownerId` | string | no | For read ACL |
| `lat` | number | no | |
| `lng` | number | no | |
| `updatedAt` | timestamp | no | Server |
| `expiresAt` | timestamp | no | e.g. updatedAt + 2–5 minutes |

| Dimension | Policy |
|-----------|--------|
| **Ownership** | Writer = `helperId`; readers = owner + helper |
| **Creators** | Helper on first GPS after claim (or Callable) |
| **Readers** | `auth.uid in [ownerId, helperId]` only — **never public map listeners** |
| **Updates** | Helper only; throttle (client + optional Function); reject if session not `claimed` |
| **Deletes** | On release/resolve/expire/stale heartbeat timeout |
| **Retention** | Minutes, not days |

---

## 3.6 `feedback/{feedbackId}`

| Field | Type | Public? | Notes |
|-------|------|---------|-------|
| `uid` | string | no | `auth.uid` |
| `message` | string | no | Max length |
| `createdAt` | timestamp | no | Server |
| `source` | string | no | e.g. `beta-feedback` |
| `contactPhoneE164` | string \| null | no | Optional; prefer omit if uid has phone on profile |
| `appVersion` | string \| null | no | |

| Dimension | Policy |
|-----------|--------|
| **Ownership** | `uid` |
| **Creators** | Authenticated users |
| **Readers** | Admin / moderator only |
| **Updates** | None (immutable) |
| **Deletes** | Admin |
| **Retention** | 90–180 days unless legal hold |

---

## 3.7 `migrationClaims/{uid}` (temporary)

| Field | Type | Notes |
|-------|------|-------|
| `uid` | string | auth uid |
| `legacyDeviceId` | string | From localStorage at claim time |
| `claimedAt` | timestamp | Server |
| `clientFingerprintHash` | string \| null | Optional weak signal |
| `status` | string | `pending` \| `applied` \| `rejected` |

| Dimension | Policy |
|-----------|--------|
| **Creators** | Callable only (not open client write of arbitrary deviceIds) |
| **Readers** | Self + admin |
| **Retention** | Delete after migration freeze |

---

## 3.8 Storage paths (related, not Firestore)

| Path | Writers | Readers | Notes |
|------|---------|---------|-------|
| `report-images/{uid}/{fileId}` | `auth.uid == uid` | Public or auth — product choice | ≤2MB, image/* |
| `stolen-bikes/{uid}/{fileId}` | `auth.uid == uid` | Prefer auth; stolen images are sensitive | ≤2MB each, max 5 refs |

Store **paths** on public/private docs; regenerate URLs as needed.

---

# 4. Removing sensitive information from public reports

## 4.1 Field relocation matrix

| Current public field (today) | Target location | Public? |
|------------------------------|-----------------|---------|
| `phone` / `ownerPhone` | `reportPrivate.ownerPhoneE164` | no |
| `ownerName` | `reportPrivate.ownerName` | no |
| `helperPhone` / `helperName` | `reportPrivate` + session | no |
| `helperLat` / `helperLng` / `helperLocationUpdatedAt` | `liveHelperLocations` | no |
| `stolenBikePhone` | `reportPrivate.stolenBikePhoneE164` | no |
| `stolenBikePlate` | `reportPrivate.stolenBikePlate` | no |
| `ownerId` as legacy deviceId | Auth `uid` only | uid ok on public |
| `deviceId` on feedback | `feedback.uid` | no |

## 4.2 Public report may still show

- Type, emoji, color, priority  
- Approximate/exact road location (product: keep exact for safety utility; optional later coarsening)  
- Description, non-PII stolen attributes (type/color/place label)  
- Image(s) if product accepts public evidence photos  
- `status`, `helperPresent`, timestamps  

## 4.3 Contact reveal UX (proposed)

| Actor | How they get a phone |
|-------|----------------------|
| Owner after claim | Read `reportPrivate` (helper fields filled) **or** Callable `revealContact` |
| Helper after claim | Read `reportPrivate` owner phone |
| Random map viewer | **Denied** |
| Stolen viewer | Tap “تواصل” → Callable checks auth + rate limit → returns phone once / short-lived |

---

# 5. Helper claim design

## 5.1 State machine

```
open → claimed → resolved
  │        │
  │        └→ released → open
  └→ expired / cancelled
```

## 5.2 Prevent double claims

**Requirement:** claim must be atomic.

**Preferred:** Callable `claimAssistance({ reportId })` using Firestore transaction:

1. Read `assistanceSessions/{reportId}`  
2. Abort if `status != open` OR `helperId != null`  
3. Abort if caller `uid == ownerId`  
4. Abort if caller banned / not phone-verified (if required)  
5. Set `helperId`, `status: claimed`, `claimedAt: serverTime`, `claimVersion++`  
6. Update `reports/{id}`: `status: claimed`, `helperPresent: true`  
7. Write helper contact into `reportPrivate`  

**Alternative (rules-only):** allow update only if:

```
resource.data.status == 'open'
&& request.resource.data.status == 'claimed'
&& request.resource.data.helperId == request.auth.uid
&& resource.data.helperId == null
```

Rules-only is brittle for multi-doc updates; **Callable + transaction is the minimum safe production choice**.

## 5.3 Claim release

Callable `releaseClaim({ reportId })` allowed if:

- `auth.uid == helperId` (helper cancels), or  
- `auth.uid == ownerId` (owner rejects helper)

Actions:

- Session → `released` then back to `open` (or directly `open` with history fields)  
- Clear `reportPrivate` helper contact fields  
- Delete `liveHelperLocations/{reportId}`  
- Public report → `status: active`, `helperPresent: false`

## 5.4 Stale helper handling

| Condition | Action |
|-----------|--------|
| No heartbeat for **10–15 minutes** | Scheduled job releases claim |
| `liveHelperLocations.expiresAt < now` | Treat as stale signal; job confirms via session heartbeat |
| Helper disables GPS | Client should heartbeat session even without move; else stale release |

## 5.5 Permissions summary

| Action | Owner | Helper | Others |
|--------|-------|--------|--------|
| Create assistance report | yes | — | — |
| Claim | no | yes if open | no |
| Update live GPS | no | yes if claimed | no |
| Read counterpart phone | yes if claimed | yes if claimed | no |
| Release | yes | yes | no |
| Resolve | yes | no (optional: helper suggest) | no |
| Cancel report | yes | no | no |

---

# 6. Live location design

## 6.1 Placement

**Separate collection:** `liveHelperLocations/{reportId}`  

**Why not on `reports`:**

- Avoids pushing GPS into every map listener  
- Tight ACL (owner+helper only)  
- Short TTL without rewriting public intel docs  
- Lower accidental PII leakage

## 6.2 Who can read

Only `ownerId` and `helperId` for that report’s active session.

Owner UI subscribes to this single doc while sheet is open — **not** the whole collection.

## 6.3 Update frequency

| Layer | Policy |
|-------|--------|
| Client (keep) | Write if moved ≥ **50 m** OR ≥ **30 s** (current TRN behavior is fine as UX throttle) |
| Server (add) | Reject / ignore updates more frequent than **1 per 15–20 s** per helper (Callable or rules + monitoring) |
| Heartbeat | Even if stationary, refresh `updatedAt` / session `lastHelperHeartbeatAt` every **60 s** |

## 6.4 Expiration and cleanup

| Mechanism | Detail |
|-----------|--------|
| Doc `expiresAt` | `updatedAt + 3 minutes` on each write |
| Scheduled Function | Every 5 minutes: delete locations where `expiresAt < now` |
| On release/resolve | Immediate delete |
| On stale session | Delete location + release claim |

---

# 7. Server responsibilities

| Responsibility | Mechanism | Notes |
|----------------|-----------|-------|
| **Trusted timestamps** | `FieldValue.serverTimestamp()` / `request.time` in rules | Client `Date.now()` not authoritative for `createdAt`/`expiresAt` |
| **Expiry computation** | On create: `expiresAt = now + capped duration by category` | Align with current family expiries; stolen long TTL |
| **Cleanup expired reports** | Scheduled Function | Set `status: expired`; move to archive; delete private + storage |
| **Notification triggers** | Optional FCM later | On claim, on helper approaching — not required for Phase 1 |
| **Rate limiting** | Callables + App Check | Creates / claims / feedback / contact reveals per uid |
| **Moderation** | Admin flags + stolen review queue | Especially stolen + images |
| **Sensitive-field access** | `reportPrivate` rules + optional `revealContact` | No public phones |
| **Claim integrity** | Transactional Callables | Double-claim prevention |
| **Cascade delete/scrub** | Functions on cancel/expire | Private docs, GPS, storage |
| **Migration linking** | Callable `linkLegacyDeviceId` | See §9 |

### Assumptions / Console verification

- Cloud Functions billing enabled  
- Scheduler available  
- Whether Blaze plan is active (required for many of the above)

---

# 8. Firebase security rules blueprint (pseudocode only)

> **Not creating real rules files in this task.**

## 8.1 Shared helpers (conceptual)

```
function isSignedIn() {
  return request.auth != null;
}

function isNotBanned() {
  return !get(/databases/$(database)/documents/users/$(request.auth.uid)).data.banned;
}

function isOwner(ownerId) {
  return isSignedIn() && request.auth.uid == ownerId;
}

function isAdmin() {
  return isSignedIn() && request.auth.token.admin == true;
}

function lebanonBBox(lat, lng) {
  return lat >= 33.0 && lat <= 34.8 && lng >= 35.0 && lng <= 36.8; // tune
}

function reportCreateKeysOK() {
  return request.resource.data.keys().hasOnly([
    'ownerId','reportFamily','reportCategory','type','emoji','color','priority',
    'lat','lng','area','street','city','district','locationName','description',
    'imagePath','imageUrl','status','helperPresent','createdAt','expiresAt',
    'resolvedAt','updatedAt','schemaVersion',
    'stolenBikeType','stolenBikeColor','stolenPlaceLabel','stolenAtDate',
    'stolenImagePaths','hasPrivateContact'
  ]);
}
```

## 8.2 `reports` logic

```
match /reports/{id} {
  allow read: if resource.data.status in ['active', 'claimed']
              || isOwner(resource.data.ownerId)
              || isAdmin();

  allow create: if isSignedIn() && isNotBanned()
    && request.resource.data.ownerId == request.auth.uid
    && reportCreateKeysOK()
    && request.resource.data.status == 'active'
    && request.resource.data.helperPresent == false
    && lebanonBBox(request.resource.data.lat, request.resource.data.lng)
    && request.resource.data.expiresAt > request.time
    // forbid sensitive keys by omission from hasOnly()
    ;

  allow update: if isSignedIn() && (
      // owner soft-cancel / resolve (allowlisted)
      (isOwner(resource.data.ownerId)
        && request.resource.data.diff(resource.data).affectedKeys()
            .hasOnly(['status','resolvedAt','updatedAt','description'])
        && request.resource.data.ownerId == resource.data.ownerId)
      ||
      // system denormalization from Callables using Admin SDK bypasses rules
    );

  allow delete: if false; // soft-delete only; Admin SDK for hard delete
}
```

## 8.3 `reportPrivate` logic

```
match /reportPrivate/{id} {
  allow read: if isOwner(resource.data.ownerId)
    || (resource.data.helperId != null
        && request.auth.uid == resource.data.helperId)
    || isAdmin();

  allow create: if isOwner(request.resource.data.ownerId)
    && request.resource.data.keys().hasOnly([/* private allowlist */]);

  allow update: if isOwner(resource.data.ownerId)
    && affectedKeys allowlist for owner contact fields only
    // helper fields written by Admin SDK / Callable
    ;

  allow delete: if false;
}
```

## 8.4 `assistanceSessions` logic

```
match /assistanceSessions/{id} {
  allow read: if isOwner(resource.data.ownerId)
    || request.auth.uid == resource.data.helperId
    || isAdmin();

  // Prefer: deny client writes; only Cloud Functions (Admin) mutate
  allow write: if false;
}
```

## 8.5 `liveHelperLocations` logic

```
match /liveHelperLocations/{reportId} {
  allow read: if isSignedIn()
    && (request.auth.uid == resource.data.ownerId
        || request.auth.uid == resource.data.helperId);

  allow create, update: if isSignedIn()
    && request.auth.uid == request.resource.data.helperId
    && request.resource.data.helperId == resource.data.helperId // on update
    && keys allowlist ['lat','lng','updatedAt','expiresAt', ...]
    // optionally verify session claimed via get(assistanceSessions/reportId)
    ;

  allow delete: if request.auth.uid == resource.data.helperId
    || request.auth.uid == resource.data.ownerId
    || isAdmin();
}
```

## 8.6 `feedback` / `users`

```
match /feedback/{id} {
  allow create: if isSignedIn() && uid match && message length OK;
  allow read, update, delete: if isAdmin();
}

match /users/{uid} {
  allow read, create, update: if request.auth.uid == uid
    && !changing role/banned/legacyDeviceIds illegally;
  allow delete: if isAdmin();
}
```

## 8.7 Storage blueprint

```
match /report-images/{uid}/{fileId} {
  allow read: if true; // or auth != null
  allow write: if request.auth.uid == uid
    && request.resource.size < 2MB
    && request.resource.contentType.matches('image/.*');
}

match /stolen-bikes/{uid}/{fileId} {
  allow read: if request.auth != null; // tighter than general images
  allow write: if request.auth.uid == uid && size/type checks;
}
```

---

# 9. Migration plan from legacy `localStorage.deviceId`

## 9.1 Goals

- Preserve existing `reports` on the map where practical  
- Re-bind ownership to Auth uids  
- Prevent attackers from claiming **someone else’s** `deviceId` scraped from Firestore  
- Eventually freeze legacy ownership  

## 9.2 Threat: malicious legacy claim

Anyone who can read today’s `ownerId` values could try to set localStorage and “become” that owner during a naive migration.

**Therefore:** do **not** allow open client writes of the form “set my legacyDeviceIds to any string.”

## 9.3 Safe linking protocol (proposed)

### Window

- Migration window: **14–30 days** after Auth launch  
- Communicate in-app: “افتح توتيموتو من نفس الجهاز لربط بلاغاتك”

### Callable `linkLegacyDeviceId`

Inputs: none required from attacker-controlled free text beyond what the **current browser already has**.

Steps:

1. Require `request.auth` (anonymous ok).  
2. Read `legacyDeviceId` **only from the caller’s localStorage via client**, but server enforces:
   - This uid has **no** legacy id yet (or under cap)  
   - This `legacyDeviceId` is **not** already linked to another uid  
   - Optional: `legacyDeviceId` must appear as `ownerId` on ≥1 report **and** client must prove possession by presenting a one-time code written only to reports the device can still “own” under temporary dual rules — **simpler MVP below**  
3. **MVP safer approach:**  
   - During window, dual-ACL allows actions if `auth.uid == ownerId` **OR** (`ownerId == presentedDeviceId` AND `migrationClaims` exists proving this uid linked that deviceId from this install).  
   - Linking allowed only once per uid and once per deviceId (unique index / transaction).  
   - Rate-limit link attempts.  
   - After link, Admin job rewrites `ownerId` → uid and stores `legacyOwnerId`.  
4. **Hardening (recommended if data already public):** require Phone Auth before legacy link; reduces casual spoofing of scraped deviceIds.

### Prevent claiming another deviceId

| Control | Effect |
|---------|--------|
| Unique `legacyDeviceId → uid` | Second claim fails |
| One link per uid | Stops collecting many victims’ ids on one account |
| Phone verify before link | Raises cost of mass takeover |
| Short window | Limits exposure time |
| After freeze, dual-ACL removed | Scraped ids become useless |

## 9.4 Re-key job

Admin SDK script/Function:

```
for report where ownerId in linkedLegacyIds:
  ownerId = uid
  legacyOwnerId = old
  schemaVersion = 2
strip PII fields from report → write reportPrivate
create assistanceSessions if family needs it
delete helper GPS fields from report after moving
```

Same for `helperId` on active claims if any.

## 9.5 Freeze / retire legacy

1. End dual-ACL on date T.  
2. Unlinked legacy reports remain **readable** as community data.  
3. Owner actions on unlinked legacy docs: disabled (or admin-only delete).  
4. Drop `migrationClaims` collection.

## 9.6 Rollback strategy

| Failure | Rollback |
|---------|----------|
| Rules too strict / app breaks | Redeploy previous rules from version control; keep Auth but temporarily allow legacy dual-ACL |
| Bad re-key batch | Restore Firestore export from Phase 0 backup; `legacyOwnerId` enables reverse mapping |
| Callable bugs | Disable Callables via Functions rollback; clients fall back to read-only map |
| Mass false legacy claims | Invalidate `migrationClaims` with `status: rejected`; revert ownerIds from `legacyOwnerId` |

**Prerequisite:** Phase 0 backup before any rewrite.

---

# 10. Implementation phases

---

## Phase 0 — Verify live Firebase rules and backups

**Goal:** Know reality before changing it; obtain a restore point.

| Item | Detail |
|------|--------|
| **Files likely affected** | None in app yet; ops notes only. Later: `docs/` runbooks |
| **Data migration** | None; **export Firestore + Storage inventory** |
| **Deployment order** | 1) Console inspect rules/Auth 2) Export backup 3) Record findings in ops doc |
| **Rollback** | N/A (read-only phase) |
| **User-visible impact** | None |
| **Risks** | Discovering open rules means urgent lockdown; do not announce exploit details publicly |

**Exit criteria:** Written copy of live rules; backup completed; decision on emergency lockdown if `allow write: if true`.

**Assumption:** Requires human access to Firebase Console / CLI — not verifiable from git alone.

---

## Phase 1 — Auth and rules-as-code

**Goal:** Introduce real principals; stop anonymous world-writes without breaking read map if possible.

| Item | Detail |
|------|--------|
| **Files likely affected** | `src/firebase.ts`, `src/App.tsx` (or new `src/auth.ts`), `firebase.json`, **new** `firestore.rules`, `storage.rules`, `package.json` (if Functions workspace added later) |
| **Data migration** | Start anonymous sign-in; dual-write `ownerId: uid` on **new** reports; begin `users/{uid}`; optional `linkLegacyDeviceId` |
| **Deployment order** | 1) Enable Auth providers 2) Commit rules 3) Deploy rules **carefully** (may need temporary dual allow) 4) Ship client that signs in anonymously before writes 5) Monitor failures |
| **Rollback** | Revert hosting release; restore previous rules revision; Auth can remain enabled harmlessly |
| **User-visible impact** | Minimal if anonymous is silent; write failures if rules ship before client Auth |
| **Risks** | Lock-out if rules require auth before client update; legacy owners lose write until link |

**Exit criteria:** All new writes authenticated; rules in git; `deviceId` no longer sole write authority for new docs.

---

## Phase 2 — Private / public data separation

**Goal:** Strip PII from `reports`; create `reportPrivate`.

| Item | Detail |
|------|--------|
| **Files likely affected** | `src/App.tsx` (split services preferred: `src/services/reports.ts`, `reportPrivate.ts`), create/submit flows, stolen modal, contact UI, `firestore.rules`, Storage path layout |
| **Data migration** | Batch: move phones/names/plates into `reportPrivate`; delete sensitive fields from public docs; set `schemaVersion: 2`; set `hasPrivateContact` |
| **Deployment order** | 1) Deploy rules allowing new private collection 2) Ship client dual-read (old fields OR private) 3) Run migration job 4) Remove client reads of legacy public PII fields 5) Rules forbid sensitive keys on `reports` |
| **Rollback** | Keep old fields until dual-read removed; migration job reversible from backup |
| **User-visible impact** | Call/WhatsApp may briefly break if private read ACL wrong; map should still work |
| **Risks** | Orphaned private docs; stolen contact reveal regression |

**Exit criteria:** Public snapshots contain no phones / helper GPS / plates; assistance contact still works for participants.

---

## Phase 3 — Helper and GPS hardening

**Goal:** Transactional claims; GPS side-channel.

| Item | Detail |
|------|--------|
| **Files likely affected** | New Functions: `claimAssistance`, `releaseClaim`, `resolveAssistance`; client helper UI; remove in-place `helperRespond` direct `updateDoc`; `liveHelperLocations` listeners; rules for sessions/GPS |
| **Data migration** | For active assistance reports: create `assistanceSessions`; move any live GPS fields into `liveHelperLocations`; clear from `reports` |
| **Deployment order** | 1) Deploy Functions 2) Deploy rules denying direct session/GPS abuse 3) Ship client using Callables 4) Disable legacy direct claim updates in rules 5) Enable stale-helper scheduler |
| **Rollback** | Re-enable temporary direct claim rules; revert client; keep sessions as source of truth if possible |
| **User-visible impact** | Help claim may feel slightly slower (Callable); GPS marker only for involved parties |
| **Risks** | Double-claim edge during mixed old/new clients; owner cannot see helper on map if ACL bug |

**Exit criteria:** No double claims under concurrency test; GPS not in public listener payload.

---

## Phase 4 — Cleanup, App Check, monitoring

**Goal:** Production hygiene and abuse resistance.

| Item | Detail |
|------|--------|
| **Files likely affected** | App Check init in `src/firebase.ts` / `main.tsx`; scheduled Functions; `firebase.json`; monitoring dashboards (ops); freeze migration code paths |
| **Data migration** | TTL expire/archive; scrub private data on expiry; delete `migrationClaims`; freeze legacy ACL |
| **Deployment order** | 1) App Check in monitor mode 2) Enforce App Check 3) TTL schedulers 4) Freeze legacy 5) Alerts on write spikes / claim failures |
| **Rollback** | App Check back to monitor; pause schedulers; extend legacy freeze date if needed |
| **User-visible impact** | Bots/scripts fail; some old browsers may struggle with App Check; expired reports disappear server-side |
| **Risks** | False-positive App Check blocks real users; over-aggressive TTL deletes stolen reports early |

**Exit criteria:** App Check enforced; legacy ownership retired; expired data cleaned; admin can read feedback only.

---

## Phase dependency graph

```
Phase 0 (inspect + backup)
    → Phase 1 (Auth + rules-as-code)
        → Phase 2 (public/private split)
            → Phase 3 (claim + GPS)
                → Phase 4 (App Check + TTL + freeze)
```

Do not skip Phase 0 if any production data exists.

---

## Cross-phase file impact cheat sheet

| Path | Phases |
|------|--------|
| `src/firebase.ts` | 1, 4 |
| `src/App.tsx` (until split) | 1–3 |
| `src/auth/*` (new) | 1 |
| `src/services/*` (new) | 2–3 |
| `functions/*` (new) | 2–4 |
| `firestore.rules` (new) | 1–4 |
| `storage.rules` (new) | 1–2 |
| `firebase.json` | 1, 4 |
| `firestore.indexes.json` (new) | 2–3 (as queries appear) |

---

## Success definition (minimum production bar)

1. Unauthenticated attackers cannot write or delete reports.  
2. Public listeners cannot read phones or live helper GPS.  
3. Only one helper can claim an open request.  
4. Owners/helpers can still call/WhatsApp after claim.  
5. Rules and indexes live in git and deploy with the project.  
6. Legacy reports remain visible; ownership migrates without mass data loss.  
7. Expired data is removed or archived by the server.

---

## Document closure

**TRN-003-SECURE-DATA-DESIGN** is complete.

| Section | Content |
|---------|---------|
| 1 | Auth model (Anonymous + optional Phone) |
| 2–3 | Target collections and per-collection policies |
| 4 | PII removal from public reports |
| 5 | Helper claim design |
| 6 | Live location design |
| 7 | Server responsibilities |
| 8 | Rules blueprint (pseudocode only) |
| 9 | Legacy `deviceId` migration |
| 10 | Phased implementation plan |

**No source code, Firebase config, rules files, data, Storage, packages, or Console settings were modified.**

**Stop.**
