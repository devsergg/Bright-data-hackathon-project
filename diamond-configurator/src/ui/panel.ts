/**
 * Configurator side panel (vanilla DOM). Every control reads from and writes to
 * the Store; `sync()` hooks keep controls current when state changes elsewhere
 * (share links, presets, resets).
 */
import { CUTS, CUT_ORDER, isStep } from '../gems/catalog';
import { COLOR_GRADES, COLOR_ORDER, type ColorGrade } from '../gems/color';
import type { LightReport } from '../gems/lightPerformance';
import type { BrilliantProportions, GemMetrics, StepProportions } from '../gems/types';
import { ENVIRONMENTS, ENVIRONMENT_ORDER } from '../render/environments';
import { METALS, METAL_ORDER } from '../render/metals';
import type { ViewPreset } from '../render/viewer';
import type { SettingManifestEntry } from '../ring/rhinoSetting';
import { withCut, type ClarityGrade, type RingConfig, type Store } from '../state';
import { usRingSizeToISO, usRingSizeToInnerDiameter } from '../units';
import { cutIcon } from './icons';

export interface PanelHooks {
  onView(v: ViewPreset): void;
  onShare(): void;
  onSnapshot(): void;
  onExport(kind: 'obj' | 'stl' | 'glb' | 'json'): void;
}

type Sync = (cfg: RingConfig) => void;

export class Panel {
  private syncs: Sync[] = [];
  private settingSyncs: Sync[] = [];
  private propsBox!: HTMLElement;
  private settingBox!: HTMLElement;
  private metricsBox!: HTMLElement;
  private lightCanvas!: HTMLCanvasElement;
  private lightBars!: HTMLElement;
  private summary!: HTMLElement;
  private manifest: SettingManifestEntry[] = [];
  private lastCut = '';

  constructor(private root: HTMLElement, private store: Store, private hooks: PanelHooks) {
    this.build();
    store.subscribe((cfg) => this.sync(cfg));
    this.sync(store.get());
  }

  setManifest(m: SettingManifestEntry[]): void {
    this.manifest = m;
    this.renderSettingButtons();
    this.sync(this.store.get());
  }

  // ------------------------------------------------------------- build

