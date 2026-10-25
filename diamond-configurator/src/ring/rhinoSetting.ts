/**
 * Loader for ring settings modelled in Rhino and exported as glTF/GLB.
 *
 * NAMING CONTRACT (object names in Rhino → node names in the GLB):
 *
 *   METAL_*            any metal part. Its material is replaced by the chosen
 *                      metal preset. (Also matched: material named metal / gold /
 *                      platinum / silver.)
 *   GEM_*              a fixed stone modelled in Rhino (side stones, melee).
 *                      Rendered with the ray-traced diamond shader. Must be a
 *                      closed mesh with flat (unwelded) facets. (Also matched:
 *                      material named diamond / gem.)
 *   SEAT_center        an empty / point / tiny mesh marking where the configurable
 *                      centre stone goes: origin = girdle centre, +Y = table up,
 *                      +Z = stone length (north–south).
 *   SEAT_<name>_<mm>   optional nominal stone width, e.g. SEAT_center_6.50 —
 *                      used to check that the chosen carat fits the setting.
 *
 * UNITS: glTF is metres. Rhino's exporter converts, so a ring arrives ~0.02 m
 * wide; we detect that and scale ×1000 back to millimetres.
 * AXES: Rhino is Z-up; its glTF exporter maps Rhino Z → glTF Y by default.
 * Model the ring with the finger axis along Rhino Y (glTF −Z) and the head on
 * Rhino +Z; see docs/RHINO_PIPELINE.md.
 */
import { Box3, Matrix4, Mesh, Quaternion, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface SettingManifestEntry {
  id: string;
  name: string;
  /** Path relative to /public, e.g. "models/cathedral-solitaire.glb". */
  file: string;
  /** Cuts this head was designed for (empty = any). */
  cuts?: string[];
  /** Nominal centre-stone width in mm the head was modelled around. */
  nominalStoneMm?: number;
  /** Whether the GLB includes its own band (true) or is a head only (false). */
  includesBand?: boolean;
  notes?: string;
}

export interface LoadedSetting {
  entry: SettingManifestEntry;
  root: Object3D;
  metalMeshes: Mesh[];
  gemMeshes: Mesh[];
  /** World matrices (mm) of SEAT_* nodes; [0] is the centre seat. */
  seats: Matrix4[];
  seatNames: string[];
  /** Nominal stone widths parsed from SEAT names, mm (NaN if absent). */
  seatWidthsMm: number[];
  /** Scale applied to convert to millimetres. */
  unitScale: number;
}

const METAL_MAT = /metal|gold|platinum|silver|palladium/i;
const GEM_MAT = /diamond|gem|stone/i;

export async function loadManifest(url = 'models/manifest.json'): Promise<SettingManifestEntry[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json.settings) ? json.settings : [];
  } catch {
    return [];
  }
}

export async function loadSetting(entry: SettingManifestEntry): Promise<LoadedSetting> {
  const gltf = await new GLTFLoader().loadAsync(entry.file);
  const root = gltf.scene;

  // metres → millimetres heuristic: a ring is 15–30 mm across
  const size = new Box3().setFromObject(root).getSize(new Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const unitScale = maxDim < 1 ? 1000 : 1;
  root.scale.multiplyScalar(unitScale);
  root.updateMatrixWorld(true);

  const metalMeshes: Mesh[] = [];
  const gemMeshes: Mesh[] = [];
  const seats: Matrix4[] = [];
  const seatNames: string[] = [];
  const seatWidthsMm: number[] = [];

  const centre: { m: Matrix4; name: string; mm: number }[] = [];
  const others: { m: Matrix4; name: string; mm: number }[] = [];

  root.traverse((o) => {
    const name = o.name || '';
    const upper = name.toUpperCase();
    if (upper.startsWith('SEAT')) {
      // Prefer the marker triangle made by rhino/make_seat.py (exporter-proof);
      // fall back to the node transform (empties from Blender etc.).
      const m =
        (o instanceof Mesh && seatFromTriangle(o)) ||
        new Matrix4().compose(
          o.getWorldPosition(new Vector3()),
          o.getWorldQuaternion(new Quaternion()),
          new Vector3(1, 1, 1),
        );
      const seat = { m, name, mm: parseFloat(name.split('_').pop() ?? '') };
      (upper.startsWith('SEAT_CENTER') ? centre : others).push(seat);
      return;
    }
    if (!(o instanceof Mesh)) return;
    const matName = Array.isArray(o.material) ? (o.material[0]?.name ?? '') : (o.material?.name ?? '');
    if (upper.startsWith('GEM') || GEM_MAT.test(matName)) gemMeshes.push(o);
    else if (upper.startsWith('METAL') || METAL_MAT.test(matName)) metalMeshes.push(o);
    else {
      console.warn(`[rhino] "${name}" has no METAL_/GEM_ prefix — treating it as metal`);
      metalMeshes.push(o);
    }
  });

  for (const s of [...centre, ...others]) {
    seats.push(s.m);
    seatNames.push(s.name);
    seatWidthsMm.push(s.mm);
  }

  return { entry, root, metalMeshes, gemMeshes, seats, seatNames, seatWidthsMm, unitScale };
}

/**
 * Decode a make_seat.py marker: a right triangle with a 1 mm leg along the
 * stone's up axis and a 2 mm leg along its length, meeting at the girdle centre.
 * Leg lengths are compared as a ratio, so the unit conversion doesn't matter.
 */
export function seatFromTriangle(mesh: Mesh): Matrix4 | null {
  const pos = mesh.geometry.getAttribute('position');
  if (!pos || pos.count < 3) return null;
  const v = [0, 1, 2].map((i) => new Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
  for (let i = 0; i < 3; i++) {
    const o = v[i];
    const a = v[(i + 1) % 3].clone().sub(o);
    const b = v[(i + 2) % 3].clone().sub(o);
    if (Math.abs(a.clone().normalize().dot(b.clone().normalize())) > 0.05) continue; // not the right angle
    const [up, len] = a.length() < b.length() ? [a, b] : [b, a];
    if (Math.abs(len.length() / up.length() - 2) > 0.1) continue;
    const y = up.normalize();
    const z = len.normalize();
    const x = new Vector3().crossVectors(y, z);
    return new Matrix4().makeBasis(x, y, z).setPosition(o);
  }
  return null;
}
