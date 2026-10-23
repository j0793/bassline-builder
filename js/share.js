// The bank (16 pads, kept in this browser) and share links (the groove packed into the URL).
const BANK = 'bassline-builder:bank';
const OLD_LIBRARY = 'bassline-builder:library';
const CURRENT = 'bassline-builder:current';
const PREFS = 'bassline-builder:prefs';
export const PADS = 16;

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

export function bank() {
  let slots = read(BANK);
  if (!Array.isArray(slots)) {
    // First run after the update: move any grooves saved in the old list onto pads.
    const old = read(OLD_LIBRARY) ?? [];
    slots = Array.from({ length: PADS }, (_, i) => old[i]?.groove ?? null);
    write(BANK, slots);
  }
  return Array.from({ length: PADS }, (_, i) => slots[i] ?? null);
}

export function setPad(i, groove) {
  const slots = bank();
  slots[i] = groove ? structuredClone(groove) : null;
  return write(BANK, slots);
}

export const saveCurrent = s => write(CURRENT, s);
export const loadCurrent = () => read(CURRENT);
export const loadPrefs = () => read(PREFS) ?? {};
export const savePrefs = p => write(PREFS, p);

export function shareLink(s) {
  const packed = globalThis.LZString?.compressToEncodedURIComponent(JSON.stringify(s));
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
