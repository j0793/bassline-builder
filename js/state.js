// The groove is one plain object. Time is in ticks: 12 per quarter note,
// so 1/8 = 6, 1/16 = 3, 1/8 triplet = 4, 1/16 triplet = 2.

export const PPQ = 12;

export const QUANTIZE = [
  { ticks: 12, label: '1/4' },
  { ticks: 6, label: '1/8' },
  { ticks: 3, label: '1/16' },
  { ticks: 4, label: '1/8 triplet' },
  { ticks: 2, label: '1/16 triplet' },
];

// Open strings, lowest first.
export const TUNINGS = {
  4: ['E1', 'A1', 'D2', 'G2'],
  5: ['B0', 'E1', 'A1', 'D2', 'G2'],
  6: ['B0', 'E1', 'A1', 'D2', 'G2', 'C3'],
};

export const MAX_BARS = 8;

export const barTicks = s => (PPQ * 4 * s.timeSig[0]) / s.timeSig[1];
export const totalTicks = s => barTicks(s) * s.bars;

// Beat = one click of the metronome. Compound meters (6/8, 9/8, 12/8) count dotted quarters.
export const isCompound = ([n, d]) => d === 8 && n % 3 === 0 && n > 3;
export const beatTicks = s => {
  const unit = (PPQ * 4) / s.timeSig[1];
  return isCompound(s.timeSig) ? unit * 3 : unit;
};

export const uid = () => Math.random().toString(36).slice(2, 9);

const n = (start, dur, midi) => ({ id: uid(), start, dur, midi, string: null });

// Starter groove: a 2-bar funk line over Am7 | D9 with chromatic approaches.
export const demoGroove = () => ({
  version: 1,
  title: 'Am7 to D9 starter',
  bpm: 92,
  timeSig: [4, 4],
  bars: 2,
  key: { tonic: 'A', mode: 'minor' },
  quantize: 3,
  tuning: [...TUNINGS[4]],
  chords: [
    { start: 0, symbol: 'Am7' },
    { start: 48, symbol: 'D9' },
  ],
  notes: [
    n(0, 6, 33), n(9, 3, 33), n(12, 3, 45), n(18, 3, 43), n(21, 3, 40),
    n(24, 6, 33), n(33, 3, 36), n(36, 3, 38), n(39, 3, 40), n(42, 3, 43), n(45, 3, 37),
    n(48, 6, 38), n(57, 3, 38), n(60, 3, 50), n(66, 3, 48), n(69, 3, 45),
    n(72, 6, 38), n(81, 3, 42), n(84, 3, 45), n(87, 3, 48), n(90, 3, 40), n(93, 3, 32),
  ],
});

export const blankGroove = from => ({
  ...structuredClone(from),
  title: 'Untitled groove',
  bars: 2,
  chords: [{ start: 0, symbol: from.chords[0]?.symbol ?? 'C' }],
  notes: [],
});

// Keep the groove valid after any edit: sorted, monophonic, inside the canvas.
export function normalize(s) {
  const total = totalTicks(s);
  s.notes = s.notes
    .filter(x => x.start >= 0 && x.start < total && x.dur > 0)
    .sort((a, b) => a.start - b.start);
  const out = [];
  for (const x of s.notes) {
    if (out.length && out.at(-1).start === x.start) continue; // first one wins
    out.push(x);
  }
  out.forEach((x, i) => {
    const limit = out[i + 1]?.start ?? total;
    x.dur = Math.min(x.dur, limit - x.start);
  });
  s.notes = out;

  s.chords = s.chords.filter(c => c.start >= 0 && c.start < total).sort((a, b) => a.start - b.start);
  s.chords = s.chords.filter((c, i, arr) => i === 0 || c.start !== arr[i - 1].start);
  if (!s.chords.length) s.chords = [{ start: 0, symbol: 'C' }];
  s.chords[0].start = 0;
  return s;
}

// Re-lay notes and chords bar by bar when the time signature changes.
export function changeTimeSig(s, timeSig) {
  const oldBar = barTicks(s);
  const newBar = (PPQ * 4 * timeSig[0]) / timeSig[1];
  const remap = t => {
    const bar = Math.floor(t / oldBar);
    const off = t - bar * oldBar;
    return off < newBar ? bar * newBar + off : null;
  };
  s.notes = s.notes
    .map(x => ({ ...x, start: remap(x.start) }))
    .filter(x => x.start !== null);
  s.chords = s.chords
    .map(c => ({ ...c, start: remap(c.start) }))
    .filter(c => c.start !== null);
  s.timeSig = timeSig;
}

export function setBars(s, bars) {
  bars = Math.max(1, Math.min(MAX_BARS, bars));
  const bt = barTicks(s);
  if (bars > s.bars) {
    const last = s.chords.at(-1)?.symbol ?? 'C';
    for (let b = s.bars; b < bars; b++) s.chords.push({ start: b * bt, symbol: last });
  }
  s.bars = bars;
}

export function createStore(initial) {
  let state = normalize(initial);
  let past = [];
  let future = [];
  const subs = new Set();
  const emit = meta => subs.forEach(f => f(state, meta));

  return {
    get: () => state,
    update(fn, { history = true, meta } = {}) {
      const next = structuredClone(state);
      fn(next);
      normalize(next);
      if (history) {
        past.push(state);
        if (past.length > 100) past.shift();
        future = [];
      }
      state = next;
      emit(meta);
    },
    replace(next) {
      past.push(state);
      future = [];
      state = normalize(next);
      emit({ kind: 'replace' });
    },
    undo() {
      if (!past.length) return;
      future.push(state);
      state = past.pop();
      emit({ kind: 'undo' });
    },
    redo() {
      if (!future.length) return;
      past.push(state);
      state = future.pop();
      emit({ kind: 'redo' });
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
