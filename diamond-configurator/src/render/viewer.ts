/**
 * Viewer: threepipe + webgi realistic-rendering pipeline.
 *
 *   ProgressivePlugin + SSAAPlugin  jittered frames accumulate while the view is still
 *                                   (clean edges on facets and prong tips)
 *   GBufferPlugin                   depth / normals for the screen-space passes
 *   SSAOPlugin                      contact darkening where prongs meet band and stone
 *   SSReflectionPlugin              metal reflects the stone and the other prongs
 *   TemporalAAPlugin                stable edges while orbiting
 *   BloomPlugin                     only the hottest glints bloom (sparkle, not glow)
 *   ContactShadowGroundPlugin       real shadow of the band and head on the backdrop
 *
 * Rendering is on demand: threepipe redraws only after {@link Viewer.invalidate}
 * (or camera / scene events), then refines for `maxFrameCount` frames.
 */
import {
  ACESFilmicToneMapping,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  ContactShadowGroundPlugin,
  GBufferPlugin,
  Line,
  LineBasicMaterial,
  Mesh,
  NeutralToneMapping,
  type Object3D,
  OrbitControls3,
  PerspectiveCamera2,
  PhysicalMaterial,
  ProgressivePlugin,
  Raycaster,
  SRGBColorSpace,
  SSAAPlugin,
  SSAOPlugin,
  ThreeViewer,
  TonemapPlugin,
  Vector2,
  Vector3,
} from 'threepipe';
import { BloomPlugin, SSReflectionPlugin, TemporalAAPlugin } from '@threepipe/webgi-plugins';
import { bakeEnvironment, ENVIRONMENTS, type BakedEnvironment, type EnvironmentId } from './environments';

export const VIEW_PRESETS = ['hero', 'top', 'side', 'front', 'hand'] as const;
export type ViewPreset = (typeof VIEW_PRESETS)[number];

export class Viewer {
  readonly three: ThreeViewer;
  readonly camera: PerspectiveCamera2;
  readonly controls: OrbitControls3;
  private env: BakedEnvironment | null = null;
  private envCache = new Map<EnvironmentId, BakedEnvironment>();
  private ground: ContactShadowGroundPlugin;
  private bloom: BloomPlugin;
  private tonemap: TonemapPlugin;
  private pathLine: Line | null = null;
  private tween: { from: Vector3; to: Vector3; t0: number; dur: number } | null = null;
  private readonly container: HTMLElement;
  private finger: Mesh;
  private backdropOverride: [string, string] | null = null;
  private envId: EnvironmentId | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.three = new ThreeViewer({
      container,
      msaa: false,
      // half-float pipeline: the light room's spots are far above RGBM's range,
      // and the gem's brightest glints must survive to bloom
      rgbm: false,
      maxHDRIntensity: 72,
      renderScale: 'auto',
      tonemap: true,
      plugins: [new ProgressivePlugin(48), SSAAPlugin],
    });
    this.three.renderManager.webglRenderer.domElement.style.touchAction = 'none';
    this.three.addPluginsSync([GBufferPlugin, SSAOPlugin, TemporalAAPlugin, BloomPlugin, SSReflectionPlugin, ContactShadowGroundPlugin]);

    this.tonemap = this.three.getPlugin(TonemapPlugin)!;
    this.tonemap.toneMapping = NeutralToneMapping;

    // only the brightest glints bloom
    this.bloom = this.three.getPlugin(BloomPlugin)!;
    this.bloom.pass!.threshold = 2.6;
    this.bloom.pass!.intensity = 0.18;
    this.bloom.pass!.radius = 0.5;

    const ssr = this.three.getPlugin(SSReflectionPlugin)!;
    ssr.pass!.intensity = 1;

    const ssao = this.three.getPlugin(SSAOPlugin)!;
    ssao.pass!.intensity = 0.6;

    // shadow catcher: transparent ground, opaque only where the ring occludes it
    this.ground = this.three.getPlugin(ContactShadowGroundPlugin)!;
    this.ground.autoAdjustTransform = false;
    this.ground.shadowHeight = 14;
    this.ground.blurAmount = 2.2;
    this.ground.mapMode = 'alphaMap';
    this.ground.material!.color!.set(0x000000);
    this.ground.material!.opacity = 0.5;
    this.ground.refresh();

    const cam = this.three.scene.mainCamera as PerspectiveCamera2;
    this.camera = cam;
    cam.fov = 30;
    cam.userData.minNearPlane = 0.5;
    cam.userData.maxFarPlane = 2000;
    cam.position.set(38, 30, 52);
    cam.target.set(0, 10, 0);
    cam.setDirty();
    this.controls = cam.controls as OrbitControls3;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 14;
    this.controls.maxDistance = 220;
    this.controls.autoRotateSpeed = 0.9;

    this.finger = makeFinger();
    this.finger.visible = false;
    this.three.scene.addObject(this.finger, { addToRoot: true });

