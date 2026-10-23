// Piano-roll editor: rows are pitches (high at the top), columns are grid steps.
import { barTicks, beatTicks, totalTicks, uid, claim } from './state.js';
import { midiName, prettyNote, pretty } from './theory.js';

export const ROW_H = 28;
const COL_W = { 12: 56, 6: 40, 4: 32, 3: 30, 2: 22 };
const FRETS_ABOVE_TOP = 12;

export function createGrid(root, { store, ui, onSelect, onChordTap, onPreview }) {
  root.innerHTML = `
    <div class="grid">
      <div class="g-corner"><span>Chord</span><span>Beat</span></div>
      <div class="g-lane" role="list" aria-label="Chords"></div>
      <div class="g-ruler" aria-hidden="true"></div>
      <div class="g-keys" aria-hidden="true"></div>
      <div class="g-field" tabindex="0" aria-label="Note grid. Tap a cell to add a note."></div>
    </div>`;
  const grid = root.querySelector('.grid');
  const lane = root.querySelector('.g-lane');
  const ruler = root.querySelector('.g-ruler');
  const keys = root.querySelector('.g-keys');
  const field = root.querySelector('.g-field');
  const playhead = document.createElement('div');
  playhead.className = 'playhead';
  playhead.hidden = true;

  let geom = null; // { rows, rowOf, ppt, q, total }
  let drag = null;
  let tap = null;

  function rowsFor(s, a) {
    const opens = a.opens;
    const lo = Math.min(...opens);
    const hi = Math.max(...opens) + FRETS_ABOVE_TOP;
    const used = new Set(s.notes.map(n => n.midi));
    const rows = [];
    for (let m = hi; m >= lo; m--) {
      if (ui.rows === 'key' && !a.key.scalePcs.includes(m % 12) && !used.has(m)) continue;
      rows.push(m);
    }
    s.notes.forEach(n => (n.midi < lo || n.midi > hi) && !rows.includes(n.midi) && rows.push(n.midi));
    return rows.sort((x, y) => y - x);
  }

  function render(s, a) {
    const q = s.quantize;
    const colW = COL_W[q] ?? 30;
    const ppt = colW / q;
    const total = totalTicks(s);
    const bar = barTicks(s);
    const beat = beatTicks(s);
    const rows = rowsFor(s, a);
    const rowOf = new Map(rows.map((m, i) => [m, i]));
    const opens = new Set(a.opens);
    geom = { rows, rowOf, ppt, q, total };

    const W = total * ppt;
    const H = rows.length * ROW_H;
    grid.style.setProperty('--field-w', `${W}px`);
    grid.style.setProperty('--field-h', `${H}px`);
    field.style.setProperty('--step', `${q * ppt}px`);
    field.style.setProperty('--beat', `${beat * ppt}px`);
    field.style.setProperty('--bar', `${bar * ppt}px`);

    // Chord lane
    lane.innerHTML = a.spans
      .map(sp => {
        const tones = sp.chord ? sp.chord.notes.map(prettyNote).join(' ') : 'unknown chord';
        return `<button class="chip" role="listitem" data-index="${sp.index}"
          style="left:${sp.start * ppt}px;width:${(sp.end - sp.start) * ppt - 4}px"
          aria-label="Chord ${pretty(sp.symbol)}, tones ${tones}. Tap to change.">
          <b>${pretty(sp.symbol)}</b><span>${tones}</span></button>`;
      })
      .join('');

    // Ruler: bar numbers and beats
    let r = '';
    for (let t = 0; t < total; t += beat) {
      const isBar = t % bar === 0;
      const n = Math.round((t % bar) / beat) + 1;
      r += `<span class="${isBar ? 'bar' : ''}" style="left:${t * ppt}px">${isBar ? `<i>${t / bar + 1}</i>` : n}</span>`;
    }
    ruler.innerHTML = r;

    // Pitch labels
    keys.innerHTML = rows
      .map(m => {
        const inKey = a.key.scalePcs.includes(m % 12);
        const open = opens.has(m);
        return `<div class="${inKey ? 'in' : 'out'}${open ? ' open' : ''}" title="${open ? 'Open string' : ''}">
          ${prettyNote(midiName(m, a.flats))}${open ? '<small>open</small>' : ''}</div>`;
      })
      .join('');

    // Field: row bands, chord-tone tints, notes
    let f = '';
    rows.forEach((m, i) => {
      if (!a.key.scalePcs.includes(m % 12)) f += `<div class="band" style="top:${i * ROW_H}px"></div>`;
    });
    a.spans.forEach(sp => {
      if (!sp.chord) return;
      rows.forEach((m, i) => {
        const pc = m % 12;
        if (!sp.chord.pcs.includes(pc)) return;
        const cls = pc === sp.chord.root ? 'tint root' : 'tint';
        f += `<div class="${cls}" style="top:${i * ROW_H}px;left:${sp.start * ppt}px;width:${(sp.end - sp.start) * ppt}px"></div>`;
      });
    });
    let links = '';
    s.notes.forEach((n, i) => {
      const info = a.notes[n.id] ?? {};
      const sel = n.id === ui.selected ? ' selected' : '';
      const appr = info.approach ? ' approach' : '';
      const art = n.art ? ` art-${n.art}` : '';
      const label = n.art === 'ghost' ? '×' : info.approach ? '→' : info.label;
      const next = s.notes[i + 1];
      if ((n.art === 'slide' || n.art === 'hammer') && next) {
        const x1 = (n.start + n.dur) * ppt - 2;
        const y1 = rowOf.get(n.midi) * ROW_H + ROW_H / 2;
        const x2 = next.start * ppt + 2;
        const y2 = rowOf.get(next.midi) * ROW_H + ROW_H / 2;
        if (n.art === 'slide') {
          links += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="lk-slide"/>`;
        } else {
          const lift = Math.min(y1, y2) - 14;
          links += `<path d="M${x1 - 6} ${y1 - 8} Q ${(x1 + x2) / 2} ${lift} ${x2 + 6} ${y2 - 8}" class="lk-hammer"/>`;
          links += `<text x="${(x1 + x2) / 2}" y="${lift + 3}" class="lk-label">${next.midi >= n.midi ? 'H' : 'P'}</text>`;
        }
      }
      f += `<div class="note cat-${info.cat}${appr}${art}${sel}" data-id="${n.id}"
        style="left:${n.start * ppt + 1}px;top:${rowOf.get(n.midi) * ROW_H + 2}px;width:${Math.max(6, n.dur * ppt - 2)}px"
        aria-label="${prettyNote(midiName(n.midi, a.flats))}, ${info.label ?? ''}">
        <span>${label ?? ''}</span>${sel ? '<i class="handle" aria-hidden="true"></i>' : ''}</div>`;
    });
    f += `<svg class="links" width="${W}" height="${H}" aria-hidden="true">${links}</svg>`;
    field.innerHTML = f;
    field.appendChild(playhead);
  }

  // ----- Pointer input -----
  const local = e => {
    const r = field.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const tickAt = x => Math.max(0, Math.min(geom.total - geom.q, Math.floor(x / geom.ppt / geom.q) * geom.q));
  const rowAt = y => Math.max(0, Math.min(geom.rows.length - 1, Math.floor(y / ROW_H)));

  field.addEventListener('pointerdown', e => {
    if (!geom || e.button > 0) return;
    const p = local(e);
    const el = e.target.closest('.note');
    if (el) {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const n = store.get().notes.find(x => x.id === el.dataset.id);
      const right = (n.start + n.dur) * geom.ppt;
      const onHandle = e.target.classList.contains('handle') || (ui.selected === n.id && right - p.x < 14);
      drag = { el, n, p0: p, mode: onHandle ? 'resize' : 'press', wasSelected: ui.selected === n.id, preview: null };
      return;
    }
    tap = { p0: p, id: e.pointerId };
  });

  field.addEventListener('pointermove', e => {
    if (tap && e.pointerId === tap.id) {
      const p = local(e);
      if (Math.hypot(p.x - tap.p0.x, p.y - tap.p0.y) > 8) tap = null; // it's a scroll
    }
    if (!drag) return;
    const p = local(e);
    const dx = p.x - drag.p0.x;
    const dy = p.y - drag.p0.y;
    const { n, el } = drag;
    if (drag.mode === 'press' && Math.hypot(dx, dy) > 6) drag.mode = 'move';
    if (drag.mode === 'move') {
      const start = Math.max(0, Math.min(geom.total - geom.q, n.start + Math.round(dx / geom.ppt / geom.q) * geom.q));
      const row = Math.max(0, Math.min(geom.rows.length - 1, geom.rowOf.get(n.midi) + Math.round(dy / ROW_H)));
      const midi = geom.rows[row];
      el.style.left = `${start * geom.ppt + 1}px`;
      el.style.top = `${row * ROW_H + 2}px`;
      if (drag.preview?.midi !== midi) onPreview(midi);
      drag.preview = { start, midi };
    } else if (drag.mode === 'resize') {
      const end = Math.max(n.start + geom.q, Math.min(geom.total, n.start + n.dur + Math.round(dx / geom.ppt / geom.q) * geom.q));
      el.style.width = `${(end - n.start) * geom.ppt - 2}px`;
      drag.preview = { dur: end - n.start };
    }
  });

  const finish = e => {
    if (drag) {
      const { n, mode, preview, wasSelected } = drag;
      drag = null;
      if (mode === 'move' && preview) {
        store.update(s => {
          const x = s.notes.find(x => x.id === n.id);
          x.start = preview.start;
          if (x.midi !== preview.midi) x.string = null;
          x.midi = preview.midi;
          claim(s, n.id);
        });
        onSelect(n.id);
      } else if (mode === 'resize' && preview) {
        store.update(s => {
          s.notes.find(x => x.id === n.id).dur = preview.dur;
          claim(s, n.id);
        });
        onSelect(n.id);
      } else if (mode === 'press') {
        if (wasSelected) {
          store.update(s => {
            s.notes = s.notes.filter(x => x.id !== n.id);
          });
          onSelect(null);
        } else {
          onSelect(n.id);
          onPreview(n.midi);
        }
      }
      return;
    }
    if (tap && e.type === 'pointerup') {
      const p = local(e);
      const start = tickAt(p.x);
      const midi = geom.rows[rowAt(p.y)];
      const id = uid();
      store.update(s => {
        s.notes.push({ id, start, dur: s.quantize, midi, string: null, art: null });
        claim(s, id);
      });
      onSelect(id);
      onPreview(midi);
    }
    tap = null;
  };
  field.addEventListener('pointerup', finish);
  field.addEventListener('pointercancel', e => {
    tap = null;
    if (drag) {
      drag = null;
      onSelect(ui.selected); // re-render to undo the live preview
    }
  });

  // Keyboard: arrows move the selected note, Delete removes it.
  document.addEventListener('keydown', e => {
    if (e.target.closest('input, select, textarea') || !document.querySelector('#chord-sheet').hidden) return;
    const id = ui.selected;
    if (!id || !geom) return;
    const s = store.get();
    const n = s.notes.find(x => x.id === id);
    if (!n) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      store.update(t => {
        t.notes = t.notes.filter(x => x.id !== id);
      });
      onSelect(null);
      return;
    }
    const moves = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-s.quantize, 0],
      ArrowRight: [s.quantize, 0],
    };
    const mv = moves[e.key];
    if (!mv) return;
    e.preventDefault();
    const row = Math.max(0, Math.min(geom.rows.length - 1, geom.rowOf.get(n.midi) + mv[1]));
    const midi = geom.rows[row];
    const start = Math.max(0, Math.min(geom.total - s.quantize, n.start + mv[0]));
    store.update(t => {
      const x = t.notes.find(x => x.id === id);
      if (x.midi !== midi) x.string = null;
      Object.assign(x, { start, midi });
      claim(t, id);
    });
    if (mv[1]) onPreview(midi);
  });

  lane.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (chip) onChordTap(Number(chip.dataset.index));
  });

  function setPlayhead(tick) {
    if (tick == null || !geom || tick < 0) {
      playhead.hidden = true;
      return;
    }
    playhead.hidden = false;
    playhead.style.transform = `translateX(${tick * geom.ppt}px)`;
  }

  // Bring the notes (or the root of the first chord) into view vertically.
  function scrollToContent(s, a) {
    if (!geom) return;
    const scroller = root;
    const targets = s.notes.length ? s.notes.map(n => geom.rowOf.get(n.midi)) : [geom.rowOf.get(a.opens[0] + ((a.spans[0]?.chord?.root ?? 0) - (a.opens[0] % 12) + 12) % 12)];
    const mid = ((Math.min(...targets) + Math.max(...targets)) / 2) * ROW_H;
    scroller.scrollTop = Math.max(0, mid - scroller.clientHeight / 2 + 60);
  }

  return { render, setPlayhead, scrollToContent };
}
