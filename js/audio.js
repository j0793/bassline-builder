// Playback with Tone.js (global `Tone`). One Transport drives the bass, the chords, the click and the loop.
// The bass is a small sampler of real electric bass notes (one recording every minor third),
// played back pitch-shifted so slides can glide and chords can ring together.
import { PPQ, barTicks, beatTicks, totalTicks, nextOf } from './state.js';
import { chordInfo } from './theory.js';

const K = 16; // Tone's 192 PPQ / our 12 PPQ
const SAMPLE_NAMES = ['Cs1', 'E1', 'G1', 'As1', 'Cs2', 'E2', 'G2', 'As2', 'Cs3', 'E3', 'G3', 'As3'];
const SAMPLE_MIDI = [25, 28, 31, 34, 37, 40, 43, 46, 49, 52, 55, 58];

let buffers = null;
let samplesReady = false;
let fallback; // synth used until the samples finish loading
let bassBus;
let ghostNoise;
let keys;
let click;
let ready = false;
let offset = 0; // count-in length in our ticks
let viewStart = 0; // first tick of the looped range
let onEnd = () => {};
let queued = null; // { groove, onSwitch } waiting for the end of the loop
let switchId = null;
let loopCount = 0;

export const opts = {
  loop: true,
  metronome: true,
  countIn: false,
  countBeats: 'bar',
  bassOn: true,
  chordsOn: false,
  bassVol: 80,
  clickVol: 60,
  chordsVol: 50,
  range: null, // { from, to } bar indexes to loop, inclusive
  trainer: { on: false, from: 70, step: 4, every: 2, target: 120 },
};
export const hooks = { onTempo: () => {}, onSamples: () => {} };

const transport = () => Tone.getTransport();
const toDb = (v, base) => (v <= 0 ? -Infinity : base + 20 * Math.log10(v / 100));
const freqOf = midi => Tone.Frequency(midi, 'midi').toFrequency();

// Start fetching the bass samples early so the first Play already sounds right.
export function preload() {
  if (buffers || !globalThis.Tone) return;
  const base = new URL('../samples/bass/', import.meta.url).href;
  const urls = Object.fromEntries(SAMPLE_NAMES.map(n => [n, `${base}${n}.mp3`]));
  buffers = new Tone.ToneAudioBuffers({
    urls,
    onload: () => {
      samplesReady = true;
      hooks.onSamples(true);
    },
    onerror: () => hooks.onSamples(false),
  });
}

export async function ensureAudio() {
  if (ready) return true;
  if (!globalThis.Tone) return false;
  await Tone.start();
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback'; // plays with the iPhone ringer off
  } catch {}
  preload();

  // Bass bus: a little compression and a gentle top-end roll-off, like a DI'd bass.
  const comp = new Tone.Compressor({ threshold: -18, ratio: 3, attack: 0.01, release: 0.15 }).toDestination();
  const tone = new Tone.Filter(3800, 'lowpass').connect(comp);
  bassBus = new Tone.Gain(1).connect(tone);

  fallback = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.005, decay: 0.3, sustain: 0.5, release: 0.15 },
    volume: -8,
  }).connect(bassBus);

  // Ghost notes add a muted string thump on top of a very short, quiet note.
  ghostNoise = new Tone.NoiseSynth({
    noise: { type: 'brown' },
    envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 },
    volume: -14,
  }).connect(new Tone.Filter(600, 'lowpass').connect(bassBus));

  // Backing chords: a soft electric-piano sound.
  keys = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 3,
    modulationIndex: 1.6,
    envelope: { attack: 0.01, decay: 1.4, sustain: 0.25, release: 0.9 },
    modulationEnvelope: { attack: 0.01, decay: 0.5, sustain: 0.1, release: 0.5 },
  }).toDestination();
  keys.maxPolyphony = 16;

  click = new Tone.Synth({
    oscillator: { type: 'square' },
    envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 },
  }).toDestination();

  transport().on('loop', onLoop);
  ready = true;
  applyVolumes();
  return true;
}

export const samplesLoaded = () => samplesReady;

export function applyVolumes() {
  if (!ready) return;
  bassBus.gain.value = opts.bassVol <= 0 ? 0 : Math.pow(opts.bassVol / 100, 1.6) * 1.3;
  keys.volume.value = toDb(opts.chordsVol, -16);
  click.volume.value = toDb(opts.clickVol, -12);
}

export const isPlaying = () => ready && transport().state === 'started';

// ----- The bass voice -----

function nearestSample(midi) {
  let best = 0;
  SAMPLE_MIDI.forEach((m, i) => {
    if (Math.abs(m - midi) < Math.abs(SAMPLE_MIDI[best] - midi)) best = i;
  });
  return { name: SAMPLE_NAMES[best], midi: SAMPLE_MIDI[best] };
}

