/**
 * Curated designs shown in the Collections gallery. Each is a partial
 * RingConfig applied on top of the defaults; the shopper can customise any of
 * them. Thumbnails live in public/showcase/<id>.jpg (npm run showcase).
 */
import { CUTS } from '../gems/catalog';
import { DEFAULT_CONFIG, type RingConfig } from '../state';

export interface Design {
  id: string;
  name: string;
  tagline: string;
  config: Partial<RingConfig>;
}

const base = (cut: RingConfig['cut']): Partial<RingConfig> => ({
  cut,
  ratio: CUTS[cut].ratio,
  proportions: { ...CUTS[cut].proportions },
});

export const COLLECTION: Design[] = [
  {
    id: 'classic',
    name: 'The Classic',
    tagline: 'Round brilliant on six slender platinum prongs.',
    config: { ...base('round'), carat: 1.5, color: 'F', clarity: 'VS1', setting: 'solitaire-6', metal: 'platinum' },
  },
  {
    id: 'oval-halo',
    name: 'Oval Halo',
    tagline: 'An elongated oval framed in melee, with a pavé band.',
    config: { ...base('oval'), carat: 1.2, color: 'G', clarity: 'VS2', setting: 'halo', pave: true, metal: 'yellow-gold-18k' },
  },
  {
    id: 'emerald-bezel',
    name: 'Emerald Bezel',
    tagline: 'Step-cut emerald held in a clean metal collar.',
    config: { ...base('emerald'), carat: 2, color: 'E', clarity: 'VVS2', setting: 'bezel', metal: 'platinum', settingHeight: 'low' },
  },
  {
    id: 'pear',
    name: 'Pear Solitaire',
    tagline: 'A teardrop in rose gold with a protective V-prong at the tip.',
    config: { ...base('pear'), carat: 1.3, color: 'H', clarity: 'VS1', setting: 'solitaire-4', metal: 'rose-gold-14k' },
  },
  {
    id: 'cushion-halo',
    name: 'Cushion Halo',
    tagline: 'Soft-cornered cushion with a halo and diamond shoulders.',
    config: { ...base('cushion'), carat: 1.5, color: 'G', clarity: 'VS1', setting: 'halo', pave: true, metal: 'white-gold-14k' },
  },
  {
    id: 'asscher-deco',
    name: 'Asscher Deco',
    tagline: 'Art-deco asscher paired with an eternity band.',
    config: {
      ...base('asscher'),
      carat: 1.75,
      color: 'D',
      clarity: 'VVS1',
      setting: 'solitaire-4',
      metal: 'platinum',
      weddingBand: 'eternity',
    },
  },
  {
    id: 'pink-heart',
    name: 'Pink Heart',
    tagline: 'A fancy pink heart in a rose-gold halo.',
    config: { ...base('heart'), carat: 1, color: 'fancy-pink', clarity: 'VS2', setting: 'halo', metal: 'rose-gold-14k' },
  },
  {
    id: 'bridal-set',
    name: 'Bridal Set',
    tagline: 'Four-prong solitaire with a matching pavé wedding band.',
    config: {
      ...base('round'),
      carat: 1,
      color: 'F',
      clarity: 'VS2',
      setting: 'solitaire-4',
      pave: true,
      weddingBand: 'pave',
      metal: 'yellow-gold-18k',
    },
  },
];

export function designConfig(d: Design, keep: RingConfig = DEFAULT_CONFIG): RingConfig {
  // keep the shopper's presentation choices (lighting, size, try-on)
  return {
    ...DEFAULT_CONFIG,
    environment: keep.environment,
    quality: keep.quality,
    ringSize: keep.ringSize,
    showFinger: keep.showFinger,
    skinTone: keep.skinTone,
    autoRotate: keep.autoRotate,
    ...d.config,
  };
}
