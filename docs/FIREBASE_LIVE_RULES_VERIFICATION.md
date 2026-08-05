# TRN Task 001 — Live Firebase Security Rules Verification

**Date:** 2026-07-31  
**Project:** `totimoto-rider-network`  
**Status:** Inspection only — no rules changed, no deploy, no code changes, no commit  

---

## Labels used

| Label | Meaning |
|-------|---------|
| **Confirmed** | Observed via CLI/API or repository files in this session |
| **Inferred** | Logical conclusion from Confirmed evidence |
| **Unknown** | Not determinable from available read-only access |

---

## 1. Firebase project confirmed

| Item | Value | Label |
|------|-------|-------|
| `.firebaserc` default | `totimoto-rider-network` | Confirmed |
| CLI `firebase use` | `totimoto-rider-network` | Confirmed |
| Project number | `1080405576408` | Confirmed |
| Web app | `totimoto-rider-map` (`1:1080405576408:web:94ea65fda3c4a662bba5ad`) | Confirmed |
| Firestore DB | `(default)`, native, `europe-west3` | Confirmed |
| Storage bucket (from app config) | `totimoto-rider-network.firebasestorage.app` | Confirmed |
| Local `firestore.rules` | **Absent** | Confirmed |
| Local `storage.rules` | **Absent** | Confirmed |
| `firebase.json` rules refs | **None** (Hosting only) | Confirmed |

---

## 2. CLI account confirmed

| Item | Value | Label |
|------|-------|-------|
| Command | `firebase login:list` | |
| Logged in as | `aniselkhoury2@gmail.com` | Confirmed |
| Firebase CLI version | `15.22.0` (via `npx firebase --version`) | Confirmed |

Secrets/tokens were used only in-memory for API calls and are **not** printed in this report.

---

## 3. Commands used (read-only)

```text
firebase login:list
firebase use
firebase projects:list
firebase firestore:databases:get "(default)" --project totimoto-rider-network
firebase apps:list WEB --project totimoto-rider-network
firebase firestore:indexes --project totimoto-rider-network
```

Deployed rules were fetched via Firebase Rules API through `firebase-tools` library helpers (equivalent to listing releases + reading ruleset source):

```text
listAllReleases("totimoto-rider-network")
getRulesetContent(<rulesetName>)
```

App Check probed via:

```text
GET https://firebaseappcheck.googleapis.com/v1/projects/totimoto-rider-network/services/{service}
GET .../apps/{appId}/recaptchaV3Config (site keys redacted / absent)
```

**Not run:** any `firebase deploy`, rules update, delete, or write command.

---

## 4. Deployed Firestore rules

**Release:** `projects/totimoto-rider-network/releases/cloud.firestore`  
**Ruleset:** `projects/totimoto-rider-network/rulesets/af414f13-0dfc-4c98-8319-f5a1de5c984e`  
**createTime:** `2026-05-28T23:06:36.436508Z`  
**updateTime:** `2026-06-28T16:50:39.733620Z`  

**Confirmed** deployed source:

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    // This rule allows anyone with your Firestore database reference to view, edit,
    // and delete all data in your Firestore database. It is useful for getting
    // started, but it is configured to expire after 30 days because it
    // leaves your app open to attackers. At that time, all client
    // requests to your Firestore database will be denied.
    //
    // Make sure to write security rules for your app before that time, or else
    // all client requests to your Firestore database will be denied until you Update
    // your rules
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

**Note:** Comments mention a 30-day starter expiry, but the **active condition is `if true` with no `request.time` bound**. Rules were last updated **2026-06-28** and remain fully open as of this verification (**Confirmed**).

### Firestore capability checks

| Capability | Allowed? | Label |
|------------|----------|-------|
| Unauthenticated **read all** `reports` | **Yes** | Confirmed (`allow read: if true` on all docs) |
| Unauthenticated **create** `reports` | **Yes** | Confirmed |
| Unauthenticated **update any** report | **Yes** | Confirmed |
| Unauthenticated **delete any** report | **Yes** | Confirmed |
| Unauthenticated **read** `feedback` | **Yes** | Confirmed |
| Unauthenticated **create** `feedback` | **Yes** | Confirmed |
| Unauthenticated **update/delete** `feedback` | **Yes** | Confirmed |

### Firestore enforcement features

| Feature | Present? | Label |
|---------|----------|-------|
| Authentication required | **No** | Confirmed |
| Report ownership checks | **No** | Confirmed |
| Helper identity checks | **No** | Confirmed |
| Field allowlists | **No** | Confirmed |
| Status transition checks | **No** | Confirmed |
| Data validation | **No** | Confirmed |
| Rate limiting in rules | **No** | Confirmed |

### Firestore access matrix

| Actor | `reports` read | `reports` create | `reports` update | `reports` delete | `feedback` read | `feedback` write |
|-------|----------------|------------------|------------------|------------------|-----------------|------------------|
| Unauthenticated client with project config | Allow | Allow | Allow | Allow | Allow | Allow |
| Authenticated user | Allow (same open rules) | Allow | Allow | Allow | Allow | Allow |
| App UI ownership checks | Cosmetic only; bypassed by SDK | — | — | — | — | — |

