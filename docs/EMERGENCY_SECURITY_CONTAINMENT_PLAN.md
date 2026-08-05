# TRN Task 002 — Emergency Security Containment Plan and Backup Readiness

**Date:** 2026-07-31  
**Project:** `totimoto-rider-network`  
**Phase:** Security incident containment **planning** only  

**Critical constraints honored**

- Do **not** change or deploy Firebase rules in this task  
- Do **not** deny unauthenticated access yet  
- Do **not** modify application code  
- Do **not** commit or push  

**Evidence sources:** Task 001 live rules verification, codebase inventory, CLI billing/backup probes  

---

## Labels

| Label | Meaning |
|-------|---------|
| **Confirmed** | Observed in code, CLI, or live rules |
| **Inferred** | Logical conclusion from Confirmed facts |
| **Unknown** | Requires Console / ops action not completed here |

---

## 1. Executive recommendation

**Confirmed:** Live Firestore and Storage rules are `allow read, write: if true`. The app has **no Firebase Auth** and all production writes are unauthenticated.

**Recommendation (order of safety):**

1. **Backup first** (Firestore managed backup + Storage copy) — do this before any rule or Auth deploy.  
2. **Ship invisible Anonymous Auth + dual identity fields** (`ownerUid` / `helperUid`) **while rules stay open** — so production keeps working.  
3. **Emulator-validate** the new rules against Auth.  
4. **Deploy rules only after** Auth is live in production and smoke-tested.  
5. Treat PII-on-public-docs as a **follow-on** migration — Auth+rules stop *anonymous internet* abuse; they do **not** hide phones/GPS from signed-in clients still listening to full `reports`.

**Do not** deploy restrictive rules before Anonymous Auth is in production. That would hard-break create/claim/upload (**Confirmed** dependency).

---

## 2. Confirmed production dependencies on unauthenticated access

| Operation | Code evidence | Needs Auth today? | Breaks if rules require auth before client ships? |
|-----------|---------------|-------------------|---------------------------------------------------|
| `onSnapshot(reports)` | `App.tsx` ~339–353 | No | Read may survive if rules allow public/auth read; write paths break |
| `createUserReport` → `addDoc` | ~1081–1136 | No | **Yes** |
| `submitStolenBikeReport` → `addDoc` + Storage | ~539–612 | No | **Yes** |
| `helperRespond` → `updateDoc` | ~631–648 | No | **Yes** |
| `cancelHelp` / `resolveReport` / GPS `updateDoc` | ~682–725, ~945–951 | No | **Yes** |
| `cancelReport` → `deleteDoc` + Storage delete | ~667–675 | No | **Yes** |
| `submitFeedback` → `addDoc` | ~520–527 | No | **Yes** |
| Storage `uploadBytes` paths `report-images/`, `stolen-bikes/` | ~556–561, ~1089–1094 | No | **Yes** |
| Identity | `localStorage.deviceId` as `ownerId`/`helperId` | Not Firebase Auth | UI ownership continues; rules cannot trust `deviceId` |

**Confirmed:** Deploying `request.auth != null` rules before the app signs in anonymously = production outage for all writes.

---

## 3. Backup and restore plan

### 3.1 Current backup posture

| Check | Result | Label |
|-------|--------|-------|
| Billing enabled | `billingEnabled: true` | Confirmed |
| Firestore backup schedules | **None** | Confirmed |
| Existing Firestore backups (`europe-west3`) | **None found** | Confirmed |
| PITR | Disabled (earlier DB get) | Confirmed |
| `gcloud` CLI on this machine | Not installed | Confirmed |
| Storage versioning / separate backup | Not verified in Console | Unknown |

### 3.2 Firestore — safest available methods

#### Method A — Firebase managed backups (preferred when available)

Requires Blaze/billing (**Confirmed** billing on). Creates restore points via Firebase’s backup service.

**Create a daily schedule (non-destructive; creates schedule only):**

```bash
firebase firestore:backups:schedules:create \
  --project totimoto-rider-network \
  -d "(default)" \
  --recurrence DAILY \
  --retention 14d
```

**List backups after first run:**

```bash
firebase firestore:backups:list -l europe-west3 --project totimoto-rider-network
firebase firestore:backups:schedules:list --project totimoto-rider-network
```

**Restore procedure (destructive to target DB id — use a NEW database id for safety):**

```bash
firebase firestore:databases:restore \
  --project totimoto-rider-network \
  -b projects/totimoto-rider-network/locations/europe-west3/backups/BACKUP_ID \
  -d reports-restore-YYYYMMDD
```

