// Pick a string and fret for every note so the fretting hand moves as little as possible.
// Strings are indexed from the lowest (0). `opens` are the open-string MIDI pitches.

export const MAX_FRET = 24;
const BOX = 3; // a hand covers four frets: hand .. hand + 3

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

// Viterbi over the candidate positions of each note.
export function assignFingering(notes, opens) {
  const playable = [];
  for (const n of notes) {
    let options = positionsFor(n.midi, opens);
    if (n.string != null) {
      const forced = options.filter(p => p.string === n.string);
      if (forced.length) options = forced;
    }
    if (options.length) playable.push({ note: n, options });
  }

  const layers = [];
  playable.forEach(({ options }, i) => {
    const prev = layers[i - 1];
    layers.push(
      options.map(p => {
        const base = p.fret * 0.06 + (p.fret === 0 ? 0.15 : 0);
        if (!prev) return { cost: base, hand: p.fret || null, back: -1, p };
        let best = null;
        prev.forEach((q, k) => {
          const { shift, hand } = reach(q.hand, p.fret);
          const cost = q.cost + base + shift * 1.4 + (shift > 0 ? 0.6 : 0) + Math.abs(p.string - q.p.string) * 0.25;
          if (!best || cost < best.cost) best = { cost, hand, back: k, p };
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
    result[playable[i].note.id] = { string: cell.p.string, fret: cell.p.fret };
    k = cell.back;
  }
  return result;
}