  private build(): void {
    const r = this.root;
    r.innerHTML = '';

    // shape
    const shape = this.section('Shape', true);
    const grid = el('div', 'shape-grid');
    for (const id of CUT_ORDER) {
      const b = el('button', 'shape-btn');
      b.innerHTML = `${cutIcon(id)}<span>${CUTS[id].name.replace(' Brilliant', '')}</span>`;
      b.title = CUTS[id].name;
      b.onclick = () => this.store.set(withCut(this.store.get(), id));
      this.syncs.push((c) => b.classList.toggle('active', c.cut === id));
      grid.append(b);
    }
    shape.append(grid);

    // stone
    const stone = this.section('Centre stone', true);
    stone.append(
      this.slider('Carat', 0.25, 5, 0.01, (c) => c.carat, (v) => ({ carat: v }), (v) => `${v.toFixed(2)} ct`),
    );
    const ratioRow = this.slider('Length ÷ width', 0.9, 2.3, 0.01, (c) => c.ratio, (v) => ({ ratio: v }), (v) => v.toFixed(2));
    this.syncs.push((c) => {
      const [lo, hi] = CUTS[c.cut].ratioRange;
      ratioRow.style.display = lo === hi ? 'none' : '';
      const input = ratioRow.querySelector('input')!;
      input.min = String(lo);
      input.max = String(hi);
    });
    stone.append(ratioRow);
    this.metricsBox = el('div', 'metrics');
    stone.append(this.metricsBox);

    stone.append(label('Colour'));
    const colors = el('div', 'chips');
    for (const g of COLOR_ORDER) {
      const b = el('button', 'chip');
      b.textContent = g.startsWith('fancy-') ? g.slice(6) : g;
      b.title = COLOR_GRADES[g].label;
      b.onclick = () => this.store.set({ color: g as ColorGrade });
      this.syncs.push((c) => b.classList.toggle('active', c.color === g));
      colors.append(b);
    }
    stone.append(colors);
    stone.append(
      this.select<ClarityGrade>(
        'Clarity',
        ['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2'].map((v) => [v as ClarityGrade, v]),
        (c) => c.clarity,
        (v) => ({ clarity: v }),
      ),
    );

    // cut geometry
    const cut = this.section('Cut geometry', false);
    cut.append(hint('Real facet angles. Changing them changes how light returns — watch the light map below.'));
    this.propsBox = el('div');
    cut.append(this.propsBox);

    // light performance
    const light = this.section('Light performance', true);
    const lp = el('div', 'light');
    this.lightCanvas = document.createElement('canvas');
    this.lightCanvas.className = 'aset';
    this.lightBars = el('div', 'bars');
    lp.append(this.lightCanvas, this.lightBars);
    light.append(lp);
    light.append(
      hint(
        '<b style="color:#e0464e">Red</b> bright overhead light · <b style="color:#3fae5a">green</b> low-angle light · <b style="color:#3b6fd8">blue</b> contrast (viewer’s shadow) · <b>dark</b> leakage. Click the stone to trace a single light ray.',
      ),
    );

    // setting
    const setting = this.section('Setting', true);
    this.settingBox = el('div', 'chips wrap');
    setting.append(this.settingBox);
    this.renderSettingButtons();
    setting.append(
      this.select(
        'Height',
        [
          ['low', 'Low profile'],
          ['medium', 'Medium'],
          ['high', 'High (cathedral)'],
        ],
        (c) => c.settingHeight,
        (v) => ({ settingHeight: v as RingConfig['settingHeight'] }),
      ),
      this.toggle('Pavé band', (c) => c.pave, (v) => ({ pave: v })),
    );

    // metal
    const metal = this.section('Metal', true);
    const sw = el('div', 'swatches');
    for (const id of METAL_ORDER) {
      const m = METALS[id];
      const b = el('button', 'swatch');
      const srgb = m.color.map((v) => Math.round(255 * Math.pow(v, 1 / 2.2)));
      b.style.setProperty('--sw', `rgb(${srgb.join(',')})`);
      b.title = m.label;
      b.innerHTML = `<i></i><span>${m.label}</span>`;
      b.onclick = () => this.store.set({ metal: id });
      this.syncs.push((c) => b.classList.toggle('active', c.metal === id));
      sw.append(b);
    }
    metal.append(sw);
    metal.append(
      this.select(
        'Finish',
        [
          ['polished', 'High polish'],
          ['satin', 'Satin / brushed'],
        ],
        (c) => c.finish,
        (v) => ({ finish: v as RingConfig['finish'] }),
      ),
    );

    // band
    const band = this.section('Band & size', false);
    band.append(
      this.slider(
        'Ring size (US)',
        3,
        13,
        0.25,
        (c) => c.ringSize,
        (v) => ({ ringSize: v }),
        (v) => `${v} · ⌀${usRingSizeToInnerDiameter(v).toFixed(1)} mm · ISO ${usRingSizeToISO(v).toFixed(1)}`,
      ),
      this.slider('Band width', 1.4, 4, 0.1, (c) => c.bandWidth, (v) => ({ bandWidth: v }), (v) => `${v.toFixed(1)} mm`),
      this.slider('Band thickness', 1.2, 2.4, 0.05, (c) => c.bandThickness, (v) => ({ bandThickness: v }), (v) => `${v.toFixed(2)} mm`),
      this.select(
        'Wedding band',
        [
          ['none', 'None'],
          ['plain', 'Plain matching band'],
          ['pave', 'Pavé (half)'],
          ['eternity', 'Eternity'],
        ],
        (c) => c.weddingBand,
        (v) => ({ weddingBand: v as RingConfig['weddingBand'] }),
      ),
      this.slider('Wedding band width', 1.4, 4, 0.1, (c) => c.weddingBandWidth, (v) => ({ weddingBandWidth: v }), (v) => `${v.toFixed(1)} mm`),
      this.text('Engraving', 24, (c) => c.engraving, (v) => ({ engraving: v })),
    );

    // lighting & view
    const look = this.section('Lighting & view', true);
    const envs = el('div', 'chips wrap');
    for (const id of ENVIRONMENT_ORDER) {
      const b = el('button', 'chip');
      b.textContent = ENVIRONMENTS[id].label;
      b.title = ENVIRONMENTS[id].description;
      b.onclick = () => this.store.set({ environment: id });
      this.syncs.push((c) => b.classList.toggle('active', c.environment === id));
      envs.append(b);
    }
    look.append(envs);
    look.append(
      this.slider('Light rotation', 0, 360, 1, (c) => c.envRotation, (v) => ({ envRotation: v }), (v) => `${v}°`),
      this.slider('Exposure', 0.4, 2, 0.01, (c) => c.exposure, (v) => ({ exposure: v }), (v) => v.toFixed(2)),
      this.slider('Fire (dispersion)', 0, 3, 0.05, (c) => c.dispersion, (v) => ({ dispersion: v }), (v) => (v === 1 ? 'physical' : `${v.toFixed(2)}×`)),
      this.select(
        'Render quality',
        [
          ['high', 'High — 8 bounces, full spectral'],
          ['medium', 'Medium — 6 bounces'],
          ['low', 'Low — 4 bounces (mobile)'],
        ],
        (c) => c.quality,
        (v) => ({ quality: v as RingConfig['quality'] }),
      ),
      this.toggle('Sparkle glow', (c) => c.bloom, (v) => ({ bloom: v })),
      this.toggle('Turntable', (c) => c.autoRotate, (v) => ({ autoRotate: v })),
    );
    const views = el('div', 'chips');
    for (const [v, name] of [
      ['hero', 'Hero'],
      ['top', 'Face-up'],
      ['side', 'Profile'],
      ['front', 'Front'],
      ['hand', 'On hand'],
    ] as [ViewPreset, string][]) {
      const b = el('button', 'chip');
      b.textContent = name;
      b.onclick = () => this.hooks.onView(v);
      views.append(b);
    }
    look.append(label('Camera'), views);

    // export
    const ex = this.section('Save & export', false);
    const row = el('div', 'chips wrap');
    const btn = (t: string, f: () => void, title = '') => {
      const b = el('button', 'chip');
      b.textContent = t;
      b.title = title;
      b.onclick = f;
      row.append(b);
    };
    btn('Copy share link', () => this.hooks.onShare());
    btn('Snapshot PNG', () => this.hooks.onSnapshot());
    btn('Stone .OBJ', () => this.hooks.onExport('obj'), 'Exact facet mesh in mm — import into Rhino');
    btn('Stone .STL', () => this.hooks.onExport('stl'), 'Exact facet mesh in mm');
    btn('Ring .GLB', () => this.hooks.onExport('glb'), 'Whole ring for other 3D viewers');
    btn('Spec .JSON', () => this.hooks.onExport('json'), 'All parameters + measurements for the order');
    ex.append(row);

    this.summary = el('div', 'summary');
    r.append(this.summary);
  }

