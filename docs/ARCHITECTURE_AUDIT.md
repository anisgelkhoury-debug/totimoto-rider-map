# Totimoto Rider Map — Architecture Audit

**Date:** 2026-07-29  
**Scope:** Read-only analysis of the current codebase  
**Status:** Documentation only — no code, installs, or commits were made

---

## 1. Executive Summary

Totimoto is a **Lebanon-focused motorcycle rider community PWA**: a single-page React app with a live map of road intelligence, roadside assistance requests, shared rides, and stolen-bike alerts.

| Aspect | Current state |
|--------|----------------|
| Architecture style | Frontend-only SPA + Firebase BaaS |
| Primary UI | One monolithic `App.tsx` (~4,250 lines) |
| Backend | None (no custom server / Cloud Functions in repo) |
| Auth | None (device ID in `localStorage`) |
| Database | Cloud Firestore (`reports`, `feedback`) |
| Media | Firebase Storage |
| Maps | Leaflet + OpenStreetMap (Google Maps present but unused) |
| Deploy | Firebase Hosting (`dist`) + PWA |

The product is a **working beta** with real GPS helper tracking, contact/WhatsApp flows, filters, and legal/settings screens — but it is still structurally a prototype: almost all logic and UI live in one file, security rules are not in-repo, and identity is anonymous/device-based.

---

## 2. Overall Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser / PWA                            │
│  React 19 + Vite 8                                           │
│  ┌──────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Leaflet Map  │  │ Local state │  │ localStorage        │ │
│  │ (OSM tiles)  │  │ (useState)  │  │ deviceId, contact   │ │
│  └──────────────┘  └──────┬──────┘  └─────────────────────┘ │
│                           │                                  │
│              Firebase JS SDK (client)                        │
└───────────────────────────┼──────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐  ┌────────────────┐  ┌────────────────┐
│  Firestore    │  │ Storage        │  │ Hosting        │
│  reports      │  │ report-images/ │  │ static SPA     │
│  feedback     │  │ stolen-bikes/  │  │ (dist/)        │
└───────────────┘  └────────────────┘  └────────────────┘

External:
  • Nominatim (OSM reverse geocoding)
  • Google Maps / WhatsApp / tel: (deep links only)
```

**Data flow (happy path):**

1. User opens app → GPS watch starts → map centers on user.
2. `onSnapshot(reports)` streams all reports into React state.
3. User creates a report → optional image upload to Storage → `addDoc` to Firestore.
4. Helpers accept assistance → Firestore update + throttled live GPS writes.
5. Client filters out resolved/expired items for display (expiry is **not** deleted server-side).

There is **no middleware layer**, no API gateway, and no React Router — navigation is modal/overlay state.

---

## 3. Folder Structure

```
totimoto-rider-map/
├── .env                      # VITE_GOOGLE_MAPS_API_KEY (tracked in git)
├── .firebaserc               # default project: totimoto-rider-network
├── .firebase/                # hosting cache
├── dist/                     # production build output
├── docs/
│   └── ARCHITECTURE_AUDIT.md # this document
├── firebase.json             # Hosting only (public: dist, SPA rewrite)
├── index.html
├── package.json
├── public/
│   ├── favicon.svg
│   ├── icon-192.png
│   ├── icon-512.png
│   └── icons.svg
├── src/
│   ├── App.tsx               # ★ entire application (~4.2k lines)
│   ├── App copy.tsx          # early local-only prototype (unused)
│   ├── App.css               # Vite template styles (unused by App)
│   ├── firebase.ts           # Firebase init + db/storage exports
│   ├── index.css             # Vite template global CSS (partially unused)
│   ├── main.tsx              # React entry
│   └── assets/               # leftover Vite hero/react/vite images
├── vite.config.ts            # React + vite-plugin-pwa
└── tsconfig*.json
```

**Notable absences:**

- No `components/`, `hooks/`, `services/`, `types/`, `pages/`
- No `firestore.rules` / `storage.rules` in the repository
- No Cloud Functions / backend folder
- No tests
- No CI config in-repo

---

## 4. Frontend

### 4.1 Stack

| Layer | Choice |
|-------|--------|
| Framework | React 19.2 |
| Language | TypeScript (loose — heavy use of `any`) |
| Bundler | Vite 8 |
| Maps | `react-leaflet` 5 + `leaflet` 1.9 |
| Unused map dep | `@react-google-maps/api` (commented out) |
| Backend SDK | `firebase` 12 (Firestore + Storage only) |
| PWA | `vite-plugin-pwa` (autoUpdate) |
| UI system | Inline styles only; RTL Arabic UI |
| CSS files | Mostly leftover Vite scaffold; app does not use a design system |

### 4.2 Entry & bootstrap

- `index.html` → `/src/main.tsx`
- `main.tsx` mounts `<App />` under `StrictMode`
- PWA manifest: name **Totimoto Rider Network**, dark theme `#020617`, standalone, portrait

