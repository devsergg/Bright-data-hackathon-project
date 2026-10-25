/**
 * Guided ring builder: Shape → Stone → Setting → Metal → Band → Review.
 *
 * Every control reads from and writes to the Store; `sync` hooks keep the
 * controls current when state changes elsewhere (collections, saved designs,
 * share links). Plain-language choices sit up front; the exact facet angles
 * stay one click away under "Cutter's controls".
 */
import { CUTS, CUT_ORDER, isStep } from '../gems/catalog';
import { COLOR_GRADES, type ColorGrade } from '../gems/color';
import type { LightReport } from '../gems/lightPerformance';
import type { BrilliantProportions, CutId, GemMetrics, StepProportions } from '../gems/types';
import { METALS, METAL_ORDER, type MetalId } from '../render/metals';
import type { SettingManifestEntry } from '../ring/rhinoSetting';
import { CUT_GRADES, detectGrade, gradeProportions, type CutGrade } from '../showcase/cutGrades';
import { withCut, type ClarityGrade, type RingConfig, type Store } from '../state';
import { usRingSizeToInnerDiameter, usRingSizeToISO } from '../units';
import { cutIcon } from './icons';

export type StepId = 'shape' | 'stone' | 'setting' | 'metal' | 'band' | 'review';
export type ExportKind = 'obj' | 'stl' | 'glb' | 'json';

export interface BuilderHooks {
  onShare(): void;
  onSave(): void;
  onPhoto(): void;
  onExport(kind: ExportKind): void;
  onReset(): void;
}

type Sync = (cfg: RingConfig) => void;

const STEPS: { id: StepId; label: string }[] = [
  { id: 'shape', label: 'Shape' },
  { id: 'stone', label: 'Stone' },
  { id: 'setting', label: 'Setting' },
  { id: 'metal', label: 'Metal' },
  { id: 'band', label: 'Band' },
  { id: 'review', label: 'Review' },
];

const SHAPE_NOTES: Record<CutId, string> = {
  round: 'The most sparkle of any shape',
  oval: 'Looks larger per carat',
  cushion: 'Soft corners, vintage glow',
  princess: 'Crisp square brilliance',
  emerald: 'Hall-of-mirrors steps',
  radiant: 'Square corners, lots of sparkle',
  asscher: 'Art-deco square steps',
  pear: 'A teardrop that lengthens the hand',
  marquise: 'The biggest look for its weight',
  heart: 'Romantic and unmistakable',
};

const COLOR_GROUPS: { label: string; grades: ColorGrade[] }[] = [
  { label: 'Colourless', grades: ['D', 'E', 'F'] },
  { label: 'Near colourless', grades: ['G', 'H', 'I', 'J'] },
  { label: 'Faint', grades: ['K'] },
  { label: 'Fancy colour', grades: ['fancy-yellow', 'fancy-pink', 'fancy-blue', 'champagne', 'black'] },
];

function colorNote(g: ColorGrade): string {
  if ('DEF'.includes(g) && g.length === 1) return 'Colourless: icy white under any light.';
  if ('GH'.includes(g) && g.length === 1) return 'Near colourless: looks white face-up, and is the best value.';
  if ('IJ'.includes(g) && g.length === 1) return 'Near colourless: a hint of warmth, lovely in yellow or rose gold.';
  if (g === 'K') return 'Faint warmth you can see, especially next to platinum.';
  return `${COLOR_GRADES[g].label}: colour comes from the stone itself, shown here by real light absorption.`;
}

const CLARITY: { id: ClarityGrade; note: string }[] = [
  { id: 'FL', note: 'Flawless: nothing visible even at 10× magnification.' },
  { id: 'IF', note: 'Internally flawless: only faint surface marks at 10×.' },
  { id: 'VVS1', note: 'Very, very slight: inclusions extremely hard to find at 10×.' },
  { id: 'VVS2', note: 'Very, very slight: inclusions very hard to find at 10×.' },
  { id: 'VS1', note: 'Very slight: minor inclusions at 10×, invisible to the eye.' },
  { id: 'VS2', note: 'Very slight: minor inclusions at 10×, eye-clean.' },
  { id: 'SI1', note: 'Slightly included: visible at 10×, usually eye-clean.' },
  { id: 'SI2', note: 'Slightly included: may be visible to the eye in larger stones.' },
];