  private renderSettingButtons(): void {
    if (!this.settingBox) return;
    this.settingBox.innerHTML = '';
    this.settingSyncs = [];
    const opts: [string, string][] = [
      ['solitaire-4', '4-prong'],
      ['solitaire-6', '6-prong'],
      ['bezel', 'Bezel'],
      ['halo', 'Halo'],
      ...this.manifest.map((m) => [`rhino:${m.id}`, `${m.name} ◆`] as [string, string]),
    ];
    for (const [id, name] of opts) {
      const b = el('button', 'chip');
      b.textContent = name;
      if (id.startsWith('rhino:')) b.title = 'Rhino model';
      b.onclick = () => {
        if (id.startsWith('rhino:')) this.store.set({ rhinoSetting: id.slice(6) });
        else this.store.set({ setting: id as RingConfig['setting'], rhinoSetting: null });
      };
      this.settingSyncs.push((c) =>
        b.classList.toggle('active', id.startsWith('rhino:') ? c.rhinoSetting === id.slice(6) : !c.rhinoSetting && c.setting === id),
      );
      this.settingBox.append(b);
    }
  }

  private renderProportions(cfg: RingConfig): void {
    const box = this.propsBox;
    box.innerHTML = '';
    const p = cfg.proportions;
    const set = (patch: Partial<BrilliantProportions & StepProportions>) =>
      this.store.set({ proportions: { ...this.store.get().proportions, ...patch } as RingConfig['proportions'] });
    const get = <K extends string>(k: K) => (c: RingConfig) => (c.proportions as unknown as Record<K, number>)[k];
    const rows: [string, number, number, number, string, string][] = isStep(p)
      ? [
          ['tablePct', 50, 75, 0.5, 'Table', '%'],
          ['crownAngle', 25, 50, 0.1, 'Crown step angle', '°'],
          ['pavilionAngle', 35, 55, 0.1, 'Pavilion step angle', '°'],
          ['girdlePct', 1, 6, 0.1, 'Girdle', '%'],
          ['crownSteps', 1, 4, 1, 'Crown steps', ''],
          ['pavilionSteps', 2, 6, 1, 'Pavilion steps', ''],
          ['stepSpread', 0, 24, 0.5, 'Step angle spread', '°'],
          ['cornerPct', 5, 35, 0.5, 'Corner cut', '%'],
        ]
      : [
          ['tablePct', 50, 70, 0.5, 'Table', '%'],
          ['crownAngle', 28, 38, 0.1, 'Crown angle', '°'],
          ['pavilionAngle', 38.5, 43.5, 0.05, 'Pavilion angle', '°'],
          ['girdlePct', 1, 6, 0.1, 'Girdle', '%'],
          ['starPct', 40, 65, 1, 'Star length', '%'],
          ['lowerHalfPct', 65, 90, 1, 'Lower half length', '%'],
        ];
    for (const [k, lo, hi, step, name, unit] of rows) {
      box.append(
        this.slider(name, lo, hi, step, get(k), (v) => {
          set({ [k]: v });
          return {};
        }, (v) => `${step < 1 ? v.toFixed(step < 0.1 ? 2 : 1) : v}${unit}`, false),
      );
    }
    const reset = el('button', 'chip');
    reset.textContent = 'Reset to recommended';
    reset.onclick = () => this.store.set({ proportions: { ...CUTS[this.store.get().cut].proportions } });
    box.append(reset);
    if (CUTS[cfg.cut].note) box.append(hint(CUTS[cfg.cut].note!));
  }

