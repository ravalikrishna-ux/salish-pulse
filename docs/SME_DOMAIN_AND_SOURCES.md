# SalishPulse — Puget Sound & Salish Sea Orca Domain & Data-Source Guide

> **Author:** Puget Sound & Salish Sea Orca Subject Matter Expert (SME) & Citizen-Science Data Specialist  
> **Target System:** SalishPulse Real-Time Seattle-Area Orca Tracker  
> **Primary Operating Area:** Puget Sound Main Basin, Admiralty Inlet, Elliott Bay, East Passage, Colvos Passage, Possession Sound, Saratoga Passage, and Commencement Bay  
> **Seasonality Reference:** Peak Puget Sound Southern Resident Chum Salmon Season (October–January) + Year-Round Bigg's (Transient) Monitoring

---

## 1. Verified Real-Time & Near-Real-Time Data Sources

Building a reliable, legal, and low-latency orca alert engine for Seattle requires fusing **three complementary signal layers**: (1) vetted marine-mammal cooperative networks, (2) live hydrophone acoustic AI detections, and (3) structured social/maritime/citizen feeds. Below is a rigorous operational evaluation of each source.

### 1.1 Source Evaluation Matrix

| Source | Signal Type | Typical Latency | Reliability / SNR | Integration Method | ToS / Scraping Risk | Recommended Role in SalishPulse |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Acartia API** (`https://acartia.io/api/v1`) | Vetted multi-org sightings (Orca Network, WhaleAlert, SpotterPro, WRAS) | 5–25 min | **Very High** (High SNR) | Official REST API (Bearer token / data-sharing cooperative agreement) | **None** (Open data cooperative; built for ingestion & contribution) | **Primary Ground Truth Backbone (Tier 1)** & bidirectional outbound sync |
| **Orcasound & OrcaHello** (`live.orcasound.net`, `ai4orcas.net/orcahello`) | Live hydrophone streams + ML vocalization detections + human review | **< 2 min** (AI) / 5–15 min (Human-verified) | **Very High for SRKWs**; Low recall for silent Bigg's | Public HLS audio streams (S3) + OrcaHello REST/JSON detection feed & webhooks | **None** (Open-source conservation project; CC/open data) | **Earliest SRKW Acoustic Early-Warning Gate (Tier 1/2)** — especially Bush Point & MaST Center |
| **Bluesky Firehose / Jetstream** (`#orcas`, `#PugetSound`, `#Seattle`, `#SalishSea`, `#PNWWhales`) | Real-time shore-spotter posts, photos, ferry updates | **1–5 min** | **Medium–High** (improving rapidly as PNW whale watchers migrated from X) | Official AT Protocol Jetstream WebSocket (JSON, free, no auth required for public stream) | **None** (Open protocol designed for real-time filtering) | **Fastest Visual Early-Warning Stream (Tier 2/3)** |
| **Reddit** (`r/Seattle`, `r/SeattleWA`, `r/whales`, `r/Vashon`) | Citizen posts, photos, thread replies with location updates | 5–20 min | **Medium** (moderate false positives from porpoises/sea lions; rich comment updates) | Official Reddit Data API / RSS (`/.rss` for read-only lightweight polling within rate limits) | **Low** (Must follow Reddit API Data Terms & user-agent/rate limits; no aggressive scraping) | **Visual Corroboration & Crowd-Sourced Detail (Tier 2/3)** |
| **Orca Network & Puget Sound Whale Sightings (Facebook)** | Highest-volume PNW citizen sighting comments & expert IDs | 3–15 min (comments) / 15–60 min (curated posts) | **Very High** (active moderators & photo-ID experts) | **NO scraping.** Ingest via **Acartia** (Orca Network feeds Acartia) + optional **opt-in community relay / webhook / email parser** (`sightings@orcanetwork.org` partnership) | **High if scraped** (Meta ToS strictly prohibits automated scraping of Facebook groups) | **Ingest exclusively via Acartia & Official Partnerships**; never scrape Meta |
| **West Seattle Blog & Local Shoreline Blogs** (`westseattleblog.com`, `vashonbeachcomber.com`, `myedmondsnews.com`) | Hyper-local shore alerts (Alki, Constellation, Lincoln Park, Vashon, Edmonds) | 5–20 min | **High** (editor-vetted before publishing; often includes photos) | Standard public **RSS / Atom feeds** (`https://westseattleblog.com/feed/`) | **None** (Respect poll intervals ≥ 60–120s & attribute/link back) | **West Seattle / Shoreline Corroboration (Tier 2)** |
| **Washington State Ferries (WSF) & WRAS** | Vessel telemetry (AIS/WSF API), WSF Twitter/Bluesky advisories, Whale Report Alert System | 2–10 min | **High** (Professional bridge crews) | Official **WSDOT Ferries REST API** (vessels/terminals) + WRAS partner alerts (Ocean Wise) | **None** (Public WSDOT API key; WRAS is commercial/partner-gated) | **Maritime Context Overlay & Ferry-Lane Crossings** |
| **Quiet Sound Slowdown Status** (`quietsound.org`) | Voluntary commercial vessel slowdown notices (Admiralty Inlet / North Puget Sound) | Daily / Event-based | **Very High** (Official Puget Sound Partnership / Maritime Blue program) | RSS / official status JSON / manual seasonal banner (active **Sept 2026 – Jan 2027**) | **None** | **Conservation Context Banner & Acoustic Noise Index** |
| **NOAA Tides & Currents + NWS Marine Weather** | Tide stage/currents (Station `9447130` Seattle), marine fog, wind, swell, visibility | Real-time (6-min NOAA; hourly NWS) | **Very High** | Official **NOAA CO-OPS API** & **NWS `api.weather.gov`** (free, public domain) | **None** | **Viewability Score & Tidal Current ETA Adjustment** |
| **The Whale Trail** (`thewhaletrail.org`) | Verified shore-based viewing sites & educational interpretive signage | Static / Periodic | **Very High** | Reference dataset / partnership attribution | **None** | **Viewing Spot Enrichment & Conservation Education** |
| **SalishPulse In-App Citizen Spotter Network** | Structured 1-tap reports (GPS, compass bearing, shoreline side, ecotype hints, photo) | **< 1 min** | **Medium → High** (improves via user reputation & photo verification) | Native SalishPulse API + **bidirectional push back to Acartia API** | **None** (First-party consent & CC-BY / Acartia opt-in) | **Closed-Loop Community Telemetry & Conservation Contribution** |

