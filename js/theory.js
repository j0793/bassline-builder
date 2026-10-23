// Music theory helpers. Tonal is loaded as a global from the CDN (window.Tonal).
import { totalTicks, beatTicks } from './state.js';
import { assignFingering } from './fingering.js';

const T = () => globalThis.Tonal;

export const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
export const KEY_TONICS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const SEMI_LABEL = ['R', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];

export const pretty = s => String(s).replace(/b(?=\d|$)/g, '♭').replace(/#/g, '♯');
export const prettyNote = s => String(s).replace(/(?<=^[A-G])b/, '♭').replace(/#/g, '♯');

export const chroma = name => T().Note.chroma(name);
export const noteMidi = name => T().Note.midi(name);

export function keyInfo(key) {
  const k = key.mode === 'minor' ? T().Key.minorKey(key.tonic) : T().Key.majorKey(key.tonic);
  const flats = k.keySignature.includes('b');
  const scale = T().Scale.get(`${key.tonic} ${key.mode === 'minor' ? 'aeolian' : 'major'}`).notes;
  const chords = key.mode === 'minor' ? k.natural.chords : k.chords;
  const triads = key.mode === 'minor' ? k.natural.triads : k.triads;
  return { flats, scale, scalePcs: scale.map(chroma), chords, triads };
}

export const midiName = (m, flats = false) =>
  (flats ? FLATS : SHARPS)[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

export function chordInfo(symbol) {
  const c = T().Chord.get(symbol);
  if (c.empty || !c.tonic) return null;
  const root = chroma(c.tonic);
  const pcs = c.intervals.map(iv => (root + T().Interval.semitones(iv)) % 12);
  return { symbol, tonic: c.tonic, root, intervals: c.intervals, pcs, notes: c.notes };
}

// '3m' -> 'b3', '7M' -> '7', '5d' -> 'b5', '1P' -> 'R'
export function intervalLabel(iv) {
  const { num, q } = T().Interval.get(iv);
  if (num === 1) return 'R';
  return (q === 'm' || q === 'd' ? 'b' : q === 'A' ? '#' : '') + num;
}

// What role does this pitch play against this chord?
export function noteFunction(midi, chord, scalePcs) {
  const pc = ((midi % 12) + 12) % 12;
  if (!chord) return { label: '?', cat: 'scale' };
  const i = chord.pcs.indexOf(pc);
  if (i === 0) return { label: 'R', cat: 'root' };
  if (i > 0) return { label: intervalLabel(chord.intervals[i]), cat: 'chord' };
  const label = SEMI_LABEL[(pc - chord.root + 12) % 12];
  return { label, cat: scalePcs.includes(pc) ? 'scale' : 'chromatic' };
}

export function chordSpans(s) {
  const total = totalTicks(s);
  return s.chords.map((c, i) => ({
    index: i,
    start: c.start,
    end: s.chords[i + 1]?.start ?? total,
    symbol: c.symbol,
    chord: chordInfo(c.symbol),
  }));
}

export const spanAt = (spans, tick) => spans.find(sp => tick >= sp.start && tick < sp.end) ?? spans[0];

const roman = (i, triad) => {
  const r = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][i];
  if (/dim$/.test(triad)) return r.toLowerCase() + '°';
  if (/m$/.test(triad)) return r.toLowerCase();
  return r;
};

export function diatonic(key) {
  const k = keyInfo(key);
  return k.chords.map((symbol, i) => ({
    symbol,
    roman: roman(i, k.triads[i]),
    degree: i,
    chord: chordInfo(symbol),
  }));
}

// Score diatonic chords by how well they explain the notes in a span.
// Bass players usually land the root on the downbeat, so that note counts most.
export function scoreChord(notes, span, chord, beat) {
  if (!chord) return -Infinity;
  let score = 0;
  for (const x of notes) {
    if (x.start < span.start || x.start >= span.end) continue;
    const w = x.dur / 3 + (x.start === span.start ? 4 : 0) + ((x.start - span.start) % beat === 0 ? 1 : 0);
    const pc = x.midi % 12;
    if (pc === chord.root) score += 2 * w;
    else if (chord.pcs.includes(pc)) score += w;
    else score -= 0.6 * w;
  }
  return score;
}

export function inferChord(notes, span, key, beat) {
  if (!notes.some(x => x.start >= span.start && x.start < span.end)) return [];
  return diatonic(key)
    .map(d => ({ ...d, score: scoreChord(notes, span, d.chord, beat) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
}

// Common next moves by scale degree (0 = tonic).
const NEXT_MAJOR = { 0: [3, 4, 5], 1: [4, 6, 3], 2: [5, 3, 1], 3: [4, 0, 1], 4: [0, 5, 3], 5: [1, 3, 4], 6: [0, 2] };
const NEXT_MINOR = { 0: [3, 5, 6], 1: [4, 0], 2: [5, 3], 3: [4, 0, 6], 4: [0, 5], 5: [3, 6, 1], 6: [2, 0] };

export function suggestNext(prevSymbol, key) {
  const prev = chordInfo(prevSymbol);
  const chords = diatonic(key);
  if (!prev) return chords.slice(0, 3);
  const deg = chords.findIndex(d => d.chord.root === prev.root);
  if (deg < 0) return [chords[0], chords[3], chords[4]];
  const table = key.mode === 'minor' ? NEXT_MINOR : NEXT_MAJOR;
  const picks = table[deg].map(i => chords[i]);
  // In minor, the borrowed V7 (harmonic minor) is the classic pull back to i.
  if (key.mode === 'minor' && table[deg].includes(4)) {
    const v7 = T().Key.minorKey(key.tonic).harmonic.chords[4];
    picks[table[deg].indexOf(4)] = { symbol: v7, roman: 'V7', degree: 4, chord: chordInfo(v7) };
  }
  return picks;
}

export function guessKey(notes) {
  if (!notes.length) return null;
  let best = null;
  for (const tonic of KEY_TONICS) {
    for (const mode of ['major', 'minor']) {
      const { scalePcs } = keyInfo({ tonic, mode });
      const t = chroma(tonic);
      let score = 0;
      notes.forEach((x, i) => {
        const pc = x.midi % 12;
        score += (scalePcs.includes(pc) ? 1 : -1.2) * x.dur;
        if (pc === t) score += x.dur * 0.6 + (i === 0 ? 6 : 0);
      });
      if (!best || score > best.score) best = { tonic, mode, score };
    }
  }
  return { tonic: best.tonic, mode: best.mode };
}

// Everything the grid, learning panel and notation need, computed once per edit.
export function analyze(s) {
  const key = keyInfo(s.key);
  const spans = chordSpans(s);
  const total = totalTicks(s);
  const opens = s.tuning.map(noteMidi);
  const fingering = assignFingering(s.notes, opens);
  const notes = {};

  s.notes.forEach((x, i) => {
    const span = spanAt(spans, x.start);
    const fn = noteFunction(x.midi, span.chord, key.scalePcs);
    notes[x.id] = { ...fn, span: span.index, symbol: span.symbol, ...(fingering[x.id] ?? {}) };
  });

  // Approach notes: a non-chord tone one or two semitones from the root it lands on at a chord change.
  s.notes.forEach(x => {
    // The next note to start after this one (with chords, the closest in pitch); wrap at the loop end.
    const later = s.notes.filter(y => y.start > x.start);
    const firstStart = later.length ? Math.min(...later.map(y => y.start)) : 0;
    const pool = later.length ? later.filter(y => y.start === firstStart) : s.notes.filter(y => y.start === s.notes[0].start);
    const next = pool.reduce((m, y) => (!m || Math.abs(y.midi - x.midi) < Math.abs(m.midi - x.midi) ? y : m), null);
    const wraps = !later.length;
    if (!next || next === x) return;
    const end = x.start + x.dur;
    const gap = wraps ? total - end + next.start : next.start - end;
    const target = spans.find(sp => sp.start === next.start);
    const info = notes[x.id];
    if (!target || gap > s.quantize || info.cat === 'root' || info.cat === 'chord') return;
    if (notes[next.id].cat !== 'root') return;
    const step = Math.abs(next.midi - x.midi);
    if (step === 1 || step === 2) {
      info.approach = { to: target.symbol, chromatic: step === 1 };
    }
  });

  const beat = beatTicks(s);
  const summaries = spans.map(sp => {
    const inSpan = s.notes.filter(x => x.start >= sp.start && x.start < sp.end);
    const count = c => inSpan.filter(x => notes[x.id].cat === c).length;
    const first = inSpan[0];
    return {
      ...sp,
      total: inSpan.length,
      roots: count('root'),
      chordTones: count('root') + count('chord'),
      scaleTones: count('scale'),
      chromatic: count('chromatic'),
      approaches: inSpan.filter(x => notes[x.id].approach).length,
      rootOnOne: !!first && first.start === sp.start && notes[first.id].cat === 'root',
      inferred: inferChord(s.notes, sp, s.key, beat),
      fit: scoreChord(s.notes, sp, sp.chord, beat),
    };
  });

  return { key, spans, notes, summaries, flats: key.flats, opens };
}
