/**
 * RingAssembly: turns a RingConfig into a scene graph.
 *
 *   ring (Group)
 *   ├── centerStone   Mesh<DiamondMaterial>         ray-traced, own BVH
 *   ├── melee         InstancedMesh<DiamondMaterial> halo / pavé, one shared BVH
 *   ├── metal         Mesh<MeshPhysicalMaterial>     band + head, merged
 *   └── weddingBand   Group                          optional matching band
 *
 * When a Rhino setting (GLB) is selected, the procedural band/head is replaced
 * by the GLB's METAL meshes and the centre stone is placed at its SEAT node.
 */
import { Group, InstancedMesh, Matrix4, Mesh, type BufferGeometry, type Texture } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { buildGem } from '../gems/build';
import { CUTS } from '../gems/catalog';
import { COLOR_GRADES } from '../gems/color';
import type { GemBuild } from '../gems/types';
import { DiamondMaterial, type DiamondQuality } from '../render/diamondMaterial';
import { applyMetal, makeMetalMaterial } from '../render/metals';
import type { RingConfig } from '../state';
import { usRingSizeToInnerDiameter } from '../units';
import type { LoadedSetting } from './rhinoSetting';
import {
  layoutHalo,
  layoutPave,
  makeBand,
  makeBezel,
  makeGalleryRail,
  makeProng,
  type BandParams,
  type HeadParams,
  type MeleeLayout,
} from './parts';

const SETTING_HEIGHT_MM = { low: 0.2, medium: 0.9, high: 1.8 } as const;

export class RingAssembly {
  readonly group = new Group();
  readonly metalMaterial = makeMetalMaterial('platinum');
  centerStone: Mesh | null = null;
  centerGem: GemBuild | null = null;
  centerBVH: MeshBVH | null = null;
  private gemKey = '';
  private meleeCache = new Map<number, { gem: GemBuild; bvh: MeshBVH }>();
  private materials: DiamondMaterial[] = [];
  private envMap: Texture;
  private quality: DiamondQuality;

  constructor(envMap: Texture, quality: DiamondQuality) {
    this.envMap = envMap;
    this.quality = quality;
    this.group.name = 'ring';
  }

  /** Rebuild the scene graph for a configuration. */
  update(cfg: RingConfig, rhino: LoadedSetting | null): void {
    this.clear();
    const gem = this.ensureCenterGem(cfg);
    applyMetal(this.metalMaterial, cfg.metal, cfg.finish);

    const band: BandParams = {
      innerDiameter: usRingSizeToInnerDiameter(cfg.ringSize),
      width: cfg.bandWidth,
      thickness: cfg.bandThickness,
    };
    const bandTopY = band.innerDiameter / 2 + band.thickness;
    const metalParts: BufferGeometry[] = [];
    const melee: MeleeLayout[] = [];
    let meleeDiameter = 0;

    // centre stone
    const stoneMat = this.makeDiamondMaterial(this.centerBVH!, cfg);
    const stone = new Mesh(gem.geometry, stoneMat);
    stone.name = 'centerStone';
    this.centerStone = stone;

    if (rhino) {
      // Rhino setting: metal from the GLB, stone at the SEAT
      for (const m of rhino.metalMeshes) {
        const clone = new Mesh(m.geometry, this.metalMaterial);
        clone.applyMatrix4(m.matrixWorld);
        clone.name = m.name;
        this.group.add(clone);
      }
      for (const g of rhino.gemMeshes) this.group.add(this.makeFixedGem(g, cfg));
      const seat = rhino.seats[0];
      if (seat) stone.applyMatrix4(seat);
      this.group.add(stone);
      return;
    }

    const gemY = bandTopY + SETTING_HEIGHT_MM[cfg.settingHeight] - gem.culetY;
    stone.position.y = gemY;
    this.group.add(stone);

    metalParts.push(makeBand(band));
    const head: HeadParams = {
      gem,
      gemY,
      bandTopY,
      prongRadius: Math.max(0.34, 0.065 * gem.metrics.widthMm),
    };

    const info = CUTS[cfg.cut];
    switch (cfg.setting) {
      case 'solitaire-4':
      case 'solitaire-6': {
        const ts = cfg.setting === 'solitaire-4' ? info.prongs4 : info.prongs6;
        for (const t of ts) metalParts.push(...makeProng(head, t));
        metalParts.push(makeGalleryRail(head));
        break;
      }
      case 'bezel': {
        metalParts.push(makeBezel(head, Math.max(0.55, 0.08 * gem.metrics.widthMm)));
        for (const t of info.prongs4) metalParts.push(...makeProng({ ...head, prongRadius: head.prongRadius * 0.8 }, t, false));
        break;
      }
      case 'halo': {
        for (const t of info.prongs4) metalParts.push(...makeProng(head, t));
        metalParts.push(makeGalleryRail(head));
        meleeDiameter = Math.min(1.6, Math.max(0.9, gem.metrics.widthMm * 0.17));
        const mg = this.ensureMelee(meleeDiameter);
        const halo = layoutHalo(head, meleeDiameter, mg.gem);
        melee.push(halo);
        metalParts.push(...halo.metal);
        break;
      }
    }

    if (cfg.pave) {
      const dm = Math.min(cfg.bandWidth * 0.55, 1.5);
      const mg = this.ensureMelee(dm);
      const ro = bandTopY;
      const clear = Math.asin(Math.min(0.95, (gem.metrics.widthMm / 2 + 0.8) / ro)) * (180 / Math.PI);
      const pave = layoutPave(band, dm, mg.gem, clear, 75);
      metalParts.push(...pave.metal);
      this.addMelee(pave.stones, dm, cfg, 'pave');
    }
    for (const m of melee) this.addMelee(m.stones, meleeDiameter, cfg, 'halo');

    const metal = new Mesh(mergeGeometries(metalParts.map(nonIndexed), false)!, this.metalMaterial);
    metal.name = 'metal';
    metalParts.forEach((g) => g.dispose());
    this.group.add(metal);

    if (cfg.weddingBand !== 'none') this.addWeddingBand(cfg, band);
  }

