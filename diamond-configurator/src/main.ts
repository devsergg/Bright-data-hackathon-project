import './ui/styles.css';
import { Box3, Vector3 } from 'three';
import { exportGemOBJ, exportGemSTL, exportRingGLB, exportSpecJSON, download } from './export/exporters';
import { analyzeLight, GemTracer } from './gems/lightPerformance';
import type { DiamondQuality } from './render/diamondMaterial';
import { Viewer, type ViewPreset } from './render/viewer';
import { RingAssembly } from './ring/assembly';
import { loadManifest, loadSetting, type LoadedSetting, type SettingManifestEntry } from './ring/rhinoSetting';
import { configFromLocation, encodeConfig, Store, writeLocation, type QualityLevel, type RingConfig } from './state';
import { Panel } from './ui/panel';
import { channelIORs, usRingSizeToInnerDiameter } from './units';

const QUALITY: Record<QualityLevel, DiamondQuality & { dpr: number }> = {
  high: { bounces: 8, fullDispersion: true, dpr: 2 },
  medium: { bounces: 6, fullDispersion: false, dpr: 1.5 },
  low: { bounces: 4, fullDispersion: false, dpr: 1 },
};

/** Changes that only touch uniforms / renderer state, never the geometry. */
const CHEAP_KEYS = new Set<keyof RingConfig>([
  'environment',
  'envRotation',
  'exposure',
  'dispersion',
  'quality',
  'bloom',
  'autoRotate',
  'clarity',
  'engraving',
]);