---

### 1.2 Technical Integration Notes for Key APIs

1. **Acartia Cooperative API (`https://acartia.io/api/v1`)**
   - **What it is:** A decentralized Salish Sea marine animal data cooperative co-developed by Orca Conservancy, Orcasound, Orca Network, Conserve.io (WhaleAlert), and Washington State partners.
   - **Endpoints of interest:** `GET /sightings` (filterable by bounding box, timestamp, species, verified status) and `POST /sightings` (pushing verified SalishPulse citizen-spotter records back to the community).
   - **Data Hygiene:** Deduplicate against `external_id` and spatio-temporal proximity (within 1.5 nm and 15 minutes for the same pod) so an Orca Network sighting syndicated into Acartia isn't double-counted alongside a West Seattle Blog repost.

2. **Orcasound & OrcaHello (`live.orcasound.net`, `ai4orcas.net/orcahello`)**
   - **How it works:** Live hydrophones stream continuous audio via HLS chunks. The **OrcaHello** inference pipeline (Azure/AI4Earth + Orcasound) runs a convolutional neural network classifier on 1-minute spectrograms to detect Southern Resident discrete calls (`S1`, `S4`, `S16`, `S19`, etc.) and echolocation clicks.
   - **Human-in-the-Loop Workflow:** Candidate detections above threshold are queued for trained volunteer moderators ("OrcaHello Moderators"). SalishPulse should surface:
     - **Verified detections** (`found: true`, human-confirmed) immediately as **Tier 1**.
     - **High-confidence pending AI candidates** (`confidence >= 0.85`, unreviewed) only as **Tier 2/3 acoustic alerts** (or elevated to Tier 2 if corroborated by a recent visual sighting along the same corridor).
   - **Strategic Value for Seattle:** **Bush Point** (Whidbey Island) is the crown jewel early-warning node—when J-Pod vocalizes at Bush Point southbound, Seattle viewers get **3 to 4.5 hours of advance notice** before whales reach Discovery Park and Alki Point! **MaST Center (Des Moines)** guards East Passage south of Lincoln Park / Vashon.

