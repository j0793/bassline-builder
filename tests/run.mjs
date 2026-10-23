// Unit tests for the pure logic. Run: npm install && npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

if (process.env.TONAL_BROWSER_BUILD) {
  globalThis.Tonal = new Function(readFileSync(process.env.TONAL_BROWSER_BUILD, 'utf8') + ';return Tonal')();
} else {
  globalThis.Tonal = await import('tonal');
}

const { demoGroove, normalize, changeTimeSig, totalTicks, claim } = await import('../js/state.js');
const { TEMPLATES, presets, buildPreset, applyTemplate, generate, generationPool } = await import('../js/genres.js');
const { coach, romanFor } = await import('../js/coach.js');
const { emptyGroove, gridLabel } = await import('../js/state.js');
const { analyze, noteFunction, chordInfo, keyInfo, suggestNext, guessKey } = await import('../js/theory.js');
const { assignFingering } = await import('../js/fingering.js');
const { buildBars } = await import('../js/notation.js');

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL ${name}\n`, e.message);
    process.exitCode = 1;
  }
};

const base = over => normalize({ ...demoGroove(), notes: [], ...over });
const note = (start, dur, midi, id = `n${start}`) => ({ id, start, dur, midi, string: null });
const sumTicks = bar => bar.pieces.reduce((a, p) => a + (p.triplet ? p.dur : p.dur), 0);

test('every bar of the demo adds up to a full bar', () => {
  const s = normalize(demoGroove());
  const { bars, approx } = buildBars(s);
  bars.forEach(b => assert.equal(sumTicks(b), 48));
  assert.equal(approx, false);
});

test('a note crossing a beat is split and tied', () => {
  const s = base({ notes: [note(6, 12, 33)] }); // and-of-1 to and-of-2
  const p = buildBars(s).bars[0].pieces.filter(p => !p.rest);
  assert.deepEqual(p.map(x => x.vf), ['8', '8']);
  assert.equal(p[0].tieToNext, true);
  assert.equal(p[1].tied, true);
});

test('a half note on beat 1 stays a half note', () => {
  const s = base({ notes: [note(0, 24, 33)] });
  const p = buildBars(s).bars[0].pieces;
  assert.equal(p[0].vf, 'h');
});

test('dotted eighth + sixteenth', () => {
  const s = base({ notes: [note(0, 9, 33), note(9, 3, 40)] });
  assert.deepEqual(buildBars(s).bars[0].pieces.slice(0, 2).map(p => p.vf), ['8d', '16']);
});

test('eighth-note triplets', () => {
  const s = base({ notes: [note(0, 4, 33), note(4, 4, 36), note(8, 4, 40)] });
  const p = buildBars(s).bars[0].pieces.slice(0, 3);
  assert.ok(p.every(x => x.triplet && x.vf === '8'));
});

test('6/8 bars are 36 ticks and fill completely', () => {
  const s = base({ notes: [note(0, 6, 33)] });
  changeTimeSig(s, [6, 8]);
  normalize(s);
  assert.equal(totalTicks(s), 72);
  buildBars(s).bars.forEach(b => assert.equal(sumTicks(b), 36));
});

test('time signature change keeps bar-relative positions', () => {
  const s = base({ notes: [note(48, 6, 38), note(42, 3, 40)] });
  changeTimeSig(s, [3, 4]);
  normalize(s);
  assert.deepEqual(s.notes.map(n => n.start), [36]); // beat 4 of bar 1 is gone
});

test('normalize trims overlaps', () => {
  const s = base({ notes: [note(0, 24, 33), note(6, 6, 40)] });
  assert.equal(s.notes[0].dur, 6);
});

test('note functions', () => {
  const am7 = chordInfo('Am7');
  const scale = keyInfo({ tonic: 'A', mode: 'minor' }).scalePcs;
  assert.equal(noteFunction(33, am7, scale).label, 'R');
  assert.equal(noteFunction(36, am7, scale).label, 'b3');
  assert.equal(noteFunction(43, am7, scale).label, 'b7');
  assert.equal(noteFunction(38, am7, scale).cat, 'scale');
  assert.equal(noteFunction(37, am7, scale).cat, 'chromatic');
  assert.equal(noteFunction(40, chordInfo('D9'), scale).label, '9');
});

test('approach notes are detected, including across the loop', () => {
  const s = normalize(demoGroove());
  const a = analyze(s);
  const cs = s.notes.find(n => n.midi === 37);
  const gs = s.notes.find(n => n.midi === 32);
  assert.equal(a.notes[cs.id].approach.to, 'D9');
  assert.equal(a.notes[gs.id].approach.to, 'Am7');
});

test('fingering stays in position', () => {
  const opens = [28, 33, 38, 43];
  const ns = [note(0, 3, 33, 'a'), note(3, 3, 36, 'c'), note(6, 3, 38, 'd'), note(9, 3, 40, 'e')];
  const f = assignFingering(ns, opens);
  const frets = Object.values(f).map(p => p.fret).filter(x => x > 0);
  assert.ok(Math.max(...frets) - Math.min(...frets) <= 3, JSON.stringify(f));
});

test('fingering uses a low B string when present', () => {
  const f = assignFingering([note(0, 3, 25, 'x')], [23, 28, 33, 38, 43]);
  assert.deepEqual(f.x, { string: 0, fret: 2 });
});

test('fingering honours a string override', () => {
  const f = assignFingering([{ ...note(0, 3, 33, 'x'), string: 0 }], [28, 33, 38, 43]);
  assert.deepEqual(f.x, { string: 0, fret: 5 });
});

test('next chord suggestions in A minor after Am7 include Dm7', () => {
  const s = suggestNext('Am7', { tonic: 'A', mode: 'minor' }).map(x => x.symbol);
  assert.ok(s.includes('Dm7'), s.join());
});

test('key guess finds A minor for the demo', () => {
  assert.deepEqual(guessKey(normalize(demoGroove()).notes), { tonic: 'A', mode: 'minor' });
});

test('an extended note overwrites the notes it now covers', () => {
  const s = base({ notes: [note(0, 3, 33, 'a'), note(3, 3, 36, 'b'), note(6, 3, 38, 'c'), note(12, 3, 40, 'd')] });
  s.notes.find(n => n.id === 'a').dur = 9;
  claim(s, 'a');
  normalize(s);
  assert.deepEqual(s.notes.map(n => [n.id, n.dur]), [['a', 9], ['d', 3]]);
});

test('a moved note keeps its length and trims the note before it', () => {
  const s = base({ notes: [note(0, 12, 33, 'a'), note(24, 6, 36, 'b')] });
  s.notes.find(n => n.id === 'b').start = 6;
  claim(s, 'b');
  normalize(s);
  assert.deepEqual(s.notes.map(n => [n.id, n.start, n.dur]), [['a', 0, 6], ['b', 6, 6]]);
});

test('normalize keeps valid articulations and drops unknown ones', () => {
  const s = base({ notes: [{ ...note(0, 3, 33), art: 'slide' }, { ...note(3, 3, 35), art: 'wobble' }] });
  assert.deepEqual(s.notes.map(n => n.art), ['slide', null]);
});

test('every preset builds, fits the bars, and renders whole bars', () => {
  for (const p of presets()) {
    const s = buildPreset(p);
    assert.ok(s.notes.length > 0, p.title);
    assert.equal(s.bars, p.chords.length);
    buildBars(s).bars.forEach(b => assert.equal(sumTicks(b), 48, p.title));
    const a = analyze(s);
    s.notes.forEach(n => assert.ok(a.notes[n.id].string != null, `${p.title}: unplayable ${n.midi}`));
  }
  assert.equal(new Set(presets().map(p => p.genre)).size, 6);
});

test('ghost steps become ghost notes', () => {
  const s = buildPreset(presets().find(p => p.template === 'funk-pocket'));
  assert.ok(s.notes.some(n => n.art === 'ghost'));
});

test('the walking approach note is a half step from the next root', () => {
  const s = buildPreset(presets().find(p => p.template === 'jazz-walk')); // Cm7 F7 Bbmaj7 Bbmaj7
  const beat4 = s.notes.find(n => n.start === 36); // last beat of bar 1, into F7
  assert.equal(Math.abs((beat4.midi % 12) - 5), 1);
});

test('templates switch a 3/4 groove to 4/4', () => {
  const s = base({ notes: [] });
  changeTimeSig(s, [3, 4]);
  normalize(s);
  const { changedMeter } = applyTemplate(s, TEMPLATES[0]);
  assert.equal(changedMeter, true);
  assert.deepEqual(s.timeSig, [4, 4]);
});

test('the tumbao anticipates the next chord on beat four', () => {
  const s = buildPreset(presets().find(p => p.template === 'latin-tumbao')); // Am E7 Am E7
  const n = s.notes.find(x => x.start === 36);
  assert.equal(n.midi % 12, 4); // E
});

test('the blank canvas suggests roots first, and applying it adds a root per chord', () => {
  const s = normalize(emptyGroove());
  const tips = coach(s, analyze(s));
  assert.equal(tips[0].id, 'roots');
  const d = structuredClone(s);
  tips[0].apply(d);
  normalize(d);
  assert.deepEqual(d.notes.map(n => n.midi % 12), [0]);
});

test('every coach suggestion on every preset applies cleanly', () => {
  for (const p of presets()) {
    const s = buildPreset(p);
    for (const t of coach(s, analyze(s))) {
      if (!t.apply) continue;
      const d = structuredClone(s);
      t.apply(d);
      normalize(d);
      buildBars(d).bars.forEach(b => assert.equal(sumTicks(b), 48, `${p.title}: ${t.id}`));
    }
  }
});

test('roman numerals', () => {
  const C = { tonic: 'C', mode: 'major' };
  const Am = { tonic: 'A', mode: 'minor' };
  assert.equal(romanFor('Dm7', C), 'ii7');
  assert.equal(romanFor('G7', C), 'V7');
  assert.equal(romanFor('Cmaj7', C), 'Imaj7');
  assert.equal(romanFor('Bb', C), '♭VII');
  assert.equal(romanFor('Bm7b5', C), 'viiø7');
  assert.equal(romanFor('E7', Am), 'V7');
});

test('generate returns a playable groove for every built-in genre', () => {
  for (const g of ['funk', 'motown', 'rock', 'reggae', 'jazz', 'latin']) {
    assert.ok(generationPool(g).length >= 6, g);
    const s = generate(g, { rand: () => 0.5 });
    assert.equal(s.genre, g);
    assert.ok(s.notes.length > 0);
  }
  assert.equal(generate('no-such-genre'), null);
});

test('quarter-note triplets render as triplets', () => {
  const s = base({ quantize: 8, notes: [note(0, 8, 33), note(8, 8, 36), note(16, 8, 40)] });
  const p = buildBars(s).bars[0].pieces.filter(x => !x.rest);
  assert.ok(p.every(x => x.triplet));
  assert.equal(sumTicks(buildBars(s).bars[0]), 48);
  assert.equal(gridLabel(8), '1/4 triplet');
});

console.log(`${passed} tests passed`);