function boot(): void {
  const viewerEl = document.getElementById('viewer')!;
  const panelEl = document.getElementById('panel')!;
  const toast = document.getElementById('toast')!;

  if (!document.createElement('canvas').getContext('webgl2')) {
    viewerEl.innerHTML = '<p class="fatal">This viewer needs WebGL 2. Please use a current Chrome, Safari, Edge or Firefox.</p>';
    return;
  }

  const initial = configFromLocation();
  // ?quality=low|medium|high overrides; phones default to medium
  const qp = new URLSearchParams(location.search).get('quality') as QualityLevel | null;
  if (qp && qp in QUALITY) initial.quality = qp;
  else if (!location.hash && matchMedia('(pointer: coarse)').matches) initial.quality = 'medium';
  if (new URLSearchParams(location.search).has('still')) initial.autoRotate = false;
  const store = new Store(initial);
  const viewer = new Viewer(viewerEl);
  let cfg = store.get();
  let env = viewer.setEnvironment(cfg.environment);
  const assembly = new RingAssembly(env.cube, QUALITY[cfg.quality]);
  viewer.scene.add(assembly.group);

  const manifest: SettingManifestEntry[] = [];
  const rhinoCache = new Map<string, LoadedSetting>();
  let rhino: LoadedSetting | null = null;
  let framed = false;

  const notify = (msg: string) => {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2400);
  };

  /** Frame the whole ring, biased up toward the centre stone (the hero). */
  const sceneBounds = () => {
    const box = new Box3().setFromObject(assembly.group);
    const center = box.getCenter(new Vector3());
    const stone = assembly.centerStone?.getWorldPosition(new Vector3());
    if (stone) center.lerp(stone, 0.4);
    return { center, radius: (box.getSize(new Vector3()).length() / 2) * 0.78 };
  };

  const panel = new Panel(panelEl, store, {
    onView: (v: ViewPreset) => {
      const b = sceneBounds();
      if (v === 'top' || v === 'side' || v === 'front') {
        // focus on the centre stone for detail views
        const s = assembly.centerStone!;
        const c = new Vector3();
        s.getWorldPosition(c);
        viewer.setView(v, c, Math.max(5, assembly.centerGem!.metrics.lengthMm * 1.1));
      } else viewer.setView(v, b.center, b.radius);
    },
    onShare: async () => {
      const url = `${location.origin}${location.pathname}#c=${encodeConfig(store.get())}`;
      try {
        await navigator.clipboard.writeText(url);
        notify('Share link copied');
      } catch {
        prompt('Copy this link', url);
      }
    },
    onSnapshot: () => {
      const data = viewer.snapshot();
      const bin = atob(data.split(',')[1]);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      download(buf, `ring-${store.get().cut}.png`, 'image/png');
    },
    onExport: (kind) => {
      const gem = assembly.centerGem!;
      if (kind === 'obj') exportGemOBJ(gem);
      if (kind === 'stl') exportGemSTL(gem);
      if (kind === 'json') exportSpecJSON(store.get(), gem);
      if (kind === 'glb') void exportRingGLB(assembly.group, `ring-${store.get().cut}`);
    },
  });

  // ---------------------------------------------------------------- light analysis (debounced, idle)
  let lightTimer = 0;
  const scheduleLight = () => {
    panel.showLight(null);
    clearTimeout(lightTimer);
    lightTimer = window.setTimeout(() => {
      const gem = assembly.centerGem;
      if (!gem || !assembly.centerBVH) return;
      panel.showLight(analyzeLight(gem, 72, new GemTracer(gem, assembly.centerBVH)));
    }, 350);
  };

  // ---------------------------------------------------------------- apply state
  const applyCheap = (c: RingConfig) => {
    env = viewer.setEnvironment(c.environment);
    assembly.setEnvironment(env.cube, c.envRotation);
    viewer.setEnvironmentRotation(c.envRotation);
    viewer.setExposure(c.exposure, c.environment);
    for (const m of assembly.diamondMaterials) m.setDispersion(c.dispersion);
    const q = QUALITY[c.quality];
    assembly.setQuality(q);
    viewer.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.dpr));
    viewer.bloomEnabled = c.bloom;
    viewer.controls.autoRotate = c.autoRotate;
  };

  const rebuild = (c: RingConfig) => {
    rhino = c.rhinoSetting ? (rhinoCache.get(c.rhinoSetting) ?? null) : null;
    assembly.update(c, rhino);
    applyCheap(c);
    const gem = assembly.centerGem!;
    panel.showMetrics(gem.metrics);
    const ro = usRingSizeToInnerDiameter(c.ringSize) / 2 + c.bandThickness;
    viewer.setShadow(-ro - 0.05, ro * 3.2);
    if (!framed) {
      const b = sceneBounds();
      viewer.setView('hero', b.center, b.radius);
      framed = true;
    }
    scheduleLight();
  };

  const ensureRhino = async (c: RingConfig) => {
    if (!c.rhinoSetting || rhinoCache.has(c.rhinoSetting)) return;
    const entry = manifest.find((m) => m.id === c.rhinoSetting);
    if (!entry) return;
    try {
      notify(`Loading ${entry.name}…`);
      rhinoCache.set(entry.id, await loadSetting(entry));
      rebuild(store.get());
    } catch (e) {
      console.error(e);
      notify(`Could not load ${entry.file}`);
      store.set({ rhinoSetting: null });
    }
  };

  let urlTimer = 0;
  store.subscribe((next, prev) => {
    cfg = next;
    const changed = (Object.keys(next) as (keyof RingConfig)[]).filter((k) => next[k] !== prev[k]);
    if (changed.some((k) => !CHEAP_KEYS.has(k))) rebuild(next);
    else applyCheap(next);
    if (next.rhinoSetting !== prev.rhinoSetting) void ensureRhino(next);
    clearTimeout(urlTimer);
    urlTimer = window.setTimeout(() => writeLocation(next), 400);
  });

  rebuild(cfg);

  void loadManifest().then((m) => {
    manifest.push(...m);
    panel.setManifest(m);
    void ensureRhino(store.get());
  });

  // ---------------------------------------------------------------- click → trace a light ray
  let down: { x: number; y: number } | null = null;
  let pathTimer = 0;
  viewerEl.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
  viewerEl.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
    const stone = assembly.centerStone;
    const gem = assembly.centerGem;
    if (!stone || !gem || !assembly.centerBVH) return;
    const { hits, ray } = viewer.pick(e, [stone]);
    if (!hits.length) {
      viewer.showPath(null);
      return;
    }
    const inv = stone.matrixWorld.clone().invert();
    const o = ray.origin.clone().applyMatrix4(inv);
    const d = ray.direction.clone().transformDirection(inv);
    const tracer = new GemTracer(gem, assembly.centerBVH);
    const res = tracer.trace(o, d, { ior: channelIORs(1)[1], maxBounces: 10 });
    if (!res) return;
    const pre = res.path[0].clone().addScaledVector(d, -gem.metrics.widthMm * 0.8);
    const best = res.exits.reduce<(typeof res.exits)[number] | undefined>(
      (a, b) => (b.energy > (a?.energy ?? 0) ? b : a),
      undefined,
    );
    // draw entry → internal bounces → the strongest exit leaving the stone
    const pts = best
      ? [pre, ...res.path.slice(0, best.at + 1), res.path[best.at].clone().addScaledVector(best.dir, gem.metrics.widthMm * 0.8)]
      : [pre, ...res.path];
    viewer.showPath(pts.map((p) => p.clone().applyMatrix4(stone.matrixWorld)));
    const exitShare = best ? `${(best.energy * 100).toFixed(0)}% leaves via the ${best.kind}` : 'trapped';
    notify(`Light ray: ${res.path.length - 1} internal bounces · ${exitShare}`);
    clearTimeout(pathTimer);
    pathTimer = window.setTimeout(() => viewer.showPath(null), 9000);
  });
}

boot();
