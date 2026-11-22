/**
 * SalishPulse — Puget Sound & Salish Sea Orca Domain Dataset
 *
 * Pure, zero-dependency TypeScript domain module providing verified Puget Sound
 * viewing locations, Orcasound hydrophone nodes, maritime corridor geometry,
 * initial near-real-time sightings, and 2025+ Washington State Be Whale Wise
 * conservation regulations.
 */

export type Ecotype =
  | 'SRKW'
  | 'BIGGS'
  | 'HUMPBACK'
  | 'GRAY'
  | 'UNKNOWN_ORCA';

export type PodId =
  | 'J_POD'
  | 'K_POD'
  | 'L_POD'
  | 'MIXED_SRKW'
  | 'T65A'
  | 'T137'
  | 'T46'
  | 'T46B'
  | 'T49A'
  | 'T124A'
  | 'T36'
  | 'T99'
  | 'OTHER_BIGGS'
  | 'SOUNDERS'
  | 'UNKNOWN';

export type TravelDirection =
  | 'NORTHBOUND'
  | 'SOUTHBOUND'
  | 'EASTBOUND'
  | 'WESTBOUND'
  | 'MILLING'
  | 'FORAGING'
  | 'STATIONARY'
  | 'UNKNOWN';

export type ConfidenceTier =
  | 'TIER_1_VERIFIED'
  | 'TIER_2_CORROBORATED'
  | 'TIER_3_COMMUNITY';

export type SourceType =
  | 'ACARTIA'
  | 'ORCA_NETWORK'
  | 'ORCASOUND_HYDROPHONE'
  | 'ORCAHELLO_AI'
  | 'BLUESKY'
  | 'REDDIT'
  | 'WSF_FERRY'
  | 'WEST_SEATTLE_BLOG'
  | 'CITIZEN_APP';

export type ShorelineSide =
  | 'EAST_SHORE'
  | 'WEST_SHORE'
  | 'MID_CHANNEL'
  | 'UNKNOWN';

export type HydrophoneStatus = 'ONLINE' | 'DETECTING' | 'INTERMITTENT' | 'OFFLINE';

export interface ViewingSpot {
  id: string;
  name: string;
  shortName: string;
  region: string;
  lat: number;
  lng: number;
  waterway: string;
  typicalViewingDistance: string;
  description: string;
  parkingTip: string;
  transitTip: string;
  amenities: string[];
  elevationNote: string;
  visibilityNote: string;
  isWhaleTrailSite: boolean;
  /** Optional linked Orcasound hydrophone node ID if co-located */
  nearbyHydrophoneId?: string;
}

export interface HydrophoneNode {
  id: string;
  orcasoundSlug: string;
  locationName: string;
  waterway: string;
  lat: number;
  lng: number;
  status: HydrophoneStatus;
  streamUrl: string;
  orcaHelloUrl: string;
  detectionRangeNm: number;
  notes: string;
  lastDetectionIso?: string;
}

export interface Sighting {
  id: string;
  timestampIso: string;
  lat: number;
  lng: number;
  locationLabel: string;
  waterway: string;
  nearestSpotId: string;
  ecotype: Ecotype;
  podId: PodId;
  estimatedCount: number;
  countRange?: [number, number];
  direction: TravelDirection;
  speedKnots: number;
  shorelineSide: ShorelineSide;
  confidenceTier: ConfidenceTier;
  confidenceScore: number;
  sourceType: SourceType;
  sourceName: string;
  corroboratingSources: SourceType[];
  rawPostExcerpt: string;
  behaviors: string[];
  hasAdultMale: boolean;
  isAcousticDetection: boolean;
  hydrophoneNodeId?: string;
  notableIndividuals?: string[];
  distanceFromShoreYards?: number;
  verifiedBy?: string;
}

export interface CorridorEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  waterway: string;
  distanceNm: number;
  defaultSpeedKnots: number;
  bidirectional: boolean;
  /** Net current / seasonal routing tendency along this edge */
  tidalBiasNote: string;
}

export interface RegulationRule {
  id: string;
  title: string;
  appliesTo: Ecotype[] | 'ALL_VESSELS' | 'DRONES_AND_SHORE';
  minDistanceYards?: number;
  maxSpeedKnots?: number;
  effectiveDate: string;
  legalBasis: string;
  severity: 'MANDATORY_LAW' | 'FEDERAL_GUIDELINE' | 'ETHICAL_BEST_PRACTICE';
  summary: string;
  actionableGuidance: string[];
}

/**
 * 12 Premier Seattle & Puget Sound Shore-Based Orca Viewing Locations
 * Ordered roughly by Seattle proximity and Puget Sound corridor coverage.
 */