3. **Bluesky Jetstream & Reddit Ingestion**
   - **Bluesky Jetstream:** Connect via lightweight WebSocket (`wss://jetstream2.us-west.bsky.network/subscribe?wantedCollections=app.bsky.feed.post`) and filter in-memory for Puget Sound marine keywords (`orca`, `orcas`, `killer whale`, `j pod`, `k pod`, `l pod`, `t65a`, `alki`, `lincoln park`, `west point`, `point robinson`, `vashon`, `edmonds`, `ferry`, `whale`, `#orcas`, `#pugetsound`, `#salishsea`). Apply strict negative-keyword filters to eliminate noise (e.g., `"orca card"`, `"transit"`, `"sound transit"`, `"reload"`, `"hockey"`, `"canucks"`, `"orca whale plush"`, `"yacht"`, `"sailboat named orca"`).
   - **Critical Seattle NLP Trap:** Seattle's regional public transit fare card is literally called the **ORCA Card**! Every social media parser in Seattle *must* filter out transit posts (`"orca card"`, `"link light rail"`, `"king county metro"`, `"tap my orca"`, `"fare"`, `"reload"`, `"bus"`).

4. **NOAA Tides & NWS Marine Visibility**
   - **NOAA CO-OPS Station `9447130` (Seattle — Pier 55 / Elliott Bay):** Fetch tide predictions and current direction/velocity at nearby Admiralty Inlet (`PUG1515`) and East Passage / Alki current stations to adjust corridor ETAs by ±1–2 knots.
   - **NWS Marine Zone `PZZ135` (Puget Sound and Hood Canal):** Surface visibility alerts (dense fog, small craft advisories, wind waves > 2 ft) directly on Viewing Spot cards as a **"Spotting Conditions" badge** (e.g., *"Glassy water / High Visibility"* vs. *"20 kt Southerly Chop — Hard to spot dorsal fins"*).

---

## 2. Puget Sound Orca Ecology & Taxonomy

Seattle residents regularly encounter **two genetically, culturally, and acoustically distinct ecotypes** of killer whale (*Orcinus orca*) that **do not interbreed or socialize**, plus two charismatic baleen whale species. Correctly distinguishing ecotype is legally critical under Washington State law (1,000-yard vs. 200-yard buffer).

### 2.1 Southern Resident Killer Whales (SRKW — J, K, and L Pods)

- **Conservation Status:** **Critically Endangered** (ESA-listed 2005); population hovers near **~73–74 individuals** across three matrilineal pods:
  - **J Pod (~25 whales):** The most frequent Puget Sound visitors! Often enters Puget Sound multiple times from **October through January** (and occasionally spring) chasing autumn **chum salmon** runs into East Passage, Colvos Passage, Elliott Bay, and Commencement Bay.
  - **K Pod (~15 whales):** Often travels with J Pod or L Pod; visits Puget Sound primarily in late autumn/early winter (Nov–Dec).
  - **L Pod (~33 whales):** Largest pod; often splits into sub-groups (e.g., L12s vs. L4s/L54s); spends more time on the outer Washington/Oregon coast but enters Puget Sound during strong late-fall salmon runs.