    this.three.addEventListener('preFrame', () => this.frame());
  }

  /** Add the ring (or anything else) to the scene. */
  add(obj: Object3D): void {
    this.three.scene.addObject(obj, { autoCenter: false, autoScale: false });
  }

  /** Ask for a fresh render (and a new progressive refinement). */
  invalidate(): void {
    this.three.setDirty();
  }

  setEnvironment(id: EnvironmentId): BakedEnvironment {
    let env = this.envCache.get(id);
    if (!env) {
      env = bakeEnvironment(this.three.renderManager.webglRenderer, ENVIRONMENTS[id]);
      this.envCache.set(id, env);
    }
    if (this.env !== env) {
      this.env = env;
      this.three.scene.autoDisposeSceneMaps = false;
      this.three.scene.environment = env.metal as never;
    }
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
    const scene = this.three.scene;
    const old = scene.background;
    scene.backgroundColor = new Color(0xffffff); // multiplies the backdrop texture
    scene.background = makeBackdrop(inner, outer) as never;
    if (old instanceof CanvasTexture) old.dispose();
    this.container.style.background = outer;
    this.invalidate();
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
    (this.finger.material as PhysicalMaterial).color.set(new Color(skin));
    this.ground.visible = !visible;
    this.invalidate();
  }

  /** Rotate the environment used by metals together with the gem environment. */
  setEnvironmentRotation(deg: number): void {
    this.three.scene.environmentRotation.set(0, (deg * Math.PI) / 180, 0);
  }

  get environment(): BakedEnvironment {
    return this.env!;
  }

  setExposure(e: number, preset: EnvironmentId): void {
    this.tonemap.exposure = e * ENVIRONMENTS[preset].exposure;
  }

  setToneMapping(mode: 'neutral' | 'aces'): void {
    this.tonemap.toneMapping = mode === 'aces' ? ACESFilmicToneMapping : NeutralToneMapping;
  }

  set bloomEnabled(on: boolean) {
    if (this.bloom.enabled !== on) this.bloom.enabled = on;
  }

  set renderScale(s: number) {
    const rm = this.three.renderManager;
    if (Math.abs(rm.renderScale - s) > 1e-3) rm.renderScale = s;
  }

  /** Screen-space reflections and ambient occlusion on/off (the costly passes). */
  setEffects(on: boolean): void {
    for (const p of [this.three.getPlugin(SSReflectionPlugin), this.three.getPlugin(SSAOPlugin)]) {
      if (p && p.enabled !== on) p.enabled = on;
    }
  }

  /** Ground (shadow catcher) height and size, mm. */
  setShadow(y: number, size: number): void {
    this.ground.yOffset = -y;
    this.ground.size = size;
    const mesh = (this.ground as unknown as { _mesh?: Mesh })._mesh;
    if (mesh) {
      mesh.position.set(0, y, 0);
      mesh.scale.setScalar(size);
    }
    this.ground.refresh();
    this.invalidate();
  }

  addFrameCallback(cb: () => void): void {
    this.three.addEventListener('preFrame', cb);
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
    this.camera.target.copy(target);
    this.tween = {
      from: this.camera.position.clone(),
      to: target.clone().addScaledVector(dirs[view].normalize(), d),
      t0: performance.now(),
      dur: 700,
    };
  }

  /** Ray from a pointer event, for picking. */
  pick(ev: PointerEvent | MouseEvent, objects: Object3D[]) {
    const r = this.three.canvas.getBoundingClientRect();
    const ndc = new Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    const rc = new Raycaster();
    rc.setFromCamera(ndc, this.camera);
    return { hits: rc.intersectObjects(objects, false), ray: rc.ray };
  }

  /** Draw a light path (world-space points); null clears it. */
  showPath(points: Vector3[] | null): void {
    if (this.pathLine) {
      this.pathLine.removeFromParent();
      this.pathLine.geometry.dispose();
      this.pathLine = null;
    }
    if (points && points.length >= 2) {
      const g = new BufferGeometry().setFromPoints(points);
      this.pathLine = new Line(g, new LineBasicMaterial({ color: 0xff3d6e, depthTest: false, transparent: true }));
      this.pathLine.renderOrder = 999;
      this.pathLine.userData.bboxVisible = false;
      this.three.scene.addObject(this.pathLine, { addToRoot: true });
    }
    this.invalidate();
  }

  /** PNG of the fully refined frame. */
  snapshot(): string {
    return this.three.canvas.toDataURL('image/png');
  }

  private frame(): void {
    if (!this.tween) return;
    const t = Math.min(1, (performance.now() - this.tween.t0) / this.tween.dur);
    const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    this.camera.position.lerpVectors(this.tween.from, this.tween.to, e);
    this.camera.setDirty();
    if (t >= 1) this.tween = null;
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
  const mat = new PhysicalMaterial({
    color: 0xe0ac85,
    roughness: 0.72,
    sheen: 0.25,
    sheenRoughness: 0.6,
    sheenColor: new Color(1, 0.8, 0.72),
    clearcoat: 0.05,
    clearcoatRoughness: 0.7,
  });
  mat.userData.ssreflDisabled = true;
  const m = new Mesh(g, mat);
  m.position.z = -12;
  m.name = 'finger';
  m.userData.bboxVisible = false;
  return m;
}