  private addWeddingBand(cfg: RingConfig, engagement: BandParams): void {
    const band: BandParams = { ...engagement, width: cfg.weddingBandWidth };
    const z = engagement.width / 2 + band.width / 2 + 0.15;
    const g = makeBand(band);
    g.translate(0, 0, z);
    const parts: BufferGeometry[] = [g];
    if (cfg.weddingBand === 'pave' || cfg.weddingBand === 'eternity') {
      const dm = Math.min(band.width * 0.6, 1.8);
      const mg = this.ensureMelee(dm);
      const layout =
        cfg.weddingBand === 'eternity'
          ? layoutPave(band, dm, mg.gem, 0, 180, z)
          : layoutPave(band, dm, mg.gem, 0, 70, z);
      parts.push(...layout.metal);
      this.addMelee(layout.stones, dm, cfg, 'wedding');
    }
    const mesh = new Mesh(mergeGeometries(parts.map(nonIndexed), false)!, this.metalMaterial);
    mesh.name = 'weddingBand';
    parts.forEach((p) => p.dispose());
    this.group.add(mesh);
  }

  private addMelee(matrices: Matrix4[], diameter: number, cfg: RingConfig, name: string): void {
    if (!matrices.length) return;
    const mg = this.ensureMelee(diameter);
    const mat = this.makeDiamondMaterial(mg.bvh, cfg, { bounces: Math.min(5, this.quality.bounces), fullDispersion: false });
    const inst = new InstancedMesh(mg.gem.geometry, mat, matrices.length);
    matrices.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    inst.name = `melee:${name}`;
    this.group.add(inst);
  }

  /** A gem modelled in Rhino: keep its geometry, give it the diamond shader. */
  private makeFixedGem(src: Mesh, cfg: RingConfig): Mesh {
    const geom = src.geometry.clone().applyMatrix4(src.matrixWorld);
    geom.computeVertexNormals();
    const bvh = new MeshBVH(geom);
    const m = new Mesh(geom, this.makeDiamondMaterial(bvh, cfg));
    m.name = src.name;
    return m;
  }

  private ensureCenterGem(cfg: RingConfig): GemBuild {
    const key = JSON.stringify([cfg.cut, cfg.carat, cfg.ratio, cfg.proportions]);
    if (key !== this.gemKey || !this.centerGem) {
      this.centerGem?.geometry.dispose();
      this.centerGem = buildGem({ cut: cfg.cut, carat: cfg.carat, ratio: cfg.ratio, proportions: cfg.proportions });
      this.centerBVH = new MeshBVH(this.centerGem.geometry);
      this.gemKey = key;
    }
    return this.centerGem;
  }

  private ensureMelee(diameter: number): { gem: GemBuild; bvh: MeshBVH } {
    const key = Math.round(diameter * 100);
    let m = this.meleeCache.get(key);
    if (!m) {
      const ref = buildGem({ cut: 'round', carat: 1, ratio: 1, proportions: CUTS.round.proportions });
      const carat = (diameter / ref.metrics.widthMm) ** 3;
      ref.geometry.dispose();
      const gem = buildGem({ cut: 'round', carat, ratio: 1, proportions: CUTS.round.proportions });
      m = { gem, bvh: new MeshBVH(gem.geometry) };
      this.meleeCache.set(key, m);
    }
    return m;
  }

  private makeDiamondMaterial(bvh: MeshBVH, cfg: RingConfig, q: DiamondQuality = this.quality): DiamondMaterial {
    const mat = new DiamondMaterial(bvh, this.envMap, q);
    mat.setAbsorption(COLOR_GRADES[cfg.color].absorption);
    mat.setDispersion(cfg.dispersion);
    mat.setEnvironment(this.envMap, (cfg.envRotation * Math.PI) / 180, 1);
    this.materials.push(mat);
    return mat;
  }

  /** Cheap updates that don't need a rebuild. */
  setEnvironment(envMap: Texture, rotationDeg: number): void {
    this.envMap = envMap;
    for (const m of this.materials) m.setEnvironment(envMap, (rotationDeg * Math.PI) / 180, 1);
  }

  setQuality(q: DiamondQuality): void {
    this.quality = q;
    for (const m of this.materials) {
      const isMelee = m !== this.centerStone?.material;
      m.setQuality(isMelee ? { bounces: Math.min(5, q.bounces), fullDispersion: false } : q);
    }
  }

  /** Materials of every stone (centre + melee) for UI-driven uniform tweaks. */
  get diamondMaterials(): readonly DiamondMaterial[] {
    return this.materials;
  }

  private clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (child instanceof Mesh && child.name !== 'centerStone' && !child.name.startsWith('melee')) {
        // merged metal geometry is rebuilt each time; gem geometries are cached
        if (child.name === 'metal' || child.name === 'weddingBand') child.geometry.dispose();
      }
    }
    for (const m of this.materials) m.dispose();
    this.materials = [];
    this.centerStone = null;
  }
}

function nonIndexed(g: BufferGeometry): BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  // keep only attributes every part has, so the merge succeeds
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal') out.deleteAttribute(name);
  }
  return out;
}