export const VIEWING_SPOTS: ViewingSpot[] = [
  {
    id: 'alki-point',
    name: 'Alki Point Lighthouse & Beach',
    shortName: 'Alki Point',
    region: 'West Seattle',
    lat: 47.5764,
    lng: -122.4206,
    waterway: 'Puget Sound Main Basin / Elliott Bay Mouth',
    typicalViewingDistance: '150 yds – 1.5 mi',
    description:
      'West Seattle’s iconic headland offering sweeping 270-degree views from West Point across Elliott Bay to Bainbridge Island and south toward Blake Island.',
    parkingTip:
      'Free street parking along Alki Ave SW and Beach Dr SW; fills within 20 minutes during active J-Pod alerts.',
    transitTip:
      'King County Water Taxi to Seacrest + free Shuttle 775, or RapidRide C Line + Metro Bus 50.',
    amenities: ['Restrooms', 'Paved Seawall', 'Benches', 'Coffee & Food Nearby', 'ADA Accessible'],
    elevationNote: 'Sea-level seawall (~12 ft); bring 8x42 binoculars for mid-channel transits.',
    visibilityNote:
      'Excellent sightlines north to West Point and west to Bainbridge; exposed to winter southerly winds.',
    isWhaleTrailSite: true,
  },
  {
    id: 'constellation-park',
    name: 'Constellation Park (Charles Richey Sr. Viewpoint)',
    shortName: 'Constellation Park',
    region: 'West Seattle',
    lat: 47.5702,
    lng: -122.4150,
    waterway: 'Puget Sound Main Basin / East Passage Entrance',
    typicalViewingDistance: '100 yds – 1.2 mi',
    description:
      'Rocky intertidal marine reserve just south of Alki Point where southbound orcas frequently hug the West Seattle shoreline before rounding toward Lincoln Park.',
    parkingTip:
      'Limited street pullouts along Beach Dr SW; overflow parking on side streets east of Beach Dr.',
    transitTip: 'Metro Bus 50 stops within a 10-minute walk along Alki Ave SW / 63rd Ave SW.',
    amenities: ['Paved Promenade', 'Benches', 'Tidepool Interpretive Signs', 'ADA Accessible'],
    elevationNote: 'Low seawall (~15 ft) with unobstructed southwest horizon toward Blake Island.',
    visibilityNote:
      'Ideal close-pass viewing when whales favor the east (Seattle) shoreline; low glare in morning light.',
    isWhaleTrailSite: true,
  },
  {
    id: 'lincoln-park',
    name: 'Lincoln Park (Point Williams)',
    shortName: 'Lincoln Park',
    region: 'West Seattle',
    lat: 47.5305,
    lng: -122.3982,
    waterway: 'East Passage / Main Basin',
    typicalViewingDistance: '100 yds – 1.0 mi',
    description:
      'Point Williams juts directly into Puget Sound just north of the Fauntleroy Ferry dock, giving shore viewers both sea-level seawall and high forested bluff vantage points.',
    parkingTip:
      'Large free North and South parking lots off Fauntleroy Way SW; allow 8–10 minutes to walk down to Point Williams.',
    transitTip: 'RapidRide C Line stops directly outside the main Lincoln Park entrance.',
    amenities: ['Restrooms', 'Bluff & Beach Trails', 'Picnic Shelters', 'Paved Seawall'],
    elevationNote:
      'Dual-level viewing: sea-level seawall (10 ft) plus 120 ft western bluff trail for wide-angle scanning.',
    visibilityNote:
      'Clear sightlines across to Vashon Island North End and Blake Island; easy to spot whales choosing East vs. Colvos Passage.',
    isWhaleTrailSite: true,
  },
  {
    id: 'discovery-park',
    name: 'Discovery Park (West Point Lighthouse)',
    shortName: 'West Point',
    region: 'Magnolia, Seattle',
    lat: 47.6619,
    lng: -122.4357,
    waterway: 'Puget Sound Main Basin',
    typicalViewingDistance: '200 yds – 1.5 mi',
    description:
      'Seattle’s westernmost promontory separating the Main Basin from Elliott Bay. First major Seattle checkpoint for southbound pods coming down from Edmonds.',
    parkingTip:
      'Free North and South Discovery Park lots (~1.4 mi hike down to lighthouse); limited ADA beach parking passes available at the Visitor Center.',
    transitTip: 'Metro Bus 24 or 33 to Discovery Park East Entrance.',
    amenities: ['Restrooms at Beach', 'Lighthouse Beach', 'Bluff Overlooks', 'Visitor Center'],
    elevationNote:
      'Both sea-level sand spit and 280 ft South Bluff overlook (exceptional for spotting distant blows).',
    visibilityNote:
      '300-degree marine panorama north to Edmonds/Shilshole and south to Alki; allow 25 min hike from parking.',
    isWhaleTrailSite: true,
  },
  {
    id: 'golden-gardens',
    name: 'Golden Gardens Park',
    shortName: 'Golden Gardens',
    region: 'Ballard, Seattle',
    lat: 47.6908,
    lng: -122.4036,
    waterway: 'Puget Sound Main Basin (Shilshole Bay)',
    typicalViewingDistance: '400 yds – 2.0 mi',
    description:
      'Expansive sandy shoreline and pier north of Shilshole Bay Marina with wide sightlines across the Main Basin toward Bainbridge Island and Point Jefferson.',
    parkingTip:
      'Large free beachfront parking lot plus upper overflow lot off Seaview Pl NW.',
    transitTip: 'Metro Bus 45 terminates nearby at Loyal Heights (15-min walk down stairs) or seasonal Bus 40.',
    amenities: ['Restrooms', 'Wide Beach', 'Pier', 'Picnic Tables', 'ADA Accessible'],
    elevationNote: 'Sea-level sandy beach (~10 ft) with elevated forested hillside trail above Seaview Pl.',
    visibilityNote:
      'Whales often pass slightly farther offshore here (~0.75–1.5 mi); binoculars strongly recommended.',
    isWhaleTrailSite: true,
  },
  {
    id: 'edmonds-bracketts-landing',
    name: "Edmonds Brackett's Landing North & Pier",
    shortName: 'Edmonds Waterfront',
    region: 'Edmonds',
    lat: 47.8136,
    lng: -122.3826,
    waterway: 'Puget Sound Main Basin (North)',
    typicalViewingDistance: '100 yds – 1.2 mi',
    description:
      'Marine sanctuary and underwater dive park immediately north of the Edmonds–Kingston ferry terminal. A prime hotspot for Bigg’s killer whales hunting harbor seals and SRKWs transiting south.',
    parkingTip:
      'Free and paid lots along Railroad Ave, Main St, and Sunset Ave; easy walk from downtown Edmonds.',
    transitTip: 'Sounder N Line train (weekdays) and Community Transit Swift / Bus 102 & 130.',
    amenities: ['Restrooms', 'Fishing Pier', 'Paved Waterfront Path', 'Coffee & Dining', 'ADA Accessible'],
    elevationNote: 'Sea-level sandy beach + elevated Sunset Ave overlook (~50 ft) just two blocks north.',
    visibilityNote:
      'Tight cross-sound view to Kingston / Point Jefferson; ferry traffic provides helpful distance reference points.',
    isWhaleTrailSite: true,
  },
  {
    id: 'mukilteo-lighthouse',
    name: 'Mukilteo Lighthouse Park',
    shortName: 'Mukilteo Lighthouse',
    region: 'Mukilteo',
    lat: 47.9488,
    lng: -122.3052,
    waterway: 'Possession Sound / Saratoga Passage',
    typicalViewingDistance: '100 yds – 1.0 mi',
    description:
      'Situated at the narrow gateway between Possession Sound, Saratoga Passage, and the Main Basin. Famous for spring "Sounders" gray whales, Bigg’s orcas, and SRKWs rounding Possession Point.',
    parkingTip:
      'Paid park lot directly adjacent to the lighthouse and Mukilteo–Clinton ferry terminal.',
    transitTip: 'Sounder N Line to Mukilteo Station (5-min walk) or Community Transit Bus 113.',
    amenities: ['Restrooms', 'Boardwalk', 'Picnic Shelters', 'Lighthouse Grounds', 'ADA Accessible'],
    elevationNote: 'Sea-level beach & boardwalk (~12 ft) directly facing Whidbey Island.',
    visibilityNote:
      'Narrow channel (< 2 nm across to Clinton) means high probability of close-range dorsal fin sightings.',
    isWhaleTrailSite: true,
  },
  {
    id: 'point-robinson',
    name: 'Point Robinson Park & Lighthouse',
    shortName: 'Point Robinson',
    region: 'Vashon / Maury Island',
    lat: 47.3881,
    lng: -122.3741,
    waterway: 'East Passage',
    typicalViewingDistance: '50 yds – 0.8 mi',
    description:
      'Easternmost tip of Maury Island and arguably Central Puget Sound’s premier shore-based orca spot. Deep water drops off right past the lighthouse shoal, routinely bringing whales within 100 yards of shore.',
    parkingTip:
      'Free upper parking lot (10-min paved walk downhill to lighthouse); lower lot reserved for ADA/drop-off.',
    transitTip: 'WSF Fauntleroy–Vashon or Point Defiance–Tahlequah ferry; Metro Bus 118 connects Vashon Hwy.',
    amenities: ['Restrooms', 'Lighthouse Beach', 'Benches', 'Wooded Trails', 'Whale Trail Signage'],
    elevationNote: 'Sea-level point (~8 ft) plus upper bluff benches (~80 ft) overlooking all of East Passage.',
    visibilityNote:
      'Unrivaled 200-degree view of East Passage from Three Tree Point to Redondo / Commencement Bay.',
    isWhaleTrailSite: true,
    nearbyHydrophoneId: 'mast-center',
  },
  {
    id: 'owen-beach',
    name: 'Owen Beach (Point Defiance Park)',
    shortName: 'Owen Beach',
    region: 'Tacoma',
    lat: 47.3155,
    lng: -122.5298,
    waterway: 'Dalco Passage / Commencement Bay',
    typicalViewingDistance: '100 yds – 0.8 mi',
    description:
      'Renovated Tacoma shoreline facing southern Vashon Island across narrow Dalco Passage. Whales funnel closely here when transiting between East Passage, Commencement Bay, and the Tacoma Narrows.',
    parkingTip:
      'Free beachfront lot at Owen Beach (note: Five Mile Drive outer loop is closed to vehicles).',
    transitTip: 'Pierce Transit Bus 10 & 11 to Point Defiance Ferry/Park entrance (15-min walk down Promenade).',
    amenities: ['Restrooms', 'Paved Promenade', 'Covered Pavilion', 'Kayak Launch', 'ADA Accessible'],
    elevationNote: 'Sea-level promenade (~15 ft) with high cliff overlooks along nearby Five Mile Drive foot trail.',
    visibilityNote:
      'Narrow 1.3 nm constriction across Dalco Passage to Tahlequah makes spotting passing fins straightforward.',
    isWhaleTrailSite: true,
  },
  {
    id: 'fort-ward',
    name: 'Fort Ward Park',
    shortName: 'Fort Ward',
    region: 'Bainbridge Island',
    lat: 47.5754,
    lng: -122.5273,
    waterway: 'Rich Passage / West Main Basin / Colvos Approach',
    typicalViewingDistance: '150 yds – 1.2 mi',
    description:
      'Essential west-side counterpart to Alki and Lincoln Park. Catches pods hugging the Bainbridge/Kitsap shoreline, hunting near Blake Island, or looping northbound out of Colvos Passage.',
    parkingTip:
      'Free lower boat-launch lot and upper lot off Pleasant Beach Dr NE; ~15 min drive from Bainbridge Ferry.',
    transitTip: 'WSF Seattle–Bainbridge ferry + Kitsap Transit BI Ride on-demand shuttle.',
    amenities: ['Restrooms', 'Paved Waterfront Trail', 'Benches', 'Historic Batteries', 'ADA Accessible'],
    elevationNote: 'Low waterfront trail (~15 ft) looking east across the Main Basin to West Seattle and south to Blake Island.',
    visibilityNote:
      'Top choice when Seattle spotters report whales "far on the west/Bainbridge side."',
    isWhaleTrailSite: true,
  },
  {
    id: 'bush-point',
    name: 'Bush Point Lighthouse & Boat Launch',
    shortName: 'Bush Point',
    region: 'Whidbey Island',
    lat: 48.0315,
    lng: -122.6075,
    waterway: 'Admiralty Inlet',
    typicalViewingDistance: '75 yds – 1.0 mi',
    description:
      'Strategic pinch point on western Whidbey Island and home to a vital Orcasound hydrophone. Virtually every Southern Resident pod entering Puget Sound passes directly off this beach.',
    parkingTip:
      'Free gravel parking at WDFW Bush Point boat launch / public beach access off S Bush Point Rd (Discover Pass required for WDFW launch lot).',
    transitTip: 'WSF Mukilteo–Clinton ferry + ~25 min scenic drive north on Hwy 525 & Bush Point Rd.',
    amenities: ['Beach Access', 'Orcasound Hydrophone Site', 'Interpretive Sign', 'Porta-Potty (Seasonal)'],
    elevationNote: 'Sea-level cobble beach (~8 ft) facing Marrowstone Island and the Olympic Mountains.',
    visibilityNote:
      'Strong tidal rips and open strait winds; dress warmly. Whales frequently pass remarkably close to the point.',
    isWhaleTrailSite: true,
    nearbyHydrophoneId: 'bush-point',
  },
  {
    id: 'mast-center',
    name: 'MaST Center Aquarium & Redondo Beach',
    shortName: 'MaST / Redondo',
    region: 'Des Moines',
    lat: 47.3489,
    lng: -122.3257,
    waterway: 'East Passage / Poverty Bay',
    typicalViewingDistance: '150 yds – 1.2 mi',
    description:
      'Highline College’s Marine Science and Technology Center on Redondo Pier directly across East Passage from Point Robinson. Hosts Puget Sound’s southernmost active Orcasound hydrophone.',
    parkingTip:
      'Paid waterfront parking lot and street parking along Redondo Beach Dr S.',
    transitTip: 'King County Metro Bus 165 / 190 nearby; easy paved boardwalk access.',
    amenities: ['Restrooms', 'Public Pier', 'Boardwalk', 'Free Saturday Aquarium', 'ADA Accessible'],
    elevationNote: 'Elevated pier deck (~18 ft above water) with unobstructed west/northwest view to Point Robinson.',
    visibilityNote:
      'Pair live MaST Center hydrophone audio on your phone with binoculars scanning toward Point Robinson.',
    isWhaleTrailSite: true,
    nearbyHydrophoneId: 'mast-center',
  },
];