### 4.3 UI composition model

Everything is **overlay-driven** on top of a full-viewport map:

| Surface | Trigger |
|---------|---------|
| Map + markers | Always |
| Report type modal | “تبليغ مباشر” |
| Description + image modal | After type selection |
| Stolen bike form modal | Stolen type |
| Contact info modal | Assistance / shared ride actions |
| Selected report bottom sheet | Marker / list click |
| Full reports page | “إظهار البلاغات” |
| Community / settings | ⚙️ |
| Legal / feedback / install guide | From settings |
| Full-screen image viewer | Report image click |
| Mobile tools dashboard | “إظهار الأدوات” (mobile) |

Language/direction: **Arabic RTL** throughout.

---

## 5. Backend

**No custom backend exists in this repository.**

Firebase is used as BaaS:

| Service | Used? | Role |
|---------|-------|------|
| Firestore | Yes | Live reports + feedback |
| Storage | Yes | Report / stolen-bike images |
| Hosting | Yes | Serve `dist` SPA |
| Auth | No | Not initialized |
| Functions | No | Not present |
| Analytics / FCM | No | Not present |

All business logic (expiry, distance, helper assignment, phone formatting) runs **in the browser**.

---

## 6. Firebase Configuration

### 6.1 Project

- **Project ID:** `totimoto-rider-network`
- **Config location:** hardcoded in `src/firebase.ts` (not via env vars)
- **Hosting:** `firebase.json` serves `dist` with SPA rewrite `** → /index.html`
- **`.firebaserc`:** default project binding only

### 6.2 Client exports

```ts
// src/firebase.ts
export const db = getFirestore(app)
export const storage = getStorage(app)
```

No Auth, no Emulator wiring, no Analytics.

### 6.3 Security posture (repo-level)

| Item | Finding |
|------|---------|
| Firestore rules file | **Missing from repo** |
| Storage rules file | **Missing from repo** |
| `.env` in `.gitignore` | **Not ignored**; `.env` is tracked |
| Google Maps key | In `.env` as `VITE_GOOGLE_MAPS_API_KEY` (currently unused in UI) |
| Firebase web config | Public client config in source (normal for Firebase web, but must be paired with strict rules) |

**Implication for development:** treat security rules and secret hygiene as first-class follow-ups before widening access.

---

## 7. Authentication

**There is no Firebase Authentication.**

Identity model:

| Concept | Implementation |
|---------|----------------|
| User ID | `deviceId` = `localStorage` string (`Date.now() + random`) |
| Contact name / phone | `localStorage` (`contactName`, `contactPhone`) |
| Ownership | `report.ownerId === deviceId` |
| Helper identity | `report.helperId === deviceId` |

**Consequences:**

- Clearing site data creates a new “user”
- No account recovery, roles, or admin console identity
- Phone numbers are shared peer-to-peer for assistance (by design) without verified identity
- Anyone with open Firestore rules can read/write/delete reports as any owner

Contact is **optional for map browsing**, required (via modal gate) for assistance / shared-ride create or accept.

---

## 8. Database Structure

### 8.1 Collection: `reports`

Primary live collection. Documents are created with `addDoc` (Firestore auto-IDs). Some payloads also store a numeric `id: Date.now()` field — **not** the document ID.

#### Common fields