// Play one plucked note. `glides` is a list of { at, to, over } pitch moves for slides.
function voice(midi, time, dur, { vel = 0.9, glides = [] } = {}) {
  if (!samplesReady) {
    fallback.triggerAttackRelease(freqOf(midi), Math.max(dur, 0.03), time, vel);
    return;
  }
  const s = nearestSample(midi);
  const rate = m => Math.pow(2, (m - s.midi) / 12);
  const env = new Tone.Gain(0).connect(bassBus);
  const src = new Tone.ToneBufferSource(buffers.get(s.name)).connect(env);
  src.playbackRate.setValueAtTime(rate(midi), time);
  glides.forEach(g => {
    src.playbackRate.setValueAtTime(rate(g.from), g.at);
    src.playbackRate.exponentialRampToValueAtTime(rate(g.to), g.at + g.over);
  });
  const release = dur < 0.08 ? 0.03 : 0.07;
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(vel, time + 0.003);
  env.gain.setValueAtTime(vel, time + dur);
  env.gain.linearRampToValueAtTime(0, time + dur + release);
  src.start(time);
  src.stop(time + dur + release + 0.02);
  src.onended = () => {
    src.dispose();
    env.dispose();
  };
}

export function preview(midi, art = null) {
  if (!ready) return;
  const now = Tone.now() + 0.01;
  if (art === 'ghost') {
    voice(midi, now, 0.04, { vel: 0.35 });
    ghostNoise.triggerAttackRelease(0.04, now);
  } else voice(midi, now, 0.45);
}

// ----- What gets played: the whole groove, or just the looped bars -----

export function view(s) {
  const r = opts.range;
  if (!r) return { s, start: 0 };
  const bt = barTicks(s);
  const from = Math.max(0, Math.min(r.from, s.bars - 1));
  const to = Math.max(from, Math.min(r.to, s.bars - 1));
  const start = from * bt;
  const end = (to + 1) * bt;
  const notes = s.notes
    .filter(n => n.start >= start && n.start < end)
    .map(n => ({ ...n, start: n.start - start, dur: Math.min(n.dur, end - n.start) }));
  const active = [...s.chords].reverse().find(c => c.start <= start) ?? s.chords[0];
  const chords = [{ start: 0, symbol: active.symbol }, ...s.chords.filter(c => c.start > start && c.start < end).map(c => ({ ...c, start: c.start - start }))];
  return { s: { ...s, notes, chords, bars: to - from + 1 }, start };
}

// Close voicing of a chord around the middle of the keyboard (E3 and up).
function voicing(symbol) {
  const c = chordInfo(symbol);
  if (!c) return [];
  let m = 52 + ((c.root - 52) % 12 + 12) % 12;
  const out = [];
  c.pcs.slice(0, 4).forEach(pc => {
    while (m % 12 !== pc) m++;
    out.push(m);
  });
  return out;
}

export function schedule(full) {
  if (!ready) return;
  const T = transport();
  T.cancel(0);
  switchId = null;
  const { s, start } = view(full);
  viewStart = start;
  T.bpm.value = opts.trainer.on ? Math.min(opts.trainer.target, currentTrainerBpm ?? opts.trainer.from) : s.bpm;
  T.timeSignature = s.timeSig[0] * (4 / s.timeSig[1]);
  const bar = barTicks(s);
  const beat = beatTicks(s);
  const total = totalTicks(s);
  const at = t => `${Math.round((offset + t) * K)}i`;
  const secs = ticks => Tone.Time(`${Math.max(1, Math.round(ticks * K))}i`).toSeconds();

  if (opts.bassOn) {
    // Slides join notes into one voice that glides; hammer-ons re-sound softly without a pluck.
    const slidInto = new Set();
    const hammeredInto = new Set();
    s.notes.forEach(n => {
      const nx = nextOf(s.notes, n);
      if (!nx || nx.start !== n.start + n.dur) return;
      if (n.art === 'slide') slidInto.add(nx.id);
      if (n.art === 'hammer') hammeredInto.add(nx.id);
    });
    s.notes.forEach(n => {
      if (slidInto.has(n.id)) return; // sounded by the note that slides into it
      if (n.art === 'ghost') {
        T.schedule(time => {
          voice(n.midi, time, 0.04, { vel: 0.3 });
          ghostNoise.triggerAttackRelease(0.04, time);
        }, at(n.start));
        return;
      }
      // Follow any chain of slides from this note.
      const chain = [n];
      let cur = n;
      while (cur.art === 'slide') {
        const nx = nextOf(s.notes, cur);
        if (!nx || nx.start !== cur.start + cur.dur || chain.includes(nx)) break;
        chain.push(nx);
        cur = nx;
      }
      const last = chain.at(-1);
      const totalDur = last.start + last.dur - n.start;
      T.schedule(time => {
        const glides = [];
        for (let i = 0; i < chain.length - 1; i++) {
          const a = chain[i];
          const endAt = time + secs(a.start + a.dur - n.start);
          const over = Math.min(secs(a.dur) * 0.5, 0.09);
          glides.push({ from: a.midi, to: chain[i + 1].midi, at: endAt - over, over });
        }
        const vel = hammeredInto.has(n.id) ? 0.55 : 0.9;
        voice(n.midi, time, secs(totalDur) * 0.96, { vel, glides });
      }, at(n.start));
    });
  }

  if (opts.chordsOn) {
    // Re-strike each chord at its start and on every bar line it spans.
    s.chords.forEach((c, i) => {
      const end = s.chords[i + 1]?.start ?? total;
      const notes = voicing(c.symbol).map(freqOf);
      if (!notes.length) return;
      for (let t = c.start; t < end; t = Math.floor(t / bar) * bar + bar) {
        const len = Math.min(end, Math.floor(t / bar) * bar + bar) - t;
        T.schedule(time => keys.triggerAttackRelease(notes, secs(len) * 0.95, time, 0.5), at(t));
      }
    });
  }

  const tick = (t, accent) =>
    T.schedule(time => click.triggerAttackRelease(accent ? 'C6' : 'G5', 0.03, time), `${Math.round(t * K)}i`);
  if (offset) for (let t = 0; t < offset; t += countIn(s).step) tick(t, t === 0);
  if (opts.metronome) for (let t = 0; t < total; t += beat) tick(offset + t, t % bar === 0);

  T.loop = opts.loop;
  T.loopStart = `${offset * K}i`;
  T.loopEnd = `${(offset + total) * K}i`;
  if (!opts.loop) {
    T.schedule(time => Tone.getDraw().schedule(() => stop(), time), at(total));
  }
  if (queued) armSwitch(full);
}