/**
 * 6 Real Orcasound Hydrophone Nodes across Puget Sound, Admiralty Inlet, and the San Juan Islands
 */
export const HYDROPHONE_NODES: HydrophoneNode[] = [
  {
    id: 'mast-center',
    orcasoundSlug: 'mast-center',
    locationName: 'MaST Center (Des Moines)',
    waterway: 'East Passage / Poverty Bay',
    lat: 47.3489,
    lng: -122.3257,
    status: 'DETECTING',
    streamUrl: 'https://live.orcasound.net/listen/mast-center',
    orcaHelloUrl: 'https://aifororcas.azurewebsites.net/',
    detectionRangeNm: 5.5,
    notes:
      'Southernmost active Puget Sound hydrophone mounted at Highline College MaST Pier; ideal for detecting SRKWs descending East Passage past Three Tree Point and Point Robinson.',
    lastDetectionIso: '2026-11-22T16:49:00Z',
  },
  {
    id: 'bush-point',
    orcasoundSlug: 'bush-point',
    locationName: 'Bush Point (Whidbey Island)',
    waterway: 'Admiralty Inlet',
    lat: 48.0315,
    lng: -122.6075,
    status: 'ONLINE',
    streamUrl: 'https://live.orcasound.net/listen/bush-point',
    orcaHelloUrl: 'https://aifororcas.azurewebsites.net/',
    detectionRangeNm: 6.0,
    notes:
      'Premier early-warning acoustic gate for Seattle (~3–4.5 hours north of West Point); monitors the eastern pinch point of Admiralty Inlet.',
    lastDetectionIso: '2026-11-22T11:20:00Z',
  },
  {
    id: 'port-townsend',
    orcasoundSlug: 'port-townsend',
    locationName: 'Port Townsend Marine Science Center',
    waterway: 'Admiralty Inlet (West / Fort Worden)',
    lat: 48.1356,
    lng: -122.7603,
    status: 'ONLINE',
    streamUrl: 'https://live.orcasound.net/listen/port-townsend',
    orcaHelloUrl: 'https://aifororcas.azurewebsites.net/',
    detectionRangeNm: 6.5,
    notes:
      'Located at Fort Worden Pier; first Puget Sound gateway hydrophone for pods entering Admiralty Inlet from the Strait of Juan de Fuca.',
    lastDetectionIso: '2026-11-22T09:35:00Z',
  },
  {
    id: 'orcasound-lab',
    orcasoundSlug: 'orcasound-lab',
    locationName: 'Orcasound Lab (San Juan Island)',
    waterway: 'Haro Strait',
    lat: 48.5583,
    lng: -123.1736,
    status: 'ONLINE',
    streamUrl: 'https://live.orcasound.net/listen/orcasound-lab',
    orcaHelloUrl: 'https://aifororcas.azurewebsites.net/',
    detectionRangeNm: 7.0,
    notes:
      'Flagship west-side San Juan Island research hydrophone array monitoring Haro Strait summer/fall salmon corridors.',
  },
  {
    id: 'north-san-juan-channel',
    orcasoundSlug: 'north-san-juan-channel',
    locationName: 'North San Juan Channel',
    waterway: 'San Juan Channel',
    lat: 48.5913,
    lng: -123.0588,
    status: 'ONLINE',
    streamUrl: 'https://live.orcasound.net/listen/north-san-juan-channel',
    orcaHelloUrl: 'https://aifororcas.azurewebsites.net/',
    detectionRangeNm: 4.5,
    notes:
      'Monitors interior San Juan Islands transit north of Friday Harbor and Point Caution.',
  },
  {
    id: 'andrews-bay',
    orcasoundSlug: 'andrews-bay',
    locationName: 'Andrews Bay (San Juan Island)',
    waterway: 'Haro Strait',
    lat: 48.5453,
    lng: -123.1645,
    status: 'ONLINE',
    streamUrl: 'https://live.orcasound.net/listen/andrews-bay',
    orcaHelloUrl: 'https://aifororcas.azurewebsites.net/',
    detectionRangeNm: 6.5,
    notes:
      'Haro Strait hydrophone positioned between Orcasound Lab and Lime Kiln Point State Park.',
  },
];

