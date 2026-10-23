// Genre rhythm templates and preset grooves.
// A template is one 4/4 bar written in 16th-note steps: [step, length, degree, articulation?].
// Degrees are relative to the chord under each note:
//   R root · R8 octave up · 5 fifth up · 5- fifth below · 3 the chord's third · b7 the chord's seventh
//   6 sixth · x ghost note on the root · A approach (a half step into the next chord's root)
//   N the next chord's root, played early (anticipation)
import { PPQ, uid, changeTimeSig, normalize, TUNINGS } from './state.js';
import { chordInfo, noteMidi, pretty } from './theory.js';
import { customGenres, genreExamples } from './share.js';

// Built-in genres. `progs` are typical progressions Generate draws from (chords, key, mode).
export const GENRES = [
  {
    id: 'funk', name: 'Funk', bpm: [92, 108],
    blurb: 'Land the one hard, fill the gaps with ghost notes, pop the octave.',
    progs: [[['E9', 'E9'], 'E', 'minor'], [['Am7', 'D9'], 'A', 'minor'], [['Cm7', 'F7'], 'C', 'minor'], [['Dm7', 'G7'], 'D', 'minor']],
  },
  {
    id: 'motown', name: 'Motown / Soul', bpm: [92, 108],
    blurb: 'Melodic chord tones that walk into each change with an approach note.',
    progs: [[['C', 'Am', 'F', 'G'], 'C', 'major'], [['F', 'Dm', 'Bb', 'C'], 'F', 'major'], [['G', 'Em', 'C', 'D'], 'G', 'major']],
  },
  {
    id: 'rock', name: 'Rock', bpm: [120, 150],
    blurb: 'Steady roots locked to the kick drum. Consistency is the groove.',
    progs: [[['A5', 'G5', 'D5', 'A5'], 'A', 'major'], [['E5', 'E5', 'C5', 'D5'], 'E', 'minor'], [['D5', 'C5', 'G5', 'D5'], 'D', 'major']],
  },
  {
    id: 'reggae', name: 'Reggae', bpm: [72, 84],
    blurb: 'Leave beat one empty and let the bass sing low and round.',
    progs: [[['G', 'C'], 'G', 'major'], [['Am', 'G', 'F', 'G'], 'A', 'minor'], [['Dm', 'Am'], 'D', 'minor']],
  },
  {
    id: 'jazz', name: 'Jazz walking', bpm: [120, 150],
    blurb: 'Quarter notes: chord tones on strong beats, an approach note on beat four.',
    progs: [[['Cm7', 'F7', 'Bbmaj7', 'Bbmaj7'], 'Bb', 'major'], [['F7', 'Bb7', 'F7', 'C7'], 'F', 'major'], [['Dm7', 'G7', 'Cmaj7', 'A7'], 'C', 'major']],
  },
  {
    id: 'latin', name: 'Latin', bpm: [96, 124],
    blurb: 'Anticipate the next chord. The bass plays ahead of the bar line.',
    progs: [[['Am', 'E7', 'Am', 'E7'], 'A', 'minor'], [['Cmaj7', 'Dm7', 'G7', 'Cmaj7'], 'C', 'major'], [['Dm', 'A7'], 'D', 'minor']],
  },
];

