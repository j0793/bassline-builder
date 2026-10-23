// Settings strip, tuning editor and the chord picker sheet.
import { GRID_VALUES, TRIPLET_OF, STRAIGHT_OF, isTriplet, TUNINGS, MAX_BARS, changeTimeSig, setBars, beatTicks, barTicks } from './state.js';
import { KEY_TONICS, FLATS, SHARPS, midiName, noteMidi, chroma, keyInfo, intervalLabel, pretty, prettyNote, guessKey, inferChord, suggestNext, chordInfo } from './theory.js';

const $ = (sel, root = document) => root.querySelector(sel);
const opt = (value, label, selected) =>
  `<option value="${value}"${selected ? ' selected' : ''}>${label}</option>`;

const QUALITIES = [
  ['', 'maj'], ['m', 'm'], ['7', '7'], ['maj7', 'maj7'], ['m7', 'm7'], ['m7b5', 'm7♭5'],
  ['dim', 'dim'], ['sus4', 'sus4'], ['6', '6'], ['m6', 'm6'], ['9', '9'], ['m9', 'm9'], ['5', '5 (power)'],
];
const STRING_RANGE = Array.from({ length: 40 }, (_, i) => 21 + i); // A0 .. C4

export function initSettings(store, ui, { toast, rerender }) {
  const el = $('#settings');

  function render() {
    const s = store.get();
    const { flats } = keyInfo(s.key);
    el.innerHTML = `
      <div class="field-group">
        <label for="key-tonic">Key</label>
        <div class="row">
          <select id="key-tonic">${KEY_TONICS.map(t => opt(t, prettyNote(t), t === s.key.tonic)).join('')}</select>
          <select id="key-mode" aria-label="Mode">${opt('major', 'major', s.key.mode === 'major')}${opt('minor', 'minor', s.key.mode === 'minor')}</select>
          <button id="key-guess" class="ghost" type="button">Guess</button>
        </div>
      </div>
      <div class="field-group">
        <label for="ts-num">Time</label>
        <div class="row">
          <select id="ts-num">${Array.from({ length: 11 }, (_, i) => i + 2).map(n => opt(n, n, n === s.timeSig[0])).join('')}</select>
          <span class="slash">/</span>
          <select id="ts-den" aria-label="Beat unit">${[2, 4, 8].map(d => opt(d, d, d === s.timeSig[1])).join('')}</select>
        </div>
      </div>
      <div class="field-group">
        <span class="label" id="grid-label">Grid</span>
        <div class="row" role="group" aria-labelledby="grid-label">
          <div class="seg">
            ${GRID_VALUES.map(g => `<button type="button" data-grid="${g.ticks}" aria-pressed="${(STRAIGHT_OF[s.quantize] ?? s.quantize) === g.ticks}">${g.label}</button>`).join('')}
          </div>
          <button type="button" id="triplet" class="toggle" aria-pressed="${isTriplet(s.quantize)}" title="Split each beat into three">Triplet</button>
        </div>
      </div>
      <div class="field-group">
        <span class="label" id="bars-label">Bars</span>
        <div class="stepper" role="group" aria-labelledby="bars-label">
          <button id="bars-minus" type="button" aria-label="Remove a bar" ${s.bars <= 1 ? 'disabled' : ''}>−</button>
          <output id="bars-out">${s.bars}</output>
          <button id="bars-plus" type="button" aria-label="Add a bar" ${s.bars >= MAX_BARS ? 'disabled' : ''}>+</button>
        </div>
      </div>
      <div class="field-group">
        <span class="label" id="rows-label">Rows</span>
        <div class="seg" role="group" aria-labelledby="rows-label">
          <button type="button" data-rows="all" aria-pressed="${ui.rows === 'all'}">All notes</button>
          <button type="button" data-rows="key" aria-pressed="${ui.rows === 'key'}">In key</button>
        </div>
      </div>
      <div class="field-group wide">
        <span class="label" id="strings-label">Strings, low to high</span>
        <div class="row wrap">
          <div class="seg" role="group" aria-labelledby="strings-label">
            ${[4, 5, 6].map(n => `<button type="button" data-strings="${n}" aria-pressed="${s.tuning.length === n}">${n}</button>`).join('')}
          </div>
          <div class="tuning">
            ${s.tuning.map((name, i) => `<select id="tune-${i}" data-string="${i}" aria-label="String ${s.tuning.length - i} open note">${STRING_RANGE.map(m => opt(m, prettyNote(midiName(m, flats)), m === noteMidi(name))).join('')}</select>`).join('')}
          </div>
        </div>
      </div>`;
  }

  el.addEventListener('change', e => {
    const t = e.target;
    const s = store.get();
    if (t.id === 'key-tonic' || t.id === 'key-mode') {
      store.update(x => {
        x.key = { tonic: $('#key-tonic').value, mode: $('#key-mode').value };
      });
    } else if (t.id === 'ts-num' || t.id === 'ts-den') {
      const ts = [Number($('#ts-num').value), Number($('#ts-den').value)];
      const before = s.notes.length;
      store.update(x => {
        changeTimeSig(x, ts);
        if (ts[1] === 8 && x.quantize === 12) x.quantize = 6;
      });
      const lost = before - store.get().notes.length;
      if (lost > 0) toast(`${lost} note${lost > 1 ? 's' : ''} fell outside the shorter bar. Undo to get ${lost > 1 ? 'them' : 'it'} back.`);
    } else if (t.dataset.string != null) {
      const i = Number(t.dataset.string);
      store.update(x => {
        x.tuning[i] = midiName(Number(t.value), keyInfo(x.key).flats);
        x.notes.forEach(n => (n.string = n.string === i ? null : n.string));
      });
    }
  });

  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const s = store.get();
    if (b.id === 'bars-plus' || b.id === 'bars-minus') {
      const next = s.bars + (b.id === 'bars-plus' ? 1 : -1);
      const lastBarStart = (s.bars - 1) * barTicks(s);
      const losing = b.id === 'bars-minus' ? s.notes.filter(n => n.start >= lastBarStart).length : 0;
      store.update(x => setBars(x, next));
      if (losing) toast(`Removed bar ${s.bars} and its ${losing} note${losing > 1 ? 's' : ''}. Undo to restore.`);
    } else if (b.dataset.grid) {
      const base = Number(b.dataset.grid);
      store.update(x => {
        x.quantize = isTriplet(x.quantize) ? TRIPLET_OF[base] : base;
      });
    } else if (b.id === 'triplet') {
      store.update(x => {
        x.quantize = isTriplet(x.quantize) ? STRAIGHT_OF[x.quantize] : TRIPLET_OF[x.quantize];
      });
    } else if (b.dataset.rows) {
      ui.rows = b.dataset.rows;
      rerender();
    } else if (b.dataset.strings) {
      const n = Number(b.dataset.strings);
      store.update(x => {
        x.tuning = [...TUNINGS[n]];
        x.notes.forEach(note => (note.string = null));
      });
    } else if (b.id === 'key-guess') {
      const g = guessKey(s.notes);
      if (!g) return toast('Add a few notes first, then guess the key.');
      store.update(x => {
        x.key = g;
      });
      toast(`Your notes fit ${prettyNote(g.tonic)} ${g.mode} best.`);
    }
  });

  return { render };
}