  // ------------------------------------------------------------- live data

  showMetrics(m: GemMetrics): void {
    this.metricsBox.innerHTML = `
      <div><b>${m.lengthMm.toFixed(2)} × ${m.widthMm.toFixed(2)} × ${m.depthMm.toFixed(2)}</b> mm</div>
      <div>Depth ${m.depthPct.toFixed(1)}% · Table ${m.tablePct.toFixed(0)}% · Crown ${m.crownHeightPct.toFixed(1)}% · Pavilion ${m.pavilionDepthPct.toFixed(1)}%</div>
      <div>${m.facetCount} facets · ${m.volumeMm3.toFixed(1)} mm³</div>`;
    const c = this.store.get();
    this.summary.innerHTML = `${CUTS[c.cut].name} · ${m.carat.toFixed(2)} ct · ${c.color} ${c.clarity} · ${METALS[c.metal].label} · size ${c.ringSize}`;
  }

  showLight(r: LightReport | null): void {
    if (!r) {
      this.lightBars.innerHTML = '<div class="muted">Analysing…</div>';
      return;
    }
    const cv = this.lightCanvas;
    cv.width = cv.height = r.size;
    const ctx = cv.getContext('2d')!;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(r.image), r.size, r.size), 0, 0);
    const bar = (name: string, v: number, tip: string, max = 1, fmt = (x: number) => `${(x * 100).toFixed(0)}%`) =>
      `<div class="bar" title="${tip}"><span>${name}</span><i style="--v:${Math.min(1, v / max)}"></i><em>${fmt(v)}</em></div>`;
    this.lightBars.innerHTML =
      bar('Brightness', r.brightness, 'Light returned to the viewer, excluding light blocked by their head') +
      bar('Light return', r.lightReturn, 'All light leaving through the crown') +
      bar('Leakage', r.leakage, 'Light lost through the pavilion — reads as dark patches') +
      bar('Contrast', r.contrast, 'Share of the pattern formed by the viewer’s shadow — some is good (scintillation)') +
      bar('Fire', r.fireDeg, 'Mean red/blue separation of exit rays', 2, (x) => `${x.toFixed(2)}°`);
  }

  // ------------------------------------------------------------- sync

  private sync(cfg: RingConfig): void {
    if (cfg.cut !== this.lastCut || !this.propsBox.childElementCount) {
      this.renderProportions(cfg);
      this.lastCut = cfg.cut;
    }
    for (const s of this.syncs) s(cfg);
    for (const s of this.settingSyncs) s(cfg);
  }

  // ------------------------------------------------------------- widgets

  private section(title: string, open: boolean): HTMLElement {
    const d = document.createElement('details');
    d.open = open;
    d.innerHTML = `<summary>${title}</summary>`;
    const body = el('div', 'section-body');
    d.append(body);
    this.root.append(d);
    return body;
  }

  private slider(
    name: string,
    min: number,
    max: number,
    step: number,
    get: (c: RingConfig) => number,
    set: (v: number) => Partial<RingConfig>,
    fmt: (v: number) => string,
    persistent = true,
  ): HTMLElement {
    const row = el('label', 'row');
    row.innerHTML = `<span class="lbl">${name}</span><output></output>`;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    const out = row.querySelector('output')!;
    input.oninput = () => {
      const v = parseFloat(input.value);
      out.textContent = fmt(v);
      const patch = set(v);
      if (Object.keys(patch).length) this.store.set(patch);
    };
    row.append(input);
    const sync: Sync = (c) => {
      const v = get(c);
      if (v === undefined) return;
      if (document.activeElement !== input) input.value = String(v);
      out.textContent = fmt(v);
    };
    if (persistent) this.syncs.push(sync);
    else {
      // proportion sliders are rebuilt per cut; sync them through the store directly
      const unsub = this.store.subscribe((c) => (row.isConnected ? sync(c) : unsub()));
    }
    sync(this.store.get());
    return row;
  }

  private select<T extends string>(
    name: string,
    options: [T, string][],
    get: (c: RingConfig) => T,
    set: (v: T) => Partial<RingConfig>,
  ): HTMLElement {
    const row = el('label', 'row');
    row.innerHTML = `<span class="lbl">${name}</span>`;
    const s = document.createElement('select');
    for (const [v, t] of options) s.append(new Option(t, v));
    s.onchange = () => this.store.set(set(s.value as T));
    this.syncs.push((c) => (s.value = get(c)));
    row.append(s);
    return row;
  }

  private toggle(name: string, get: (c: RingConfig) => boolean, set: (v: boolean) => Partial<RingConfig>): HTMLElement {
    const row = el('label', 'row toggle');
    row.innerHTML = `<span class="lbl">${name}</span>`;
    const i = document.createElement('input');
    i.type = 'checkbox';
    i.onchange = () => this.store.set(set(i.checked));
    this.syncs.push((c) => (i.checked = get(c)));
    row.append(i);
    return row;
  }

  private text(name: string, max: number, get: (c: RingConfig) => string, set: (v: string) => Partial<RingConfig>): HTMLElement {
    const row = el('label', 'row');
    row.innerHTML = `<span class="lbl">${name}</span>`;
    const i = document.createElement('input');
    i.type = 'text';
    i.maxLength = max;
    i.placeholder = 'Inside the band';
    i.oninput = () => this.store.set(set(i.value));
    this.syncs.push((c) => {
      if (document.activeElement !== i) i.value = get(c);
    });
    row.append(i);
    return row;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function label(t: string): HTMLElement {
  const d = el('div', 'lbl block');
  d.textContent = t;
  return d;
}

function hint(html: string): HTMLElement {
  const d = el('p', 'hint');
  d.innerHTML = html;
  return d;
}
