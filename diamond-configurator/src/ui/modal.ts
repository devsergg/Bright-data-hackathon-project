/**
 * Minimal accessible modal (native <dialog>) for photos and share links.
 * Downloads and clipboard can be refused in embedded frames, so every action
 * has a fallback the shopper can complete by hand.
 */
export function openModal(title: string, content: HTMLElement): void {
  const d = document.createElement('dialog');
  d.className = 'modal';
  const head = document.createElement('header');
  head.innerHTML = `<h2>${title}</h2>`;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn ghost';
  close.textContent = 'Close';
  close.onclick = () => d.close();
  head.append(close);
  d.append(head, content);
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });
  document.body.append(d);
  d.showModal();
}

export function shareModal(url: string): void {
  const box = document.createElement('div');
  box.className = 'modal-body';
  const field = document.createElement('input');
  field.type = 'text';
  field.id = 'share-url';
  field.readOnly = true;
  field.value = url;
  field.onfocus = () => field.select();
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn primary';
  copy.textContent = 'Copy link';
  copy.onclick = () => {
    navigator.clipboard
      ?.writeText(url)
      .then(() => (copy.textContent = 'Copied'))
      .catch(() => {
        field.focus();
        field.select();
        copy.textContent = 'Press Ctrl/⌘ + C';
      });
  };
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = 'Anyone with this link sees exactly this ring, down to the facet angles.';
  const row = document.createElement('div');
  row.className = 'share-row';
  row.append(field, copy);
  box.append(row, p);
  openModal('Share your ring', box);
}

export function photoModal(dataUrl: string, filename: string): void {
  const box = document.createElement('div');
  box.className = 'modal-body';
  const img = new Image();
  img.src = dataUrl;
  img.alt = 'Photo of your ring design';
  img.className = 'photo';
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.className = 'btn primary';
  a.textContent = 'Download photo';
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = 'If the download doesn’t start, right-click or long-press the image to save it.';
  box.append(img, a, p);
  openModal('Photo of your ring', box);
}
