/**
 * Export a stone from the gem generator as an OBJ with true n-gon facets
 * (one planar face per facet), millimetres, Y up — for Blender or Rhino.
 *
 *   npx tsx tools/export-gem.ts <cut> <carat> <out.obj> [grade]
 *   npx tsx tools/export-gem.ts round 1.75 blender/assets/center.obj
 */
import { writeFileSync } from 'node:fs';
import { buildGem } from '../src/gems/build';
import { CUTS } from '../src/gems/catalog';
import type { CutId } from '../src/gems/types';
import { gradeProportions, type CutGrade } from '../src/showcase/cutGrades';

const [cut = 'round', caratArg = '1', out = 'gem.obj', grade = 'ideal'] = process.argv.slice(2);
const info = CUTS[cut as CutId];
const gem = buildGem({
  cut: cut as CutId,
  carat: parseFloat(caratArg),
  ratio: info.ratio,
  proportions: gradeProportions(cut as CutId, grade as CutGrade),
});

const verts: string[] = [];
const index = new Map<string, number>();
const faces: string[] = [];
for (const f of gem.facets) {
  const ids: number[] = [];
  for (const v of f.verts) {
    const key = v.map((x) => x.toFixed(6)).join(' ');
    let i = index.get(key);
    if (i === undefined) {
      verts.push(`v ${key}`);
      i = verts.length;
      index.set(key, i);
    }
    if (ids[ids.length - 1] !== i && ids[0] !== i) ids.push(i);
  }
  if (ids.length >= 3) faces.push(`g ${f.kind}\nf ${ids.join(' ')}`);
}
const m = gem.metrics;
writeFileSync(
  out,
  `# ${cut} ${m.carat.toFixed(3)} ct, ${m.lengthMm.toFixed(3)} x ${m.widthMm.toFixed(3)} x ${m.depthMm.toFixed(3)} mm, ${m.facetCount} facets\n` +
    `# millimetres, Y up, girdle plane at y=0; girdleTop=${gem.girdleTopY.toFixed(4)} girdleBottom=${gem.girdleBottomY.toFixed(4)} table=${gem.tableY.toFixed(4)} culet=${gem.culetY.toFixed(4)}\n` +
    `${verts.join('\n')}\n${faces.join('\n')}\n`,
);
console.log(`wrote ${out}: ${m.widthMm.toFixed(2)} mm, ${m.facetCount} facets, ${faces.length} faces`);
