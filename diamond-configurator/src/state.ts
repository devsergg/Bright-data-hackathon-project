/**
 * Configurator state: one serialisable object describing the whole ring,
 * a tiny observable store, and share-link (URL hash) encoding.
 *
 * Everything an order needs is in RingConfig, so the same JSON can go to a
 * cart, a CAD technician, or back into Rhino.
 */
import { CUTS } from './gems/catalog';
import type { ColorGrade } from './gems/color';
import type { CutId, Proportions } from './gems/types';
import type { EnvironmentId } from './render/environments';
import type { MetalId } from './render/metals';

export type SettingStyle = 'solitaire-4' | 'solitaire-6' | 'bezel' | 'halo';
export type ClarityGrade = 'FL' | 'IF' | 'VVS1' | 'VVS2' | 'VS1' | 'VS2' | 'SI1' | 'SI2';
export type QualityLevel = 'high' | 'medium' | 'low';

export interface RingConfig {
  // centre stone
  cut: CutId;
  carat: number;
  ratio: number;
  proportions: Proportions;
  color: ColorGrade;
  /** Recorded for the order; not rendered yet (see docs/ROADMAP.md). */
  clarity: ClarityGrade;

  // setting
  setting: SettingStyle;
  /** id from public/models/manifest.json — overrides `setting` when set. */
  rhinoSetting: string | null;
  settingHeight: 'low' | 'medium' | 'high';
  pave: boolean;
  metal: MetalId;
  finish: 'polished' | 'satin';
  ringSize: number;
  bandWidth: number;
  bandThickness: number;
  weddingBand: 'none' | 'plain' | 'pave' | 'eternity';
  weddingBandWidth: number;
  engraving: string;

  // presentation
  environment: EnvironmentId;
  envRotation: number;
  exposure: number;
  /** 1 = physical diamond dispersion. */
  dispersion: number;
  quality: QualityLevel;
  bloom: boolean;
  autoRotate: boolean;
}

export const DEFAULT_CONFIG: RingConfig = {
  cut: 'round',
  carat: 1.0,
  ratio: 1,
  proportions: { ...CUTS.round.proportions },
  color: 'F',
  clarity: 'VS1',
  setting: 'solitaire-6',
  rhinoSetting: null,
  settingHeight: 'medium',
  pave: false,
  metal: 'platinum',
  finish: 'polished',
  ringSize: 6,
  bandWidth: 2.0,
  bandThickness: 1.7,
  weddingBand: 'none',
  weddingBandWidth: 2.0,
  engraving: '',
  environment: 'studio',
  envRotation: 0,
  exposure: 1,
  dispersion: 1,
  quality: 'high',
  bloom: true,
  autoRotate: true,
};

/** Apply a cut change: reset ratio and proportions to that cut's defaults. */
export function withCut(cfg: RingConfig, cut: CutId): RingConfig {
  const info = CUTS[cut];
  return { ...cfg, cut, ratio: info.ratio, proportions: { ...info.proportions } };
}

type Listener = (cfg: RingConfig, prev: RingConfig) => void;

export class Store {
  private cfg: RingConfig;
  private listeners = new Set<Listener>();

  constructor(initial: RingConfig) {
    this.cfg = initial;
  }

  get(): RingConfig {
    return this.cfg;
  }

  set(patch: Partial<RingConfig>): void {
    const prev = this.cfg;
    this.cfg = { ...prev, ...patch };
    for (const l of this.listeners) l(this.cfg, prev);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

// ------------------------------------------------------------ share links

export function encodeConfig(cfg: RingConfig): string {
  const json = JSON.stringify(cfg);
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeConfig(s: string): RingConfig | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(b64)));
    const parsed = JSON.parse(json) as Partial<RingConfig>;
    if (!parsed.cut || !(parsed.cut in CUTS)) return null;
    // merge onto defaults so links survive new fields being added
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return null;
  }
}

export function configFromLocation(): RingConfig {
  const m = location.hash.match(/c=([^&]+)/);
  return (m && decodeConfig(m[1])) || { ...DEFAULT_CONFIG };
}

export function writeLocation(cfg: RingConfig): void {
  history.replaceState(null, '', `#c=${encodeConfig(cfg)}`);
}
