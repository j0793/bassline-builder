// Pick a string and fret for every note so the fretting hand moves as little as possible.
// Notes that start together (chords, double stops) get different strings and stay within a hand span.
// Strings are indexed from the lowest (0). `opens` are the open-string MIDI pitches.

export const MAX_FRET = 24;
const BOX = 3; // a hand covers four frets: hand .. hand + 3
const SPAN = 5; // widest stretch allowed inside one chord

export function positionsFor(midi, opens) {
  return opens
    .map((open, string) => ({ string, fret: midi - open }))
    .filter(p => p.fret >= 0 && p.fret <= MAX_FRET);
}

// How far the hand has to shift to reach `fret`, and where it ends up.
function reach(hand, fret) {
  if (fret === 0) return { shift: 0, hand }; // open strings leave the hand where it is
  if (hand == null) return { shift: 0, hand: fret };
  if (fret < hand) return { shift: hand - fret, hand: fret };
  if (fret > hand + BOX) return { shift: fret - (hand + BOX), hand: fret - BOX };
  return { shift: 0, hand };
}

// Low positions are easier to read and play; above the 7th fret costs extra.
const height = fret => fret * 0.1 + Math.max(0, fret - 7) * 0.3 + (fret === 0 ? 0.1 : 0);

// Every way to put a group of simultaneous notes on distinct strings, cheapest first.
function assignments(group, opens) {
  const options = group.map(n => {
    let ps = positionsFor(n.midi, opens);
    if (n.string != null) {
      const forced = ps.filter(p => p.string === n.string);
      if (forced.length) ps = forced;
    }
    return ps;
  });
  const out = [];
  const walk = (i, used, acc) => {
    if (out.length > 400) return;
    if (i === group.length) {
      const fretted = acc.filter(p => p.fret > 0).map(p => p.fret);
      const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
      out.push({ ps: [...acc], span, cost: acc.reduce((c, p) => c + height(p.fret), 0) + span * 0.4 });
      return;
    }
    for (const p of options[i]) {
      if (used.has(p.string)) continue;
      used.add(p.string);
      acc.push(p);
      walk(i + 1, used, acc);
      acc.pop();
      used.delete(p.string);
    }
  };
  walk(0, new Set(), []);
  const comfy = out.filter(a => a.span <= SPAN);
  return (comfy.length ? comfy : out).sort((a, b) => a.cost - b.cost).slice(0, 40);
}

export function assignFingering(notes, opens) {
  // Group playable notes by start time.
  const sorted = [...notes]
    .filter(n => positionsFor(n.midi, opens).length)
    .sort((a, b) => a.start - b.start || a.midi - b.midi);
  const groups = [];
  for (const n of sorted) {
    const g = groups.at(-1);
    if (g && g.start === n.start && g.notes.length < opens.length) g.notes.push(n);
    else groups.push({ start: n.start, notes: [n] });
  }

  const layers = [];
  groups.forEach((g, gi) => {
    const prev = layers[gi - 1];
    const prevGroup = groups[gi - 1];
    const cands = assignments(g.notes, opens);
    layers.push(
      cands.map(a => {
        const fretted = a.ps.filter(p => p.fret > 0).map(p => p.fret);
        const lo = fretted.length ? Math.min(...fretted) : 0;
        const hi = fretted.length ? Math.max(...fretted) : 0;
        if (!prev) return { cost: a.cost, hand: lo || null, back: -1, a };
        let best = null;
        prev.forEach((q, k) => {
          const r1 = reach(q.hand, lo);
          const r2 = reach(r1.hand, hi);
          const shift = r1.shift + r2.shift;
          // A string still ringing from the previous notes can't play a new one.
          const ringing = prevGroup.notes
            .map((n, i) => (n.start + n.dur > g.start ? q.a.ps[i].string : null))
            .filter(x => x != null);
          const clash = a.ps.some(p => ringing.includes(p.string)) ? 50 : 0;
          const cross = Math.abs(a.ps[0].string - q.a.ps[0].string) * 0.08; // crossing strings is cheap on bass
          const cost = q.cost + a.cost + shift * 1.4 + (shift > 0 ? 0.6 : 0) + cross + clash;
          if (!best || cost < best.cost) best = { cost, hand: r2.hand, back: k, a };
        });
        return best;
      })
    );
  });

  const result = {};
  if (!layers.length) return result;
  let k = layers.at(-1).reduce((bi, c, i, arr) => (c.cost < arr[bi].cost ? i : bi), 0);
  for (let i = layers.length - 1; i >= 0; i--) {
    const cell = layers[i][k];
    groups[i].notes.forEach((n, j) => (result[n.id] = { string: cell.a.ps[j].string, fret: cell.a.ps[j].fret }));
    k = cell.back;
  }
  return result;
}