const SETTING_ICONS: Record<string, string> = {
  'solitaire-4': prongIcon(4, 45),
  'solitaire-6': prongIcon(6, 30),
  bezel: `<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="12"/><circle cx="24" cy="24" r="16" stroke-width="4"/></svg>`,
  halo: `<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="11"/>${Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    return `<circle cx="${(24 + 16 * Math.cos(a)).toFixed(1)}" cy="${(24 + 16 * Math.sin(a)).toFixed(1)}" r="2.6"/>`;
  }).join('')}</svg>`,
  rhino: `<svg viewBox="0 0 48 48"><path d="M24 8 38 20 24 40 10 20Z"/><path d="M10 20h28M18 20l6-12 6 12-6 20-6-20"/></svg>`,
};

function prongIcon(n: number, phase: number): string {
  const dots = Array.from({ length: n }, (_, i) => {
    const a = ((phase + (360 * i) / n) * Math.PI) / 180;
    return `<circle cx="${(24 + 14 * Math.cos(a)).toFixed(1)}" cy="${(24 + 14 * Math.sin(a)).toFixed(1)}" r="3.4" class="fill"/>`;
  }).join('');
  return `<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="13"/>${dots}</svg>`;
}

export class Builder {
  private syncs: Sync[] = [];
  private settingSyncs: Sync[] = [];
  private step: StepId = 'shape';
  private sections = new Map<StepId, HTMLElement>();
  private stepButtons = new Map<StepId, HTMLButtonElement>();
  private settingGrid!: HTMLElement;
  private cutterBox!: HTMLElement;
  private metricsEls: HTMLElement[] = [];
  private lightEls: { canvas: HTMLCanvasElement; bars: HTMLElement }[] = [];
  private reviewSheet!: HTMLElement;
  private backBtn!: HTMLButtonElement;
  private nextBtn!: HTMLButtonElement;
  private manifest: SettingManifestEntry[] = [];
  private metrics: GemMetrics | null = null;
  private light: LightReport | null = null;
  private lastCut = '';

  constructor(
    private root: HTMLElement,
    private store: Store,
    private hooks: BuilderHooks,
  ) {
    this.build();
    store.subscribe((c) => this.sync(c));
    this.sync(store.get());
    this.goTo('shape');
  }

  setManifest(m: SettingManifestEntry[]): void {
    this.manifest = m;
    this.renderSettingCards();
    this.sync(this.store.get());
  }

  goTo(step: StepId): void {
    this.step = step;
    for (const [id, el] of this.sections) el.hidden = id !== step;
    for (const [id, b] of this.stepButtons) {
      b.classList.toggle('current', id === step);
      b.setAttribute('aria-current', id === step ? 'step' : 'false');
    }
    const i = STEPS.findIndex((s) => s.id === step);
    this.backBtn.hidden = i === 0;
    this.nextBtn.hidden = i === STEPS.length - 1;
    if (i < STEPS.length - 1) this.nextBtn.textContent = `Next: ${STEPS[i + 1].label}`;
    this.root.querySelector('.step-body')!.scrollTop = 0;
  }

  showMetrics(m: GemMetrics): void {
    this.metrics = m;
    const html = `<span class="mono">${m.lengthMm.toFixed(2)} × ${m.widthMm.toFixed(2)} × ${m.depthMm.toFixed(2)} mm</span>`;
    for (const el of this.metricsEls) el.innerHTML = html;
    this.renderReview();
  }

