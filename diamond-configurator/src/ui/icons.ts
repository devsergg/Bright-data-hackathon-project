/**
 * Shape icons drawn from the real generated geometry (top view of the crown),
 * so the picker always matches what is rendered.
 */
import { buildGem } from '../gems/build';
import { CUTS } from '../gems/catalog';
import type { CutId, GemBuild } from '../gems/types';

const cache = new Map<CutId, string>();

export function gemTopSVG(gem: GemBuild, size = 64, stroke = 'currentColor'): string {
  const xs = gem.outline.map((p) => p[0]);
  const zs = gem.outline.map((p) => p[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  const s = (size * 0.84) / span;
  const c = size / 2;
  const P = (x: number, z: number) => `${(c + x * s).toFixed(2)},${(c - z * s).toFixed(2)}`;
  const faces = gem.facets
    .filter((f) => f.kind === 'crown' || f.kind === 'table')
    .map((f) => `<polygon points="${f.verts.map((v) => P(v[0], v[2])).join(' ')}"/>`)
    .join('');
  const outline = `<polygon points="${gem.outline.map(([x, z]) => P(x, z)).join(' ')}" stroke-width="1.4"/>`;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" fill="none" stroke="${stroke}" stroke-width="0.6" stroke-linejoin="round" aria-hidden="true">${faces}${outline}</svg>`;
}

export function cutIcon(cut: CutId): string {
  let svg = cache.get(cut);
  if (!svg) {
    const info = CUTS[cut];
    const gem = buildGem({ cut, carat: 1, ratio: info.ratio, proportions: info.proportions });
    svg = gemTopSVG(gem);
    gem.geometry.dispose();
    cache.set(cut, svg);
  }
  return svg;
}