| Field | Type | Notes |
|-------|------|-------|
| `type` | string | Arabic label (e.g. زحمة, عطل بالدراجة) |
| `reportFamily` | string | `intelligence` \| `assistance` \| `sharedRide` \| `stolen` |
| `reportCategory` | string | e.g. `traffic`, `fuel`, `stolen` |
| `emoji`, `color`, `priority` | string | UI metadata (`high`/`medium`/`low`) |
| `lat`, `lng` | number | Report location |
| `area`, `street`, `city`, `district`, `locationName` | string | From Nominatim reverse geocode |
| `distance` | string | Display string (“الآن”, “مباشر”, …) |
| `createdAt` | number | epoch ms |
| `expiry` | number | **minutes** until soft-expiry |
| `ownerId` | string | deviceId |
| `ownerName`, `ownerPhone` / `phone` | string | Contact for help |
| `description` | string | Optional note |
| `reportImageUrl` | string | Storage download URL |
| `resolved`, `solvedAt` | bool / number | Completion |
| `helperComing`, `helperArrived`, `joined` | bool | Helper workflow |
| `helperId`, `helperName`, `helperPhone` | string | Assigned helper |
| `helperStatus` | string | e.g. “مساعد بالطريق” |
| `helpers`, `helpersList` | number / array | Currently single-helper oriented |
| `helperLat`, `helperLng` | number | Live helper GPS |
| `helperLocationUpdatedAt`, `helperAcceptedAt` | number | Timestamps |

#### Stolen-bike extra fields

| Field | Notes |
|-------|-------|
| `stolenBikeType`, `stolenBikeColor`, `stolenBikePlate` | Bike details |
| `stolenBikePhone`, `stolenBikePlace` | Contact / place text |
| `stolenBikeDate`, `stolenBikeTime` | Form inputs |
| `stolenBikeImageUrls` | string[] (up to 5) |

#### Report families & default expiries (from `reportTypes`)

| Family | Types | Typical expiry (minutes) |
|--------|-------|--------------------------|
| `intelligence` | زحمة, حادث, طريق مسكر, طريق زلق | 15–45 (overrides exist in older `addReport`) |
| `assistance` | عطل, دفشة, بنزين | 30–45 |
| `sharedRide` | وصلني معك | 10 |
| `stolen` | دراجة مسروقة | 43200 (30 days) |

### 8.2 Collection: `feedback`

| Field | Notes |
|-------|-------|
| `message` | User text |
| `deviceId`, `contactName`, `contactPhone` | Attribution |
| `createdAt` | epoch ms |
| `source` | `"beta-feedback"` |

### 8.3 Storage paths

| Path prefix | Use |
|-------------|-----|
| `report-images/{timestamp}-{filename}` | General report photos (JPEG compressed) |
| `stolen-bikes/{timestamp}-{filename}` | Stolen bike photos |

Image pipeline: client canvas compress → max width 900 → JPEG quality 0.65; general reports also enforce 2MB pre-check.

### 8.4 Soft deletion / expiry

- Resolved reports are filtered client-side (`resolved === true`).
- Expired reports are filtered client-side every 1s (`minutesPassed < expiry`).
- **Expired documents are not automatically deleted from Firestore** (except explicit owner cancel via `deleteDoc`).
- Image delete on cancel attempts `deleteObject` using URL as storage ref (fragile if path vs URL mismatch).

---

## 9. APIs

### 9.1 Internal (Firebase SDK)

| Operation | Where |
|-----------|--------|
| `onSnapshot(collection(db, "reports"))` | Live sync |
| `addDoc(...reports)` | Create report / stolen report |
| `updateDoc(...reports/{id})` | Helper accept, cancel help, resolve, GPS heartbeat |
| `deleteDoc(...reports/{id})` | Cancel / found bike |
| `uploadBytes` / `getDownloadURL` | Images |
| `deleteObject` | Image cleanup on cancel |
| `addDoc(...feedback)` | Beta feedback |

### 9.2 External HTTP

| API | Purpose |
|-----|---------|
| `https://nominatim.openstreetmap.org/reverse?...&accept-language=ar` | Reverse geocoding (street/area/city) |
| `https://www.google.com/maps?q=lat,lng` | Open external maps |
| `https://wa.me/961{phone}` | WhatsApp contact |
| `tel:{phone}` | Native dialer |

