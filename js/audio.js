// Playback with Tone.js (global `Tone`). One Transport drives the bass, the click and the loop.
import { barTicks, beatTicks, totalTicks } from './state.js';

const K = 16; // Tone's 192 PPQ / our 12 PPQ
let synth;
let ghost;
let click;
let ready = false;
let offset = 0; // count-in length in our ticks
let onEnd = () => {};
let queued = null; // { groove, onSwitch } waiting for the end of the loop
let switchId = null;

export const opts = { loop: true, metronome: true, countIn: false, countBeats: 4, bassOn: true, bassVol: 80, clickVol: 60 };

const transport = () => Tone.getTransport();
const toDb = (v, base) => (v <= 0 ? -Infinity : base + 20 * Math.log10(v / 100));
const freqOf = midi => Tone.Frequency(midi, 'midi').toFrequency();

export async function ensureAudio() {
  if (ready) return true;
  if (!globalThis.Tone) return false;
  await Tone.start();
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback'; // plays with the iPhone ringer off
  } catch {}
  synth = new Tone.MonoSynth({
    oscillator: { type: 'sawtooth' },
    filter: { type: 'lowpass', Q: 1.5, rolloff: -24 },
    envelope: { attack: 0.004, decay: 0.25, sustain: 0.7, release: 0.12 },
    filterEnvelope: { attack: 0.004, decay: 0.18, sustain: 0.25, release: 0.2, baseFrequency: 90, octaves: 2.6 },
  }).toDestination();
  // Ghost notes: a muted thump, mostly attack and string noise.
  const ghostFilter = new Tone.Filter(700, 'lowpass').toDestination();
  ghost = new Tone.NoiseSynth({
    noise: { type: 'brown' },
    envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
  }).connect(ghostFilter);
  click = new Tone.Synth({
    oscillator: { type: 'square' },
    envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 },
  }).toDestination();
  ready = true;
  applyVolumes();
  return true;
}

export function applyVolumes() {
  if (!ready) return;
  synth.volume.value = toDb(opts.bassVol, -6);
  ghost.volume.value = toDb(opts.bassVol, -4);
  click.volume.value = toDb(opts.clickVol, -12);
}

export const isPlaying = () => ready && transport().state === 'started';

export function preview(midi, art = null) {
  if (!ready) return;
  if (art === 'ghost') return ghost.triggerAttackRelease(0.05);
  synth.triggerAttackRelease(freqOf(midi), 0.22);
}

// Build the note events, joining slides and hammer-ons into the next note without re-plucking.
function bassEvents(s) {
  const events = [];
  s.notes.forEach((n, i) => {
    const next = s.notes[i + 1];
    const joins = (n.art === 'slide' || n.art === 'hammer') && next && next.start === n.start + n.dur;
    const prev = s.notes[i - 1];
    const joined = prev && (prev.art === 'slide' || prev.art === 'hammer') && prev.start + prev.dur === n.start;
    events.push({ n, next, joins, joined });
  });
  return events;
}

export function schedule(s) {
  if (!ready) return;
  const T = transport();
  T.cancel(0);
  switchId = null;
  T.bpm.value = s.bpm;
  T.timeSignature = s.timeSig[0] * (4 / s.timeSig[1]);
  const bar = barTicks(s);
  const beat = beatTicks(s);
  const total = totalTicks(s);
  const at = t => `${Math.round((offset + t) * K)}i`;
  const secs = ticks => Tone.Time(`${Math.max(1, Math.round(ticks * K))}i`).toSeconds();

  if (opts.bassOn) {
    bassEvents(s).forEach(({ n, next, joins, joined }) => {
      if (n.art === 'ghost') {
        T.schedule(time => ghost.triggerAttackRelease(0.05, time), at(n.start));
        return;
      }
      const f = freqOf(n.midi);
      T.schedule(time => {
        if (joined) synth.setNote(f, time); // hammered or slid into: no new pluck
        else synth.triggerAttack(f, time);
        if (joins && n.art === 'slide') {
          const glide = Math.min(secs(n.dur) * 0.6, 0.12);
          synth.frequency.setValueAtTime(f, time + secs(n.dur) - glide);
          synth.frequency.exponentialRampToValueAtTime(freqOf(next.midi), time + secs(n.dur));
        }
        if (!joins) synth.triggerRelease(time + secs(n.dur * 0.92));
      }, at(n.start));
    });
  }

  const tick = (t, accent) =>
    T.schedule(time => click.triggerAttackRelease(accent ? 'C6' : 'G5', 0.03, time), `${Math.round(t * K)}i`);
  if (offset) for (let t = 0; t < offset; t += beat) tick(t, t === 0);
  if (opts.metronome) for (let t = 0; t < total; t += beat) tick(offset + t, t % bar === 0);

  T.loop = opts.loop;
  T.loopStart = `${offset * K}i`;
  T.loopEnd = `${(offset + total) * K}i`;
  if (!opts.loop) {
    T.schedule(time => Tone.getDraw().schedule(() => stop(), time), at(total));
  }
  if (queued) armSwitch(s);
}

// Swap to another groove right as the current loop comes around.
function armSwitch(s) {
  const T = transport();
  const endTick = Math.round((offset + totalTicks(s)) * K);
  switchId = T.scheduleOnce(time => {
    const q = queued;
    queued = null;
    if (!q) return;
    schedule(q.groove); // new events exist before the clock wraps to the loop start
    // Keep wrapping at the old length this time round, then take the new length.
    T.loopEnd = `${endTick}i`;
    const newEnd = `${(offset + totalTicks(q.groove)) * K}i`;
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
  offset = opts.countIn ? opts.countBeats * beatTicks(s) : 0; // count-in length in beats
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
  synth.triggerRelease();
  cancelQueue();
  onEnd();
}

// Current position in our ticks (negative during the count-in), or null when stopped.
export function position() {
  if (!isPlaying()) return null;
  return transport().ticks / K - offset;
}

export function setBpm(bpm) {
  if (ready) transport().bpm.value = bpm;
}