// ----- Chord picker -----
export function initChordSheet(store, { toast }) {
  const sheet = $('#chord-sheet');
  const body = $('#chord-sheet .sheet-body');
  let index = null;
  let root = 'C';
  let quality = '';

  function parse(symbol) {
    const m = symbol.match(/^([A-G][#b]?)(.*)$/);
    return m ? [m[1], m[2]] : ['C', ''];
  }

  function open(i) {
    index = i;
    [root, quality] = parse(store.get().chords[i].symbol);
    draw();
    sheet.hidden = false;
    $('#chord-close').focus();
  }

  function close() {
    sheet.hidden = true;
    index = null;
  }

  function apply(symbol) {
    if (!chordInfo(symbol)) return toast(`${symbol} isn't a chord I recognise.`);
    store.update(s => {
      s.chords[index].symbol = symbol;
    });
    [root, quality] = parse(symbol);
    draw();
  }

  function draw() {
    const s = store.get();
    if (index == null || !s.chords[index]) return close();
    const c = s.chords[index];
    const end = s.chords[index + 1]?.start ?? s.bars * barTicks(s);
    const bar = barTicks(s);
    const beat = beatTicks(s);
    const where = `Bar ${Math.floor(c.start / bar) + 1}, beat ${Math.round((c.start % bar) / beat) + 1}`;
    const roots = keyInfo(s.key).flats ? FLATS : SHARPS;
    const info = chordInfo(c.symbol);
    const inferred = inferChord(s.notes, { start: c.start, end }, s.key, beat);
    const prev = index > 0 ? s.chords[index - 1].symbol : null;
    const next = prev ? suggestNext(prev, s.key) : [];
    const span = end - c.start;
    const half = Math.round(span / 2 / beat) * beat;

    $('#chord-title').textContent = `${pretty(c.symbol)} · ${where}`;
    body.innerHTML = `
      <p class="tones">${info ? info.notes.map((n, i) => `<span class="${i === 0 ? 'r' : ''}">${prettyNote(n)}<small>${pretty(intervalLabel(info.intervals[i]))}</small></span>`).join('') : ''}</p>
      <h4>Root</h4>
      <div class="pick roots">${roots.map(r => `<button type="button" data-root="${r}" aria-pressed="${chroma(r) === chroma(root)}">${prettyNote(r)}</button>`).join('')}</div>
      <h4>Quality</h4>
      <div class="pick">${QUALITIES.map(([q, l]) => `<button type="button" data-quality="${q}" aria-pressed="${q === quality}">${l}</button>`).join('')}</div>
      ${inferred.length ? `<h4>Your notes here sound like</h4><div class="pick sug">${inferred.map(d => `<button type="button" data-symbol="${d.symbol}"><b>${pretty(d.symbol)}</b><small>${d.roman}</small></button>`).join('')}</div>` : ''}
      ${next.length ? `<h4>Common moves after ${pretty(prev)}</h4><div class="pick sug">${next.map(d => `<button type="button" data-symbol="${d.symbol}"><b>${pretty(d.symbol)}</b><small>${d.roman}</small></button>`).join('')}</div>` : ''}
      <div class="sheet-actions">
        ${half >= beat && half < span ? `<button type="button" id="chord-split" class="ghost">Split at beat ${Math.round(((c.start + half) % bar) / beat) + 1}</button>` : ''}
        ${index > 0 ? `<button type="button" id="chord-merge" class="ghost">Remove this change</button>` : ''}
      </div>`;
    body.dataset.half = half;
  }

  sheet.addEventListener('click', e => {
    if (e.target === sheet) return close();
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'chord-close') return close();
    if (b.dataset.root) apply(b.dataset.root + quality);
    else if (b.dataset.quality != null) apply(root + b.dataset.quality);
    else if (b.dataset.symbol) apply(b.dataset.symbol);
    else if (b.id === 'chord-split') {
      const at = store.get().chords[index].start + Number(body.dataset.half);
      const symbol = store.get().chords[index].symbol;
      store.update(s => {
        s.chords.push({ start: at, symbol });
      });
      index = store.get().chords.findIndex(c => c.start === at);
      draw();
      toast('Split. Pick a chord for the second half.');
    } else if (b.id === 'chord-merge') {
      store.update(s => {
        s.chords.splice(index, 1);
      });
      close();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !sheet.hidden) close();
  });

  return { open, refresh: () => !sheet.hidden && draw() };
}
