// Saved grooves (this browser only) and share links (the groove packed into the URL).
const LIB = 'bassline-builder:library';
const CURRENT = 'bassline-builder:current';

const read = k => {
  try {
    return JSON.parse(localStorage.getItem(k));
  } catch {
    return null;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
};

export const library = () => read(LIB) ?? [];
export const saveCurrent = s => write(CURRENT, s);
export const loadCurrent = () => read(CURRENT);

export function saveToLibrary(s) {
  const lib = library();
  const entry = { id: s.libId ?? crypto.randomUUID(), title: s.title, saved: Date.now(), groove: s };
  entry.groove = { ...s, libId: entry.id };
  const i = lib.findIndex(x => x.id === entry.id);
  if (i >= 0) lib[i] = entry;
  else lib.unshift(entry);
  return write(LIB, lib) ? entry : null;
}

export function deleteFromLibrary(id) {
  write(LIB, library().filter(x => x.id !== id));
}

export function shareLink(s) {
  const { libId, ...rest } = s;
  const packed = globalThis.LZString?.compressToEncodedURIComponent(JSON.stringify(rest));
  return `${location.origin}${location.pathname}#g=${packed}`;
}

export function fromHash() {
  const m = location.hash.match(/^#g=(.+)$/);
  if (!m || !globalThis.LZString) return null;
  try {
    const s = JSON.parse(LZString.decompressFromEncodedURIComponent(m[1]));
    return s && Array.isArray(s.notes) ? s : null;
  } catch {
    return null;
  }
}