  showLight(r: LightReport | null): void {
    this.light = r;
    for (const { canvas, bars } of this.lightEls) {
      if (!r) {
        bars.innerHTML = '<p class="muted small">Measuring light…</p>';
        continue;
      }
      canvas.width = canvas.height = r.size;
      canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.image), r.size, r.size), 0, 0);
      bars.innerHTML =
        meter('Brightness', r.brightness, 'Light returned to your eye') +
        meter('Fire', r.fireDeg / 1.5, 'Rainbow flashes from dispersion', `${r.fireDeg.toFixed(2)}°`) +
        meter('Leakage', r.leakage, 'Light escaping out the bottom', undefined, true);
    }
    this.renderReview();
  }

  // ------------------------------------------------------------------ build

  private build(): void {
    this.root.innerHTML = '';
    const nav = el('nav', 'steps');
    nav.setAttribute('aria-label', 'Design steps');
    const ol = el('ol');
    STEPS.forEach((s, i) => {
      const li = el('li');
      const b = el('button', 'step-pill');
      b.type = 'button';
      b.innerHTML = `<span class="num">${i + 1}</span><span class="txt"><span class="lbl">${s.label}</span><span class="val"></span></span>`;
      b.onclick = () => this.goTo(s.id);
      this.stepButtons.set(s.id, b);
      this.syncs.push((c) => (b.querySelector('.val')!.textContent = stepValue(s.id, c)));
      li.append(b);
      ol.append(li);
    });
    nav.append(ol);

    const body = el('div', 'step-body');
    body.append(this.buildShape(), this.buildStone(), this.buildSetting(), this.buildMetal(), this.buildBand(), this.buildReview());

    const foot = el('div', 'step-foot');
    this.backBtn = button('Back', 'btn ghost', () => this.move(-1));
    this.nextBtn = button('Next', 'btn primary', () => this.move(1));
    foot.append(this.backBtn, this.nextBtn);

    this.root.append(nav, body, foot);
  }

  private move(d: number): void {
    const i = STEPS.findIndex((s) => s.id === this.step);
    const next = STEPS[Math.min(STEPS.length - 1, Math.max(0, i + d))];
    this.goTo(next.id);
  }

  private section(id: StepId, title: string, lede: string): HTMLElement {
    const s = el('section', 'step');
    s.id = `step-${id}`;
    s.innerHTML = `<header><h2>${title}</h2><p class="lede">${lede}</p></header>`;
    this.sections.set(id, s);
    return s;
  }

  // ------------------------------------------------------------------ steps

  private buildShape(): HTMLElement {
    const s = this.section('shape', 'Choose a shape', 'Every shape here is cut facet by facet and lit by real optics.');
    const grid = el('div', 'shape-grid');
    for (const id of CUT_ORDER) {
      const b = el('button', 'card shape-card');
      b.type = 'button';
      b.innerHTML = `${cutIcon(id)}<span class="name">${CUTS[id].name.replace(' Brilliant', '')}</span><span class="note">${SHAPE_NOTES[id]}</span>`;
      b.onclick = () => this.store.set(withCut(this.store.get(), id));
      this.syncs.push((c) => b.classList.toggle('selected', c.cut === id));
      grid.append(b);
    }
    const ratio = this.slider('ratio', 'Length to width', 0.9, 2.3, 0.01, (c) => c.ratio, (v) => ({ ratio: v }), (v) => `${v.toFixed(2)} : 1`);
    this.syncs.push((c) => {
      const [lo, hi] = CUTS[c.cut].ratioRange;
      ratio.hidden = lo === hi;
      const input = ratio.querySelector('input')!;
      input.min = String(lo);
      input.max = String(hi);
    });
    s.append(grid, ratio);
    return s;
  }

  private buildStone(): HTMLElement {
    const s = this.section('stone', 'Your diamond', 'Size, colour, clarity and cut. The preview updates as you choose.');

    // carat
    const carat = el('div', 'field');
    carat.innerHTML = `<div class="field-head"><span class="label">Carat weight</span><span class="big-num" id="carat-readout"></span></div>`;
    const readout = carat.querySelector('#carat-readout') as HTMLElement;
    const range = input('range', 'carat');
    range.min = '0.25';
    range.max = '5';
    range.step = '0.01';
    range.setAttribute('aria-label', 'Carat weight');
    range.oninput = () => this.store.set({ carat: parseFloat(range.value) });
    const quick = el('div', 'chips');
    for (const v of [0.5, 0.75, 1, 1.5, 2, 3]) {
      const b = button(`${v} ct`, 'chip', () => this.store.set({ carat: v }));
      this.syncs.push((c) => b.classList.toggle('selected', Math.abs(c.carat - v) < 0.005));
      quick.append(b);
    }
    const size = el('p', 'hint');
    this.metricsEls.push(size);
    this.syncs.push((c) => {
      if (document.activeElement !== range) range.value = String(c.carat);
      readout.textContent = `${c.carat.toFixed(2)} ct`;
    });
    carat.append(range, quick, size);

    // colour
    const color = el('div', 'field');
    color.innerHTML = `<div class="field-head"><span class="label">Colour</span></div>`;
    const groups = el('div', 'color-groups');
    for (const g of COLOR_GROUPS) {
      const box = el('div', 'color-group');
      box.innerHTML = `<span class="group-label">${g.label}</span>`;
      const row = el('div', 'chips');
      for (const grade of g.grades) {
        const b = button(grade.replace('fancy-', ''), 'chip color-chip', () => this.store.set({ color: grade }));
        b.title = COLOR_GRADES[grade].label;
        b.style.setProperty('--tint', tintCss(grade));
        this.syncs.push((c) => b.classList.toggle('selected', c.color === grade));
        row.append(b);
      }
      box.append(row);
      groups.append(box);
    }
    const colorHint = el('p', 'hint');
    this.syncs.push((c) => (colorHint.textContent = colorNote(c.color)));
    color.append(groups, colorHint);

    // clarity
    const clarity = el('div', 'field');
    clarity.innerHTML = `<div class="field-head"><span class="label">Clarity</span></div>`;
    const crow = el('div', 'chips');
    for (const c of CLARITY) {
      const b = button(c.id, 'chip', () => this.store.set({ clarity: c.id }));
      this.syncs.push((cfg) => b.classList.toggle('selected', cfg.clarity === c.id));
      crow.append(b);
    }
    const clarityHint = el('p', 'hint');
    this.syncs.push((cfg) => (clarityHint.textContent = CLARITY.find((c) => c.id === cfg.clarity)!.note));
    clarity.append(crow, clarityHint);

    // cut
    const cut = el('div', 'field');
    cut.innerHTML = `<div class="field-head"><span class="label">Cut</span><span class="muted small">How well the angles handle light</span></div>`;
    const grades = el('div', 'segmented');
    for (const g of CUT_GRADES) {
      const b = button(g.label, 'seg', () => this.store.set({ proportions: gradeProportions(this.store.get().cut, g.id) }));
      b.title = g.note;
      this.syncs.push((c) => b.classList.toggle('selected', detectGrade(c.cut, c.proportions) === g.id));
      grades.append(b);
    }
    const gradeHint = el('p', 'hint');
    this.syncs.push((c) => {
      const g = detectGrade(c.cut, c.proportions);
      gradeHint.textContent = g === 'custom' ? 'Custom angles from the cutter’s controls.' : CUT_GRADES.find((x) => x.id === g)!.note;
    });
    const lightCard = this.lightCard();
    const cutter = document.createElement('details');
    cutter.className = 'cutter';
    cutter.innerHTML = `<summary>Cutter’s controls</summary>`;
    this.cutterBox = el('div', 'cutter-body');
    cutter.append(this.cutterBox);
    cut.append(grades, gradeHint, lightCard, cutter);

    s.append(carat, color, clarity, cut);
    return s;
  }

  private lightCard(): HTMLElement {
    const card = el('div', 'light-card');
    const canvas = document.createElement('canvas');
    canvas.className = 'aset';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Light map of the diamond seen face-up');
    const bars = el('div', 'meters');
    const legend = el('p', 'legend');
    legend.innerHTML =
      '<span><i class="k-red"></i>bright overhead light</span><span><i class="k-green"></i>low-angle light</span><span><i class="k-blue"></i>contrast</span><span><i class="k-dark"></i>leakage</span>';
    const left = el('div', 'aset-wrap');
    left.append(canvas, legend);
    card.append(left, bars);
    this.lightEls.push({ canvas, bars });
    return card;
  }

  private buildSetting(): HTMLElement {
    const s = this.section('setting', 'Pick a setting', 'How the stone is held changes how big it looks and how much light reaches it.');
    this.settingGrid = el('div', 'setting-grid');
    this.renderSettingCards();

    const height = el('div', 'field');
    height.innerHTML = `<div class="field-head"><span class="label">Setting height</span></div>`;
    const seg = el('div', 'segmented');
    for (const [v, t] of [
      ['low', 'Low'],
      ['medium', 'Medium'],
      ['high', 'High'],
    ] as [RingConfig['settingHeight'], string][]) {
      const b = button(t, 'seg', () => this.store.set({ settingHeight: v }));
      this.syncs.push((c) => b.classList.toggle('selected', c.settingHeight === v));
      seg.append(b);
    }
    height.append(seg, hint('Low sits snug against gloves and sleeves. High lifts the stone so more light enters from the side.'));

    const pave = this.toggle('pave', 'Diamonds along the band', (c) => c.pave, (v) => ({ pave: v }));
    s.append(this.settingGrid, height, pave);
    return s;
  }

  private renderSettingCards(): void {
    if (!this.settingGrid) return;
    this.settingGrid.innerHTML = '';
    this.settingSyncs = [];
    const cards: { id: string; name: string; note: string; icon: string }[] = [
      { id: 'solitaire-4', name: 'Four prongs', note: 'Shows the most diamond', icon: SETTING_ICONS['solitaire-4'] },
      { id: 'solitaire-6', name: 'Six prongs', note: 'Extra secure, rounder look', icon: SETTING_ICONS['solitaire-6'] },
      { id: 'bezel', name: 'Bezel', note: 'A metal rim; sleek and protective', icon: SETTING_ICONS.bezel },
      { id: 'halo', name: 'Halo', note: 'A ring of small diamonds', icon: SETTING_ICONS.halo },
      ...this.manifest.map((m) => ({ id: `rhino:${m.id}`, name: m.name, note: 'Designed in Rhino', icon: SETTING_ICONS.rhino })),
    ];
    for (const c of cards) {
      const b = el('button', 'card setting-card');
      b.type = 'button';
      b.innerHTML = `${c.icon}<span class="name">${c.name}</span><span class="note">${c.note}</span>`;
      b.onclick = () => {
        if (c.id.startsWith('rhino:')) this.store.set({ rhinoSetting: c.id.slice(6) });
        else this.store.set({ setting: c.id as RingConfig['setting'], rhinoSetting: null });
      };
      this.settingSyncs.push((cfg) =>
        b.classList.toggle('selected', c.id.startsWith('rhino:') ? cfg.rhinoSetting === c.id.slice(6) : !cfg.rhinoSetting && cfg.setting === c.id),
      );
      this.settingGrid.append(b);
    }
  }

  private buildMetal(): HTMLElement {
    const s = this.section('metal', 'Choose the metal', 'Colours are measured reflectance values for each alloy.');
    const grid = el('div', 'metal-grid');
    const notes: Record<MetalId, string> = {
      platinum: 'Naturally white, dense, hypoallergenic',
      'white-gold-14k': 'Rhodium plated for a bright white',
      'yellow-gold-18k': '75% gold: rich and warm',
      'yellow-gold-14k': '58% gold: softer yellow, harder wearing',
      'rose-gold-14k': 'Copper alloy: a blush pink',
      palladium: 'Platinum’s lighter cousin',
    };
    for (const id of METAL_ORDER) {
      const m = METALS[id];
      const b = el('button', 'card metal-card');
      b.type = 'button';
      const srgb = m.color.map((v) => Math.round(255 * Math.pow(v, 1 / 2.2)));
      b.style.setProperty('--metal', `rgb(${srgb.join(',')})`);
      b.innerHTML = `<i class="metal-swatch" aria-hidden="true"></i><span class="name">${m.label}</span><span class="note">${notes[id]}</span>`;
      b.onclick = () => this.store.set({ metal: id });
      this.syncs.push((c) => b.classList.toggle('selected', c.metal === id));
      grid.append(b);
    }
    const finish = el('div', 'field');
    finish.innerHTML = `<div class="field-head"><span class="label">Finish</span></div>`;
    const seg = el('div', 'segmented');
    for (const [v, t] of [
      ['polished', 'High polish'],
      ['satin', 'Satin'],
    ] as [RingConfig['finish'], string][]) {
      const b = button(t, 'seg', () => this.store.set({ finish: v }));
      this.syncs.push((c) => b.classList.toggle('selected', c.finish === v));
      seg.append(b);
    }
    finish.append(seg);
    s.append(grid, finish);
    return s;
  }

  private buildBand(): HTMLElement {
    const s = this.section('band', 'Size and band', 'Sizes are exact: the band is built to the inside diameter of your size.');
    const size = this.slider(
      'ring-size',
      'Ring size (US)',
      3,
      13,
      0.25,
      (c) => c.ringSize,
      (v) => ({ ringSize: v }),
      (v) => `${v} · ${usRingSizeToInnerDiameter(v).toFixed(1)} mm inside · ISO ${usRingSizeToISO(v).toFixed(0)}`,
    );
    const sizeHint = hint('Not sure? The most common sizes are 6–7. Try it on the finger with the hand button on the preview.');
    const width = this.slider('band-width', 'Band width', 1.4, 4, 0.1, (c) => c.bandWidth, (v) => ({ bandWidth: v }), (v) => `${v.toFixed(1)} mm`);
    const thick = this.slider('band-thickness', 'Band thickness', 1.2, 2.4, 0.05, (c) => c.bandThickness, (v) => ({ bandThickness: v }), (v) => `${v.toFixed(2)} mm`);

    const wb = el('div', 'field');
    wb.innerHTML = `<div class="field-head"><span class="label">Wedding band</span><span class="muted small">Sits beside the engagement ring</span></div>`;
    const seg = el('div', 'segmented four');
    for (const [v, t] of [
      ['none', 'None'],
      ['plain', 'Plain'],
      ['pave', 'Half pavé'],
      ['eternity', 'Eternity'],
    ] as [RingConfig['weddingBand'], string][]) {
      const b = button(t, 'seg', () => this.store.set({ weddingBand: v }));
      this.syncs.push((c) => b.classList.toggle('selected', c.weddingBand === v));
      seg.append(b);
    }
    wb.append(seg);

    const engr = el('div', 'field');
    engr.innerHTML = `<div class="field-head"><label class="label" for="engraving">Engraving</label><span class="muted small">Up to 24 characters</span></div>`;
    const t = input('text', 'engraving');
    t.maxLength = 24;
    t.placeholder = 'e.g. Always · 06.14.2026';
    t.oninput = () => this.store.set({ engraving: t.value });
    const preview = el('div', 'engraving-preview');
    this.syncs.push((c) => {
      if (document.activeElement !== t) t.value = c.engraving;
      preview.textContent = c.engraving || 'Your words, inside the band';
      preview.classList.toggle('empty', !c.engraving);
    });
    engr.append(t, preview);

    s.append(size, sizeHint, width, thick, wb, engr);
    return s;
  }

  private buildReview(): HTMLElement {
    const s = this.section('review', 'Your ring', 'Everything below is what a jeweller needs to make it.');
    this.reviewSheet = el('div', 'report');
    const light = this.lightCard();
    const actions = el('div', 'actions');
    actions.append(
      button('Save design', 'btn primary', () => this.hooks.onSave()),
      button('Copy share link', 'btn', () => this.hooks.onShare()),
      button('Take a photo', 'btn', () => this.hooks.onPhoto()),
      button('Start over', 'btn ghost', () => this.hooks.onReset()),
    );
    const pro = document.createElement('details');
    pro.className = 'pro';
    pro.innerHTML = '<summary>For jewellers: CAD files</summary>';
    const row = el('div', 'chips');
    row.append(
      button('Stone .OBJ (mm)', 'chip', () => this.hooks.onExport('obj')),
      button('Stone .STL (mm)', 'chip', () => this.hooks.onExport('stl')),
      button('Ring .GLB', 'chip', () => this.hooks.onExport('glb')),
      button('Spec .JSON', 'chip', () => this.hooks.onExport('json')),
    );
    pro.append(row, hint('Exact facet geometry for Rhino (see rhino/import_gem.py).'));
    s.append(this.reviewSheet, light, actions, pro);
    return s;
  }

  private renderReview(): void {
    if (!this.reviewSheet) return;
    const c = this.store.get();
    const m = this.metrics;
    const grade = detectGrade(c.cut, c.proportions);
    const settingName = c.rhinoSetting
      ? (this.manifest.find((x) => x.id === c.rhinoSetting)?.name ?? c.rhinoSetting)
      : { 'solitaire-4': 'Four-prong solitaire', 'solitaire-6': 'Six-prong solitaire', bezel: 'Bezel', halo: 'Halo' }[c.setting];
    const p = c.proportions;
    const angles = isStep(p)
      ? `${(p as StepProportions).crownSteps} crown / ${(p as StepProportions).pavilionSteps} pavilion steps`
      : `crown ${(p as BrilliantProportions).crownAngle.toFixed(1)}° · pavilion ${(p as BrilliantProportions).pavilionAngle.toFixed(1)}°`;
    const rows: [string, string, StepId | null][] = [
      ['Shape', `${CUTS[c.cut].name}${CUTS[c.cut].ratioRange[0] !== CUTS[c.cut].ratioRange[1] ? ` · ${c.ratio.toFixed(2)} : 1` : ''}`, 'shape'],
      ['Carat weight', `${c.carat.toFixed(2)} ct`, 'stone'],
      ['Measurements', m ? `${m.lengthMm.toFixed(2)} × ${m.widthMm.toFixed(2)} × ${m.depthMm.toFixed(2)} mm` : '…', null],
      ['Colour · Clarity', `${COLOR_GRADES[c.color].label.split(' — ')[0]} · ${c.clarity}`, 'stone'],
      ['Cut', `${grade === 'custom' ? 'Custom' : CUT_GRADES.find((g) => g.id === grade)!.label} · ${angles}`, 'stone'],
      ['Depth · Table', m ? `${m.depthPct.toFixed(1)}% · ${m.tablePct.toFixed(0)}%` : '…', null],
      ['Facets', m ? `${m.facetCount}` : '…', null],
      ['Setting', `${settingName}${c.pave ? ' · pavé band' : ''} · ${c.settingHeight} height`, 'setting'],
      ['Metal', `${METALS[c.metal].label} · ${c.finish === 'satin' ? 'satin' : 'high polish'}`, 'metal'],
      ['Size', `US ${c.ringSize} · ${usRingSizeToInnerDiameter(c.ringSize).toFixed(1)} mm`, 'band'],
      ['Band', `${c.bandWidth.toFixed(1)} × ${c.bandThickness.toFixed(2)} mm${c.weddingBand !== 'none' ? ` · ${c.weddingBand} wedding band` : ''}`, 'band'],
      ['Engraving', c.engraving ? `“${escapeHtml(c.engraving)}”` : 'None', 'band'],
    ];
    if (this.light) rows.splice(7, 0, ['Light return', `${(this.light.brightness * 100).toFixed(0)}% brightness · ${this.light.fireDeg.toFixed(2)}° fire`, null]);
    this.reviewSheet.innerHTML = `<dl>${rows
      .map(([k, v, step]) => `<div class="row"><dt>${k}</dt><dd>${v}</dd>${step ? `<button type="button" class="link" data-step="${step}">Change</button>` : '<span></span>'}</div>`)
      .join('')}</dl>`;
    this.reviewSheet.querySelectorAll<HTMLButtonElement>('button[data-step]').forEach((b) => {
      b.onclick = () => this.goTo(b.dataset.step as StepId);
    });
  }

  private renderCutter(cfg: RingConfig): void {
    const box = this.cutterBox;
    box.innerHTML = '';
    const p = cfg.proportions;
    const set = (patch: Partial<BrilliantProportions & StepProportions>) =>
      this.store.set({ proportions: { ...this.store.get().proportions, ...patch } as RingConfig['proportions'] });
    const rows: [string, number, number, number, string, string][] = isStep(p)
      ? [
          ['tablePct', 50, 75, 0.5, 'Table', '%'],
          ['crownAngle', 25, 50, 0.1, 'Crown step angle', '°'],
          ['pavilionAngle', 35, 55, 0.1, 'Pavilion step angle', '°'],
          ['girdlePct', 1, 6, 0.1, 'Girdle', '%'],
          ['crownSteps', 1, 4, 1, 'Crown steps', ''],
          ['pavilionSteps', 2, 6, 1, 'Pavilion steps', ''],
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
      const get = (c: RingConfig) => (c.proportions as unknown as Record<string, number>)[k];
      const row = this.slider(`cut-${k}`, name, lo, hi, step, get, (v) => (set({ [k]: v }), {}), (v) => `${step < 1 ? v.toFixed(step < 0.1 ? 2 : 1) : v}${unit}`, false);
      box.append(row);
    }
    box.append(hint('Pavilion angle matters most: 40.6–41° returns the most light in a round brilliant.'));
    if (CUTS[cfg.cut].note) box.append(hint(CUTS[cfg.cut].note!));
  }

  // ------------------------------------------------------------------ sync

  private sync(cfg: RingConfig): void {
    if (cfg.cut !== this.lastCut) {
      this.renderCutter(cfg);
      this.lastCut = cfg.cut;
    }
    for (const s of this.syncs) s(cfg);
    for (const s of this.settingSyncs) s(cfg);
    this.renderReview();
  }

  // ------------------------------------------------------------------ widgets

  private slider(
    id: string,
    name: string,
    min: number,
    max: number,
    step: number,
    get: (c: RingConfig) => number,
    set: (v: number) => Partial<RingConfig>,
    fmt: (v: number) => string,
    persistent = true,
  ): HTMLElement {
    const row = el('div', 'field slider');
    row.innerHTML = `<div class="field-head"><label class="label" for="${id}">${name}</label><output for="${id}" class="mono"></output></div>`;
    const r = input('range', id);
    r.min = String(min);
    r.max = String(max);
    r.step = String(step);
    const out = row.querySelector('output')!;
    r.oninput = () => {
      const v = parseFloat(r.value);
      out.textContent = fmt(v);
      const patch = set(v);
      if (Object.keys(patch).length) this.store.set(patch);
    };
    row.append(r);
    const sync: Sync = (c) => {
      const v = get(c);
      if (v === undefined) return;
      if (document.activeElement !== r) r.value = String(v);
      out.textContent = fmt(v);
    };
    if (persistent) this.syncs.push(sync);
    else {
      const unsub = this.store.subscribe((c) => (row.isConnected ? sync(c) : unsub()));
    }
    sync(this.store.get());
    return row;
  }

  private toggle(id: string, name: string, get: (c: RingConfig) => boolean, set: (v: boolean) => Partial<RingConfig>): HTMLElement {
    const row = el('label', 'switch-row');
    row.htmlFor = id;
    row.innerHTML = `<span class="label">${name}</span>`;
    const i = input('checkbox', id);
    i.setAttribute('role', 'switch');
    i.onchange = () => this.store.set(set(i.checked));
    this.syncs.push((c) => (i.checked = get(c)));
    row.append(i);
    return row;
  }
}

