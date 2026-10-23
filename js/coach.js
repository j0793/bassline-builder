// The teaching panel: read the groove, then suggest what to try next.
// Each suggestion explains why, and most carry a `apply(draft)` that makes the change (undoable).
import { barTicks, beatTicks, totalTicks, uid, claim, MAX_BARS } from './state.js';
import { chordInfo, chordSpans, keyInfo, suggestNext, noteMidi, chroma, pretty, prettyNote } from './theory.js';
import { TEMPLATES, GENRES } from './genres.js';

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];
const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

// Roman numeral for any chord in a key, e.g. Dm7 in C major -> ii7, Bb in C major -> bVII.
export function romanFor(symbol, key) {
  const c = chordInfo(symbol);
  if (!c) return '?';
  const tonic = chroma(key.tonic);
  const steps = key.mode === 'minor' ? MINOR_STEPS : MAJOR_STEPS;
  const semis = (c.root - tonic + 12) % 12;
  let deg = steps.indexOf(semis);
  let prefix = '';
  if (deg < 0) {
    // Not on a scale step: name it as a flat of the step above.
    deg = steps.indexOf((semis + 1) % 12);
    prefix = '♭';
    if (deg < 0) {
      deg = steps.indexOf((semis + 11) % 12);
      prefix = '♯';
    }
  }
  const third = c.intervals.find(iv => iv.startsWith('3'));
  const minor = third === '3m';
  const dim = c.intervals.includes('5d');
  let r = NUMERALS[deg] ?? '?';
  if (minor) r = r.toLowerCase();
  const has = iv => c.intervals.includes(iv);
  const ninth = c.intervals.some(iv => iv.startsWith('9'));
  let ext = '';
  if (has('7M')) ext = ninth ? 'maj9' : 'maj7';
  else if (has('7m')) ext = ninth ? '9' : '7';
  else if (has('7d')) ext = '°7';
  const quality = dim ? (has('7m') ? 'ø' : ext === '°7' ? '' : '°') : c.intervals.includes('5A') ? '+' : '';
  return `${prefix}${r}${quality}${ext}`;
}

export function inKey(symbol, key) {
  const c = chordInfo(symbol);
  if (!c) return false;
  const pcs = keyInfo(key).scalePcs;
  return c.pcs.every(pc => pcs.includes(pc));
}

// Low, comfortable root for a chord: first at or above the lowest open string.
function rootPitch(chord, opens) {
  const low = Math.min(...opens);
  return low + (((chord.root - low) % 12) + 12) % 12;
}

const noteAt = (t, tick) => t.notes.find(n => n.start <= tick && n.start + n.dur > tick);
const startsAt = (t, tick) => t.notes.find(n => n.start === tick);

function addNote(t, start, dur, midi, art = null) {
  const id = uid();
  t.notes.push({ id, start, dur, midi, string: null, art });
  claim(t, id);
  return id;
}

