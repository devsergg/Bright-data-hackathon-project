/**
 * Exports for production and for the Rhino round-trip.
 *
 *   gem → OBJ / STL   exact facet geometry in millimetres. Import into Rhino,
 *                     then MergeAllCoplanarFaces (or MeshToNURB + MergeAllFaces)
 *                     to get a clean faceted polysurface.
 *   ring → GLB        whole design; ray-traced gems are swapped for a standard
 *                     glTF transmission material so other viewers can open it.
 *   spec → JSON       every parameter + measured stone metrics, for the order.
 */
import { Color, Group, Mesh, MeshPhysicalMaterial, type InstancedMesh, type Object3D } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import type { GemBuild } from '../gems/types';
import { DiamondMaterial } from '../render/diamondMaterial';
import type { BenchReport } from '../ring/metallurgy';
import type { RingConfig } from '../state';
import { DIAMOND_IOR_D, usRingSizeToInnerDiameter } from '../units';

export function download(data: BlobPart, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function gemMesh(gem: GemBuild): Mesh {
  const m = new Mesh(gem.geometry);
  m.name = `${gem.spec.cut}_${gem.spec.carat.toFixed(2)}ct`;
  return m;
}

export function exportGemOBJ(gem: GemBuild): void {
  const obj = new OBJExporter().parse(gemMesh(gem));
  download(`# ${gem.spec.cut} ${gem.spec.carat} ct — units: millimetres, Y up\n${obj}`, `${gemMesh(gem).name}.obj`, 'text/plain');
}

export function exportGemSTL(gem: GemBuild): void {
  const stl = new STLExporter().parse(gemMesh(gem), { binary: true }) as DataView;
  download(stl.buffer as ArrayBuffer, `${gemMesh(gem).name}.stl`, 'model/stl');
}

const exportDiamond = new MeshPhysicalMaterial({
  name: 'diamond',
  color: new Color(1, 1, 1),
  metalness: 0,
  roughness: 0,
  transmission: 1,
  thickness: 2,
  ior: DIAMOND_IOR_D,
  dispersion: 20 / 55, // KHR_materials_dispersion = 20 / Abbe number (diamond V ≈ 55)
});

export async function exportRingGLB(ring: Object3D, name = 'ring'): Promise<void> {
  const copy = ring.clone(true) as Group;
  copy.traverse((o) => {
    const mesh = o as Mesh | InstancedMesh;
    if (mesh.isMesh && mesh.material instanceof DiamondMaterial) mesh.material = exportDiamond;
  });
  const glb = (await new GLTFExporter().parseAsync(copy, { binary: true })) as ArrayBuffer;
  download(glb, `${name}.glb`, 'model/gltf-binary');
}

export function exportSpecJSON(cfg: RingConfig, gem: GemBuild, bench: BenchReport | null = null): void {
  const spec = {
    generatedAt: new Date().toISOString(),
    units: 'mm',
    config: cfg,
    centreStone: {
      cut: cfg.cut,
      measurements: `${gem.metrics.lengthMm.toFixed(2)} × ${gem.metrics.widthMm.toFixed(2)} × ${gem.metrics.depthMm.toFixed(2)} mm`,
      ...gem.metrics,
      proportions: cfg.proportions,
    },
    band: {
      usSize: cfg.ringSize,
      innerDiameterMm: usRingSizeToInnerDiameter(cfg.ringSize),
      widthMm: cfg.bandWidth,
      thicknessMm: cfg.bandThickness,
    },
    // resolved prong size and the rule-of-thumb checks it was designed against
    bench: bench && {
      metal: bench.metal,
      prongDiameterMm: +bench.prongDiameterMm.toFixed(2),
      minProngMm: +bench.minProngMm.toFixed(2),
      tipBendDeg: +bench.bend.requiredDeg.toFixed(1),
      springBackDeg: +bench.bend.springBackDeg.toFixed(2),
      estimatedWeightG: bench.weightG && +bench.weightG.toFixed(2),
      checks: bench.checks.map(({ id, status, value }) => ({ id, status, value })),
    },
  };
  download(JSON.stringify(spec, null, 2), `ring-spec-${cfg.cut}-${cfg.carat}ct.json`, 'application/json');
}
