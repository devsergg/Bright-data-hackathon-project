/**
 * Lighting environments.
 *
 * Diamonds look the way their surroundings look: brilliance needs large bright
 * sources, scintillation needs contrast (dark areas + small sources), fire needs
 * small point-like sources. Each preset is a procedural HDR "light room" that
 * is rendered once into a sharp cube map (for the ray-traced gems) and a
 * prefiltered PMREM (for metal roughness).
 *
 * Drop real HDRIs into /public/hdri and register them in HDRI_PRESETS to use
 * photographic lighting instead (e.g. Poly Haven studio HDRIs, CC0).
 */
import {
  BackSide,
  BoxGeometry,
  Color,
  CubeCamera,
  EquirectangularReflectionMapping,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  WebGLCubeRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

export type EnvironmentId = 'studio' | 'boutique' | 'daylight' | 'candlelight' | 'office';

interface LightPanel {
  /** Elevation above the horizon and azimuth, degrees. */
  elev: number;
  azim: number;
  /** Width / height in degrees of arc (approx). */
  w: number;
  h: number;
  color: string;
  intensity: number;
  round?: boolean;
}

export interface EnvironmentPreset {
  label: string;
  description: string;
  dome: { top: string; horizon: string; bottom: string; intensity: number };
  panels: LightPanel[];
  /**
   * What polished metal reflects, when it should differ from the gem's room.
   * A bright, even dome flatters a diamond but turns polished metal into grey
   * plastic; metal needs a dark room with long strip softboxes so the band shows
   * crisp light/dark bands (the jewellery-photography look).
   */
  metal?: { dome: EnvironmentPreset['dome']; panels: LightPanel[] };
  /** Backdrop the shopper sees behind the ring: radial gradient [centre, edge]. */
  background: [string, string];
  exposure: number;
}

/** Ring of small spots — the jewellery-store look. */
function spots(n: number, elev: number, size: number, intensity: number, color = '#fff6ea', phase = 0): LightPanel[] {
  return Array.from({ length: n }, (_, i) => ({
    elev,
    azim: phase + (360 * i) / n,
    w: size,
    h: size,
    color,
    intensity,
    round: true,
  }));
}

export const ENVIRONMENTS: Record<EnvironmentId, EnvironmentPreset> = {
  studio: {
    label: 'Studio Light Tent',
    description: 'Jewellery photography: a bright diffusion tent with black cards for diamond contrast.',
    dome: { top: '#e4e4e4', horizon: '#c9c9c9', bottom: '#7d7d7d', intensity: 1.0 },
    panels: [
      // the camera / viewer's reflection — gives the classic dark arrows (ASET blue)
      { elev: 89, azim: 0, w: 20, h: 20, color: '#060606', intensity: 1, round: true },
      // black flags that create contrast in the crown
      { elev: 30, azim: 0, w: 14, h: 30, color: '#0a0a0a', intensity: 1 },
      { elev: 30, azim: 120, w: 14, h: 30, color: '#0a0a0a', intensity: 1 },
      { elev: 30, azim: 240, w: 14, h: 30, color: '#0a0a0a', intensity: 1 },
      // softboxes
      { elev: 55, azim: 60, w: 30, h: 34, color: '#ffffff', intensity: 3.2 },
      { elev: 55, azim: 180, w: 30, h: 34, color: '#ffffff', intensity: 3.2 },
      { elev: 55, azim: 300, w: 30, h: 34, color: '#ffffff', intensity: 3.2 },
      { elev: 12, azim: 90, w: 50, h: 10, color: '#f6f8ff', intensity: 2 },
      { elev: 12, azim: 270, w: 50, h: 10, color: '#f6f8ff', intensity: 2 },
      // small hard sources for fire
      ...spots(8, 42, 1.8, 60, '#ffffff', 22),
    ],
    metal: {
      dome: { top: '#9a9a9a', horizon: '#2c2c2c', bottom: '#6a6a6a', intensity: 1 },
      panels: [
        // overhead softboxes and a white table bounce
        { elev: 62, azim: 60, w: 46, h: 38, color: '#ffffff', intensity: 5 },
        { elev: 62, azim: 180, w: 46, h: 38, color: '#ffffff', intensity: 4 },
        { elev: 62, azim: 300, w: 46, h: 38, color: '#ffffff', intensity: 4.5 },
        { elev: -60, azim: 0, w: 120, h: 50, color: '#f2f2f2', intensity: 2.2 },
        // tall strip lights: the long highlights down the band
        { elev: 10, azim: 35, w: 7, h: 70, color: '#ffffff', intensity: 6 },
        { elev: 10, azim: 145, w: 7, h: 70, color: '#ffffff', intensity: 5 },
        { elev: 10, azim: 215, w: 7, h: 70, color: '#ffffff', intensity: 6 },
        { elev: 10, azim: 325, w: 7, h: 70, color: '#ffffff', intensity: 5 },
        // a low horizontal strip for the inside of the shank
        { elev: -8, azim: 90, w: 80, h: 5, color: '#ffffff', intensity: 4 },
        { elev: -8, azim: 270, w: 80, h: 5, color: '#ffffff', intensity: 4 },
        ...spots(8, 42, 1.8, 40, '#ffffff', 22),
      ],
    },
    background: ['#fbfaf8', '#d9d8d4'],
    exposure: 1.0,
  },
  boutique: {
    label: 'Boutique Spotlights',
    description: 'Many small halogen spots — maximum sparkle and fire.',
    dome: { top: '#3d352e', horizon: '#1c1814', bottom: '#080706', intensity: 1 },
    panels: [
      ...spots(10, 62, 2.2, 90, '#fff3e0', 0),
      ...spots(8, 38, 2.0, 70, '#fff3e0', 22),
      ...spots(5, 80, 2.5, 90, '#fffaf2', 10),
      { elev: 18, azim: 90, w: 70, h: 6, color: '#ffe9cc', intensity: 1.2 },
    ],
    metal: {
      dome: { top: '#4a4038', horizon: '#14110e', bottom: '#2a241e', intensity: 1 },
      panels: [
        { elev: 60, azim: 40, w: 36, h: 28, color: '#fff1dc', intensity: 3.5 },
        { elev: 60, azim: 200, w: 36, h: 28, color: '#fff1dc', intensity: 2.5 },
        { elev: 12, azim: 120, w: 6, h: 60, color: '#ffe9cc', intensity: 5 },
        { elev: 12, azim: 300, w: 6, h: 60, color: '#ffe9cc', intensity: 5 },
        { elev: -55, azim: 0, w: 120, h: 40, color: '#e8dccb', intensity: 0.9 },
        ...spots(10, 62, 2.2, 60, '#fff3e0', 0),
      ],
    },
    background: ['#2b2622', '#0c0a08'],
    exposure: 1.0,
  },
  daylight: {
    label: 'Daylight',
    description: 'Open sky with sun — how the ring looks outdoors.',
    dome: { top: '#9cc3ff', horizon: '#e9f0f7', bottom: '#5a5248', intensity: 1.6 },
    panels: [{ elev: 55, azim: 120, w: 1.6, h: 1.6, color: '#fff7e8', intensity: 2400, round: true }],
    metal: {
      dome: { top: '#5d86c4', horizon: '#9aa4ae', bottom: '#2a2620', intensity: 1 },
      panels: [{ elev: 55, azim: 120, w: 1.6, h: 1.6, color: '#fff7e8', intensity: 2400, round: true }],
    },
    background: ['#f7f6f2', '#dfe7f0'],
    exposure: 0.85,
  },
  candlelight: {
    label: 'Candlelight',
    description: 'Warm, dim, few point sources — evening dinner.',
    dome: { top: '#120a05', horizon: '#1c1008', bottom: '#050302', intensity: 1 },
    panels: [
      ...spots(3, 18, 1.5, 160, '#ffb466', 30),
      ...spots(2, 35, 1.2, 120, '#ffc27a', 200),
    ],
    metal: {
      dome: { top: '#2a1a10', horizon: '#120a05', bottom: '#20140b', intensity: 1 },
      panels: [
        // candle flames read as warm glows on the metal
        { elev: 18, azim: 30, w: 14, h: 22, color: '#ffb466', intensity: 4 },
        { elev: 18, azim: 150, w: 14, h: 22, color: '#ffb466', intensity: 3 },
        { elev: 35, azim: 200, w: 12, h: 18, color: '#ffc27a', intensity: 3 },
        { elev: -50, azim: 0, w: 120, h: 40, color: '#5a3a22', intensity: 1 },
        ...spots(3, 18, 1.5, 120, '#ffb466', 30),
      ],
    },
    background: ['#3a2414', '#0e0805'],
    exposure: 1.25,
  },
  office: {
    label: 'Office',
    description: 'Overhead fluorescent panels — everyday indoor light.',
    dome: { top: '#c9ccd0', horizon: '#8e9196', bottom: '#4a4b4e', intensity: 0.7 },
    panels: [
      { elev: 70, azim: 0, w: 24, h: 10, color: '#f4f8ff', intensity: 6 },
      { elev: 70, azim: 90, w: 24, h: 10, color: '#f4f8ff', intensity: 6 },
      { elev: 70, azim: 180, w: 24, h: 10, color: '#f4f8ff', intensity: 6 },
      { elev: 70, azim: 270, w: 24, h: 10, color: '#f4f8ff', intensity: 6 },
      { elev: 40, azim: 45, w: 28, h: 8, color: '#f4f8ff', intensity: 4 },
      { elev: 40, azim: 225, w: 28, h: 8, color: '#f4f8ff', intensity: 4 },
    ],
    metal: {
      dome: { top: '#4a4c50', horizon: '#26272a', bottom: '#141516', intensity: 1 },
      panels: [
        { elev: 70, azim: 0, w: 24, h: 10, color: '#f4f8ff', intensity: 6 },
        { elev: 70, azim: 90, w: 24, h: 10, color: '#f4f8ff', intensity: 6 },
        { elev: 70, azim: 180, w: 24, h: 10, color: '#f4f8ff', intensity: 6 },
        { elev: 70, azim: 270, w: 24, h: 10, color: '#f4f8ff', intensity: 6 },
        { elev: 40, azim: 45, w: 28, h: 8, color: '#f4f8ff', intensity: 4 },
        { elev: 40, azim: 225, w: 28, h: 8, color: '#f4f8ff', intensity: 4 },
        { elev: -50, azim: 0, w: 120, h: 40, color: '#d8d8d8', intensity: 0.8 },
      ],
    },
    background: ['#f2f3f5', '#d6d8dc'],
    exposure: 0.95,
  },
};

export const ENVIRONMENT_ORDER: EnvironmentId[] = ['studio', 'boutique', 'daylight', 'candlelight', 'office'];

/** Optional photographic HDRIs (equirectangular .hdr placed in /public/hdri). */
export const HDRI_PRESETS: { id: string; label: string; url: string }[] = [
  // { id: 'studio-small-09', label: 'Studio (HDRI)', url: 'hdri/studio_small_09_2k.hdr' },
];

const RADIUS = 100;

function buildLightRoom(p: { dome: EnvironmentPreset['dome']; panels: LightPanel[] }): Scene {
  const scene = new Scene();
  const dome = new Mesh(
    new SphereGeometry(RADIUS, 64, 32),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new Color(p.dome.top).multiplyScalar(p.dome.intensity) },
        horizon: { value: new Color(p.dome.horizon).multiplyScalar(p.dome.intensity) },
        bottom: { value: new Color(p.dome.bottom).multiplyScalar(p.dome.intensity) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom;
        varying vec3 vDir;
        void main() {
          float y = vDir.y;
          vec3 c = y > 0.0 ? mix(horizon, top, pow(y, 0.6)) : mix(horizon, bottom, pow(-y, 0.4));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  scene.add(dome);

  const plane = new PlaneGeometry(1, 1);
  const disc = new SphereGeometry(0.5, 24, 12);
  for (const l of p.panels) {
    const el = (l.elev * Math.PI) / 180;
    const az = (l.azim * Math.PI) / 180;
    const r = RADIUS * 0.9;
    const mat = new MeshBasicMaterial({ color: new Color(l.color).multiplyScalar(l.intensity) });
    const mesh = new Mesh(l.round ? disc : plane, mat);
    mesh.position.set(r * Math.cos(el) * Math.sin(az), r * Math.sin(el), r * Math.cos(el) * Math.cos(az));
    mesh.lookAt(0, 0, 0);
    const w = 2 * r * Math.tan(((l.w / 2) * Math.PI) / 180);
    const h = 2 * r * Math.tan(((l.h / 2) * Math.PI) / 180);
    mesh.scale.set(w, h, l.round ? w : 1);
    scene.add(mesh);
  }
  // a floor bounce card under the ring
  const floor = new Mesh(new BoxGeometry(60, 0.1, 60), new MeshBasicMaterial({ color: new Color(p.dome.bottom).multiplyScalar(1.5) }));
  floor.position.y = -30;
  scene.add(floor);
  return scene;
}

export interface BakedEnvironment {
  /** Sharp HDR cube map for the ray-traced gems. */
  cube: Texture;
  /** What metal reflects (the renderer prefilters it for roughness). */
  metal: Texture;
  dispose(): void;
}

function bakeRoom(renderer: WebGLRenderer, room: { dome: EnvironmentPreset['dome']; panels: LightPanel[] }, size: number) {
  const target = new WebGLCubeRenderTarget(size, {
    type: HalfFloatType,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
  });
  const cam = new CubeCamera(0.1, 500, target);
  const scene = buildLightRoom(room);
  cam.update(renderer, scene);
  scene.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose();
      (o.material as MeshBasicMaterial).dispose();
    }
  });
  return target;
}

export function bakeEnvironment(renderer: WebGLRenderer, preset: EnvironmentPreset, size = 1024): BakedEnvironment {
  const gem = bakeRoom(renderer, preset, size);
  const metal = preset.metal ? bakeRoom(renderer, preset.metal, 512) : null;
  return {
    cube: gem.texture,
    metal: (metal ?? gem).texture,
    dispose() {
      gem.dispose();
      metal?.dispose();
    },
  };
}

export async function bakeHDRI(renderer: WebGLRenderer, url: string, size = 1024): Promise<BakedEnvironment> {
  const tex = await new RGBELoader().loadAsync(url);
  tex.mapping = EquirectangularReflectionMapping;
  const target = new WebGLCubeRenderTarget(size, { type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter });
  target.fromEquirectangularTexture(renderer, tex);
  tex.dispose();
  return {
    cube: target.texture,
    metal: target.texture,
    dispose() {
      target.dispose();
    },
  };
}