No REST backend, GraphQL, or Cloud Function endpoints.

### 9.3 Unused / dormant

- Google Maps JS API key via Vite env — commented-out `LoadScript` / `GoogleMap` block in `App.tsx`.

---

## 10. Components

There is **no component library folder**. Structure inside `App.tsx`:

### 10.1 Small helpers / map children

| Symbol | Role |
|--------|------|
| `makeIcon` | Leaflet `DivIcon` colored dots |
| `MyLocation` | One-time `flyTo` on first GPS fix |
| `FlyToReport` | Fly map to selected target |
| `MapZoomTracker` | Sync zoom for high-priority circles |
| `timeAgo` / `timeLeft` | Arabic relative time / expiry text |
| `calculateDistance` / `formatDistance` / `getDistanceMeters` | Haversine helpers |
| `compressImage` | Canvas image compression |
| `deleteReportImage` | Storage cleanup attempt |
| `getAddressFromCoords` | Nominatim wrapper |
| `ensureContactInfo` / `saveContactInfo` | Contact gate |
| `isAssistanceReport` / `canReceiveHelp` | Type family helpers |

### 10.2 Monolithic `App` responsibilities

State, Firestore listeners, GPS watch, helper GPS throttling, all modals, reports list/filters, map markers, PWA install, legal pages, feedback, and action handlers — **all in one component**.

### 10.3 Dead / legacy artifacts

| Artifact | Notes |
|----------|--------|
| `src/App copy.tsx` | Early local-state prototype (no Firebase) |
| Large `{false && ...}` UI blocks | Old nearby sheet / duplicate dashboards |
| `sendReport` local-only path | Pre-Firebase style; still wired to `selectedType` modal |
| `addReport` | Alternate create path; partially superseded by `createUserReport` |
| `forceUpdate` | Declared unused |
| Duplicate mobile dashboard JSX | Appears more than once |
| Vite `App.css` / `index.css` layout | Not driving the map UI |

---

## 11. Routing

**No router** (`react-router` not installed).

“Screens” are boolean React state flags, for example:

- `showReportModal`, `showDescriptionModal`, `showStolenModal`
- `showReportsPage`, `showCommunityCenter`, `showLegalPage`
- `showContactModal`, `showInstallGuide`, `selectedReport`, `fullImageUrl`

Deep linking / shareable report URLs are **not supported**.

---

## 12. State Management

| Kind | Mechanism |
|------|-----------|
| Server state | Firestore `onSnapshot` → `reports` |
| UI state | Dozens of `useState` hooks in `App` |
| Identity / contact | `localStorage` + React state |
| GPS | `navigator.geolocation.watchPosition` → `myLocation` |
| Helper GPS write throttle | `useRef` (50m move **or** 30s heartbeat) |
| Global store | None (no Redux / Zustand / Context) |
| Derived counts | Inline filters (`intelligenceCount`, etc.) |

**Risks of current model:**

- Every Firestore update re-renders the entire app tree
- Client-side expiry `setInterval` rewrites `reports` every second (extra churn)
- `selectedReport` is synced via effect against live `reports`
- Mixed ownership of truth: some local animations (`moving` / `isHelper`) vs real Firestore helper coords

---

## 13. Maps Implementation

### 13.1 Active stack

- **Library:** Leaflet via `react-leaflet`
- **Tiles:** OpenStreetMap (`{s}.tile.openstreetmap.org`)
- **Default center:** ~Beirut (`33.8750, 35.5120`) until GPS available
- **User marker:** blue DivIcon
- **Report markers:** colored dots; stolen / helper-coming special colors
- **Helper marker:** separate marker when `helperComing` + `helperLat/Lng`
- **High-priority aura:** concentric `Circle`s when `priority === "high"` and zoom ≥ 14
- **Interactions:** click marker → detail sheet (road-intel types often non-clickable for detail); Google Maps deep link from popups

### 13.2 GPS

- Continuous `watchPosition` (high accuracy, `maximumAge: 5000`)
- Manual refresh button (“موقعي GPS”)
- Helper location updates only when this device is the active helper:
  - write if moved ≥ **50 m** OR last write ≥ **30 s**

