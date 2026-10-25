/**
 * Collections (curated designs) and Saved designs (this browser only).
 */
import { CUTS } from '../gems/catalog';
import { COLOR_GRADES } from '../gems/color';
import { METALS } from '../render/metals';
import { COLLECTION, designConfig, type Design } from '../showcase/collections';
import { decodeConfig, encodeConfig, type RingConfig, type Store } from '../state';
import { cutIcon } from './icons';

const SETTING_NAMES: Record<RingConfig['setting'], string> = {
  'solitaire-4': 'Four-prong',
  'solitaire-6': 'Six-prong',
  bezel: 'Bezel',
  halo: 'Halo',
};

export function specLine(c: RingConfig): string {
  const color = COLOR_GRADES[c.color].label.split(' — ')[0];
  return `${c.carat.toFixed(2)} ct ${CUTS[c.cut].name.replace(' Brilliant', '').toLowerCase()} · ${color} · ${METALS[c.metal].label.replace(/ \(.*\)/, '')}`;
}

export function mountCollections(root: HTMLElement, store: Store, onOpen: () => void): void {
  root.innerHTML = '';
  for (const d of COLLECTION) root.append(designCard(d, store, onOpen));
}

function designCard(d: Design, store: Store, onOpen: () => void): HTMLElement {
  const cfg = designConfig(d);
  const card = document.createElement('article');
  card.className = 'design';
  const fig = document.createElement('figure');
  const img = new Image();
  img.alt = `${d.name}: ${specLine(cfg)}`;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.src = `showcase/${d.id}.jpg`;
  img.onerror = () => {
    // no rendered thumbnail yet: fall back to the stone's facet drawing
    fig.classList.add('fallback');
    fig.innerHTML = cutIcon(cfg.cut);
  };
  fig.append(img);
  const body = document.createElement('div');
  body.className = 'design-body';
  body.innerHTML = `<h3>${d.name}</h3><p>${d.tagline}</p><p class="spec mono">${specLine(cfg)} · ${SETTING_NAMES[cfg.setting]}</p>`;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn';
  btn.textContent = 'Customise this ring';
  btn.onclick = () => {
    store.set(designConfig(d, store.get()));
    onOpen();
  };
  body.append(btn);
  card.append(fig, body);
  return card;
}

// ------------------------------------------------------------------ saved designs

interface Saved {
  id: string;
  name: string;
  savedAt: number;
  config: string; // encoded RingConfig
  thumb: string; // small JPEG data URL
}

const KEY = 'ringstudio.saved.v1';

function readSaved(): Saved[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Saved[]) : [];
  } catch {
    return [];
  }
}

function writeSaved(list: Saved[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export class SavedDesigns {
  constructor(
    private root: HTMLElement,
    private store: Store,
    private onOpen: () => void,
  ) {
    this.render();
  }

  /** Returns false when this browser refuses storage (private mode, blocked). */
  save(cfg: RingConfig, thumb: string): boolean {
    const list = readSaved();
    const name = `${CUTS[cfg.cut].name.replace(' Brilliant', '')} ${SETTING_NAMES[cfg.setting].toLowerCase()}`;
    list.unshift({ id: crypto.randomUUID?.() ?? String(Date.now()), name, savedAt: Date.now(), config: encodeConfig(cfg), thumb });
    const ok = writeSaved(list.slice(0, 24));
    this.render();
    return ok;
  }

  private render(): void {
    const list = readSaved();
    this.root.innerHTML = '';
    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'Designs you save appear here, on this device. Use “Save design” on the Review step.';
      this.root.append(empty);
      return;
    }
    for (const s of list) {
      const cfg = decodeConfig(s.config);
      if (!cfg) continue;
      const card = document.createElement('article');
      card.className = 'saved';
      card.innerHTML = `<img src="${s.thumb}" alt="" /><div><h3>${s.name}</h3><p class="spec mono">${specLine(cfg)}</p><p class="muted small">Saved ${new Date(s.savedAt).toLocaleDateString()}</p></div>`;
      const actions = document.createElement('div');
      actions.className = 'saved-actions';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn';
      open.textContent = 'Open';
      open.onclick = () => {
        this.store.set(cfg);
        this.onOpen();
      };
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn ghost';
      del.textContent = 'Remove';
      del.onclick = () => {
        writeSaved(readSaved().filter((x) => x.id !== s.id));
        this.render();
      };
      actions.append(open, del);
      card.append(actions);
      this.root.append(card);
    }
  }
}