export const TEMPLATES = [
  {
    id: 'funk-pocket', genre: 'funk', name: 'The One + ghosts',
    teaches: 'Root on the one, ghost notes keep the 16ths moving without adding pitches.',
    steps: [[0, 2, 'R'], [3, 1, 'x'], [4, 1, 'R8'], [6, 1, 'x'], [7, 1, 'R'], [10, 1, 'b7', 'hammer'], [11, 1, 'R8'], [12, 1, 'x'], [14, 1, '5'], [15, 1, 'A']],
  },
  {
    id: 'funk-octaves', genre: 'funk', name: 'Octave pops',
    teaches: 'Low root, high octave. The jump is the hook; ghosts fill the space.',
    steps: [[0, 1, 'R'], [2, 1, 'R8'], [3, 1, 'x'], [4, 1, 'R'], [6, 1, 'R8'], [8, 1, 'x'], [9, 1, 'R'], [10, 1, 'R8'], [12, 1, 'b7', 'hammer'], [13, 1, 'R8'], [14, 1, 'x'], [15, 1, 'R']],
  },
  {
    id: 'motown-walk', genre: 'motown', name: 'Walk-up',
    teaches: 'Root, fifth, octave, then step into the next chord.',
    steps: [[0, 3, 'R'], [3, 1, 'R'], [4, 2, '5'], [6, 2, 'R8'], [8, 3, 'R'], [11, 1, '3'], [12, 2, '5'], [14, 2, 'A']],
  },
  {
    id: 'motown-octave', genre: 'motown', name: 'Octave and sixth',
    teaches: 'The sixth is the sweet note in soul basslines. Slide down from the octave into it.',
    steps: [[0, 2, 'R'], [2, 2, 'R8'], [4, 2, '5'], [6, 2, '6'], [8, 2, 'R8', 'slide'], [10, 2, '6'], [12, 2, '5'], [14, 2, 'A']],
  },
  {
    id: 'rock-eighths', genre: 'rock', name: 'Driving eighths',
    teaches: 'Eight even roots per bar. Hold the tempo and the tone dead steady.',
    steps: [[0, 2, 'R'], [2, 2, 'R'], [4, 2, 'R'], [6, 2, 'R'], [8, 2, 'R'], [10, 2, 'R'], [12, 2, 'R'], [14, 2, 'R']],
  },
  {
    id: 'rock-gallop', genre: 'rock', name: 'Gallop',
    teaches: 'Eighth plus two sixteenths. Keep the picking hand relaxed at speed.',
    steps: [[0, 2, 'R'], [2, 1, 'R'], [3, 1, 'R'], [4, 2, 'R'], [6, 1, 'R'], [7, 1, 'R'], [8, 2, 'R8'], [10, 1, 'R8'], [11, 1, 'R8'], [12, 2, '5'], [14, 1, '5'], [15, 1, 'A']],
  },
  {
    id: 'reggae-onedrop', genre: 'reggae', name: 'One drop',
    teaches: 'Nothing on beat one. The space is the style.',
    steps: [[2, 2, 'R'], [4, 2, '3'], [6, 2, '5'], [8, 4, 'R'], [12, 2, '5'], [14, 1, '3'], [15, 1, 'A']],
  },
  {
    id: 'reggae-roots', genre: 'reggae', name: 'Roots line',
    teaches: 'Long, low notes that slide between chord tones.',
    steps: [[0, 3, 'R'], [3, 1, 'R'], [6, 2, '5', 'slide'], [8, 4, 'R8'], [12, 2, '5'], [14, 2, '3']],
  },
  {
    id: 'jazz-walk', genre: 'jazz', name: 'Chord-tone walk',
    teaches: 'Root, third, fifth, then a half step into the next root.',
    steps: [[0, 4, 'R'], [4, 4, '3'], [8, 4, '5'], [12, 4, 'A']],
  },
  {
    id: 'jazz-down', genre: 'jazz', name: 'Walk down',
    teaches: 'Start on the octave and walk down through the chord.',
    steps: [[0, 4, 'R8'], [4, 4, 'b7'], [8, 4, '5'], [12, 4, 'A']],
  },
  {
    id: 'latin-tumbao', genre: 'latin', name: 'Tumbao',
    teaches: 'Fifth on the and of two, next chord\'s root on four, nothing on one.',
    steps: [[6, 6, '5'], [12, 4, 'N']],
  },
  {
    id: 'latin-bossa', genre: 'latin', name: 'Bossa',
    teaches: 'Root, then the fifth below, in a dotted-quarter pattern.',
    steps: [[0, 6, 'R'], [6, 2, '5-'], [8, 6, '5-'], [14, 2, 'R']],
  },
];

const PRESETS = [
  { genre: 'funk', title: 'E9 one-chord vamp', key: ['E', 'minor'], bpm: 98, chords: ['E9', 'E9'], template: 'funk-pocket' },
  { genre: 'funk', title: 'Cm7 octave pops', key: ['C', 'minor'], bpm: 104, chords: ['Cm7', 'F7'], template: 'funk-octaves' },
  { genre: 'motown', title: 'Soul in C', key: ['C', 'major'], bpm: 100, chords: ['C', 'Am', 'F', 'G'], template: 'motown-walk' },
  { genre: 'motown', title: 'Sixths in F', key: ['F', 'major'], bpm: 96, chords: ['F', 'Dm', 'Bb', 'C'], template: 'motown-octave' },
  { genre: 'rock', title: 'Driving A', key: ['A', 'major'], bpm: 132, chords: ['A5', 'G5', 'D5', 'A5'], template: 'rock-eighths' },
  { genre: 'rock', title: 'E minor gallop', key: ['E', 'minor'], bpm: 150, chords: ['E5', 'E5', 'C5', 'D5'], template: 'rock-gallop' },
  { genre: 'reggae', title: 'One drop in G', key: ['G', 'major'], bpm: 76, chords: ['G', 'C'], template: 'reggae-onedrop' },
  { genre: 'reggae', title: 'Roots in A minor', key: ['A', 'minor'], bpm: 80, chords: ['Am', 'G', 'F', 'G'], template: 'reggae-roots' },
  { genre: 'jazz', title: 'ii–V–I in B♭', key: ['Bb', 'major'], bpm: 132, chords: ['Cm7', 'F7', 'Bbmaj7', 'Bbmaj7'], template: 'jazz-walk' },
  { genre: 'jazz', title: 'F blues turnaround', key: ['F', 'major'], bpm: 140, chords: ['F7', 'Bb7', 'F7', 'C7'], template: 'jazz-down' },
  { genre: 'latin', title: 'Tumbao in A minor', key: ['A', 'minor'], bpm: 100, chords: ['Am', 'E7', 'Am', 'E7'], template: 'latin-tumbao' },
  { genre: 'latin', title: 'Bossa in C', key: ['C', 'major'], bpm: 120, chords: ['Cmaj7', 'Dm7', 'G7', 'Cmaj7'], template: 'latin-bossa' },
];

