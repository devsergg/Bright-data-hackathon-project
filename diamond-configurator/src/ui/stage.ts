/**
 * Controls floating over the 3D stage: camera views, lighting mood, try-on
 * finger with skin tones, turntable, sparkle and fullscreen.
 */
import { ENVIRONMENTS, ENVIRONMENT_ORDER } from '../render/environments';
import type { ViewPreset } from '../render/viewer';
import { SKIN_TONES, type RingConfig, type Store } from '../state';

const ICONS = {
  hand: '<svg viewBox="0 0 24 24"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11.5V6a1.5 1.5 0 0 1 3 0v8.5c0 3.6-2.6 6.5-6 6.5-2.4 0-4-1.2-5.2-3.2L4 14.6a1.4 1.4 0 0 1 2.3-1.6L8 15"/></svg>',
  spin: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24"><path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
};

export interface StageHooks {
  onView(v: ViewPreset): void;
}

export function mountStageControls(stage: HTMLElement, store: Store, hooks: StageHooks): void {
  // view buttons
  const views = document.createElement('div');
  views.className = 'stage-views';
  views.setAttribute('role', 'group');
  views.setAttribute('aria-label', 'Camera view');
  for (const [v, label] of [
    ['hero', 'Ring'],
    ['top', 'Face up'],
    ['side', 'Profile'],
    ['hand', 'On hand'],
  ] as [ViewPreset, string][]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.onclick = () => {
      if (v === 'hand' && !store.get().showFinger) store.set({ showFinger: true });
      hooks.onView(v);
    };
    views.append(b);
  }

  // right-hand tools
  const tools = document.createElement('div');
  tools.className = 'stage-tools';
  const tool = (icon: string, label: string, pressed: (c: RingConfig) => boolean, act: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-btn';
    b.innerHTML = icon;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.onclick = act;
    store.subscribe((c) => b.setAttribute('aria-pressed', String(pressed(c))));
    b.setAttribute('aria-pressed', String(pressed(store.get())));
    tools.append(b);
    return b;
  };
  tool(ICONS.hand, 'Try on a finger', (c) => c.showFinger, () => store.set({ showFinger: !store.get().showFinger }));
  tool(ICONS.spin, 'Turntable', (c) => c.autoRotate, () => store.set({ autoRotate: !store.get().autoRotate }));
  tool(ICONS.sparkle, 'Sparkle glow', (c) => c.bloom, () => store.set({ bloom: !store.get().bloom }));
  const full = tool(ICONS.full, 'Full screen', () => !!document.fullscreenElement, () => {
    const p = document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen?.();
    void p?.catch(() => full.remove());
  });
  if (!stage.requestFullscreen) full.remove();

  // skin tones (only while trying on)
  const skins = document.createElement('div');
  skins.className = 'skin-tones';
  skins.setAttribute('role', 'radiogroup');
  skins.setAttribute('aria-label', 'Skin tone');
  SKIN_TONES.forEach((tone, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.background = tone;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', `Skin tone ${i + 1}`);
    b.onclick = () => store.set({ skinTone: i });
    store.subscribe((c) => b.setAttribute('aria-checked', String(c.skinTone === i)));
    b.setAttribute('aria-checked', String(store.get().skinTone === i));
    skins.append(b);
  });
  const showSkins = (c: RingConfig) => (skins.hidden = !c.showFinger);
  store.subscribe(showSkins);
  showSkins(store.get());

  // lighting mood
  const light = document.createElement('label');
  light.className = 'stage-light';
  light.innerHTML = '<span>Lighting</span>';
  const sel = document.createElement('select');
  sel.id = 'lighting';
  for (const id of ENVIRONMENT_ORDER) sel.append(new Option(ENVIRONMENTS[id].label, id));
  sel.onchange = () => store.set({ environment: sel.value as RingConfig['environment'] });
  store.subscribe((c) => (sel.value = c.environment));
  sel.value = store.get().environment;
  light.append(sel);

  const hint = document.createElement('p');
  hint.className = 'stage-hint';
  hint.textContent = 'Drag to turn · pinch or scroll to zoom · tap the diamond to trace a ray of light';

  const top = document.createElement('div');
  top.className = 'stage-top';
  top.append(light, tools);
  const bottom = document.createElement('div');
  bottom.className = 'stage-bottom';
  bottom.append(views, skins);
  stage.append(top, bottom, hint);
  stage.addEventListener('pointerdown', () => hint.classList.add('gone'), { once: true });
}
