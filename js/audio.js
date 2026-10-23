// Playback with Tone.js (global `Tone`). One Transport drives the bass, the click and the loop.
import { barTicks, beatTicks, totalTicks } from './state.js';

const K = 16; // Tone's 192 PPQ / our 12 PPQ
let synth;
let click;
let ready = false;
let offset = 0; // count-in length in our ticks
let onEnd = () => {};

export const opts = { loop: true, metronome: true, countIn: false, bassOn: true };

const transport = () => Tone.getTransport();

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
    volume: -8,
  }).toDestination();
  click = new Tone.Synth({
    oscillator: { type: 'square' },
    envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 },
    volume: -16,
  }).toDestination();
  ready = true;
  return true;
}

export const isPlaying = () => ready && transport().state === 'started';

export function preview(midi) {
  if (!ready) return;
  synth.triggerAttackRelease(Tone.Frequency(midi, 'midi').toFrequency(), 0.22);
}

export function schedule(s) {
  if (!ready) return;
  const T = transport();
  T.cancel(0);
  T.bpm.value = s.bpm;
  T.timeSignature = s.timeSig[0] * (4 / s.timeSig[1]);
  const bar = barTicks(s);
  const beat = beatTicks(s);
  const total = totalTicks(s);
  const at = t => `${Math.round((offset + t) * K)}i`;

  if (opts.bassOn) {
    s.notes.forEach(n => {
      const freq = Tone.Frequency(n.midi, 'midi').toFrequency();
      const len = `${Math.max(1, Math.round(n.dur * K * 0.92))}i`;
      T.schedule(time => synth.triggerAttackRelease(freq, len, time), at(n.start));
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
}

export async function play(s, whenEnded) {
  if (!(await ensureAudio())) return false;
  onEnd = whenEnded ?? (() => {});
  offset = opts.countIn ? barTicks(s) : 0;
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

