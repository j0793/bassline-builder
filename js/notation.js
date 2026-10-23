// Grid ticks -> readable note values -> VexFlow bass clef + tab.
// buildBars() is pure (and tested); renderNotation() draws with the global VexFlow.
import { barTicks, beatTicks, isCompound, nextOf } from './state.js';
import { midiName, pretty } from './theory.js';

const STRAIGHT = { 48: 'w', 36: 'hd', 24: 'h', 18: 'qd', 12: 'q', 9: '8d', 6: '8', 3: '16' };
const TRIPLET = { 8: 'q', 4: '8', 2: '16' };
const LONG = [48, 36, 24, 18, 12];

function greedy(len, table, maxLen) {
  const values = Object.keys(table).map(Number).filter(v => v <= maxLen).sort((a, b) => b - a);
  const out = [];
  let left = len;
  for (const v of values) {
    while (left >= v) {
      out.push(v);
      left -= v;
    }
  }
  return { values: out, leftover: left };
}

// Returns one entry per bar, each with pieces covering the bar exactly.
export function buildBars(s) {
  const bar = barTicks(s);
  const beat = beatTicks(s);
  const bars = [];
  let approx = false;

  for (let b = 0; b < s.bars; b++) {
    const b0 = b * bar;
    const b1 = b0 + bar;

    // Slice the bar wherever any note starts or stops. Each slice is a rest or a chord of
    // whatever is sounding; a note that spans several slices is tied across them.
    const inBar = s.notes.filter(n => n.start < b1 && n.start + n.dur > b0);
    const cuts = new Set([b0, b1]);
    inBar.forEach(n => [n.start, n.start + n.dur].forEach(t => t > b0 && t < b1 && cuts.add(t)));
    const points = [...cuts].sort((x, y) => x - y);
    const events = [];
    for (let i = 0; i < points.length - 1; i++) {
      const [st, en] = [points[i], points[i + 1]];
      const sounding = inBar.filter(n => n.start < en && n.start + n.dur > st).sort((x, y) => x.midi - y.midi);
      const prev = events.at(-1);
      if (!sounding.length && prev?.rest) prev.end = en; // join neighbouring rests
      else events.push(sounding.length ? { start: st, end: en, notes: sounding } : { start: st, end: en, rest: true });
    }

    const chordStarts = s.chords.map(c => c.start).filter(t => t > b0 && t < b1);
    const nextChord = t => Math.min(b1, ...chordStarts.filter(c => c > t));

    // Each beat is either straight (16ths) or triplet, decided by where its notes fall.
    const beatType = [];
    for (let k = 0; k * beat < bar; k++) {
      const bs = b0 + k * beat;
      const inner = [];
      events.forEach(e => [e.start, e.end].forEach(t => t > bs && t < bs + beat && inner.push(t - bs)));
      if (inner.every(r => r % 3 === 0)) beatType.push('straight');
      else if (beat === 12 && inner.every(r => r % 2 === 0)) beatType.push('triplet');
      else {
        beatType.push('straight');
        approx = true;
      }
    }

    const pieces = [];
    for (const e of events) {
      let pos = e.start;
      const startPieceIndex = pieces.length;
      while (pos < e.end) {
        const k = Math.floor((pos - b0) / beat);
        const bs = b0 + k * beat;
        let took = false;

        // On a beat: try one long value that also ends on a beat.
        if (pos === bs) {
          for (const v of LONG) {
            if (v < beat || pos + v > e.end || (pos + v - b0) % beat !== 0) continue;
            if (nextChord(pos) < pos + v) continue;
            const beats = v / beat;
            if (beatType.slice(k, k + beats).some(t => t !== 'straight')) continue;
            if (isCompound(s.timeSig) && v === 12) continue;
            pieces.push({ start: pos, dur: v, vf: STRAIGHT[v] });
            pos += v;
            took = true;
            break;
          }
        }
        if (took) continue;

        // Otherwise fill up to the end of this beat (or the next chord change).
        const limit = Math.min(e.end, bs + beat, nextChord(pos));
        const len = limit - pos;
        const triplet = beatType[k] === 'triplet';
        const { values, leftover } = greedy(len, triplet ? TRIPLET : STRAIGHT, beat);
        if (leftover) approx = true;
        let p = pos;
        for (const v of values) {
          pieces.push({ start: p, dur: v, vf: (triplet ? TRIPLET : STRAIGHT)[v], triplet, beat: k });
          p += v;
        }
        pos = limit;
      }

      const mine = pieces.slice(startPieceIndex);
      mine.forEach(p => {
        p.rest = !!e.rest;
        p.dots = p.vf.endsWith('d') ? 1 : 0;
        if (e.notes) {
          const end = p.start + p.dur;
          p.notes = e.notes.map(n => ({
            id: n.id,
            midi: n.midi,
            art: n.art ?? null,
            tied: n.start < p.start, // continues from an earlier piece
            tieToNext: n.start + n.dur > end,
          }));
          // Single-note shorthands.
          p.noteId = p.notes[0].id;
          p.midi = p.notes[0].midi;
          p.tied = p.notes.every(n => n.tied);
          p.tieToNext = p.notes.some(n => n.tieToNext);
        }
      });
    }

    const chords = s.chords.filter(c => c.start >= b0 && c.start < b1);
    bars.push({ index: b, start: b0, end: b1, pieces, chords });
  }
  return { bars, approx };
}