**Important (Inferred from CLI restore model):** Managed restore typically restores into a **database id you specify**, not an instant in-place overwrite of `(default)`. Production rollback may mean: restore to side DB → validate → cut over app `getFirestore(app, 'reports-restore-…')` **or** carefully replace `(default)` only with explicit ops approval.

**Timing risk (Confirmed/Inferred):** Schedule create does not invent a past backup. First usable backup appears **after** the first scheduled run (or after Google completes the first backup). For **immediate** pre-change snapshot, prefer Method B the same day as lockdown.

#### Method B — One-time GCS export (classic; needs GCS + `gcloud` or Console export)

1. Create a GCS bucket in a compatible location (often same multi-region / `europe-west3` constraints apply — verify in docs/Console).  
2. Run (when `gcloud` available):

```bash
gcloud firestore export gs://BUCKET_NAME/trn-firestore-YYYYMMDD \
  --project=totimoto-rider-network \
  --database="(default)"
```

3. Verify completeness: export operation status `SUCCESS`; object prefixes for `all_namespaces/all_kinds` (or collection groups) present; document counts vs live approximate.

**Collections to care about:** `reports`, `feedback` (full DB export covers both) — **Confirmed** those are the only app collections.

#### Method C — Admin SDK / scripted JSON dump (last resort)

Possible but weak for large binary-adjacent data and not point-in-time consistent like managed export. Use only if A/B blocked.

### 3.3 Storage backup (`report-images/`, `stolen-bikes/`)

Firestore backups **do not** include Cloud Storage objects (**Confirmed** product separation).

**Separate method required:**

```bash
# Example once gsutil/gcloud is available — copy, do not delete source
gsutil -m cp -r gs://totimoto-rider-network.firebasestorage.app/report-images \
  gs://BACKUP_BUCKET/trn-storage-YYYYMMDD/report-images

gsutil -m cp -r gs://totimoto-rider-network.firebasestorage.app/stolen-bikes \
  gs://BACKUP_BUCKET/trn-storage-YYYYMMDD/stolen-bikes
```

Or Console → Cloud Storage → Transfer / sync to backup bucket.

**Verify completeness:** object count and total bytes on source vs destination prefixes; spot-check random download URLs still resolve on **source** (backup is copy).

**Restore:** `gsutil -m cp -r` back into the production bucket paths (overwrite risk — restore to staging prefix first).

### 3.4 Backup destination recommendation

| Data | Destination |
|------|-------------|
| Firestore managed backups | Google-managed backup storage (listed via CLI) |
| Firestore GCS export | Dedicated bucket e.g. `trn-backups-XXXX` (not public) |
| Storage images | Same backup bucket under dated prefixes |

Do not use the public app hosting `dist/` or git for backups.

### 3.5 Pre-containment backup checklist (ops)

1. Confirm billing remains enabled.  
2. Create GCS backup bucket **or** create Firestore backup schedule **and** wait for first backup / run GCS export.  
3. Copy Storage prefixes.  
4. Record backup IDs, timestamps, object counts in an ops note.  
5. Dry-run restore to a **non-default** Firestore database id (optional but strongly recommended).

**This task did not create schedules or buckets** (planning only).

---

## 4. Anonymous Auth compatibility design

### 4.1 Goal

Invisible Firebase Anonymous Authentication:

- No login UI, password, OTP, email, or social  
- Map still opens automatically  
- Silent `signInAnonymously()` on startup  
- Keep `deviceId` for UI / legacy  
- New writes add Firebase `uid`  
- Avoid forcing contact re-entry (`contactName` / `contactPhone` stay in `localStorage`)

### 4.2 Affected files (implementation later)

| File | Change |
|------|--------|
| `src/firebase.ts` | `getAuth`, export `auth` |
| **New** `src/auth.ts` (preferred) or early `App.tsx` | `onAuthStateChanged` + `signInAnonymously` |
| `src/main.tsx` | Optionally wait for auth ready before render |
| `src/App.tsx` | Dual-write `ownerUid` / `helperUid`; gate writes until `auth.currentUser` |
| `package.json` | Already has `firebase` — Auth is same SDK (**Confirmed**) |
| Firebase Console | Enable **Anonymous** sign-in provider (**Unknown** if already enabled) |

### 4.3 Initialization flow (proposed)

```
App boot
  → initializeApp / auth
  → onAuthStateChanged
       if user == null → signInAnonymously()
       if user != null → setAuthReady(true), keep uid in React state
  → existing deviceId init (unchanged)
  → existing onSnapshot(reports) (can start after authReady for consistency)
  → contactName/Phone from localStorage (unchanged)
```