### 13.3 Known map/geo quirks

1. **`makeIcon` template bug:** ternary expressions for `box-shadow` / `animation` are embedded as **literal text** inside the HTML string (JS is not evaluated), so pulse styling for traffic may not work as intended.
2. **Stolen bike coordinates** in `submitStolenBikeReport` are **hardcoded** to `33.8938, 35.5018` (Hamra area) — not the user’s GPS.
3. Google Maps dependency/env exist but production map path is OSM/Leaflet.
4. Marker popup expiry math inconsistently mixes `expiry` as minutes vs milliseconds in one place.

---

## 14. User Flow

```
Open PWA
   │
   ├─► Grant GPS ─► Map centers on user
   │
   ├─► Browse map markers / open reports list
   │      ├─ filter by geo / sort
   │      └─ tap report → detail / help actions
   │
   ├─► Create report (“تبليغ مباشر”)
   │      ├─ Road intel ─► optional note + photo ─► publish at GPS
   │      ├─ Assistance / shared ride ─► require contact ─► note/photo ─► publish
   │      └─ Stolen bike ─► detailed form + images ─► publish (⚠ fixed lat/lng today)
   │
   ├─► Help someone (assistance types)
   │      ├─ ensure contact
   │      ├─ helperRespond → claim request
   │      ├─ call / WhatsApp / navigate
   │      ├─ live helper GPS streamed to owner
   │      └─ cancel help OR owner marks resolved
   │
   └─► Settings ⚙️
          ├─ contact info
          ├─ privacy / terms / emergency disclaimer
          ├─ founders note
          ├─ install PWA
          └─ send feedback → Firestore
```

### Roles (implicit)

| Role | Capabilities |
|------|----------------|
| Viewer | See map, reports, filters |
| Reporter | Create/cancel own reports; resolve when helped |
| Helper | Accept one assistance request; contact owner; stream GPS |
| Stolen reporter | Publish bike alert; mark found (delete) |

No multi-helper queue; acceptance is effectively **first writer wins** (`helpers: 1`).

---

## 15. Existing Features

### Implemented and in active UI

- Live multi-user reports via Firestore
- Four report families (roads, help, ride-share, stolen)
- Optional descriptions + compressed images
- Stolen bike multi-image form (up to 5)
- Assistance claim / cancel / resolve
- Owner ↔ helper call & WhatsApp
- Throttled helper live location
- Reports page with geo filters (Lebanon regions) + sort (newest / nearest / important)
- Distance-from-me display
- Soft client-side expiry
- Community settings + legal copy + feedback
- PWA install (Android prompt + iOS guide)
- iPhone Safari-specific button sizing tweaks
- Full-screen image viewer
- OpenStreetMap reverse geocoding (Arabic)

### Partially present / incomplete

- `typeFilter` UI exists but **is not applied** in the filter pipeline (state updates styling only)
- Family tabs / nearby bottom sheet largely disabled via `{false && ...}`
- Google Maps overlay path commented out
- `helpersList` written as empty array; multi-helper not built
- Client expiry does not purge Firestore
- Image delete uses download URL as Storage ref (may fail silently)

### Prototype leftovers

- `App copy.tsx`
- Local `sendReport` / animated `isHelper` movement intervals
- Seed `startingReports` overwritten once snapshot arrives

---

## 16. Technical Debt

### Architecture & maintainability

1. **God component** — ~4,250-line `App.tsx` blocks testing, reuse, and safe parallel work.
2. **No module boundaries** — types, Firebase services, map, modals, and domain logic are intertwined.
3. **Heavy `any` usage** — weak TypeScript safety despite TS toolchain.
4. **Dead code volume** — duplicated dashboards, `{false &&}` blocks, unused hooks/functions.
5. **Inconsistent create paths** — `createUserReport`, `addReport`, `sendReport`, `submitStolenBikeReport` overlap.

### Product / correctness bugs

6. Stolen reports ignore GPS (hardcoded Beirut coords).
7. `typeFilter` non-functional.
8. `makeIcon` glow/pulse interpolation bug.
9. Popup expiry calculation inconsistency (minutes vs ms).
10. Client-only expiry → Firestore growth / stale data.
11. Single helper race conditions (no transaction / claim lock).
12. WhatsApp number formatting inconsistent across stolen vs assistance flows.
13. `isSubmittingStolenBike` may not reset to `false` on success path.

