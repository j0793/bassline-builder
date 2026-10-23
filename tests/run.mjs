// Unit tests for the pure logic. Run: npm install && npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

if (process.env.TONAL_BROWSER_BUILD) {
  globalThis.Tonal = new Function(readFileSync(process.env.TONAL_BROWSER_BUILD, 'utf8') + ';return Tonal')();
} else {
  globalThis.Tonal = await import('tonal');
}

const { demoGroove, normalize, changeTimeSig, totalTicks } = await import('../js/state.js');
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

console.log(`${passed} tests passed`);