### 4.4 Loading / error behavior

| State | UX |
|-------|-----|
| Auth initializing | Brief block on **write** buttons (“جاري التحضير…”) or disable publish/claim |
| Auth success | Invisible; map already usable |
| Auth failure (network / provider disabled) | Show non-blocking banner; **do not** open write paths; allow read if rules still permit |
| Rules still open (stage before rule deploy) | Writes work with or without auth — still **must** sign in so tokens exist before rule cutover |

### 4.5 Offline / cleared data

| Event | Behavior |
|-------|----------|
| Normal refresh | Anonymous session persists (IndexedDB / persistence) — **Inferred** Firebase default |
| “Clear site data” | New anonymous `uid` + new `deviceId` — **Confirmed** for deviceId; **Inferred** for Auth |
| Multi-device | Different uids — expected for anonymous |

### 4.6 Dual identity fields

| Field | Role |
|-------|------|
| `ownerId` / `helperId` | Keep = `deviceId` for current UI comparisons |
| `ownerUid` / `helperUid` | New = `auth.currentUser.uid` for rules |
| `deviceId` on feedback | Keep + add `uid` |

**Legacy reports** without `ownerUid`: remain readable; owner self-service in **rules** cannot be proven via `deviceId` alone (see §7).

### 4.7 Contact info

No change required: `localStorage` contact continues; only attach phones on create/claim as today.

---

## 5. Proposed Firestore rule model (design only — do not deploy yet)

### 5.1 Principles for emergency phase

1. `request.auth != null` for all writes.  
2. Prefer **field allowlists** over open `write`.  
3. New docs must set `ownerUid == request.auth.uid`.  
4. Legacy docs (`ownerUid` missing): limited compatibility policy (§7) — cannot be fully owner-secure.  
5. `feedback`: create-only for auth users; no client read/update/delete.

### 5.2 `reports` — intended capabilities

| Action | Who | Rule idea |
|--------|-----|-----------|
| Read | Authenticated (or public if product requires open map) | Prefer `allow read: if request.auth != null` for emergency; optional public read if business insists |
| Create | Authenticated | `ownerUid == auth.uid`; required typed fields; forbid setting others’ uids; optional Lebanon bbox |
| Delete | Owner | `resource.data.ownerUid == auth.uid` |
| Resolve | Owner | allowlisted keys only: `resolved`, `solvedAt`, `updatedAt` |
| Helper claim | Non-owner auth user | only if `helperComing != true` / no `helperUid`; set `helperUid == auth.uid` + allowlisted helper fields |
| Helper GPS | Accepted helper | `helperUid == auth.uid` && `helperComing == true`; only `helperLat/Lng/helperLocationUpdatedAt` |
| Cancel help | Accepted helper (or owner) | clear allowlisted helper fields |
| Immutable | — | `ownerUid`, `ownerId`, `createdAt` cannot change after create |