// ---------- Rendering ----------

let pieceEls = [];

// Draws into `el` as SVG, or into `canvas` (for image export) when one is given.
export function renderNotation(el, s, analysis, { loop = true, selectedId = null, canvas = null, width: fixedWidth = null } = {}) {
  const VF = globalThis.VexFlow;
  if (!canvas) {
    el.innerHTML = '';
    pieceEls = [];
  }
  if (!VF) {
    el.textContent = 'Notation library did not load. Check your connection and reload.';
    return { approx: false };
  }

  const { bars, approx } = buildBars(s);
  const strings = s.tuning.length;
  const width = fixedWidth ?? Math.max(300, el.clientWidth || 600);
  const usable = width - 16;

  // Pack bars into lines by how many note values each holds, then share out the spare width.
  const need = bars.map((b, i) => 40 + b.pieces.length * 24 + (i === 0 ? 30 : 0));
  const lines = [];
  let cur = [];
  let curW = 0;
  bars.forEach((b, i) => {
    const w = need[i] + (cur.length ? 0 : 50);
    if (cur.length && curW + w > usable) {
      lines.push(cur);
      cur = [];
      curW = 0;
    }
    cur.push({ bar: b, w: need[i] + (cur.length ? 0 : 50) });
    curW += cur.at(-1).w;
  });
  if (cur.length) lines.push(cur);
  lines.forEach(line => {
    const sum = line.reduce((a, x) => a + x.w, 0);
    // Give every bar room (about 260px), fill the width when that's close, and let a single
    // bar too busy for the screen keep its natural width and scroll sideways.
    const wanted = Math.max(sum, line.length * 260);
    const target = sum > usable ? (line.length === 1 ? sum : usable) : wanted > usable * 0.55 ? usable : wanted;
    const scale = target / sum;
    let x = 8;
    line.forEach(item => {
      item.x = x;
      item.w = Math.floor(item.w * scale);
      x += item.w;
    });
  });
  const canvasW = Math.max(width, ...lines.map(l => l.at(-1).x + l.at(-1).w + 8));

  const tabH = (strings - 1) * 13 + 20;
  const lineH = 170 + tabH;
  const renderer = new VF.Renderer(canvas ?? el, canvas ? VF.Renderer.Backends.CANVAS : VF.Renderer.Backends.SVG);
  renderer.resize(canvasW, lines.length * lineH + 10);
  const ctx = renderer.getContext();
  if (canvas) {
    ctx.save();
    ctx.setFillStyle('#ffffff');
    ctx.fillRect(0, 0, canvasW, lines.length * lineH + 10);
    ctx.restore();
  }
  ctx.setFillStyle(canvas ? '#111111' : 'currentColor');
  ctx.setStrokeStyle(canvas ? '#111111' : 'currentColor');
  const layout = new Map();
  lines.forEach((line, li) => line.forEach((item, ci) => layout.set(item.bar.index, { x: item.x, w: item.w, line: li, col: ci })));

  const ties = [];
  const heads = new Map(); // noteId -> first drawn piece { sn, idx, tn, tidx, line }
  const tails = new Map(); // noteId -> latest drawn piece { sn, idx, line }

  bars.forEach((bar, bi) => {
    const { x, w: barW, line, col } = layout.get(bi);
    const y = 10 + line * lineH;

    const stave = new VF.Stave(x, y + 30, barW);
    const tab = new VF.TabStave(x, y + 115, barW, { numLines: strings });
    if (col === 0) {
      stave.addClef('bass');
      tab.setNoteStartX(stave.getNoteStartX());
    }
    if (bi === 0) stave.addTimeSignature(`${s.timeSig[0]}/${s.timeSig[1]}`);
    if (loop && bi === 0) {
      stave.setBegBarType(VF.Barline.type.REPEAT_BEGIN);
      tab.setBegBarType(VF.Barline.type.REPEAT_BEGIN);
    }
    if (bi === bars.length - 1) {
      const t = loop ? VF.Barline.type.REPEAT_END : VF.Barline.type.END;
      stave.setEndBarType(t);
      tab.setEndBarType(t);
    }
    const startX = Math.max(stave.getNoteStartX(), tab.getNoteStartX());
    stave.setNoteStartX(startX);
    tab.setNoteStartX(startX);

    const staffNotes = [];
    const tabNotes = [];
    const tripletGroups = new Map();

    bar.pieces.forEach(p => {
      const duration = p.vf.replace('d', '');
      let sn;
      let tn;
      if (p.rest) {
        sn = new VF.StaveNote({ keys: ['d/3'], duration: duration + 'r', clef: 'bass', dots: p.dots });
        tn = new VF.GhostNote({ duration, dots: p.dots });
      } else {
        // One key per sounding note, low to high. Bass is written an octave above where it sounds.
        const keys = p.notes.map(n => {
          const [, letter, acc, oct] = midiName(n.midi + 12, analysis.flats).match(/^([A-G])([#b]?)(-?\d+)$/);
          return `${letter.toLowerCase()}${acc}/${oct}${n.art === 'ghost' ? '/x2' : ''}`;
        });
        sn = new VF.StaveNote({ keys, duration, dots: p.dots, clef: 'bass', autoStem: true });
        // Tab shows only the notes struck here; held notes are implied by the staff ties.
        const struck = p.notes
          .map((n, i) => ({ n, i, pos: analysis.notes[n.id] }))
          .filter(x => !x.n.tied && x.pos && x.pos.string != null);
        if (struck.length) {
          tn = new VF.TabNote({
            positions: struck.map(x => ({ str: strings - x.pos.string, fret: x.n.art === 'ghost' ? 'x' : x.pos.fret })),
            duration,
            dots: p.dots,
          });
        } else {
          tn = new VF.GhostNote({ duration, dots: p.dots });
        }
        p.notes.forEach((n, i) => {
          if (n.tied && tails.has(n.id)) {
            const t = tails.get(n.id);
            ties.push({ first: t.sn, firstIdx: t.idx, last: sn, lastIdx: i, sameLine: t.line === line });
          }
          if (!heads.has(n.id)) {
            const tidx = struck.findIndex(x => x.n.id === n.id);
            heads.set(n.id, { sn, idx: i, tn: tidx >= 0 ? tn : null, tidx, line });
          }
          tails.set(n.id, { sn, idx: i, line });
        });
      }
      if (p.dots) VF.Dot.buildAndAttach([sn], { all: true });

      const chord = bar.chords.find(c => c.start === p.start);
      if (chord) {
        const ann = new VF.Annotation(pretty(chord.symbol))
          .setFont('IBM Plex Sans, system-ui, sans-serif', 13, 'bold')
          .setVerticalJustification(VF.AnnotationVerticalJustify?.TOP ?? 1);
        sn.addModifier(ann, 0);
      }

      if (p.triplet) {
        const key = p.beat;
        if (!tripletGroups.has(key)) tripletGroups.set(key, { staff: [], tab: [] });
        tripletGroups.get(key).staff.push(sn);
        tripletGroups.get(key).tab.push(tn);
      }

      staffNotes.push(sn);
      tabNotes.push(tn);
      if (!canvas) pieceEls.push({ start: p.start, end: p.start + p.dur, ids: p.rest ? [] : p.notes.map(n => n.id), sn, tn });
    });

    const tuplets = [];
    tripletGroups.forEach(g => {
      tuplets.push(new VF.Tuplet(g.staff, { numNotes: 3, notesOccupied: 2, bracketed: true }));
      new VF.Tuplet(g.tab, { numNotes: 3, notesOccupied: 2 }); // timing only, not drawn
    });

    const time = { numBeats: s.timeSig[0], beatValue: s.timeSig[1] };
    const v1 = new VF.Voice(time).setMode(VF.Voice.Mode.SOFT).addTickables(staffNotes);
    const v2 = new VF.Voice(time).setMode(VF.Voice.Mode.SOFT).addTickables(tabNotes);
    VF.Accidental.applyAccidentals([v1], 'C');

    const groups = isCompound(s.timeSig) ? [new VF.Fraction(3, 8)] : [new VF.Fraction(1, 4)];
    const beams = VF.Beam.generateBeams(staffNotes, { groups });

    new VF.Formatter().joinVoices([v1]).joinVoices([v2]).format([v1, v2], stave.getNoteEndX() - startX - 12);

    stave.setContext(ctx).draw();
    tab.setContext(ctx).draw();
    if (col === 0) {
      // A small T-A-B label fits any string count (the built-in glyph assumes six strings).
      const top = tab.getYForLine(0);
      const bottom = tab.getYForLine(strings - 1);
      ctx.save();
      ctx.setFont('IBM Plex Sans, system-ui, sans-serif', 11, 'bold');
      ['T', 'A', 'B'].forEach((ch, i) => ctx.fillText(ch, startX - 24, top + 4 + ((bottom - top) * i) / 2));
      ctx.restore();
    }
    v1.draw(ctx, stave);
    v2.draw(ctx, tab);
    beams.forEach(b => b.setContext(ctx).draw());
    tuplets.forEach(t => t.setContext(ctx).draw());
  });

  ties.forEach(t => {
    const parts = t.sameLine
      ? [{ firstNote: t.first, lastNote: t.last, firstIndexes: [t.firstIdx], lastIndexes: [t.lastIdx] }]
      : [
          { firstNote: t.first, firstIndexes: [t.firstIdx], lastIndexes: [t.firstIdx] },
          { lastNote: t.last, firstIndexes: [t.lastIdx], lastIndexes: [t.lastIdx] },
        ];
    parts.forEach(p => new VF.StaveTie(p).setContext(ctx).draw());
  });

  // Slides and hammer-ons / pull-offs connect a note to the one it leads into.
  s.notes.forEach(n => {
    if (n.art !== 'slide' && n.art !== 'hammer') return;
    const next = nextOf(s.notes, n);
    const a = tails.get(n.id);
    const ah = heads.get(n.id);
    const b = next && heads.get(next.id);
    if (!a || !b || a.line !== b.line) return;
    const up = next.midi >= n.midi;
    try {
      const staffIdx = { firstIndexes: [a.idx], lastIndexes: [b.idx] };
      const tabIdx = { firstIndexes: [ah.tidx], lastIndexes: [b.tidx] };
      const tabOk = ah.tn && b.tn && ah.tidx >= 0 && b.tidx >= 0;
      if (n.art === 'slide') {
        new VF.StaveTie({ firstNote: a.sn, lastNote: b.sn, ...staffIdx }, 'sl.').setContext(ctx).draw();
        if (tabOk) {
          new VF.TabSlide({ firstNote: ah.tn, lastNote: b.tn, ...tabIdx }, up ? VF.TabSlide.SLIDE_UP : VF.TabSlide.SLIDE_DOWN).setContext(ctx).draw();
        }
      } else {
        new VF.StaveTie({ firstNote: a.sn, lastNote: b.sn, ...staffIdx }, up ? 'H' : 'P').setContext(ctx).draw();
        if (tabOk) {
          const make = up ? VF.TabTie.createHammeron : VF.TabTie.createPulloff;
          make({ firstNote: ah.tn, lastNote: b.tn, ...tabIdx }).setContext(ctx).draw();
        }
      }
    } catch (err) {
      console.warn('Could not draw articulation', err);
    }
  });

  if (!canvas) {
    pieceEls.forEach(p => {
      p.els = [p.sn, p.tn].map(n => n.getSVGElement?.()).filter(Boolean);
      if (selectedId && p.ids.includes(selectedId)) p.els.forEach(e => e.classList.add('vf-selected'));
    });
  }
  return { approx };
}

let lit = [];
export function highlightNotation(tick) {
  lit.forEach(e => e.classList.remove('vf-playing'));
  lit = [];
  if (tick == null) return;
  const p = pieceEls.find(p => p.ids.length && tick >= p.start && tick < p.end);
  if (p) {
    p.els.forEach(e => e.classList.add('vf-playing'));
    lit = p.els;
  }
}