/**
 * Puget Sound Waterway Corridor Graph for realistic nautical-mile ETA calculations
 * Node IDs correspond to VIEWING_SPOTS and HYDROPHONE_NODES IDs.
 */
export const CORRIDOR_EDGES: CorridorEdge[] = [
  {
    id: 'port-townsend-to-bush-point',
    fromNodeId: 'port-townsend',
    toNodeId: 'bush-point',
    waterway: 'Admiralty Inlet',
    distanceNm: 9.2,
    defaultSpeedKnots: 5.5,
    bidirectional: true,
    tidalBiasNote: 'Strong 2–4 kn flood/ebb tidal currents; southbound flood pushes pods faster into Puget Sound.',
  },
  {
    id: 'bush-point-to-edmonds',
    fromNodeId: 'bush-point',
    toNodeId: 'edmonds-bracketts-landing',
    waterway: 'Admiralty Inlet -> North Main Basin',
    distanceNm: 16.5,
    defaultSpeedKnots: 5.5,
    bidirectional: true,
    tidalBiasNote: 'Primary SRKW highway past Point No Point and Possession Point.',
  },
  {
    id: 'bush-point-to-mukilteo',
    fromNodeId: 'bush-point',
    toNodeId: 'mukilteo-lighthouse',
    waterway: 'Admiralty Inlet -> Possession Sound',
    distanceNm: 15.8,
    defaultSpeedKnots: 5.0,
    bidirectional: true,
    tidalBiasNote: 'Common branch for Bigg’s orcas and spring Gray whales entering Saratoga Passage.',
  },
  {
    id: 'edmonds-to-mukilteo',
    fromNodeId: 'edmonds-bracketts-landing',
    toNodeId: 'mukilteo-lighthouse',
    waterway: 'Possession Sound',
    distanceNm: 9.5,
    defaultSpeedKnots: 4.5,
    bidirectional: true,
    tidalBiasNote: 'Frequent Bigg’s hunting corridor along the Everett/Mukilteo shoreline.',
  },
  {
    id: 'edmonds-to-golden-gardens',
    fromNodeId: 'edmonds-bracketts-landing',
    toNodeId: 'golden-gardens',
    waterway: 'Puget Sound Main Basin',
    distanceNm: 7.5,
    defaultSpeedKnots: 5.2,
    bidirectional: true,
    tidalBiasNote: 'Steady open-basin transit; pods may hug either Edmonds/Carkeek or Kitsap shore.',
  },
  {
    id: 'golden-gardens-to-discovery-park',
    fromNodeId: 'golden-gardens',
    toNodeId: 'discovery-park',
    waterway: 'Puget Sound Main Basin',
    distanceNm: 2.1,
    defaultSpeedKnots: 5.2,
    bidirectional: true,
    tidalBiasNote: 'Short transit past Meadow Point and Shilshole Bay to West Point Lighthouse.',
  },
  {
    id: 'discovery-park-to-alki-point',
    fromNodeId: 'discovery-park',
    toNodeId: 'alki-point',
    waterway: 'Puget Sound Main Basin / Elliott Bay Mouth',
    distanceNm: 5.2,
    defaultSpeedKnots: 5.0,
    bidirectional: true,
    tidalBiasNote: 'Crosses Seattle–Bainbridge ferry lane; occasional foraging detour east into Elliott Bay.',
  },
  {
    id: 'alki-point-to-fort-ward',
    fromNodeId: 'alki-point',
    toNodeId: 'fort-ward',
    waterway: 'Puget Sound Main Basin (Cross-Channel)',
    distanceNm: 4.5,
    defaultSpeedKnots: 4.5,
    bidirectional: true,
    tidalBiasNote: 'Cross-channel lateral movement between West Seattle and Bainbridge / Blake Island.',
  },
  {
    id: 'alki-point-to-constellation-park',
    fromNodeId: 'alki-point',
    toNodeId: 'constellation-park',
    waterway: 'Main Basin / West Seattle Shore',
    distanceNm: 0.45,
    defaultSpeedKnots: 4.8,
    bidirectional: true,
    tidalBiasNote: 'Immediate continuation south along Beach Dr SW.',
  },
  {
    id: 'constellation-park-to-lincoln-park',
    fromNodeId: 'constellation-park',
    toNodeId: 'lincoln-park',
    waterway: 'Main Basin -> East Passage Approach',
    distanceNm: 2.5,
    defaultSpeedKnots: 4.8,
    bidirectional: true,
    tidalBiasNote: 'Prime West Seattle shore-spotter stretch; whales pass close off Point Williams.',
  },
  {
    id: 'lincoln-park-to-point-robinson',
    fromNodeId: 'lincoln-park',
    toNodeId: 'point-robinson',
    waterway: 'East Passage',
    distanceNm: 8.6,
    defaultSpeedKnots: 5.0,
    bidirectional: true,
    tidalBiasNote: 'East Passage carries a net southward current—strongly favored for southbound SRKW transits.',
  },
  {
    id: 'point-robinson-to-mast-center',
    fromNodeId: 'point-robinson',
    toNodeId: 'mast-center',
    waterway: 'East Passage / Poverty Bay',
    distanceNm: 3.0,
    defaultSpeedKnots: 4.8,
    bidirectional: true,
    tidalBiasNote: 'Acoustic sweet spot: MaST Center hydrophone typically picks up SRKW calls 20–40 min ahead.',
  },
  {
    id: 'point-robinson-to-owen-beach',
    fromNodeId: 'point-robinson',
    toNodeId: 'owen-beach',
    waterway: 'East Passage -> Dalco Passage',
    distanceNm: 9.2,
    defaultSpeedKnots: 5.0,
    bidirectional: true,
    tidalBiasNote: 'Leads into Commencement Bay and Tacoma Narrows; pods often loop north via Colvos Passage ("Vashon Loop").',
  },
  {
    id: 'owen-beach-to-fort-ward',
    fromNodeId: 'owen-beach',
    toNodeId: 'fort-ward',
    waterway: 'Colvos Passage (Northbound Loop)',
    distanceNm: 15.8,
    defaultSpeedKnots: 5.5,
    bidirectional: true,
    tidalBiasNote: 'Colvos Passage flows predominantly northward—classic northbound exit lane west of Vashon Island.',
  },
];