// ----- Tempo trainer: speed up every few loops until the target -----
let currentTrainerBpm = null;
function onLoop(time) {
  loopCount++;
  const tr = opts.trainer;
  if (!tr.on || currentTrainerBpm == null) return;
  if (loopCount % Math.max(1, tr.every) !== 0 || currentTrainerBpm >= tr.target) return;
  currentTrainerBpm = Math.min(tr.target, currentTrainerBpm + tr.step);
  transport().bpm.setValueAtTime(currentTrainerBpm, time);
  const bpm = currentTrainerBpm;
  Tone.getDraw().schedule(() => hooks.onTempo(bpm), time);
}
export const trainerBpm = () => currentTrainerBpm;

// Swap to another groove right as the current loop comes around.
function armSwitch(full) {
  const T = transport();
  const endTick = Math.round((offset + totalTicks(view(full).s)) * K);
  switchId = T.scheduleOnce(time => {
    const q = queued;
    queued = null;
    if (!q) return;
    schedule(q.groove); // new events exist before the clock wraps to the loop start
    // Keep wrapping at the old length this time round, then take the new length.
    T.loopEnd = `${endTick}i`;
    const newEnd = `${(offset + totalTicks(view(q.groove).s)) * K}i`;
    T.scheduleOnce(() => (T.loopEnd = newEnd), `${offset * K}i`);
    Tone.getDraw().schedule(() => q.onSwitch(), time);
  }, `${endTick - 2}i`);
}

export function queueSwitch(groove, onSwitch, current) {
  queued = { groove, onSwitch };
  if (isPlaying()) {
    if (switchId != null) transport().clear(switchId);
    armSwitch(current);
  }
}

export const hasQueued = () => !!queued;
export function cancelQueue() {
  queued = null;
  if (ready && switchId != null) transport().clear(switchId);
  switchId = null;
}

export async function play(s, whenEnded) {
  if (!(await ensureAudio())) return false;
  onEnd = whenEnded ?? (() => {});
  const v = view(s).s;
  offset = opts.countIn ? countIn(v).ticks : 0;
  loopCount = 0;
  currentTrainerBpm = opts.trainer.on ? opts.trainer.from : null;
  if (currentTrainerBpm != null) hooks.onTempo(currentTrainerBpm);
  const T = transport();
  T.stop();
  T.position = 0;
  schedule(s);
  T.start('+0.05');
  return true;
}

export function stop() {
  if (!ready) return;
  const T = transport();
  T.stop();
  T.cancel(0);
  fallback.releaseAll();
  keys.releaseAll();
  cancelQueue();
  currentTrainerBpm = null;
  onEnd();
}

// Current position in the groove's own ticks (negative during the count-in), or null when stopped.
export function position() {
  if (!isPlaying()) return null;
  const t = transport().ticks / K - offset;
  return t < 0 ? t : t + viewStart;
}

// 'bar' counts one full bar in the time signature's own unit: 4 in 4/4, 3 in 3/4, 6 in 6/8, 7 in 7/8.
// A number counts that many metronome beats.
export function countIn(s) {
  if (opts.countBeats === 'bar') {
    const step = (PPQ * 4) / s.timeSig[1];
    return { step, ticks: barTicks(s), count: s.timeSig[0] };
  }
  const n = Number(opts.countBeats) || 4;
  return { step: beatTicks(s), ticks: n * beatTicks(s), count: n };
}

export function setBpm(bpm) {
  if (ready && !opts.trainer.on) transport().bpm.value = bpm;
}