export function coach(s, a) {
  const tips = [];
  const total = totalTicks(s);
  const bar = barTicks(s);
  const beat = beatTicks(s);
  const spans = a.summaries;
  const opens = s.tuning.map(noteMidi);
  const step = Math.min(s.quantize, 6);
  const notes = s.notes;
  const pitched = notes.filter(n => n.art !== 'ghost');

  // 1. Nothing yet: roots on the chord changes.
  if (!notes.length) {
    tips.push({
      id: 'roots',
      title: 'Start with the root on every chord change',
      why: 'The root tells the band and the listener where the harmony is. Most basslines are built outward from this skeleton.',
      action: 'Add the roots',
      apply: t => {
        for (const sp of chordSpans(t)) {
          if (!sp.chord) continue;
          addNote(t, sp.start, Math.min(sp.end - sp.start, beat), rootPitch(sp.chord, opens));
        }
      },
    });
    tips.push({
      id: 'generate',
      title: 'Or generate a starting idea',
      why: 'Pick a genre at the top and press Generate to hear a typical line for it, then change it until it sounds like yours.',
    });
    return tips;
  }

  // 2. A chord change that doesn't land on the root. Reggae and Latin lines skip the downbeat on purpose.
  const skipsOne = (s.genre === 'reggae' || s.genre === 'latin');
  const missed = spans.find(sp => sp.chord && sp.total && !sp.rootOnOne && !(skipsOne && !startsAt(s, sp.start)));
  if (missed) {
    tips.push({
      id: `land-${missed.index}`,
      title: `Land the root of ${pretty(missed.symbol)} on the change`,
      why: 'When the chord changes, the root on the downbeat makes the new chord sound settled. Delaying it is a fine choice later, once you mean it.',
      action: `Put ${prettyNote(missed.chord.tonic)} on the change`,
      apply: t => {
        const existing = startsAt(t, missed.start);
        const midi = rootPitch(missed.chord, opens);
        if (existing) Object.assign(existing, { midi, string: null, art: null });
        else addNote(t, missed.start, Math.min(beat / 2, missed.end - missed.start), midi);
      },
    });
  }

  // 2b. Very sparse: give the line a pulse.
  if (pitched.length < s.bars * 3 && s.genre !== 'latin') {
    tips.push({
      id: 'pulse',
      title: 'Give the line a pulse',
      why: 'Repeating the root on the beat (or on eighth notes) locks you in with the drummer. Get the rhythm feeling good before adding new pitches.',
      action: 'Fill empty beats with the root',
      apply: t => {
        const spansT = chordSpans(t);
        for (let tick = 0; tick < totalTicks(t); tick += beat) {
          if (noteAt(t, tick)) continue;
          const sp = spansT.find(x => tick >= x.start && tick < x.end);
          if (sp?.chord) addNote(t, tick, beat / 2, rootPitch(sp.chord, opens));
        }
      },
    });
  }

  // 3. Connect chords with an approach note.
  if (spans.length > 1 && pitched.length >= 3) {
    const sp = spans.find(x => {
      if (!x.chord || !x.rootOnOne) return false;
      const end = x.start === 0 ? total : x.start;
      const before = notes.find(n => n.start + n.dur === end);
      return !before || !a.notes[before.id]?.approach;
    });
    if (sp) {
      const at = (sp.start - step + total) % total;
      tips.push({
        id: `approach-${sp.index}`,
        title: `Walk into ${pretty(sp.symbol)} with an approach note`,
        why: `A note a half step from the next root, played just before the change, pulls the ear into ${pretty(sp.symbol)}. It's the most common way bass players connect chords.`,
        action: 'Add the approach note',
        apply: t => {
          const targetMidi = startsAt(t, sp.start)?.midi ?? rootPitch(sp.chord, opens);
          const prev = noteAt(t, at - 1);
          const from = prev && prev.midi > targetMidi ? 1 : -1;
          const midi = targetMidi + from < Math.min(...opens) ? targetMidi + 1 : targetMidi + from;
          addNote(t, at, step, midi);
        },
      });
    }
  }

  // 4. Only roots so far: open the line up.
  const counted = spans.reduce((n, sp) => n + sp.total, 0);
  const roots = spans.reduce((n, sp) => n + sp.roots, 0);
  if (counted >= 3 && roots === counted) {
    tips.push({
      id: 'fifths',
      title: 'Add the fifth to move the line',
      why: 'A line of only roots is solid but static. The fifth is the safest second note: it fits almost every chord and adds motion without clashing.',
      action: 'Swap some off-beat roots for fifths',
      apply: t => {
        const spansT = chordSpans(t);
        t.notes.forEach((n, i) => {
          const sp = spansT.find(x => n.start >= x.start && n.start < x.end);
          if (!sp?.chord || n.start === sp.start || n.start % beat === 0 || i % 2 === 0) return;
          n.midi += 7;
          n.string = null;
        });
        if (!t.notes.some(n => spansT.some(x => x.chord && n.start > x.start && n.start < x.end && (n.midi % 12) === ((x.chord.root + 7) % 12)))) {
          // No off-beat notes to swap: add a fifth on beat 3 of each chord.
          for (const x of spansT) {
            if (!x.chord || x.end - x.start < beat * 3) continue;
            addNote(t, x.start + beat * 2, beat, rootPitch(x.chord, opens) + 7);
          }
        }
      },
    });
  }

  // 5. Mostly non-chord tones.
  const tones = spans.reduce((n, sp) => n + sp.chordTones, 0);
  if (counted >= 4 && tones / counted < 0.5) {
    tips.push({
      id: 'tones',
      title: 'Put chord tones on the strong beats',
      why: `${tones} of ${counted} notes are chord tones. Passing notes sound intentional when the beats themselves sit on R, 3, 5 or 7.`,
      action: 'Move on-beat notes to the nearest chord tone',
      apply: t => {
        const spansT = chordSpans(t);
        t.notes.forEach(n => {
          if (n.start % beat !== 0 || n.art === 'ghost') return;
          const sp = spansT.find(x => n.start >= x.start && n.start < x.end);
          if (!sp?.chord || sp.chord.pcs.includes(n.midi % 12)) return;
          for (const d of [1, -1, 2, -2]) {
            if (sp.chord.pcs.includes((((n.midi + d) % 12) + 12) % 12)) {
              n.midi += d;
              n.string = null;
              break;
            }
          }
        });
      },
    });
  }

  // 6. Harmony: grow the progression.
  const k = s.key;
  if (s.chords.length === 1 || new Set(s.chords.map(c => c.symbol)).size === 1) {
    const sym = s.chords[0].symbol;
    const next = suggestNext(sym, k).find(d => d.symbol !== sym);
    if (next) {
      tips.push({
        id: 'second-chord',
        title: `Try a second chord: ${pretty(next.symbol)} (${next.roman})`,
        why: `One-chord vamps are great for groove practice. Moving ${romanFor(sym, k)} to ${next.roman} is a common step in ${prettyNote(k.tonic)} ${k.mode} and gives your line somewhere to travel.`,
        action: `Make bar ${s.bars} ${pretty(next.symbol)}`,
        apply: t => {
          const bt = barTicks(t);
          const start = (t.bars - 1) * bt;
          if (start === 0) t.chords.push({ start: bt / 2, symbol: next.symbol });
          else {
            t.chords = t.chords.filter(c => c.start < start);
            t.chords.push({ start, symbol: next.symbol });
          }
        },
      });
    }
  } else {
    const last = s.chords.at(-1).symbol;
    const first = s.chords[0].symbol;
    // If the last chord already leads back to the first, the loop resolves; otherwise offer a next chord.
    const loops = suggestNext(last, k).some(d => d.chord?.root === chordInfo(first)?.root);
    const options = suggestNext(last, k).filter(d => !s.chords.some(c => c.symbol === d.symbol));
    if (!loops && options[0] && s.bars < MAX_BARS) {
      const o = options[0];
      tips.push({
        id: 'extend',
        title: `Extend the progression with ${pretty(o.symbol)} (${o.roman})`,
        why: `After ${pretty(last)} (${romanFor(last, k)}), ${o.roman} is a common next chord in ${prettyNote(k.tonic)} ${k.mode}. A new bar gives you room to write a fresh idea.`,
        action: `Add a bar of ${pretty(o.symbol)}`,
        apply: t => {
          const bt = barTicks(t);
          t.chords.push({ start: t.bars * bt, symbol: o.symbol });
          t.bars += 1;
        },
      });
    }
    const outside = s.chords.filter(c => !inKey(c.symbol, k));
    if (outside.length) {
      const o = outside[0].symbol;
      const info = chordInfo(o);
      const tones = info?.notes.map(prettyNote).join(' ');
      const minorV = k.mode === 'minor' && info && (info.root - chroma(k.tonic) + 12) % 12 === 7 && info.intervals.includes('3M');
      tips.push({
        id: 'outside',
        title: minorV ? `${pretty(o)} is the V chord of harmonic minor` : `${pretty(o)} borrows notes from outside ${prettyNote(k.tonic)} ${k.mode}`,
        why: minorV
          ? `Minor keys usually raise the 7th for the V chord, which is where ${prettyNote(info.notes[1])} comes from. Play ${prettyNote(info.notes[1])} (not the key's natural note) over ${pretty(o)}: it pulls hard back to ${prettyNote(k.tonic)}.`
          : `Over ${pretty(o)}, follow the chord rather than the key: lean on its own chord tones (${tones}) so the line agrees with the harmony.`,
      });
    }
  }

  // 7. Genre-specific moves.
  const genre = s.genre;
  const ghosts = notes.filter(n => n.art === 'ghost').length;
  if (genre === 'funk' && !ghosts && pitched.length >= 3) {
    tips.push({
      id: 'ghosts',
      title: 'Add ghost notes between the pitches',
      why: 'Funk lines feel busy without being cluttered because the gaps are filled with muted, percussive ghost notes. They add groove without adding harmony.',
      action: 'Fill some gaps with ghosts',
      apply: t => {
        const spansT = chordSpans(t);
        for (let tick = 0; tick < total; tick += beat) {
          const at = tick + (beat * 3) / 4; // the "a" of each beat
          if (noteAt(t, at) || at % 3) continue;
          const sp = spansT.find(x => at >= x.start && at < x.end);
          if (!sp?.chord) continue;
          addNote(t, at, 3, rootPitch(sp.chord, opens), 'ghost');
        }
      },
    });
  }
  if (genre === 'reggae') {
    const onOne = notes.filter(n => n.start % bar === 0);
    if (onOne.length) {
      tips.push({
        id: 'one-drop',
        title: 'Leave beat one empty',
        why: 'In one-drop reggae the drums and bass skip the downbeat. The silence on one is what makes the groove lean back.',
        action: 'Clear the downbeats',
        apply: t => {
          t.notes = t.notes.filter(n => n.start % barTicks(t) !== 0);
        },
      });
    }
  }
  if (genre === 'jazz' && pitched.some(n => n.dur !== beat)) {
    tips.push({
      id: 'walk',
      title: 'Walk in steady quarter notes',
      why: 'A walking line plays every beat: chord tones on 1 and 3, an approach note on 4 leading into the next root.',
      action: 'Apply the chord-tone walk',
      template: 'jazz-walk',
    });
  }

  // 8. Range and techniques.
  if (pitched.length >= 6) {
    const midis = pitched.map(n => n.midi);
    if (Math.max(...midis) - Math.min(...midis) < 7) {
      tips.push({
        id: 'octave',
        title: 'Use the octave',
        why: 'All your notes sit within a few frets. Jumping up an octave (two strings over, two frets up) adds lift without leaving the chord.',
        action: 'Move one off-beat root up an octave',
        apply: t => {
          const spansT = chordSpans(t);
          const n = t.notes.find(n => {
            const sp = spansT.find(x => n.start >= x.start && n.start < x.end);
            return sp?.chord && n.start !== sp.start && n.midi % 12 === sp.chord.root && n.art !== 'ghost';
          });
          if (n) {
            n.midi += 12;
            n.string = null;
          }
        },
      });
    }
    if (!notes.some(n => n.art === 'slide' || n.art === 'hammer')) {
      const idx = notes.findIndex((n, i) => {
        const next = notes[i + 1];
        return next && n.start + n.dur === next.start && n.art !== 'ghost' && next.art !== 'ghost' && n.midi !== next.midi && Math.abs(n.midi - next.midi) <= 5;
      });
      if (idx >= 0) {
        tips.push({
          id: 'slide',
          title: 'Slide into a note',
          why: 'A slide connects two notes with one pluck and gives the line a vocal, human feel. Try it where two notes sit close together.',
          action: 'Add a slide',
          apply: t => {
            const n = t.notes.find(x => x.id === notes[idx].id);
            if (n) n.art = 'slide';
          },
        });
      }
    }
  }

  // 9. Every bar the same: a fill at the end.
  if (s.bars >= 2 && pitched.length >= 4) {
    const rhythm = b => notes.filter(n => n.start >= b * bar && n.start < (b + 1) * bar).map(n => n.start - b * bar).join(',');
    const same = Array.from({ length: s.bars }, (_, b) => rhythm(b)).every((r, _, arr) => r === arr[0]);
    if (same) {
      tips.push({
        id: 'fill',
        title: 'Change the last beat into a fill',
        why: 'Repeating the same bar locks in the groove. A short run in the final beat leads the ear back to the top of the loop.',
        action: 'Add a chromatic fill',
        apply: t => {
          const tt = totalTicks(t);
          const start = tt - beat;
          const first = chordSpans(t)[0];
          if (!first?.chord) return;
          const target = startsAt(t, 0)?.midi ?? rootPitch(first.chord, opens);
          t.notes = t.notes.filter(n => n.start < start);
          const len = beat / 4;
          [target - 4, target - 3, target - 2, target - 1].forEach((m, i) =>
            addNote(t, start + i * len, len, m < Math.min(...opens) ? m + 12 : m)
          );
        },
      });
    }
  }

  // 10. Always offer the genre's rhythms as a direction.
  const genreTemplates = TEMPLATES.filter(tp => tp.genre === genre);
  if (genreTemplates.length && tips.length < 4) {
    const tp = genreTemplates[Math.floor((notes.length + s.bars) % genreTemplates.length)];
    tips.push({
      id: `template-${tp.id}`,
      title: `Hear "${tp.name}" over your chords`,
      why: `${tp.teaches} Use it as a reference, then rework it into your own line.`,
      action: 'Apply the template',
      template: tp.id,
    });
  }

  return tips.slice(0, 5);
}

export const genreHint = id => GENRES.find(g => g.id === id)?.blurb ?? '';