/**
 * 8 Realistic, Geographically & Chronologically Coherent Initial Sightings
 * Scenario: Autumn chum-salmon morning (Nov 22, 2026) showing J-Pod moving
 * southbound from Bush Point Hydrophone -> West Point -> Elliott Bay -> Alki ->
 * Constellation Park -> Lincoln Park -> MaST Center acoustic detection, alongside
 * a separate Bigg's T65A family hunting off Edmonds Brackett's Landing.
 */
export const INITIAL_SIGHTINGS: Sighting[] = [
  {
    id: 'sighting-mast-acoustic-01',
    timestampIso: '2026-11-22T16:49:00Z',
    lat: 47.3489,
    lng: -122.3257,
    locationLabel: 'MaST Center Hydrophone (Redondo / East Passage)',
    waterway: 'East Passage / Poverty Bay',
    nearestSpotId: 'mast-center',
    ecotype: 'SRKW',
    podId: 'J_POD',
    estimatedCount: 18,
    countRange: [15, 22],
    direction: 'SOUTHBOUND',
    speedKnots: 4.8,
    shorelineSide: 'MID_CHANNEL',
    confidenceTier: 'TIER_1_VERIFIED',
    confidenceScore: 0.93,
    sourceType: 'ORCAHELLO_AI',
    sourceName: 'Orcasound / OrcaHello Live Acoustic',
    corroboratingSources: ['ORCASOUND_HYDROPHONE', 'ORCA_NETWORK'],
    rawPostExcerpt:
      '[OrcaHello Verified — 94% model confidence] Faint but distinct J-Pod S1 discrete calls and foraging echolocation clicks detected on MaST Center hydrophone as lead group descends East Passage toward Point Robinson.',
    behaviors: ['VOCALIZING', 'ECHOLOCATING', 'FORAGING'],
    hasAdultMale: true,
    isAcousticDetection: true,
    hydrophoneNodeId: 'mast-center',
    verifiedBy: 'OrcaHello Human Moderator',
  },
  {
    id: 'sighting-lincoln-park-02',
    timestampIso: '2026-11-22T16:44:00Z',
    lat: 47.5305,
    lng: -122.4045,
    locationLabel: 'Off Point Williams / Lincoln Park',
    waterway: 'East Passage / Main Basin',
    nearestSpotId: 'lincoln-park',
    ecotype: 'SRKW',
    podId: 'J_POD',
    estimatedCount: 20,
    countRange: [18, 23],
    direction: 'SOUTHBOUND',
    speedKnots: 4.8,
    shorelineSide: 'EAST_SHORE',
    confidenceTier: 'TIER_1_VERIFIED',
    confidenceScore: 0.96,
    sourceType: 'ORCA_NETWORK',
    sourceName: 'Orca Network (via Acartia)',
    corroboratingSources: ['ACARTIA', 'CITIZEN_APP'],
    rawPostExcerpt:
      'J-Pod main group (J16s, J19s, J27 Blackberry) steadily southbound past Point Williams / Lincoln Park about 400 yds off the Seattle seawall, committing to East Passage toward Three Tree Point and Point Robinson.',
    behaviors: ['TRAVELING', 'FORAGING', 'BREACHING'],
    hasAdultMale: true,
    isAcousticDetection: false,
    notableIndividuals: ['J27 Blackberry', 'J16 Slick', 'J19 Shachi'],
    distanceFromShoreYards: 400,
    verifiedBy: 'Orca Network Field Naturalist',
  },
  {
    id: 'sighting-edmonds-biggs-03',
    timestampIso: '2026-11-22T16:32:00Z',
    lat: 47.8152,
    lng: -122.3880,
    locationLabel: "Off Edmonds Brackett's Landing North",
    waterway: 'Puget Sound Main Basin (North)',
    nearestSpotId: 'edmonds-bracketts-landing',
    ecotype: 'BIGGS',
    podId: 'T65A',
    estimatedCount: 5,
    countRange: [5, 5],
    direction: 'MILLING',
    speedKnots: 2.5,
    shorelineSide: 'EAST_SHORE',
    confidenceTier: 'TIER_2_CORROBORATED',
    confidenceScore: 0.86,
    sourceType: 'CITIZEN_APP',
    sourceName: 'SalishPulse Citizen Spotter + Bluesky',
    corroboratingSources: ['BLUESKY', 'REDDIT'],
    rawPostExcerpt:
      'Tight group of 5 Bigg’s killer whales (definitely the T65As — towering pointed dorsal of T65A2!) circling right off the Edmonds Underwater Park reef hunting harbor seals, super quiet and unpredictable direction.',
    behaviors: ['HUNTING', 'MILLING', 'SURFACE_STEALTH'],
    hasAdultMale: true,
    isAcousticDetection: false,
    notableIndividuals: ['T65A Artemis', 'T65A2 Ooxjaa'],
    distanceFromShoreYards: 300,
  },
  {
    id: 'sighting-constellation-04',
    timestampIso: '2026-11-22T16:22:00Z',
    lat: 47.5700,
    lng: -122.4210,
    locationLabel: 'Constellation Park / Beach Dr SW',
    waterway: 'Puget Sound Main Basin / East Passage Entrance',
    nearestSpotId: 'constellation-park',
    ecotype: 'SRKW',
    podId: 'J_POD',
    estimatedCount: 8,
    countRange: [6, 10],
    direction: 'SOUTHBOUND',
    speedKnots: 4.9,
    shorelineSide: 'EAST_SHORE',
    confidenceTier: 'TIER_3_COMMUNITY',
    confidenceScore: 0.68,
    sourceType: 'REDDIT',
    sourceName: 'Reddit r/Seattle',
    corroboratingSources: [],
    rawPostExcerpt:
      'Run to Beach Drive!! At least 6-8 orcas cruising south right past Constellation Park super close to shore, heading straight toward Lincoln Park!',
    behaviors: ['TRAVELING', 'TAIL_SLAPPING'],
    hasAdultMale: true,
    isAcousticDetection: false,
    distanceFromShoreYards: 350,
  },
  {
    id: 'sighting-alki-point-05',
    timestampIso: '2026-11-22T16:12:00Z',
    lat: 47.5782,
    lng: -122.4268,
    locationLabel: 'Alki Point Lighthouse',
    waterway: 'Puget Sound Main Basin / Elliott Bay Mouth',
    nearestSpotId: 'alki-point',
    ecotype: 'SRKW',
    podId: 'J_POD',
    estimatedCount: 16,
    countRange: [14, 20],
    direction: 'SOUTHBOUND',
    speedKnots: 5.0,
    shorelineSide: 'EAST_SHORE',
    confidenceTier: 'TIER_2_CORROBORATED',
    confidenceScore: 0.89,
    sourceType: 'BLUESKY',
    sourceName: 'Bluesky #orcas + West Seattle Blog',
    corroboratingSources: ['WEST_SEATTLE_BLOG'],
    rawPostExcerpt:
      'Huge morning at Alki Point Lighthouse! J-Pod spread across the east side of the channel moving steadily southbound (~5 kn), multiple spyhops, a full breach, and J27’s massive dorsal clear from the seawall! #Seattle #orcas #PugetSound',
    behaviors: ['TRAVELING', 'BREACHING', 'SPYHOPPING', 'FORAGING'],
    hasAdultMale: true,
    isAcousticDetection: false,
    notableIndividuals: ['J27 Blackberry', 'J38 Cookie'],
    distanceFromShoreYards: 450,
  },
  {
    id: 'sighting-elliott-bay-ferry-06',
    timestampIso: '2026-11-22T15:42:00Z',
    lat: 47.6120,
    lng: -122.4480,
    locationLabel: 'Seattle–Bainbridge Ferry Lane (Mid-Channel)',
    waterway: 'Puget Sound Main Basin / Elliott Bay Approach',
    nearestSpotId: 'alki-point',
    ecotype: 'SRKW',
    podId: 'J_POD',
    estimatedCount: 18,
    countRange: [15, 22],
    direction: 'SOUTHBOUND',
    speedKnots: 5.2,
    shorelineSide: 'MID_CHANNEL',
    confidenceTier: 'TIER_2_CORROBORATED',
    confidenceScore: 0.87,
    sourceType: 'WSF_FERRY',
    sourceName: 'WSF M/V Tacoma (WRAS) + Bluesky',
    corroboratingSources: ['BLUESKY'],
    rawPostExcerpt:
      'Captain just announced whales ahead on the Bainbridge–Seattle crossing! M/V Tacoma slowed to a crawl while ~18 orcas crossed southbound toward Alki Point in glassy water.',
    behaviors: ['TRAVELING', 'FORAGING'],
    hasAdultMale: true,
    isAcousticDetection: false,
    distanceFromShoreYards: 1800,
  },
  {
    id: 'sighting-west-point-07',
    timestampIso: '2026-11-22T15:10:00Z',
    lat: 47.6635,
    lng: -122.4460,
    locationLabel: 'Off Discovery Park / West Point Lighthouse',
    waterway: 'Puget Sound Main Basin',
    nearestSpotId: 'discovery-park',
    ecotype: 'SRKW',
    podId: 'J_POD',
    estimatedCount: 20,
    countRange: [18, 24],
    direction: 'SOUTHBOUND',
    speedKnots: 5.5,
    shorelineSide: 'MID_CHANNEL',
    confidenceTier: 'TIER_1_VERIFIED',
    confidenceScore: 0.96,
    sourceType: 'ACARTIA',
    sourceName: 'Acartia Cooperative (Orca Network)',
    corroboratingSources: ['ORCA_NETWORK'],
    rawPostExcerpt:
      'Confirmed Southern Residents (J-Pod) passing abeam of West Point Lighthouse southbound at ~5.5 knots, spread 1.5 miles across the shipping lane chasing chum salmon.',
    behaviors: ['TRAVELING', 'FORAGING'],
    hasAdultMale: true,
    isAcousticDetection: false,
    notableIndividuals: ['J26 Mike', 'J27 Blackberry'],
    distanceFromShoreYards: 900,
    verifiedBy: 'Acartia / Orca Network Verified Observer',
  },
  {
    id: 'sighting-bush-point-acoustic-08',
    timestampIso: '2026-11-22T11:20:00Z',
    lat: 48.0315,
    lng: -122.6075,
    locationLabel: 'Bush Point Hydrophone (Whidbey Island)',
    waterway: 'Admiralty Inlet',
    nearestSpotId: 'bush-point',
    ecotype: 'SRKW',
    podId: 'J_POD',
    estimatedCount: 22,
    countRange: [18, 25],
    direction: 'SOUTHBOUND',
    speedKnots: 6.0,
    shorelineSide: 'EAST_SHORE',
    confidenceTier: 'TIER_1_VERIFIED',
    confidenceScore: 0.98,
    sourceType: 'ORCASOUND_HYDROPHONE',
    sourceName: 'Orcasound Bush Point Hydrophone',
    corroboratingSources: ['ORCAHELLO_AI'],
    rawPostExcerpt:
      '[OrcaHello Verified — 99% confidence] Clear, loud J-Pod S1 and S4 calls plus rapid echolocation click trains recorded for 24 minutes at Bush Point as pod entered Puget Sound on incoming flood tide.',
    behaviors: ['VOCALIZING', 'FAST_TRANSIT'],
    hasAdultMale: true,
    isAcousticDetection: true,
    hydrophoneNodeId: 'bush-point',
    verifiedBy: 'Orcasound / OrcaHello Lead Moderator',
  },
];

