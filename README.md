# SalishPulse — Seattle & Puget Sound Real-Time Orca Tracker

A modern, cross-platform (**iOS, Android, and Web** via **React Native / Expo**) orca tracking and shore-viewing alert platform for Seattle and Puget Sound. Aggregates near-real-time sightings across **Orca Network (via Acartia)**, **Orcasound / OrcaHello hydrophones**, **Bluesky Jetstream**, **Reddit / West Seattle Blog**, **WSF Ferries**, and **1-tap citizen spotters** with spatio-temporal deduplication, waterway ETA predictions, and mandatory Washington State **Be Whale Wise** (1,000-yard SRKW) conservation guardrails.

---

## Project Structure

```text
orca-tracker/
├── app/                         # React Native (Expo SDK 58) — iOS, Android & Web
│   ├── App.tsx                  # Responsive split-pane web / mobile app
│   └── src/
│       ├── components/
│       │   ├── PugetSoundMap.tsx # Interactive projected Puget Sound SVG marine chart
│       │   ├── SightingCard.tsx  # Confidence-tiered sighting card with source attribution
│       │   └── ReportModal.tsx   # 1-tap shore reporter + Live Social NLP tester
│       ├── services/api.ts       # REST + SSE client with instant offline fallback
│       ├── utils/geo.ts          # Haversine, corridor ETA engine, client NLP + deduplicator
│       └── data/fallbackData.ts  # Seattle beaches, Orcasound hydrophones & WA 2025 rules
├── backend/                     # Zero-dependency Node 22 + TypeScript real-time server
│   └── src/
│       ├── server.ts            # REST + Server-Sent Events (/api/stream) on port 4000
│       ├── nlpParser.ts         # Deterministic Seattle NLP + LLM fallback adapter
│       ├── deduplicator.ts      # Spatio-temporal clustering (<=2.5km, <=20m) & tiering
│       ├── etaEngine.ts         # Corridor alignment & knot-speed beach ETA predictor
│       ├── connectors.ts        # Acartia, Orcasound, Bluesky & Live Simulator adapters
│       └── server.test.ts       # Node built-in unit & HTTP/SSE integration tests
├── shared/
│   └── pugetSoundData.ts        # SME-curated Puget Sound spots, corridors & sightings dataset
└── docs/
    ├── PRD.md                   # Principal PMT Product Requirements Document
    ├── SME_DOMAIN_AND_SOURCES.md # Puget Sound Orca SME Data Sources, Ecology & Legal Guide
    └── ARCHITECTURE_AND_PRICING.md # Distributed Architecture & Cloud Cost Comparison
```

---

## Quick Start

### 1. Run the Near-Real-Time Aggregation Backend (Node 22+)
```bash
cd backend
npm install
npm test          # Runs 9 unit + HTTP/SSE integration tests
npm start         # Starts REST + SSE API on http://localhost:4000
```

Test live social-post NLP ingestion via `curl`:
```bash
curl -X POST http://localhost:4000/api/ingest/social \
  -H "Content-Type: application/json" \
  -d '{"source":"bluesky","authorHandle":"@alki.bsky.social","text":"8 orcas heading south past Alki Point toward Lincoln Park!"}'
```

### 2. Run the Cross-Platform React Native App (iOS, Android & Web)
```bash
cd app
npm install
npm run web       # Opens Expo Web (MapLibre GL + offline chart fallback, connects to localhost:4000)
npm run ios       # Launch in iOS Simulator / Expo Go
npm run android   # Launch in Android Emulator / Expo Go
```

### 3. Deploy to Production (Cloudflare Workers + Supabase PostGIS)
```bash
# 1. Apply the PostGIS spatial schema & alert RPC to Supabase
supabase db push --file supabase/migrations/001_initial_postgis.sql

# 2. Configure Worker secrets & deploy to Cloudflare Edge (Workers + Queues + Durable Objects)
cd cloudflare
npm install
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put ADMIN_FREEZE_TOKEN
# Optional: ACARTIA_API_TOKEN, LLM_API_KEY, EXPO_ACCESS_TOKEN
npm run deploy
```

### 4. Build & Submit for iOS TestFlight (EAS Build)
`app/eas.json`, `app/app.json` (`ITSAppUsesNonExemptEncryption: false`, `expo-notifications` plugin, location permission string), and `.github/workflows/testflight.yml` are pre-configured for Apple TestFlight:

```bash
cd app
npx eas-cli login
npx eas-cli init                                    # Links project to your Expo account (adds extra.eas.projectId)
npx eas-cli build --platform ios --profile production --auto-submit
```

Or trigger automated cloud builds directly from GitHub Actions:
1. Create an Expo Access Token at `https://expo.dev/settings/access-tokens` and add it as repository secret **`EXPO_TOKEN`**.
2. Update `submit.production.ios` in `app/eas.json` with your Apple ID, App Store Connect App ID (`ascAppId`), and Apple Team ID (or configure credentials interactively once via `npx eas-cli credentials -p ios`).
3. Run **Actions → iOS TestFlight Release (EAS Build)** or push a version tag (`git tag v1.0.0 && git push origin v1.0.0`).

---

## Key Architecture & Product Highlights

- **Sanctioned Data First:** Ingests **Acartia API** (carrying vetted Orca Network & WhaleAlert sightings), **Orcasound / OrcaHello AI** hydrophones (Bush Point, MaST Center Des Moines, Port Townsend), **Bluesky Jetstream**, and in-app citizen reports — avoiding fragile Facebook scraping.
- **Seattle-Aware NLP Noise Filter:** Rejects common Puget Sound false positives (such as Seattle **ORCA transit card** posts) while extracting landmarks, travel heading, whale counts, and ecotypes.
- **Anti-Fatigue Smart Alerts:** Combines spatio-temporal clustering (`<= 2.5 km`, `<= 20 min`), corridor ETA prediction, favorite-beach geofencing, per-track cooldowns, and daylight quiet hours.
- **Conservation & WA 2025+ Law Built-In:** Highlights Washington State's mandatory **1,000-yard buffer** for endangered Southern Resident Killer Whales (RCW 77.15.740) and **200-yard buffer** for Bigg's orcas, prioritizing zero-impact shore viewing.
- **Recommended Cloud Stack:** **Cloudflare Workers + Durable Objects (SSE) + Supabase PostGIS + Expo Push** — ~\$7/mo at MVP, ~\$45/mo at 25k MAU, and ~\$196/mo during a 100k MAU viral J-Pod Elliott Bay spike (vs. ~\$535/mo on AWS Serverless).