---

## 5. Deployed Storage rules

**Release:** `projects/totimoto-rider-network/releases/firebase.storage/totimoto-rider-network.firebasestorage.app`  
**Ruleset:** `projects/totimoto-rider-network/rulesets/c60ba775-0636-4a23-9d78-b34c0e3e0154`  
**createTime:** `2026-06-18T15:24:00.202571Z`  
**updateTime:** `2026-06-28T16:23:29.914746Z`  

**Confirmed** deployed source:

```
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {

    // ... starter comment about 30-day expiry ...
    match /{allPaths=**} {
      allow read, write: if true;
    }
  }
}
```

Again: comments mention expiry; **active rule is open `if true`** (**Confirmed**).

### Storage capability checks

| Capability | Allowed? | Label |
|------------|----------|-------|
| Unauthenticated read report images | **Yes** | Confirmed |
| Unauthenticated upload | **Yes** | Confirmed |
| Overwrite existing objects | **Yes** (write includes overwrite) | Confirmed / Inferred from `allow write: if true` |
| Delete images | **Yes** | Confirmed |
| Unrestricted file types | **Yes** (no `contentType` check) | Confirmed |
| Unrestricted file sizes | **Yes** (no `size` check) | Confirmed |
| Access other users’ paths (`report-images/`, `stolen-bikes/`) | **Yes** (`/{allPaths=**}`) | Confirmed |

### Storage access matrix

| Actor | Read `report-images/**` | Write `report-images/**` | Read `stolen-bikes/**` | Write `stolen-bikes/**` | Delete any object |
|-------|-------------------------|--------------------------|------------------------|-------------------------|-------------------|
| Unauthenticated | Allow | Allow | Allow | Allow | Allow |
| Path/owner restricted | **No restriction** | **No restriction** | **No restriction** | **No restriction** | **No restriction** |

---

## 6. App Check status

| Question | Finding | Label |
|----------|---------|-------|
| App Check initialized in application code | **No** (`initializeAppCheck` absent under `src/`) | Confirmed |
| App Check provider fully configured (e.g. reCAPTCHA site key) | reCAPTCHA v3/Enterprise config resources exist but **no `siteKey` present** in API response | Confirmed (provider not meaningfully configured) |
| Enforcement mode on `firestore.googleapis.com` | Field **`enforcementMode` absent**; `updateTime` epoch `1970-01-01` | Confirmed |
| Enforcement mode on `firebasestorage.googleapis.com` | Same as Firestore | Confirmed |
| App Check **enforcement enabled** for Firestore | **No evidence of ENFORCED**; treat as off | Inferred (API default / unset) |
| App Check **enforcement enabled** for Storage | **No evidence of ENFORCED**; treat as off | Inferred |
| Console UI “App Check” page nuances | Exact Console badge text not screenshotted | Unknown (API is sufficient for enforcement absence) |

**Distinction summary**

| Layer | Status |
|-------|--------|
| Configured in Console (providers) | Partial empty config resources only — **not a working web provider** (Confirmed: no siteKey) |
| Enforcement enabled | **Not enabled** for Firestore/Storage (Inferred from missing `enforcementMode`) |
| Initialized in app code | **No** (Confirmed) |

---

## 7. Confirmed security risks

1. **Firestore is world-readable and world-writable** (`allow read, write: if true`). Anyone with the public web config can read/modify/delete all `reports` and `feedback`.  
2. **Storage is world-readable and world-writable** for all paths, including `report-images/` and `stolen-bikes/`.  
3. **No ownership, auth, field allowlists, or claim transitions** in live rules.  
4. Combined with the app’s full-collection `onSnapshot` and PII-on-report design, **phones, plates, and live helper GPS are publicly scrapable and forgeable**.  
5. **App Check does not protect** these services in practice (not enforced; not in app).  
6. Starter-mode comments are misleading: rules remain open **after** the nominal 30-day window referenced in comments (last update 2026-06-28, still `if true`).

**Severity:** Critical — production data is effectively an open database and open bucket.

---

## 8. Unknown / manual Console items

| Item | Why unknown |
|------|-------------|
| Exact Console UI copy for App Check “Enforcement” toggles | API shows unset; Console screenshots not taken |
| Historical who/when unlocked rules on 2026-06-28 | Ruleset metadata has times only |
| Whether Google API key HTTP referrer restrictions exist | GCP Credentials Console not queried |
| Whether abuse/scraping has already occurred | Needs logs / metrics review |
| Billing anomaly alerts | Console/billing |

---

## 9. One recommended next task only

**Objective:** Immediately replace the live open Firestore and Storage rules with a **temporary lockdown** that preserves map read for `reports` if product-required, but **denies all unauthenticated writes** (and preferably denies public read of `feedback`), then verify with a non-destructive read/write probe — still without refactoring the app.

**Scope:** Rules + verification only (and version-control the new rule files). No feature work, no Auth migration yet.

**Rationale:** Live `if true` rules are an active production incident; Auth/PII split can follow, but open write access must stop first.

---

## Stop

Verification complete. No application code modified. No rules deployed or changed. No commits. No pushes.