### 5.3 Pseudocode (not a deployable file in this task)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() { return request.auth != null; }
    function isOwner() { return signedIn() && resource.data.ownerUid == request.auth.uid; }
    function isHelper() { return signedIn() && resource.data.helperUid == request.auth.uid; }
    function isLegacy() { return !('ownerUid' in resource.data); }

    match /reports/{id} {
      allow read: if signedIn(); // or `if true` if open map mandated

      allow create: if signedIn()
        && request.resource.data.ownerUid == request.auth.uid
        && request.resource.data.keys().hasAll(['ownerUid','ownerId','type','lat','lng','createdAt','expiry'])
        && !(request.resource.data.keys().hasAny([/* forbidden */]));

      allow delete: if isOwner();
      // legacy delete: see §7 — either deny or temporary authenticated soft policy

      allow update: if signedIn() && (
        /* owner resolve */ (isOwner() && onlyAffects(['resolved','solvedAt',...])) ||
        /* helper claim */ (claimTransitionValid()) ||
        /* helper GPS */ (isHelper() && onlyAffects(['helperLat','helperLng','helperLocationUpdatedAt'])) ||
        /* cancel help */ (isHelper() && clearingHelperFields()) ||
        /* legacy branch */ legacyUpdatePolicy()
      );
    }

    match /feedback/{id} {
      allow create: if signedIn()
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.keys().hasOnly([/* allowlist */]);
      allow read, update, delete: if false; // admin SDK only
    }
  }
}
```

### 5.4 What rules **can** secure now

- Block unauthenticated SDK abuse (**primary incident response**)  
- Bind **new** ownership to Auth uid  
- Constrain claim/GPS/resolve field sets for uid-backed docs  

### 5.5 What rules **cannot** fully secure while legacy exists

- Prove that a caller “owns” a pre-Auth `ownerId` (deviceId) document  
- Hide phone/GPS from other **authenticated** readers of `reports`  
- True rate limiting  

---

## 6. Proposed Storage rule model (design only)

### 6.1 Path strategy

**New uploads** (after Auth):

```text
report-images/{uid}/{reportId}/{fileId}.jpg
stolen-bikes/{uid}/{reportId}/{fileId}.jpg
```

**Legacy paths** (today):

```text
report-images/{timestamp}-{filename}
stolen-bikes/{timestamp}-{filename}
```

Existing download URLs embedded in Firestore continue to work if **read** remains allowed for those objects.

### 6.2 Rule intents

| Rule | Policy |
|------|--------|
| Upload | `request.auth != null` && path uid == `auth.uid` |
| Size | e.g. `request.resource.size < 2 * 1024 * 1024` |
| MIME | `request.resource.contentType.matches('image/jpeg|image/png|image/webp')` |
| Overwrite | Deny overwrite unless metadata generation match / use unique `fileId` |
| Delete | Owner uid segment match OR admin |
| Read | `if true` temporarily (URLs already public) **or** auth-only if product accepts broken hotlinks for old clients |

### 6.3 Migration impact of URLs

| Item | Effect |
|------|--------|
| Current `getDownloadURL` strings in docs | Keep working if read stays open |
| `deleteReportImage` using URL as `ref(storage, url)` | Already fragile (**Confirmed**); fix in later impl to store path |
| Tightening read to auth-only | May break `<img src=longLivedUrl>` for logged-out scrapers **and** possibly some caches — test carefully |

Emergency recommendation: **auth write + size/type checks**; keep **public read** initially to avoid breaking image display.

---

## 7. Legacy-data compatibility strategy

### 7.1 Document classes

| Class | Shape | After Auth+rules |
|-------|-------|------------------|
| **New** | has `ownerUid` / optional `helperUid` | Full rule enforcement |
| **Legacy** | `ownerId` = deviceId only | Readable; writes limited |

### 7.2 Compatibility policy (recommended)

1. **Reads:** Allow authenticated read of all reports (map works after silent sign-in).  
2. **Creates:** Always write `ownerUid` + `ownerId`.  
3. **Claims on legacy:** Allow authenticated claim if unclaimed; set `helperUid` (and keep `helperId` deviceId).  
4. **Owner resolve/delete on legacy:**  
   - **Preferred emergency:** Deny in rules until linked; provide later Callable `linkLegacyReports(deviceId)` with uniqueness constraints — **or**  
   - **Temporary soften:** Allow resolve/delete for **any** signed-in user on `isLegacy()` docs with audit logging (still far better than open internet, but abuse possible by signed-in attackers).  
5. **Do not** trust client-supplied `ownerId` in rules as identity.

**Honest limit (Confirmed logically):** Without a server-side link from `deviceId` → `uid`, legacy owners may lose **privileged** actions after strict rules. Map + help claims can still work.

### 7.3 Sensitive-data limitation (Part 5)

| Control | Protects | Does not protect |
|---------|----------|------------------|
| Anonymous Auth + deny unauth writes | Random internet create/delete/hijack without signing in | Anyone who obtains/uses the web app (and thus gets anonymous auth) |
| Field allowlists | Privilege escalation on updates | Reading phones already on documents |
| Auth-required read | Blocks totally auth-less scrapers | **Authenticated** full `onSnapshot` still receives phones + helper GPS |

**Later migration (not in first emergency impl unless mandatory):** split `reportPrivate` + `liveHelperLocations` per `docs/SECURE_DATA_DESIGN.md`.  
**Emergency phase does not require that split** to stop open `if true` writes.

---

## 8. Emulator test matrix

Use Auth + Firestore + Storage emulators; seed legacy and new docs.

| ID | Case | Type | Expected |
|----|------|------|----------|
| F1 | Auth user creates report with `ownerUid==uid` | Positive | Allow |
| F2 | Unauthenticated create | Negative | Deny |
| F3 | Owner resolve allowlisted fields | Positive | Allow |
| F4 | Non-owner resolve | Negative | Deny |
| F5 | Helper claim on open report | Positive | Allow |
| F6 | Second helper claim when already claimed | Negative | Deny |
| F7 | Helper GPS by accepted helper | Positive | Allow |
| F8 | GPS by unrelated user | Negative | Deny |
| F9 | Owner delete (new doc) | Positive | Allow |
| F10 | Non-owner delete | Negative | Deny |
| F11 | Feedback create with `uid` | Positive | Allow |
| F12 | Feedback list/get from client | Negative | Deny |
| F13 | Feedback update/delete client | Negative | Deny |
| F14 | Legacy claim sets `helperUid` | Positive / policy | Per §7 |
| F15 | Legacy owner delete under chosen policy | Regression | Matches documented policy |
| S1 | Auth upload JPEG &lt; 2MB under `report-images/{uid}/…` | Positive | Allow |
| S2 | `text/plain` upload | Negative | Deny |
| S3 | &gt; 2MB upload | Negative | Deny |
| S4 | Delete other uid’s object | Negative | Deny |
| S5 | Unauthenticated upload | Negative | Deny |
| R1 | App smoke: anonymous sign-in then create | Regression | Success against emulator |
| R2 | Contact localStorage unchanged across auth | Regression | Still present |

---

## 9. Staged deployment plan (safest sequence)

**Do not** deploy rules before Auth is live.

| Step | Action | Why |
|------|--------|-----|
| 0 | Ops: billing confirmed; create Firestore backup schedule **and/or** GCS export; copy Storage prefixes | Rollback fuel |
| 1 | Enable **Anonymous** provider in Console (no app change yet) | Prerequisite |
| 2 | Add local `firestore.rules`, `storage.rules`, wire `firebase.json` — **not deployed** | Version control |
| 3 | Implement invisible Anonymous Auth + dual-write uid fields | Client ready for locked rules |
| 4 | Emulator matrix (§8) | Prove rules |
| 5 | `npm run build` production build | Catch import/bundle issues |
| 6 | **Deploy Hosting/app only** (Auth code); **rules remain open** | Zero downtime; tokens start existing |
| 7 | Live smoke: cold load → anonymous user appears in Auth console; create report contains `ownerUid`; claim/GPS/feedback/upload work | Gate |
| 8 | Monitor 24h if possible (optional) | Confidence |
| 9 | **Deploy Firestore rules** | Stops open DB writes |
| 10 | Immediate smoke: unauth REST/SDK write fails; authed app create/claim works | |
| 11 | **Deploy Storage rules** | Stops open bucket writes |
| 12 | Smoke images upload/display/delete | |
| 13 | Monitor client errors / support | |

**Rejected order:** Rules before app Auth → **Confirmed** outage.

**Optional tighter read:** If product allows, require auth for Firestore read at step 9 (anonymous still silent). If open map without waiting for auth is mandatory, keep `allow read: if true` temporarily (**Inferred** tradeoff).

---

## 10. Rollback plan

| Failure | Rollback |
|---------|----------|
| Auth breaks writes while rules still open | Revert Hosting to previous `dist`; Auth can stay enabled |
| Rules too strict / legacy owners stuck | `firebase deploy --only firestore:rules` with **previous open ruleset content** kept in git history as `firestore.rules.emergency-open.bak` **or** redeploy known-open rules from Task 001 snapshot |
| Storage images fail | Redeploy previous Storage rules (`if true` snapshot) |
| Data loss / corruption | Restore Firestore from backup to side DB; copy Storage from backup bucket |
| Need full “undo Auth requirement” | Open rules first (restore write access), then decide Auth client revert |

**Keep Task 001 rule text** as the known-open rollback artifact (already documented).

---

## 11. Files expected during later implementation

| Path | Role |
|------|------|
| `src/firebase.ts` | Export `auth` |
| `src/auth.ts` (new) | Silent anonymous session |
| `src/main.tsx` / `src/App.tsx` | Auth gate + `ownerUid`/`helperUid` dual-write |
| `firestore.rules` (new) | Rules-as-code |
| `storage.rules` (new) | Rules-as-code |
| `firebase.json` | Add `firestore.rules` / `storage.rules` (+ emulator config) |
| `.firebaserc` | Unchanged project id |
| `firebase.json` emulators block / `firebase emulators:start` | Test |
| Docs only this task | This plan file |

**Not in emergency auth+rules:** full `reportPrivate` split (later).

---

## 12. One recommended implementation task only

**TRN Task 003 — Implement invisible Firebase Anonymous Authentication and dual-write `ownerUid` / `helperUid` (rules remain open / undeployed).**

**Scope:** App Auth init + create/claim/feedback/GPS writes attach uid fields; keep `deviceId` UI; no restrictive rules deploy; no Storage path migration required yet; include emulator-ready hooks if trivial; production build + manual smoke; **stop before commit** per project workflow.

**Why this next:** It is the only change that makes a later rules lockdown non-breaking.

---

## Stop

Plan complete. No code modified. No rules deployed. No application deployed. No commit. No push.