### Security & ops

14. No in-repo Firestore/Storage security rules.
15. No Auth → spoofable `ownerId` / destructive writes if rules are open.
16. `.env` tracked; Maps API key in repo.
17. Phone numbers stored in plaintext on reports.
18. Nominatim usage from browser (rate limits / ToS / no User-Agent policy handling).

### UX / platform

19. No offline queue / conflict strategy beyond PWA caching of assets.
20. No push notifications for nearby help / stolen alerts.
21. No deep links or shareable report pages.
22. Accessibility / design system not established (inline styles, emoji-heavy).
23. Leftover Vite CSS constrains `#root` width conceptually (map uses fixed full viewport inline styles that mostly override this).

### Dependencies

24. `@react-google-maps/api` installed but unused.
25. Both Leaflet and Google Maps mental models in one file increase confusion.

---

## 17. Opportunities for Future AI Features

High-fit opportunities given the current domain (Lebanon riders, live geo reports, images, Arabic UX):

### Near-term (fit existing data)

| Idea | How it would plug in |
|------|----------------------|
| **Smart report triage** | Classify free-text `description` + type into severity / spam / duplicate |
| **Duplicate / cluster detection** | Group nearby same-category reports within time window (“same زحمة”) |
| **Image assist for stolen bikes** | Suggest bike type/color from uploaded photos; warn low-quality images |
| **Arabic NLP search** | Natural-language search over `locationName` / descriptions (“زحمة قرب الحمرا”) |
| **Expiry / freshness scoring** | Predict how long a road condition stays relevant; auto-suggest confirm/extend |
| **Helper matching** | Rank nearby riders by distance, heading, past reliability (needs Auth + history) |

### Medium-term (needs more product surface)

| Idea | Prerequisite |
|------|----------------|
| **Voice-to-report** | Speech → Arabic structured report while riding |
| **Route risk brief** | “Your path has 2 accidents + slippery ahead” using live report layer |
| **Anomaly / abuse detection** | Flag fake help requests or coordinated spam |
| **Community digest** | Daily AI summary of Beirut road conditions for riders |
| **Photo scene understanding** | Confirm accident vs traffic from optional images |

### Platform prerequisites for AI

Before serious AI features, the codebase ideally needs:

1. Extracted domain services + typed report model  
2. Real Auth + security rules  
3. Server-side or Functions layer (keep API keys / model calls off the client)  
4. Durable history / analytics events (not only ephemeral map docs)  
5. Consent model for using location/phone/images in ML pipelines  

---

## 18. Recommended Mental Model for Future Development

Treat the current app as a **vertical slice prototype** that already proves:

- Realtime geo social layer for riders  
- Assistance marketplace MVP  
- Stolen bike bulletin  
- PWA distribution  

Next engineering phases (when implementation is requested) should likely prioritize, in order:

1. **Security rules + Auth** (non-negotiable for scale)  
2. **Split `App.tsx`** into map / reports / modals / services  
3. **Fix correctness bugs** (stolen GPS, filters, icon template, expiry cleanup)  
4. **Stabilize data model** (single create path, typed schema, claim transactions)  
5. **Then** product/AI features on a clean foundation  

---

## 19. File Reference Index

| Path | Importance |
|------|------------|
| `src/App.tsx` | Entire product UI + domain logic |
| `src/firebase.ts` | Firebase app, Firestore, Storage |
| `src/main.tsx` | React bootstrap |
| `vite.config.ts` | Build + PWA manifest |
| `firebase.json` / `.firebaserc` | Hosting deploy |
| `package.json` | Dependencies & scripts |
| `.env` | Unused Google Maps key (tracked) |
| `src/App copy.tsx` | Historical prototype only |
| `README.md` | Empty stub |

---

## 20. Audit Closure

This document is the architectural baseline for Totimoto Rider Map as of the audit date.  

**No source code was modified** beyond creating this Markdown report under `docs/`.  

Awaiting further instructions before any implementation work.