- **Diet & Foraging Behavior:** Obligate fish-eaters (**~80%+ Chinook salmon** annually, shifting heavily to **Puget Sound Chum salmon** in Oct–Dec). Spread out over 1–5 miles when actively foraging, milling across current seams and tidal rips.
- **Acoustic Signature:** **Highly vocal.** Each pod has a unique repertoire of discrete calls (e.g., J Pod's iconic `S1` call). They frequently echolocate and socialize loudly, making them **ideal targets for Orcasound hydrophones**.
- **Visual & Behavioral Cues:** Larger groups (10–30+ whales); rounded dorsal fin tips with "open" saddle patches (black pigment invading the gray saddle behind the dorsal fin); frequent surface-active behaviors (breaching, spyhopping, pec-slapping, kelp-rolling).
- **Notable Iconic Individuals:** Adult males like **J27 "Blackberry"** (tall, slightly wavy dorsal fin), **J26 "Mike"**, **J38 "Cookie"**, and matriarchs like **J16 "Slick"** and **J19 "Shachi"**.

### 2.2 Bigg's (Transient) Killer Whales

- **Conservation Status:** **Thriving & Increasing** (~370+ individuals in the West Coast Transient stock), driven by rebounding harbor seal and sea lion populations. **Year-round** visitors to Seattle and Puget Sound!
- **Common Puget Sound Matrilines:** **T65As** (frequent Puget Sound regulars, including towering male **T65A2 "Ooxjaa"**), **T137s** (with giant male **T137A "Jack"**), **T46s / T46Bs**, **T49As**, **T124As**, **T36s**, and **T99s**.
- **Diet & Foraging Behavior:** **Marine mammal hunters** (harbor seals, harbor porpoises, California/Steller sea lions, Dall's porpoises). They hunt in tight, coordinated stealth formations close to shorelines, rock reefs, and haul-outs (Blake Island, Edmonds Underwater Park, Alki, Vashon, Nisqually Reach, Saratoga Passage).
- **Acoustic Signature:** **Acoustically stealthy.** They remain almost completely silent while hunting to avoid alerting marine mammal prey; they vocalize mainly *after* a successful kill or during rare multi-family social gatherings ("T-parties"). **Consequence for SalishPulse:** Hydrophones miss ~85%+ of Bigg's transits—visual citizen spotters, Bluesky/Reddit, and WSF ferries are indispensable for tracking Bigg's.
- **Visual Cues:** Smaller tight groups (2–6 whales, occasionally 10–15 during T-parties); tall, pointed/triangular dorsal fins; uniform "closed" gray saddle patches; unpredictable direction reversals (circling bays rather than steady linear travel).

### 2.3 Bonus Salish Sea Cetaceans & False-Positive Confounders

| Species | Peak Puget Sound Season | Distinguishing Visual Cues | SalishPulse Handling |
| :--- | :--- | :--- | :--- |
| **Humpback Whale** (*Megaptera novaeangliae*) | May – November | Huge bushy blow (10–15 ft), small stubby/knobby dorsal fin on a hump, raises broad notched tail flukes before deep dives; often solitary or mom-calf pairs near West Point, Alki, and Vashon. | Track as `HUMPBACK` bonus sighting! High public excitement. |
| **Gray Whale — "Sounders"** (*Eschrichtius robustus*) | March – May (rarely fall) | Mottled gray-white barnacle-encrusted back, **no dorsal fin** (series of knuckles along tail stock), heart-shaped blow; feed on ghost shrimp in shallow intertidal mudflats of Possession Sound, Saratoga Passage, Mukilteo, and Edmonds. | Track as `GRAY` (`SOUNDERS`); note Mukilteo & Whidbey hotspots. |
| **Harbor Porpoise** (*Phocoena phocoena*) | Year-round | Very small (5 ft), tiny triangular dark dorsal fin, quick rolling surface arc, shy around boats, no visible blow. | **Top False Positive** in beginner social posts—flag/demote in NLP confidence rubric. |
| **California / Steller Sea Lions** | Fall – Spring | Often "rafting" with a single flipper sticking straight up ("jughandling"), barking loudly, brown/tan heads surfacing vertically. | **Frequent False Positive** ("black fin not moving near buoy" → sea lion flipper!). |

---

## 3. Seattle & Puget Sound Premier Shore-Based Viewing Geography

SalishPulse champions **zero-impact land-based whale watching**. Below are the 12 highest-probability shore viewing locations covering the entire Puget Sound Main Basin, Admiralty Inlet, Possession Sound, East Passage, and Dalco Passage.

| # | Viewing Spot | Lat, Lng | Waterway Corridor | Typical Viewing Distance | Sightlines & Elevation | Parking & Access Notes |
| :-: | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | **Alki Point (Lighthouse & Beach)** | `47.5764, -122.4206` | Puget Sound Main Basin / Elliott Bay Mouth | 150 yds – 1.5 mi | 270° panoramic view north to West Point, west to Bainbridge, south toward Blake Island; sea-level seawall & lighthouse point. | Street parking along Alki Ave SW & Beach Dr SW (fills fast during alerts); Metro Water Taxi + Shuttle 775 or C Line + Bus 50. |
| 2 | **Constellation Park** | `47.5702, -122.4150` | Main Basin / East Passage Entrance | 100 yds – 1.2 mi | Rocky marine reserve south of Alki Point; prime spot when whales hug the West Seattle shoreline heading south. | Small street parking pullouts on Beach Dr SW; wheelchair-accessible promenade & public restrooms at Weather Watch / Alki. |
| 3 | **Lincoln Park (Point Williams)** | `47.5305, -122.3982` | East Passage / Main Basin | 100 yds – 1.0 mi | Point Williams juts right into the shipping lane north of Fauntleroy Ferry; both sea-level seawall and elevated bluff trails. | North & South Park lots off Fauntleroy Way SW; ~8 min walk downhill to Point Williams beach. |
| 4 | **Discovery Park (West Point Lighthouse)** | `47.6619, -122.4357` | Puget Sound Main Basin | 200 yds – 1.5 mi | Seattle's westernmost promontory; sweeping views north toward Edmonds/Shilshole and south across Elliott Bay to Alki. | Park at South or North Discovery Park lots (~1.5 mi hike each way to beach); ADA beach parking pass available at Visitor Center. |
| 5 | **Golden Gardens Park** | `47.6908, -122.4036` | Puget Sound Main Basin (Shilshole Bay) | 400 yds – 2.0 mi | Wide sandy beach & pier looking NW across Main Basin to Bainbridge/Point Jefferson; elevated bluff trail offers binoculars advantage. | Large beachfront lot + overflow lot on Seaview Pl NW; restrooms, benches, sunset glare late afternoon in winter. |
| 6 | **Edmonds Brackett's Landing North** | `47.8136, -122.3826` | Puget Sound Main Basin (North) | 100 yds – 1.2 mi | Marine Sanctuary just north of Edmonds–Kingston ferry dock; whales routinely pass tight to the underwater dive park reef. | Paid/free lots along Railroad Ave & Main St; Sounder train & ferry walk-on friendly; Edmonds Fishing Pier nearby. |
| 7 | **Mukilteo Lighthouse Park** | `47.9488, -122.3052` | Possession Sound / Saratoga Passage | 100 yds – 1.0 mi | Confluence of Possession Sound, Saratoga Passage, and Main Basin; prime for Bigg's, Gray "Sounders," and SRKWs rounding Whidbey. | Paid park lot right next to Mukilteo–Clinton ferry terminal; flat accessible boardwalk, restrooms, coffee shops nearby. |
| 8 | **Point Robinson Park (Vashon / Maury Island)** | `47.3881, -122.3741` | East Passage | **50 yds – 0.8 mi** | **Arguably Central Puget Sound's #1 close-pass shore site.** Whales frequently hug the deep drop-off right off the lighthouse shoal! | Free upper lot (10-min walk down road) + limited lower ADA/drop-off spots; requires WSF Fauntleroy–Vashon or Pt Defiance ferry. |
| 9 | **Owen Beach (Point Defiance Park)** | `47.3155, -122.5298` | Dalco Passage / Commencement Bay | 100 yds – 0.8 mi | Tight funnel between Tacoma and Vashon Island; whales entering Quartermaster Harbor, Tacoma Narrows, or Commencement Bay pass close. | Free parking at Owen Beach promenade (note: Five Mile Drive outer loop is pedestrian-only); accessible kayak launch & benches. |
| 10 | **Fort Ward Park (Bainbridge Island)** | `47.5754, -122.5273` | Rich Passage / West Main Basin / Colvos Approach | 150 yds – 1.2 mi | Crucial **west-side counterpart** to Alki/Lincoln Park—catches whales hugging Bainbridge/Blake Island or entering Colvos Passage! | Lower boat-launch lot & upper lot on Pleasant Beach Dr NE; paved waterfront trail; ~15 min drive from Bainbridge Ferry. |
| 11 | **Bush Point (Whidbey Island)** | `48.0315, -122.6075` | Admiralty Inlet | **75 yds – 1.0 mi** | Narrow eastern pinch point of Admiralty Inlet + active **Orcasound hydrophone**; catches nearly all SRKWs entering/exiting Puget Sound. | Free parking at WDFW Bush Point boat launch / beach access off S Bush Point Rd; bring windproof gear—exposed to strait winds. |
| 12 | **MaST Center Aquarium & Redondo Beach** | `47.3489, -122.3257` | East Passage / Poverty Bay | 150 yds – 1.2 mi | Highline College marine pier directly across East Passage from Point Robinson; hosts the southernmost active **Orcasound hydrophone**. | Street parking & paid lot along Redondo Beach Dr S; wheelchair-accessible pier & boardwalk; Saturday free aquarium hours. |

---

## 4. Travel Speed & Corridor ETA Heuristics

Puget Sound acts as a deep, narrow north–south fjord system. Rather than straight-line Euclidean distance, SalishPulse must compute ETAs along the **Puget Sound Waterway Corridor Graph** using behavior-adjusted speeds and tidal current offsets.

### 4.1 Speed Profiles by Behavioral State

| Behavioral State | Typical Speed (Knots) | Distance Covered in 30 min | Typical Ecotype Context | ETA Confidence Band |
| :--- | :---: | :---: | :--- | :--- |
| **Foraging / Milling** | **1.5 – 3.0 kn** | 0.75 – 1.5 nm | SRKWs spread across chum runs; Bigg's hunting seals near shore | Low (±45–90 min; high reversal probability) |
| **Steady Travel (Standard)** | **4.0 – 6.0 kn** | 2.0 – 3.0 nm | SRKWs & Bigg's transiting Main Basin / East Passage | **High** (±15–25 min) |
| **Fast Transit ("Commuting")** | **6.5 – 8.5 kn** | 3.25 – 4.25 nm | Pods riding flood/ebb current down Admiralty Inlet or East Passage | High (±10–15 min) |

### 4.2 Primary North–South Corridor Distances & Baseline Transit Times (at 5.0 kn)

| Corridor Segment | Water Distance (nm) | Baseline Transit @ 5.0 kn | Key Oceanographic / Whale Routing Notes |
| :--- | :---: | :---: | :--- |
| **Port Townsend → Bush Point** (Admiralty Inlet) | 9.2 nm | ~1 hr 50 min | Strong 2–4 kn tidal currents; hydrophone-to-hydrophone speed calibration! |
| **Bush Point → Edmonds (Brackett's Landing)** | 16.5 nm | ~3 hr 18 min | Broadens past Point No Point & Possession Point (pods occasionally branch east toward Mukilteo/Saratoga Passage). |
| **Edmonds → Mukilteo** (Possession Sound branch) | 9.5 nm | ~1 hr 54 min | Common Bigg's & Gray whale detour; SRKWs occasionally loop into Possession Sound before heading south. |
| **Edmonds → Discovery Park (West Point)** | 9.4 nm | ~1 hr 53 min | Passes Golden Gardens (~7.5 nm from Edmonds); check both east (Seattle) and west (Kitsap/Bainbridge) shorelines. |
| **West Point → Alki Point** (across Elliott Bay mouth) | 5.2 nm | ~1 hr 02 min | Crosses Seattle–Bainbridge ferry lanes; SRKWs occasionally detour east into Elliott Bay toward Duwamish Head! |
| **Alki Point → Constellation Park → Lincoln Park** | 2.9 nm | ~35 min | Prime West Seattle shore-viewing stretch; easy for spotters to leapfrog south by car/bike along Beach Dr SW. |
| **Lincoln Park → Fort Ward (cross-channel)** | 5.6 nm | ~1 hr 07 min | Split point at **Blake Island**—pods choose either **East Passage** (east of Vashon) or **Colvos Passage** (west of Vashon). |
| **Lincoln Park → Point Robinson (East Passage)** | 8.6 nm | ~1 hr 43 min | Passes Three Tree Point; East Passage has a **net southward current**—favored for southbound transits. |
| **Point Robinson → MaST Center (Redondo)** | 3.0 nm | ~36 min | Whales off Point Robinson are often acoustically audible on the MaST Center hydrophone 20–40 min before passing abeam! |
| **Point Robinson → Owen Beach (Dalco Passage)** | 9.2 nm | ~1 hr 50 min | Enters Commencement Bay / Dalco Passage / Tacoma Narrows; pods often turn north here and loop up **Colvos Passage** (net northward current — the classic **"Vashon Loop"**). |

---

## 5. NLP Extraction Schema for Noisy Social Media Posts

Raw posts from Bluesky, Reddit, and shoreline comments are unstructured, slang-heavy, and rife with Seattle localisms (*"off the lighthouse"*, *"west side of Vashon"*, *"huge dorsal right by the Bainbridge ferry"*). SalishPulse's ingestion pipeline should parse raw text into a standardized JSON extraction payload.

### 5.1 Example Input → Structured Output

> **Raw Post:** *"OMG orcas right off Alki Point lighthouse!! Saw at least 6–8 heading south toward Lincoln Park, one massive tall dorsal fin slapping its tail maybe 300 yards out! #Seattle #orcas"*

```json
{
  "is_relevant_cetacean": true,
  "false_positive_flags": [],
  "ecotype_guess": "UNKNOWN_ORCA",
  "ecotype_clues": ["6-8 individuals", "surface active: tail slapping", "adult male dorsal fin"],
  "pod_id": "UNKNOWN",
  "estimated_count_min": 6,
  "estimated_count_max": 8,
  "has_adult_male": true,
  "behaviors": ["TRAVELING", "TAIL_SLAPPING"],
  "direction": "SOUTHBOUND",
  "matched_landmark": "alki-point",
  "next_mentioned_landmark": "lincoln-park",
  "shoreline_side": "EAST_SHORE_SEATTLE",
  "distance_from_shore_yards": 300,
  "media_attached": false,
  "extraction_confidence": 0.88
}
```

### 5.2 Core Entity Gazetteer & Negative Filters

1. **Mandatory Negative Filters (Drop Immediately):**
   - Transit card terms: `orca card`, `reload orca`, `tap my orca`, `sound transit`, `link light rail`, `king county metro`, `fare enforcement`.
   - Sports/Commercial/Non-local: `vancouver canucks`, `seaworld`, `miami`, `spain`, `gibraltar`, `orca cooler`, `yacht`, `book`, `movie`, `tattoo`.
2. **Shoreline Side Disambiguation:**
   - **East / Seattle Side:** `Seattle side`, `east shore`, `Alki`, `Beach Dr`, `Lincoln Park`, `West Point`, `Edmonds`, `Three Tree Point`, `Des Moines`, `Redondo`.
   - **West / Kitsap & Bainbridge Side:** `Bainbridge side`, `west shore`, `Kitsap side`, `Kingston`, `Fort Ward`, `Blake Island`, `Colvos`, `Southworth`, `Manchester`.
   - **Mid-Channel:** `mid-channel`, `middle of the sound`, `ferry lanes`, `shipping lane`, `near the green buoy`.
3. **Direction Phrase Normalization:**
   - `SOUTHBOUND`: `"heading south"`, `"SB"`, `"going down East Passage"`, `"toward Vashon"`, `"toward Tacoma"`, `"toward Lincoln Park"` (when at Alki/West Point).
   - `NORTHBOUND`: `"heading north"`, `"NB"`, `"up Colvos"`, `"toward Edmonds"`, `"toward Kingston"`, `"exiting Puget Sound"`.
   - `MILLING` / `FORAGING`: `"milling"`, `"circling"`, `"hunting"`, `"feeding"`, `"going back and forth"`, `"stalled"`, `"staying put"`.

### 5.3 Confidence Tier Rubric

| Confidence Tier | Numeric Score Band | Criteria | UI Presentation & Alert Behavior |
| :--- | :---: | :--- | :--- |
| **Tier 1 — Verified Expert / Acoustic** (`TIER_1_VERIFIED`) | `0.90 – 1.00` | Verified Acartia / Orca Network sighting, licensed naturalist/researcher report, or **human-verified OrcaHello / Orcasound** hydrophone detection. | Solid Emerald/Teal badge (**"Verified"**); triggers high-priority push notifications & updates active corridor ETA track. |
| **Tier 2 — Corroborated Multi-Source** (`TIER_2_CORROBORATED`) | `0.72 – 0.89` | ≥ 2 independent community sources within 20 min & 2 nm (e.g., Bluesky + WSF Ferry, or Reddit + West Seattle Blog), OR unreviewed high-confidence (`>= 0.85`) OrcaHello AI detection aligned with a known pod trajectory, OR Citizen App report with verified dorsal photo. | Amber-Cyan badge (**"Corroborated"**); triggers standard push alerts & plots on live map with ETA cone. |
| **Tier 3 — Single Community Report** (`TIER_3_COMMUNITY`) | `0.40 – 0.71` | Single uncorroborated social post (Reddit/Bluesky) or first-time Citizen App submission without photo confirmation. Automatically downgraded if text hints at porpoises/sea lions. | Muted Slate/Dashed pin (**"Unconfirmed Report"**); shown on map for spotters to verify; does **not** trigger loud push alerts until corroborated. |

---

## 6. Conservation & Washington State Legal Guardrails

SalishPulse is built with a **Conservation-First** mandate. Misused real-time whale tracking apps can inadvertently cause "whale crowding" by recreational boaters—harming endangered Southern Residents through underwater noise that masks their salmon echolocation.

### 6.1 Mandatory Washington State Law (Effective January 1, 2025 — SB 5371 / RCW 77.15.740)

1. **1,000-Yard Buffer for Southern Resident Killer Whales (SRKWs):**
   - Effective **January 1, 2025**, Washington law mandates that **all vessels** (motorized boats, sailboats, kayaks, paddleboards, personal watercraft) maintain a minimum distance of **1,000 yards** (more than half a mile / 914 meters) from any Southern Resident killer whale in Washington waters.
2. **Speed Limit (< 7 Knots) & Engine Disengagement:**
   - Slow to **7 knots or less** within 1,000 yards (and recommended within ½ nautical mile of any whales).
   - If whales unexpectedly approach within **400 yards**, operators must **disengage engines (shift to neutral)** or stop paddling until the whales pass beyond 400 yards, then move slowly away to restore the 1,000-yard buffer.
   - **Never position a vessel in the path of whales** ("leapfrogging" is illegal).
3. **200-Yard Buffer for Bigg's (Transient) Killer Whales (and Precautionary Rule):**
   - Federal MMPA / Be Whale Wise guidelines require staying at least **200 yards** from Bigg's/Transient killer whales (and at least 100–200 yards from humpback and gray whales).
   - **Crucial Precautionary Rule:** If a boater cannot positively identify whether killer whales are Southern Residents or Bigg's, **they must treat them as Southern Residents and maintain 1,000 yards.**
4. **Drones (UAVs) & Aircraft:**
   - Do not fly drones below **1,000 feet** above marine mammals (harassment under the federal MMPA). Drones are prohibited in Washington State Parks without special permits and restricted in Seattle City Parks.

### 6.2 Ethical Product Guardrails Built Into SalishPulse

- **Zero-Impact Shore-First UX:** Every alert routes users to **land-based viewing parks** (Alki, Lincoln Park, Point Robinson, etc.) with public transit & parking info—never boat launches or open-water GPS waypoints designed for vessel interception.
- **Anti-Harassment & Sensitive-Bay Protection:**
  - When SRKWs enter narrow, shallow resting/foraging bays (e.g., Quartermaster Harbor, Dyes Inlet, Port Madison) or when a newborn calf is present, SalishPulse can activate **"Conservation Buffer Mode"**: showing the general corridor and shore-viewing recommendations while coarsening exact open-water pin coordinates (~1 nm fuzz radius) and displaying an explicit 1,000-yard legal reminder banner.
- **Quiet Sound Awareness:** During the active **Quiet Sound voluntary commercial vessel slowdown** (Sept 2026 – Jan 2027 in Admiralty Inlet & North Puget Sound), display an educational indicator explaining how reduced vessel noise helps SRKWs hunt salmon and lets hydrophones hear their calls clearly.
- **Bidirectional Stewardship:** Encourage shore spotters to log sightings through SalishPulse's structured form, automatically contributing clean citizen-science data back to **Acartia** and **Orca Network** to assist WSF ferry slowdowns (WRAS) and NOAA/WDFW conservation research.
