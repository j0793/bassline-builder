// Grid ticks -> readable note values -> VexFlow bass clef + tab.
// buildBars() is pure (and tested); renderNotation() draws with the global VexFlow.
import { barTicks, beatTicks, isCompound } from './state.js';
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

    // Note and rest events covering the bar.
    const events = [];
    let cursor = b0;
    for (const n of s.notes) {
      const ns = Math.max(n.start, b0);
      const ne = Math.min(n.start + n.dur, b1);
      if (ne <= ns) continue;
      if (ns > cursor) events.push({ start: cursor, end: ns, rest: true });
      events.push({ start: ns, end: ne, note: n, continued: n.start < b0, continues: n.start + n.dur > b1 });
      cursor = ne;
    }
    if (cursor < b1) events.push({ start: cursor, end: b1, rest: true });

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
      mine.forEach((p, i) => {
        p.rest = !!e.rest;
        p.dots = p.vf.endsWith('d') ? 1 : 0;
        if (e.note) {
          p.noteId = e.note.id;
          p.midi = e.note.midi;
          p.tied = i > 0 || e.continued; // continuation of an earlier piece
          p.tieToNext = i < mine.length - 1 || e.continues;
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

export function renderNotation(el, s, analysis, { loop = true, selectedId = null } = {}) {
  const VF = globalThis.VexFlow;
  el.innerHTML = '';
  pieceEls = [];
  if (!VF) {
    el.textContent = 'Notation library did not load. Check your connection and reload.';
    return { approx: false };
  }

  const { bars, approx } = buildBars(s);
  const strings = s.tuning.length;
  const width = Math.max(300, el.clientWidth || 600);
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
    // A single bar too busy for the screen keeps its natural width and scrolls sideways.
    const scale = sum > usable ? (line.length === 1 ? 1 : usable / sum) : sum > usable * 0.55 ? usable / sum : 1;
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
  const renderer = new VF.Renderer(el, VF.Renderer.Backends.SVG);
  renderer.resize(canvasW, lines.length * lineH + 10);
  const ctx = renderer.getContext();
  ctx.setFillStyle('currentColor');
  ctx.setStrokeStyle('currentColor');
  const layout = new Map();
  lines.forEach((line, li) => line.forEach((item, ci) => layout.set(item.bar.index, { x: item.x, w: item.w, line: li, col: ci })));

  const ties = [];
  let prevLast = null; // last staff note of the previous bar, for ties across bars

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
      let sn;
      let tn;
      if (p.rest) {
        sn = new VF.StaveNote({ keys: ['d/3'], duration: p.vf.replace('d', '') + 'r', clef: 'bass', dots: p.dots });
        tn = new VF.GhostNote({ duration: p.vf.replace('d', ''), dots: p.dots });
      } else {
        const name = midiName(p.midi + 12, analysis.flats); // bass is written an octave up
        const [, letter, acc, oct] = name.match(/^([A-G])([#b]?)(-?\d+)$/);
        sn = new VF.StaveNote({
          keys: [`${letter.toLowerCase()}${acc}/${oct}`],
          duration: p.vf.replace('d', ''),
          dots: p.dots,
          clef: 'bass',
          autoStem: true,
        });
        const pos = analysis.notes[p.noteId];
        if (p.tied || !pos || pos.string == null) {
          tn = new VF.GhostNote({ duration: p.vf.replace('d', ''), dots: p.dots });
          if (!p.tied && (!pos || pos.string == null)) tn = new VF.TabNote({ positions: [{ str: 1, fret: '?' }], duration: p.vf.replace('d', ''), dots: p.dots });
        } else {
          tn = new VF.TabNote({
            positions: [{ str: strings - pos.string, fret: pos.fret }],
            duration: p.vf.replace('d', ''),
            dots: p.dots,
          });
        }
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

      if (!p.rest) {
        if (p.tied && prevLast) ties.push({ first: prevLast.note, last: sn, sameLine: prevLast.line === line });
        prevLast = p.tieToNext ? { note: sn, line } : null;
      } else {
        prevLast = null;
      }

      staffNotes.push(sn);
      tabNotes.push(tn);
      pieceEls.push({ start: p.start, end: p.start + p.dur, noteId: p.noteId, sn, tn });
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
      ? [{ firstNote: t.first, lastNote: t.last }]
      : [{ firstNote: t.first }, { lastNote: t.last }];
    parts.forEach(p =>
      new VF.StaveTie({ ...p, firstIndexes: [0], lastIndexes: [0] }).setContext(ctx).draw()
    );
  });

  pieceEls.forEach(p => {
    p.els = [p.sn, p.tn].map(n => n.getSVGElement?.()).filter(Boolean);
    if (p.noteId && p.noteId === selectedId) p.els.forEach(e => e.classList.add('vf-selected'));
  });
  return { approx };
}

let lit = [];
export function highlightNotation(tick) {
  lit.forEach(e => e.classList.remove('vf-playing'));
  lit = [];
  if (tick == null) return;
  const p = pieceEls.find(p => p.noteId && tick >= p.start && tick < p.end);
  if (p) {
    p.els.forEach(e => e.classList.add('vf-playing'));
    lit = p.els;
  }
}
