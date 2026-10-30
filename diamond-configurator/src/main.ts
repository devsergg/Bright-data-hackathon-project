import './ui/styles.css';
import { Box3, Vector3 } from 'three';
import { exportGemOBJ, exportGemSTL, exportRingGLB, exportSpecJSON } from './export/exporters';
import { analyzeLight, GemTracer } from './gems/lightPerformance';
import type { DiamondQuality } from './render/diamondMaterial';
import { VIEW_PRESETS, Viewer, type ViewPreset } from './render/viewer';
import { METAL_ORDER } from './render/metals';
import { RingAssembly } from './ring/assembly';
import { benchCheck, compareMetals, type BenchReport } from './ring/metallurgy';
import { loadManifest, loadSetting, type LoadedSetting, type SettingManifestEntry } from './ring/rhinoSetting';
import { COLLECTION, designConfig } from './showcase/collections';
import {
  configFromLocation,
  DEFAULT_CONFIG,
  encodeConfig,
  SKIN_TONES,
  Store,
  writeLocation,
  type QualityLevel,
  type RingConfig,
} from './state';
import { Builder } from './ui/builder';
import { mountCollections, SavedDesigns } from './ui/gallery';
import { photoModal, shareModal } from './ui/modal';
import { mountStageControls } from './ui/stage';
import { channelIORs, usRingSizeToInnerDiameter } from './units';

/** `effects`: screen-space reflections + ambient occlusion (off on low for older phones). */
const QUALITY: Record<QualityLevel, DiamondQuality & { dpr: number; effects: boolean }> = {
  high: { bounces: 8, fullDispersion: true, dpr: 2, effects: true },
  medium: { bounces: 6, fullDispersion: false, dpr: 1.5, effects: true },
  low: { bounces: 4, fullDispersion: false, dpr: 1, effects: false },
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
  'showFinger',
  'skinTone',
]);

/** Small square JPEG for the saved-designs list. */
async function thumbnail(dataUrl: string, size = 240): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  c.getContext('2d')!.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
  return c.toDataURL('image/jpeg', 0.8);
}