/**
 * Washington State 2025+ Be Whale Wise Legal & Conservation Regulations
 * Reflects WA Senate Bill 5371 (RCW 77.15.740), effective January 1, 2025.
 */
export const BE_WHALE_WISE_RULES: RegulationRule[] = [
  {
    id: 'srkw-1000-yard-buffer',
    title: '1,000-Yard Mandatory Buffer from Southern Resident Killer Whales',
    appliesTo: ['SRKW'],
    minDistanceYards: 1000,
    effectiveDate: '2025-01-01',
    legalBasis: 'Washington State Law — SB 5371 / RCW 77.15.740',
    severity: 'MANDATORY_LAW',
    summary:
      'All motorized and non-motorized vessels (including boats, sailboats, kayaks, and paddleboards) must stay at least 1,000 yards (over 1/2 mile) away from endangered Southern Resident Killer Whales in Washington waters.',
    actionableGuidance: [
      'Maintain at least 1,000 yards separation from all sides of any SRKW pod.',
      'Never position your vessel in the path of traveling whales ("leapfrogging" is illegal).',
      'Commercial whale watch vessels are likewise prohibited from approaching within 1,000 yards of SRKWs.',
    ],
  },
  {
    id: 'slow-speed-and-disengage',
    title: '7-Knot Speed Limit & Disengage Engines Within 400 Yards',
    appliesTo: ['SRKW', 'BIGGS', 'UNKNOWN_ORCA'],
    minDistanceYards: 400,
    maxSpeedKnots: 7,
    effectiveDate: '2025-01-01',
    legalBasis: 'RCW 77.15.740 & Be Whale Wise Joint Guidelines',
    severity: 'MANDATORY_LAW',
    summary:
      'Vessels must reduce speed to 7 knots or less within 1,000 yards (and recommended within 1/2 nautical mile) of killer whales, and immediately disengage engines if whales unexpectedly approach within 400 yards.',
    actionableGuidance: [
      'Slow to 7 knots or less whenever whales are sighted within 1/2 nautical mile.',
      'If SRKWs surface within 400 yards of your vessel, shift engines to neutral (or stop paddling) until they move beyond 400 yards.',
      'Once beyond 400 yards, move slowly away perpendicular to the whales’ travel path until 1,000 yards are restored.',
    ],
  },
  {
    id: 'biggs-200-yard-precautionary',
    title: '200-Yard Buffer for Bigg’s (Transient) Orcas — Default to 1,000 Yards if Unsure',
    appliesTo: ['BIGGS', 'UNKNOWN_ORCA'],
    minDistanceYards: 200,
    maxSpeedKnots: 7,
    effectiveDate: '2025-01-01',
    legalBasis: 'Federal MMPA & WDFW Be Whale Wise Regulations',
    severity: 'MANDATORY_LAW',
    summary:
      'Stay at least 200 yards away from Bigg’s (Transient) killer whales and 100–200 yards from humpback and gray whales. If you cannot positively identify the ecotype, Washington law requires treating all killer whales as Southern Residents (1,000 yards).',
    actionableGuidance: [
      'When in doubt about ecotype (SRKW vs. Bigg’s), always keep 1,000 yards.',
      'Avoid circling or boxing in Bigg’s whales actively hunting harbor seals near shoreline haul-outs.',
      'Turn off fish-finders and depth sounders (50 kHz sonar) when safe, as high-frequency pings disrupt whale echolocation.',
    ],
  },
  {
    id: 'quiet-sound-vessel-slowdown',
    title: 'Quiet Sound Voluntary Commercial Vessel Slowdown (Admiralty Inlet)',
    appliesTo: 'ALL_VESSELS',
    effectiveDate: '2026-09-01',
    legalBasis: 'Quiet Sound / Washington Maritime Blue & NOAA Voluntary Program',
    severity: 'FEDERAL_GUIDELINE',
    summary:
      'Active autumn/winter (Sept 2026 – Jan 2027) in Admiralty Inlet and North Puget Sound. Large commercial ships voluntarily reduce speed to cut underwater radiated noise by ~50% while Southern Residents forage on chum salmon.',
    actionableGuidance: [
      'Lower underwater ambient noise helps SRKWs echolocate salmon and boosts Orcasound hydrophone clarity.',
      'Recreational boaters should likewise minimize wake and propeller cavitation in Admiralty Inlet and East Passage.',
    ],
  },
  {
    id: 'shore-based-zero-impact',
    title: 'Zero-Impact Land-Based Viewing & Drone Restrictions',
    appliesTo: 'DRONES_AND_SHORE',
    effectiveDate: '2025-01-01',
    legalBasis: 'Federal MMPA Harassment Rule, WA State Parks & Seattle Parks Code',
    severity: 'ETHICAL_BEST_PRACTICE',
    summary:
      'Watching from Seattle’s Whale Trail shore parks creates zero underwater noise or vessel disturbance. Drones must never harass wildlife and are restricted across WA State Parks and Seattle Parks.',
    actionableGuidance: [
      'Champion shore-based viewing at Alki, Lincoln Park, West Point, Point Robinson, and Edmonds with binoculars.',
      'Never fly drones below 1,000 feet over marine mammals; respect park-wide UAV bans.',
      'Report suspected whale harassment or 1,000-yard violations to WDFW Enforcement (1-877-933-9847) or NOAA OLE (1-800-853-1964).',
    ],
  },
];