// -------------------------------------------------------------------- helpers

function stepValue(id: StepId, c: RingConfig): string {
  switch (id) {
    case 'shape':
      return CUTS[c.cut].name.replace(' Brilliant', '');
    case 'stone':
      return `${c.carat.toFixed(2)} ct · ${c.color.replace('fancy-', '')}`;
    case 'setting':
      return c.rhinoSetting ? 'Custom' : { 'solitaire-4': '4 prong', 'solitaire-6': '6 prong', bezel: 'Bezel', halo: 'Halo' }[c.setting];
    case 'metal':
      return METALS[c.metal].label.replace(/ \(.*\)/, '').replace(' Gold', '');
    case 'band':
      return `Size ${c.ringSize}`;
    case 'review':
      return 'Save & share';
  }
}

/** Approximate face-up tint of a colour grade, for the chip swatch. */
function tintCss(g: ColorGrade): string {
  const a = COLOR_GRADES[g].absorption;
  const path = g === 'black' ? 1 : 9; // mm of travel through the stone
  const rgb = a.map((k) => Math.round(255 * Math.pow(Math.exp(-k * path), 1 / 2.2)));
  return `rgb(${rgb.join(',')})`;
}

function meter(name: string, v: number, tip: string, text?: string, invert = false): string {
  const pct = Math.max(0, Math.min(1, v));
  return `<div class="meter${invert ? ' invert' : ''}" title="${tip}"><span class="m-label">${name}</span><span class="m-track"><i style="width:${(pct * 100).toFixed(0)}%"></i></span><span class="m-val mono">${text ?? `${(v * 100).toFixed(0)}%`}</span></div>`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function input(type: string, id: string): HTMLInputElement {
  const i = document.createElement('input');
  i.type = type;
  i.id = id;
  return i;
}

function button(text: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls);
  b.type = 'button';
  b.textContent = text;
  b.onclick = onClick;
  return b;
}

function hint(text: string): HTMLElement {
  const p = el('p', 'hint');
  p.textContent = text;
  return p;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export type { CutGrade };