// Put a pitch class in the comfortable low register: the first one at or above the lowest open string.
function placeRoot(pc, opens) {
  const low = Math.min(...opens);
  let m = low + ((pc - low) % 12 + 12) % 12;
  if (m > low + 11) m -= 12;
  return m;
}

function interval(chord, num, fallback) {
  const i = chord.intervals.findIndex(iv => parseInt(iv, 10) === num);
  if (i < 0) return fallback;
  return (chord.pcs[i] - chord.root + 12) % 12;
}

export function degreePitch(deg, chord, nextChord, opens) {
  const root = placeRoot(chord.root, opens);
  const low = Math.min(...opens);
  switch (deg) {
    case 'R': case 'x': return root;
    case 'R8': return root + 12;
    case '5': return root + 7;
    case '5-': return root - 5 >= low ? root - 5 : root + 7;
    case '3': return root + interval(chord, 3, 4);
    case 'b7': return root + interval(chord, 7, 10);
    case '6': return root + 9;
    case 'N': return placeRoot(nextChord.root, opens);
    case 'A': {
      // From below when the line rises into the target, from above when it falls.
      const target = placeRoot(nextChord.root, opens);
      if (target - 1 < low) return target + 1;
      return target < root ? target + 1 : target - 1;
    }
    default: return root;
  }
}

// Replace the groove's notes with the template played over its own chords. Templates are 4/4.
export function applyTemplate(s, template) {
  let changedMeter = false;
  if (s.timeSig[0] !== 4 || s.timeSig[1] !== 4) {
    changeTimeSig(s, [4, 4]);
    changedMeter = true;
  }
  normalize(s);
  const opens = s.tuning.map(noteMidi);
  const step = PPQ / 4;
  const bar = PPQ * 4;
  const total = bar * s.bars;
  const chordAt = t => [...s.chords].reverse().find(c => c.start <= t) ?? s.chords[0];
  const nextChordAfter = t => s.chords.find(c => c.start > t) ?? s.chords[0];

  const notes = [];
  for (let b = 0; b < s.bars; b++) {
    for (const [st, len, deg, art] of template.steps) {
      const start = b * bar + st * step;
      if (start >= total) continue;
      const chord = chordInfo(chordAt(start).symbol);
      const next = chordInfo(nextChordAfter(start).symbol) ?? chord;
      if (!chord) continue;
      notes.push({
        id: uid(),
        start,
        dur: len * step,
        midi: degreePitch(deg, chord, next, opens),
        string: null,
        art: deg === 'x' ? 'ghost' : art ?? null,
      });
    }
  }
  s.notes = notes;
  s.quantize = template.steps.every(([st, len]) => st % 2 === 0 && len % 2 === 0) ? 6 : 3;
  s.genre = template.genre;
  return { changedMeter };
}

export function buildPreset(p, tuning = TUNINGS[4]) {
  const s = {
    version: 1,
    title: p.title,
    genre: p.genre,
    bpm: p.bpm,
    timeSig: [4, 4],
    bars: p.chords.length,
    key: { tonic: p.key[0], mode: p.key[1] },
    quantize: 3,
    tuning: [...tuning],
    chords: p.chords.map((symbol, i) => ({ start: i * PPQ * 4, symbol })),
    notes: [],
  };
  applyTemplate(s, TEMPLATES.find(t => t.id === p.template));
  return normalize(s);
}

export const presets = () => PRESETS;
export const templatesFor = genre => TEMPLATES.filter(t => !genre || genre === 'all' || t.genre === genre);

// Built-in genres plus the ones you created.
export const allGenres = () => [...GENRES, ...customGenres().map(g => ({ ...g, custom: true }))];
export const genreName = id => allGenres().find(g => g.id === id)?.name ?? 'Other';

// Everything Generate can pick for a genre: template × progression ideas, plus basslines you saved there.
export function generationPool(genreId, tuning = TUNINGS[4]) {
  const g = GENRES.find(x => x.id === genreId);
  const pool = [];
  if (g) {
    for (const t of TEMPLATES.filter(t => t.genre === genreId)) {
      for (const [chords, tonic, mode] of g.progs) {
        pool.push({
          label: `${t.name} over ${chords.map(pretty).join(' – ')}`,
          build: rand => {
            const bpm = g.bpm[0] + Math.round(rand() * (g.bpm[1] - g.bpm[0]) / 2) * 2;
            return buildPreset({ genre: genreId, title: `${g.name}: ${t.name}`, key: [tonic, mode], bpm, chords, template: t.id }, tuning);
          },
        });
      }
    }
  }
  for (const ex of genreExamples().filter(e => e.genre === genreId)) {
    pool.push({ label: ex.groove.title, build: () => normalize(structuredClone({ ...ex.groove, genre: genreId })) });
  }
  return pool;
}

let lastPick = null;
export function generate(genreId, { tuning, rand = Math.random } = {}) {
  const pool = generationPool(genreId, tuning);
  if (!pool.length) return null;
  let i = Math.floor(rand() * pool.length);
  if (pool.length > 1 && pool[i].label === lastPick) i = (i + 1) % pool.length;
  lastPick = pool[i].label;
  return pool[i].build(rand);
}
