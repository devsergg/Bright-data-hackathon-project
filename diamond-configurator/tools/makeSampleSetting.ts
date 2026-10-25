/**
 * Generates public/models/sample-cathedral.glb — a stand-in for a Rhino export
 * that follows the naming contract (METAL_*, SEAT_center_<mm> marker triangle)
 * and Rhino's metre scaling, so the GLB pipeline can be exercised before a real
 * Rhino model exists. Open /tools/make-sample-setting.html in `npm run dev`.
 */
import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, TubeGeometry, Vector3 } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildGem } from '../src/gems/build';
import { CUTS } from '../src/gems/catalog';
import { makeBand, makeGalleryRail, makeProng } from '../src/ring/parts';
import { usRingSizeToInnerDiameter } from '../src/units';

function build(): Group {
  const gem = buildGem({ cut: 'round', carat: 1, ratio: 1, proportions: CUTS.round.proportions });
  const band = { innerDiameter: usRingSizeToInnerDiameter(6), width: 2.2, thickness: 1.8 };
  const bandTopY = band.innerDiameter / 2 + band.thickness;
  const gemY = bandTopY + 2.4 - gem.culetY; // high cathedral head
  const head = { gem, gemY, bandTopY, prongRadius: 0.42 };

  const metal = new MeshStandardMaterial({ name: 'Platinum', metalness: 1, roughness: 0.15 });
  const root = new Group();

  const bandMesh = new Mesh(makeBand(band), metal);
  bandMesh.name = 'METAL_band';
  root.add(bandMesh);

  const headParts = [...[45, 135, 225, 315].flatMap((t) => makeProng(head, t)), makeGalleryRail(head, 0.55), makeGalleryRail(head, 0.2, 0.6)];
  // cathedral arches: rise from the band's outer surface to the gallery rail
  const ro = bandTopY;
  const a0 = (38 * Math.PI) / 180;
  const railY = gemY + gem.culetY * 0.45 + gem.girdleBottomY * 0.55;
  for (const side of [1, -1]) {
    for (const z of [0.55, -0.55]) {
      const pts = [
        new Vector3(side * ro * Math.sin(a0), ro * Math.cos(a0) - 0.35, z),
        new Vector3(side * ro * Math.sin(a0 * 0.55), bandTopY + 0.6, z * 1.3),
        new Vector3(side * 2.9, railY - 1.1, z * 1.9),
        new Vector3(side * 2.35, railY, z * 2.2),
      ];
      headParts.push(new TubeGeometry(new CatmullRomCurve3(pts), 48, 0.5, 12, false));
    }
  }
  const headMesh = new Mesh(mergeGeometries(headParts.map((g) => (g.index ? g.toNonIndexed() : g)).map(strip))!, metal);
  headMesh.name = 'METAL_head';
  root.add(headMesh);

  // SEAT marker: right triangle, 1 mm up, 2 mm along the stone length
  const o = new Vector3(0, gemY, 0);
  const seat = new BufferGeometry();
  seat.setAttribute('position', new Float32BufferAttribute([o.x, o.y, o.z, o.x, o.y + 1, o.z, o.x, o.y, o.z + 2], 3));
  const seatMesh = new Mesh(seat, new MeshStandardMaterial({ name: 'seat' }));
  seatMesh.name = `SEAT_center_${gem.metrics.widthMm.toFixed(2)}`;
  root.add(seatMesh);

  // emulate Rhino's glTF export: millimetres → metres
  root.scale.setScalar(0.001);
  return root;
}

function strip(g: BufferGeometry): BufferGeometry {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  return g;
}

async function run() {
  const glb = (await new GLTFExporter().parseAsync(build(), { binary: true })) as ArrayBuffer;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
  a.download = 'sample-cathedral.glb';
  a.click();
}

document.getElementById('go')!.onclick = run;
