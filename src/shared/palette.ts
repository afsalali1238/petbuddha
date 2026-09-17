/**
 * Hard palette values (§3.3). These are decisions, not suggestions.
 * Kept in one place so the model builder, the renderer and the 2D laser
 * overlay can never drift apart.
 */
export const PALETTE = {
  outline: '#1A1A1A',
  skinBase: '#FFF6E8',
  skinShade: '#EBDCC6',
  robeBase: '#F08A24',
  robeShade: '#C9621A',
  sash: '#8A4B12',
  shadesFrame: '#1A1A1A',
  lensIdle: '#2B2B2B',
  lensHighlight: '#FFFFFF',
  lensCharge: '#FF2A2A',
  leafLight: '#7CC94F',
  leafDark: '#1E6B2C',
  cushion: '#D94F4F',
  cushionBand: '#A83838',
  auraGold: '#FFC24D',
  laserCore: '#FF2A2A',
  laserGlow: '#FF8A8A',
  blossom: '#FFE3EE',
  islandGrass: '#7CC94F',
  islandDirt: '#8A5A3B',
  trunk: '#8A5A3B',
  trunkShade: '#6B4429',
  skyLight: '#FFF8EC',
  groundLight: '#D8C9B0'
} as const

/** Time-of-day light rigs (§4.5): light colours only, zero material changes. */
export const TIME_OF_DAY_RIGS = {
  dawn: { hemiSky: '#FFD9A0', hemiGround: '#C9A882', hemiIntensity: 0.85, dirColor: '#FFD9A0', dirIntensity: 0.55, fireflies: false },
  day: { hemiSky: '#FFF8EC', hemiGround: '#D8C9B0', hemiIntensity: 0.9, dirColor: '#FFF6E0', dirIntensity: 0.6, fireflies: false },
  dusk: { hemiSky: '#FF9E6B', hemiGround: '#B07A55', hemiIntensity: 0.8, dirColor: '#FF9E6B', dirIntensity: 0.55, fireflies: false },
  night: { hemiSky: '#7E8BC7', hemiGround: '#3B3F52', hemiIntensity: 0.7, dirColor: '#9FB0E8', dirIntensity: 0.35, fireflies: true }
} as const

export type TimeOfDay = keyof typeof TIME_OF_DAY_RIGS
