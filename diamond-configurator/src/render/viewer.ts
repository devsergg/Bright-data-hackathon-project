/**
 * Viewer: renderer, camera, orbit controls, post-processing and lighting.
 */
import {
  ACESFilmicToneMapping,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  MeshPhysicalMaterial,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { bakeEnvironment, ENVIRONMENTS, type BakedEnvironment, type EnvironmentId } from './environments';

export const VIEW_PRESETS = ['hero', 'top', 'side', 'front', 'hand'] as const;
export type ViewPreset = (typeof VIEW_PRESETS)[number];

export class Viewer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private env: BakedEnvironment | null = null;
  private envCache = new Map<EnvironmentId, BakedEnvironment>();
  private shadow: Mesh;
  private pathLine: Line | null = null;
  private tween: { from: Vector3; to: Vector3; t0: number; dur: number } | null = null;
  private readonly container: HTMLElement;
  private onFrame: (() => void)[] = [];
  private finger: Mesh;
  private backdropOverride: [string, string] | null = null;
  private envId: EnvironmentId | null = null;
  bloomEnabled = true;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    container.appendChild(this.renderer.domElement);

    this.camera = new PerspectiveCamera(30, 1, 0.5, 2000);
    this.camera.position.set(38, 30, 52);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 14;
    this.controls.maxDistance = 220;
    this.controls.autoRotateSpeed = 0.9;
    this.controls.target.set(0, 10, 0);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // only the brightest glints bloom — subtle "sparkle", not a glow
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), 0.18, 0.1, 2.2);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.shadow = makeContactShadow();
    this.scene.add(this.shadow);

    this.finger = makeFinger();
    this.finger.visible = false;
    this.scene.add(this.finger);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  setEnvironment(id: EnvironmentId): BakedEnvironment {
    let env = this.envCache.get(id);
    if (!env) {
      env = bakeEnvironment(this.renderer, ENVIRONMENTS[id]);
      this.envCache.set(id, env);
    }
    this.env = env;
    this.scene.environment = env.pmrem;
    if (this.envId !== id) {
      this.envId = id;
      this.applyBackdrop();
    }
    return env;
  }

  /**
   * Override the studio backdrop (e.g. to follow the page's light/dark theme).
   * Only the neutral studio preset is overridden; mood presets keep their own.
   */
  setBackdrop(colors: [string, string] | null): void {
    this.backdropOverride = colors;
    this.applyBackdrop();
  }

  private applyBackdrop(): void {
    if (!this.envId) return;
    const own = ENVIRONMENTS[this.envId].background;
    const [inner, outer] = this.envId === 'studio' && this.backdropOverride ? this.backdropOverride : own;
    if (this.scene.background instanceof CanvasTexture) this.scene.background.dispose();
    this.scene.background = makeBackdrop(inner, outer);
    this.container.style.background = outer;
  }

  /** Try-on finger running through the band (finger axis = Z, fingertip toward +Z). */
  setFinger(visible: boolean, innerDiameterMm: number, skin: string): void {
    this.finger.visible = visible;
    const r = innerDiameterMm / 2 - 0.05;
    if (Math.abs((this.finger.userData.r ?? 0) - r) > 1e-3) {
      this.finger.geometry.dispose();
      this.finger.geometry = fingerGeometry(r);
      this.finger.userData.r = r;
    }
    (this.finger.material as MeshPhysicalMaterial).color.set(new Color(skin));
    this.shadow.visible = !visible;
  }

  /** Rotate the PMREM used by metals together with the gem environment. */
  setEnvironmentRotation(deg: number): void {
    this.scene.environmentRotation.set(0, (deg * Math.PI) / 180, 0);
  }

  get environment(): BakedEnvironment {
    return this.env!;
  }

  setExposure(e: number, preset: EnvironmentId): void {
    this.renderer.toneMappingExposure = e * ENVIRONMENTS[preset].exposure;
  }

  setToneMapping(mode: 'neutral' | 'aces'): void {
    this.renderer.toneMapping = mode === 'aces' ? ACESFilmicToneMapping : NeutralToneMapping;
  }

  setShadow(y: number, size: number): void {
    this.shadow.position.y = y;
    this.shadow.scale.setScalar(size);
  }

  addFrameCallback(cb: () => void): void {
    this.onFrame.push(cb);
  }

  /** Smoothly move the camera to a preset viewpoint around `target`. */
  setView(view: ViewPreset, target: Vector3, radius: number): void {
    // distance that fits a sphere of `radius` in the narrower of the two fields of view
    const vfov = (this.camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const d = (radius / Math.sin(Math.min(vfov, hfov) / 2)) * 0.92;
    const dirs: Record<ViewPreset, Vector3> = {
      hero: new Vector3(0.55, 0.42, 0.72),
      top: new Vector3(0, 1, -0.0001), // +Z (fingertip direction) at the top of the screen
      side: new Vector3(1, 0.08, 0),
      front: new Vector3(0, 0.08, 1),
      hand: new Vector3(0.18, 0.74, -0.62), // from the wrist, fingertip pointing away
    };
    this.controls.target.copy(target);
    this.tween = {
      from: this.camera.position.clone(),
      to: target.clone().addScaledVector(dirs[view].normalize(), d),
      t0: performance.now(),
      dur: 700,
    };
  }

  /** Ray from a pointer event, for picking. */
  pick(ev: PointerEvent | MouseEvent, objects: Object3D[]) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    const rc = new Raycaster();
    rc.setFromCamera(ndc, this.camera);
    return { hits: rc.intersectObjects(objects, false), ray: rc.ray };
  }

  /** Draw a light path (world-space points); null clears it. */
  showPath(points: Vector3[] | null): void {
    if (this.pathLine) {
      this.scene.remove(this.pathLine);
      this.pathLine.geometry.dispose();
      this.pathLine = null;
    }
    if (!points || points.length < 2) return;
    const g = new BufferGeometry().setFromPoints(points);
    this.pathLine = new Line(g, new LineBasicMaterial({ color: 0xff3d6e, depthTest: false, transparent: true }));
    this.pathLine.renderOrder = 999;
    this.scene.add(this.pathLine);
  }

  snapshot(): string {
    this.render();
    return this.renderer.domElement.toDataURL('image/png');
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  private frame(): void {
    if (this.tween) {
      const t = Math.min(1, (performance.now() - this.tween.t0) / this.tween.dur);
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      this.camera.position.lerpVectors(this.tween.from, this.tween.to, e);
      if (t >= 1) this.tween = null;
    }
    this.controls.update();
    for (const cb of this.onFrame) cb();
    this.render();
  }

  private render(): void {
    if (this.bloomEnabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}

/** Radial-gradient backdrop drawn behind the scene. */
function makeBackdrop(inner: string, outer: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(256, 210, 0, 256, 256, 380);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Capsule ~70 mm long, from knuckle to fingertip, along Z. */
function fingerGeometry(r: number): CapsuleGeometry {
  const g = new CapsuleGeometry(r, 70 - 2 * r, 12, 48);
  g.rotateX(Math.PI / 2);
  return g;
}

function makeFinger(): Mesh {
  const g = fingerGeometry(8);
  const mat = new MeshPhysicalMaterial({
    color: 0xe0ac85,
    roughness: 0.72,
    sheen: 0.25,
    sheenRoughness: 0.6,
    sheenColor: new Color(1, 0.8, 0.72),
    clearcoat: 0.05,
    clearcoatRoughness: 0.7,
  });
  const m = new Mesh(g, mat);
  m.position.z = -12;
  m.name = 'finger';
  return m;
}

/** Soft radial contact shadow under the ring. */
function makeContactShadow(): Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(0,0,0,0.38)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.16)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const m = new Mesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = -1;
  return m;
}
