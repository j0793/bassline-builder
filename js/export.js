// Exports: a Standard MIDI File of the bassline (and chords), and a PNG of the notation + tab.
import { PPQ, totalTicks } from './state.js';
import { chordInfo } from './theory.js';

const MIDI_PPQ = 96;
const SCALE = MIDI_PPQ / PPQ; // our ticks -> MIDI ticks

const vlq = n => {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
};
const str = s => [...s].map(c => c.charCodeAt(0));
const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = n => [(n >>> 8) & 255, n & 255];

function track(events, name) {
  // events: [{ tick, data: [...] }] in absolute MIDI ticks
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const bytes = [0x00, 0xff, 0x03, ...vlq(name.length), ...str(name)];
  let last = 0;
  for (const e of sorted) {
    bytes.push(...vlq(e.tick - last), ...e.data);
    last = e.tick;
  }
  bytes.push(0x00, 0xff, 0x2f, 0x00);
  return [...str('MTrk'), ...u32(bytes.length), ...bytes];
}

// Format 1: tempo/meter track, bass on channel 1 (fingered electric bass), chords on channel 2.
export function midiFile(s, { chords = true } = {}) {
  const [num, den] = s.timeSig;
  const tempo = Math.round(60000000 / s.bpm);
  const meta = track(
    [
      { tick: 0, order: 0, data: [0xff, 0x51, 0x03, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255] },
      { tick: 0, order: 1, data: [0xff, 0x58, 0x04, num, Math.log2(den), 24, 8] },
    ],
    s.title || 'Bassline'
  );

  const bassEvents = [{ tick: 0, order: 0, data: [0xc0, 33] }]; // program 34: Electric Bass (finger)
  s.notes.forEach(n => {
    const on = Math.round(n.start * SCALE);
    const len = n.art === 'ghost' ? Math.max(1, Math.round(MIDI_PPQ / 16)) : Math.max(1, Math.round(n.dur * SCALE) - 2);
    const vel = n.art === 'ghost' ? 40 : 100;
    bassEvents.push({ tick: on, order: 2, data: [0x90, n.midi, vel] });
    bassEvents.push({ tick: on + len, order: 1, data: [0x80, n.midi, 0] });
  });
  const tracks = [meta, track(bassEvents, 'Bass')];

  if (chords) {
    const total = totalTicks(s);
    const ev = [{ tick: 0, order: 0, data: [0xc1, 4] }]; // program 5: Electric Piano 1
    s.chords.forEach((c, i) => {
      const info = chordInfo(c.symbol);
      if (!info) return;
      const end = s.chords[i + 1]?.start ?? total;
      let m = 52 + ((info.root - 52) % 12 + 12) % 12;
      info.pcs.slice(0, 4).forEach(pc => {
        while (m % 12 !== pc) m++;
        ev.push({ tick: Math.round(c.start * SCALE), order: 2, data: [0x91, m, 70] });
        ev.push({ tick: Math.round(end * SCALE) - 1, order: 1, data: [0x81, m, 0] });
      });
    });
    tracks.push(track(ev, 'Chords'));
  }

  const header = [...str('MThd'), ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(MIDI_PPQ)];
  return new Uint8Array([...header, ...tracks.flat()]);
}

export const fileName = (s, ext) =>
  `${(s.title || 'bassline').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'bassline'}.${ext}`;

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
