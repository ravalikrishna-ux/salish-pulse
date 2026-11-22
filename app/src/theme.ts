export const palette = {
  // Deep Salish Sea & PNW Coastal Daylight palette
  bgPage: '#F3F6F8',
  bgSurface: '#FFFFFF',
  bgSurfaceMuted: '#EBF1F4',
  bgHeader: '#0B1F2E',
  bgMapWater: '#0E2A3F',
  bgMapWaterDeep: '#091E2F',
  bgMapLand: '#1C3B47',
  bgMapLandStroke: '#2E5665',

  inkPrimary: '#0D2230',
  inkSecondary: '#476172',
  inkMuted: '#6C8494',
  inkInverse: '#F6FAFC',
  inkInverseMuted: '#9FB8C8',

  // Semantic accents
  tealPrimary: '#0E7C72',
  tealSoft: '#E3F4F1',
  oceanBlue: '#186B94',
  oceanSoft: '#E3F1F8',

  // Ecotypes & confidence
  srkw: '#D1493E', // Endangered Southern Resident (high priority)
  srkwSoft: '#FCECEB',
  biggs: '#0E7C72', // Bigg's / Transient
  biggsSoft: '#E3F4F1',
  acoustic: '#1D6FA5', // Orcasound Hydrophone detection
  acousticSoft: '#E5F2FA',
  otherWhale: '#5F6F7E',
  otherWhaleSoft: '#EEF2F5',

  amber: '#C4760A',
  amberSoft: '#FEF4E2',
  verified: '#147A56',
  verifiedSoft: '#E3F5EE',

  border: '#D9E3E9',
  borderSubtle: '#E7EEF2',
  shadow: 'rgba(11, 31, 46, 0.08)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;