function boot(): void {
  const viewerEl = document.getElementById('viewer')!;
  const stageEl = document.getElementById('stage')!;
  const builderEl = document.getElementById('builder')!;
  const toast = document.getElementById('toast')!;
  const params = new URLSearchParams(location.search);
  // ?capture=<design id>: render-only stage, used to make the Collections thumbnails
  const capture = params.get('capture');
  if (capture) document.body.classList.add('capture');

  if (!document.createElement('canvas').getContext('webgl2')) {
    viewerEl.innerHTML = '<p class="fatal">This viewer needs WebGL 2. Please use a current Chrome, Safari, Edge or Firefox.</p>';
    return;
  }

  const design = capture ? COLLECTION.find((d) => d.id === capture) : undefined;
  const initial = design ? designConfig(design) : configFromLocation();
  // ?quality=low|medium|high overrides; phones default to medium
  const qp = params.get('quality') as QualityLevel | null;
  if (qp && qp in QUALITY) initial.quality = qp;
  else if (!location.hash && matchMedia('(pointer: coarse)').matches) initial.quality = 'medium';
  if (params.has('still') || capture) initial.autoRotate = false;
  const store = new Store(initial);
  const viewer = new Viewer(viewerEl);
  if (import.meta.env.DEV) Object.assign(window, { __viewer: viewer });
  let cfg = store.get();
  let env = viewer.setEnvironment(cfg.environment);
  const assembly = new RingAssembly(env.cube, QUALITY[cfg.quality]);
  viewer.add(assembly.group);

  const manifest: SettingManifestEntry[] = [];
  const rhinoCache = new Map<string, LoadedSetting>();
  let rhino: LoadedSetting | null = null;
  let framed = false;
  let lastBench: BenchReport | null = null;

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
    if (stone) center.lerp(stone, 0.25);
    return { center, radius: (box.getSize(new Vector3()).length() / 2) * 0.92 };
  };

  const setView = (v: ViewPreset) => {
    const b = sceneBounds();
    if (v === 'top' || v === 'side' || v === 'front') {
      // focus on the centre stone for detail views
      const c = new Vector3();
      assembly.centerStone!.getWorldPosition(c);
      viewer.setView(v, c, Math.max(5, assembly.centerGem!.metrics.lengthMm * 1.1));
    } else viewer.setView(v, b.center, b.radius);
  };

  const shareUrl = () => `${location.origin}${location.pathname}#c=${encodeConfig(store.get())}`;
  const studio = document.getElementById('studio')!;
  const openInStudio = () => {
    builder.goTo('review');
    studio.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };

  const builder = new Builder(builderEl, store, {
    onShare: () => shareModal(shareUrl()),
    onPhoto: () => photoModal(viewer.snapshot(), `ring-${store.get().cut}.png`),
    onSave: async () => {
      const ok = saved.save(store.get(), await thumbnail(viewer.snapshot()));
      notify(ok ? 'Saved to this browser' : 'This browser blocks saving — copy a share link instead');
    },
    onReset: () => {
      const c = store.get();
      store.set({ ...DEFAULT_CONFIG, environment: c.environment, quality: c.quality, showFinger: c.showFinger, skinTone: c.skinTone });
      builder.goTo('shape');
    },
    onExport: (kind) => {
      const gem = assembly.centerGem!;
      if (kind === 'obj') exportGemOBJ(gem);
      if (kind === 'stl') exportGemSTL(gem);
      if (kind === 'json') exportSpecJSON(store.get(), gem, lastBench);
      if (kind === 'glb') void exportRingGLB(assembly.group, `ring-${store.get().cut}`);
    },
  });
    mountStageControls(stageEl, store, { onView: setView });
  mountCollections(document.getElementById('collection-grid')!, store, openInStudio);
  const saved = new SavedDesigns(document.getElementById('saved-grid')!, store, openInStudio);

  // the studio backdrop follows the page theme
  const syncBackdrop = () => {
    const cs = getComputedStyle(document.documentElement);
    viewer.setBackdrop([cs.getPropertyValue('--stage-in').trim(), cs.getPropertyValue('--stage-out').trim()]);
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncBackdrop);
  new MutationObserver(syncBackdrop).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------------------------------------------------------------- light analysis (debounced, idle)
  let lightTimer = 0;
  const scheduleLight = () => {
    builder.showLight(null);
    clearTimeout(lightTimer);
    lightTimer = window.setTimeout(() => {
      const gem = assembly.centerGem;
      if (!gem || !assembly.centerBVH) return;
      builder.showLight(analyzeLight(gem, 72, new GemTracer(gem, assembly.centerBVH)));
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
    viewer.renderScale = Math.min(window.devicePixelRatio, q.dpr);
    viewer.setEffects(q.effects);
    viewer.bloomEnabled = c.bloom;
    viewer.controls.autoRotate = c.autoRotate;
    viewer.setFinger(c.showFinger, usRingSizeToInnerDiameter(c.ringSize), SKIN_TONES[c.skinTone] ?? SKIN_TONES[1]);
    viewer.invalidate();
  };

  const rebuild = (c: RingConfig) => {
    rhino = c.rhinoSetting ? (rhinoCache.get(c.rhinoSetting) ?? null) : null;
    assembly.update(c, rhino);
    applyCheap(c);
    const gem = assembly.centerGem!;
    builder.showMetrics(gem.metrics);
    // prong / band checks describe the procedural head; a Rhino head is checked in Rhino
    const bench = rhino
      ? null
      : benchCheck(c, gem, {
          metalVolumeMm3: assembly.metalVolumeMm3,
          bezelWallMm: assembly.bezelWallMm ?? undefined,
          meleeMm: assembly.paveMeleeMm ?? undefined,
        });
    lastBench = bench;
    builder.showBench(bench, compareMetals(gem, assembly.metalVolumeMm3, METAL_ORDER));
    if (rhino) {
      // does the chosen stone fit the head the jeweller modelled?
      const nominal = rhino.seatWidthsMm[0] || rhino.entry.nominalStoneMm;
      if (rhino.entry.cuts?.length && !rhino.entry.cuts.includes(c.cut)) {
        notify(`${rhino.entry.name} is designed for ${rhino.entry.cuts.join(', ')} stones`);
      } else if (nominal && Math.abs(gem.metrics.widthMm - nominal) > 0.25) {
        notify(`Stone is ${gem.metrics.widthMm.toFixed(2)} mm; this head is made for ${nominal.toFixed(2)} mm`);
      }
    }
    const ro = usRingSizeToInnerDiameter(c.ringSize) / 2 + c.bandThickness;
    viewer.setShadow(-ro - 0.05, ro * 3.2);
    if (!framed) {
      // ?view=top|side|front|hand opens on that preset (handy for share links and captures)
      const v = params.get('view') as ViewPreset | null;
      if (v && VIEW_PRESETS.includes(v)) setView(v);
      else {
        const b = sceneBounds();
        viewer.setView('hero', b.center, b.radius);
      }
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

  syncBackdrop();
  rebuild(cfg);
  // signal capture scripts once a few frames have rendered
  let frames = 0;
  viewer.addFrameCallback(() => {
    if (++frames === 12) document.body.dataset.ready = '1';
  });

  void loadManifest().then((m) => {
    manifest.push(...m);
    builder.setManifest(m);
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
