import { createStore, demoGroove, blankGroove, barTicks, beatTicks } from './state.js';
import { analyze, midiName, prettyNote, pretty, spanAt } from './theory.js';
import { createGrid } from './grid.js';
import { renderNotation, highlightNotation } from './notation.js';
import { initSettings, initChordSheet } from './controls.js';
import * as audio from './audio.js';
import * as share from './share.js';

const $ = sel => document.querySelector(sel);

const ui = { selected: null, rows: 'all' };
const fromLink = share.fromHash();
const store = createStore(fromLink ?? share.loadCurrent() ?? demoGroove());
if (fromLink) history.replaceState(null, '', location.pathname);
let analysis = analyze(store.get());

// ----- Toast -----
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

// ----- Grid -----
const grid = createGrid($('#grid-scroll'), {
  store,
  ui,
  onSelect(id) {
    ui.selected = id;
    renderAll();
  },
  onChordTap: i => chordSheet.open(i),
  onPreview: midi => audio.ensureAudio().then(() => audio.preview(midi)),
});

const settings = initSettings(store, ui, { toast, rerender: () => renderAll() });
const chordSheet = initChordSheet(store, { toast });

// ----- Learning panel -----
const CAT_TEXT = {
  root: 'root of the chord',
  chord: 'chord tone',
  scale: 'in the key, not in the chord',
  chromatic: 'outside the key',
};

function renderLearn() {
  const s = store.get();
  const a = analysis;
  const n = s.notes.find(x => x.id === ui.selected);
  const bar = barTicks(s);
  const beat = beatTicks(s);
  let html = '';

  if (n) {
    const info = a.notes[n.id];
    const where = `bar ${Math.floor(n.start / bar) + 1}, beat ${(((n.start % bar) / beat) + 1).toFixed(2).replace(/\.?0+$/, '')}`;
    const string = info.string != null ? `${prettyNote(s.tuning[info.string].replace(/\d+$/, ''))} string, ${info.fret === 0 ? 'open' : `fret ${info.fret}`}` : 'out of range for this tuning';
    const role = info.approach
      ? `${info.approach.chromatic ? 'Chromatic' : 'Scale-step'} approach into ${pretty(info.approach.to)}`
      : info.cat === 'root' || info.cat === 'chord'
        ? `${pretty(info.label)} of ${pretty(info.symbol)}, ${CAT_TEXT[info.cat]}`
        : `${pretty(info.label)} over ${pretty(info.symbol)}, ${CAT_TEXT[info.cat]}`;
    html += `
      <div class="now">
        <div class="now-note cat-${info.cat}${info.approach ? ' approach' : ''}">${prettyNote(midiName(n.midi, a.flats))}</div>
        <div>
          <p class="now-role">${role}</p>
          <p class="now-meta">${string} · ${where}</p>
        </div>
        <button type="button" id="delete-note" class="ghost">Delete</button>
      </div>`;
  } else {
    html += `<p class="hint">Tap a cell to add a note. Tap a note to see what it does, tap it again to delete it, drag it to move, drag its right edge to lengthen.</p>`;
  }

  html += `<ul class="spans">${a.summaries
    .map(sm => {
      const bits = [];
      if (!sm.total) bits.push('No notes yet.');
      else {
        bits.push(`${sm.chordTones} of ${sm.total} notes are chord tones`);
        if (sm.scaleTones) bits.push(`${sm.scaleTones} scale tone${sm.scaleTones > 1 ? 's' : ''}`);
        if (sm.chromatic) bits.push(`${sm.chromatic} outside the key`);
        if (sm.approaches) bits.push(`${sm.approaches} approach note${sm.approaches > 1 ? 's' : ''}`);
      }
      const one = sm.total ? (sm.rootOnOne ? 'Root lands on the chord change.' : 'The chord change doesn\'t start on the root. Fine on purpose, worth noticing.') : '';
      const sounds = sm.inferred[0] && sm.inferred[0].symbol !== sm.symbol && sm.inferred[0].score > sm.fit + 1 ? ` These notes fit ${pretty(sm.inferred[0].symbol)} (${sm.inferred[0].roman}) better than ${pretty(sm.symbol)}.` : '';
      const pos = `Bar ${Math.floor(sm.start / bar) + 1}${sm.start % bar ? `, beat ${Math.round((sm.start % bar) / beat) + 1}` : ''}`;
      return `<li><span class="sp-chord">${pretty(sm.symbol)}</span><span class="sp-pos">${pos}</span><p>${bits.join(', ')}${sm.total ? '.' : ''} ${one}${sounds}</p></li>`;
    })
    .join('')}</ul>`;

  $('#learn-body').innerHTML = html;
}

$('#learn-body').addEventListener('click', e => {
  if (e.target.id === 'delete-note' && ui.selected) {
    const id = ui.selected;
    ui.selected = null;
    store.update(s => {
      s.notes = s.notes.filter(x => x.id !== id);
    });
  }
});

// ----- Transport -----
function renderTransport() {
  const s = store.get();
  $('#bpm').value = s.bpm;
  $('#title').value = s.title;
  $('#undo').disabled = !store.canUndo();
  $('#redo').disabled = !store.canRedo();
  $('#loop').setAttribute('aria-pressed', audio.opts.loop);
  $('#metro').setAttribute('aria-pressed', audio.opts.metronome);
  $('#countin').setAttribute('aria-pressed', audio.opts.countIn);
  $('#bass').setAttribute('aria-pressed', audio.opts.bassOn);
}

function setPlaying(on) {
  const b = $('#play');
  b.setAttribute('aria-pressed', on);
  b.querySelector('span').textContent = on ? 'Stop' : 'Play';
  document.body.classList.toggle('playing', on);
}

$('#play').addEventListener('click', async () => {
  if (audio.isPlaying()) return audio.stop();
  const ok = await audio.play(store.get(), () => {
    setPlaying(false);
    grid.setPlayhead(null);
    highlightNotation(null);
  });
  if (!ok) return toast('Sound engine did not load. Check your connection and reload.');
  setPlaying(true);
  requestAnimationFrame(follow);
});

let lastSpan = -1;
function follow() {
  if (!document.body.classList.contains('playing')) return;
  const t = audio.position();
  if (t == null) return requestAnimationFrame(follow);
  grid.setPlayhead(t);
  highlightNotation(t < 0 ? null : t);
  const sp = t < 0 ? null : spanAt(analysis.spans, t);
  if (sp && sp.index !== lastSpan) {
    lastSpan = sp.index;
    renderNowChord(sp);
  }
  requestAnimationFrame(follow);
}

const toggles = { loop: 'loop', metro: 'metronome', countin: 'countIn', bass: 'bassOn' };
Object.entries(toggles).forEach(([id, key]) =>
  $(`#${id}`).addEventListener('click', () => {
    audio.opts[key] = !audio.opts[key];
    renderTransport();
    if (audio.isPlaying()) audio.schedule(store.get());
    if (id === 'loop') drawNotation();
  })
);

const setBpm = v => {
  const bpm = Math.max(40, Math.min(240, Math.round(v) || 100));
  store.update(s => (s.bpm = bpm), { history: false });
  audio.setBpm(bpm);
};
$('#bpm').addEventListener('change', e => setBpm(Number(e.target.value)));
$('#bpm-down').addEventListener('click', () => setBpm(store.get().bpm - 1));
$('#bpm-up').addEventListener('click', () => setBpm(store.get().bpm + 1));

let taps = [];
$('#tap').addEventListener('click', () => {
  const now = performance.now();
  taps = taps.filter(t => now - t < 2500).concat(now);
  if (taps.length >= 3) {
    const gaps = taps.slice(1).map((t, i) => t - taps[i]);
    setBpm(60000 / (gaps.reduce((a, b) => a + b) / gaps.length));
  }
});

$('#undo').addEventListener('click', () => store.undo());
$('#redo').addEventListener('click', () => store.redo());
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? store.redo() : store.undo();
  } else if (e.code === 'Space' && !e.target.closest('input, select, button, textarea')) {
    e.preventDefault();
    $('#play').click();
  }
});

$('#title').addEventListener('change', e => store.update(s => (s.title = e.target.value.trim() || 'Untitled groove'), { history: false }));

// ----- Current chord readout -----
function renderNowChord(sp) {
  const span = sp ?? spanAt(analysis.spans, store.get().notes.find(n => n.id === ui.selected)?.start ?? 0);
  const c = span.chord;
  $('#now-chord').innerHTML = c
    ? `<b>${pretty(span.symbol)}</b><span class="tones-inline">${c.notes.map((n, i) => `<span class="${i === 0 ? 'r' : ''}">${prettyNote(n)}</span>`).join('')}</span><span class="legend"><i class="lg root"></i>root <i class="lg chord"></i>chord tone <i class="lg scale"></i>in key <i class="lg chromatic"></i>outside</span>`
    : `<b>${pretty(span.symbol)}</b> isn't a chord I recognise`;
}

// ----- Library -----
let confirming = null;
function renderLibrary() {
  const lib = share.library();
  $('#library-list').innerHTML = lib.length
    ? lib
        .map(
          x => `<li><button type="button" class="link" data-load="${x.id}">${x.title}</button>
            <span class="meta">${x.groove.bars} bars · ${x.groove.timeSig.join('/')} · ${x.groove.bpm} BPM</span>
            ${confirming === x.id
              ? `<span class="confirm">Delete? <button type="button" data-del-yes="${x.id}">Delete</button><button type="button" data-del-no>Keep</button></span>`
              : `<button type="button" class="ghost small" data-del="${x.id}" aria-label="Delete ${x.title}">Delete</button>`}</li>`
        )
        .join('')
    : '<li class="empty">Saved grooves appear here. They stay in this browser on this device.</li>';
}

$('#library').addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'save') {
    const entry = share.saveToLibrary(store.get());
    if (!entry) return toast('This browser blocked saving. Use the share link instead.');
    store.update(s => (s.libId = entry.id), { history: false });
    toast(`Saved "${entry.title}".`);
  } else if (b.id === 'new') {
    if (audio.isPlaying()) audio.stop();
    ui.selected = null;
    store.replace(blankGroove(store.get()));
    toast('New groove. Undo brings the last one back.');
  } else if (b.id === 'demo') {
    ui.selected = null;
    store.replace(demoGroove());
  } else if (b.id === 'copy-link') {
    const link = share.shareLink(store.get());
    $('#share-out').value = link;
    $('#share-out').hidden = false;
    try {
      await navigator.clipboard.writeText(link);
      toast('Share link copied.');
    } catch {
      $('#share-out').select();
      toast('Link selected below. Copy it from there.');
    }
  } else if (b.dataset.load) {
    const entry = share.library().find(x => x.id === b.dataset.load);
    if (!entry) return;
    ui.selected = null;
    store.replace(entry.groove);
    grid.scrollToContent(store.get(), analysis);
    toast(`Loaded "${entry.title}".`);
  } else if (b.dataset.del) {
    confirming = b.dataset.del;
  } else if (b.dataset.delYes) {
    share.deleteFromLibrary(b.dataset.delYes);
    confirming = null;
  } else if ('delNo' in b.dataset) {
    confirming = null;
  }
  renderLibrary();
});

// ----- Notation -----
let notationTimer;
function drawNotation() {
  clearTimeout(notationTimer);
  notationTimer = setTimeout(() => {
    try {
      const { approx } = renderNotation($('#notation'), store.get(), analysis, { loop: audio.opts.loop, selectedId: ui.selected });
      $('#notation-note').hidden = !approx;
    } catch (err) {
      console.error(err);
      $('#notation').textContent = 'Could not draw this line as notation. The grid and audio still work.';
    }
  }, 60);
}

// ----- Render loop -----
function renderAll({ notation = true } = {}) {
  const s = store.get();
  if (ui.selected && !s.notes.some(n => n.id === ui.selected)) ui.selected = null;
  grid.render(s, analysis);
  settings.render();
  renderTransport();
  renderLearn();
  renderNowChord();
  chordSheet.refresh();
  if (notation) drawNotation();
}

let saveTimer;
store.subscribe(s => {
  analysis = analyze(s);
  renderAll();
  if (audio.isPlaying()) audio.schedule(s);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => share.saveCurrent(s), 400);
});

let lastWidth = 0;
new ResizeObserver(([e]) => {
  const w = Math.round(e.contentRect.width);
  if (Math.abs(w - lastWidth) > 30) {
    lastWidth = w;
    drawNotation();
  }
}).observe($('#notation'));

renderAll();
renderLibrary();
grid.scrollToContent(store.get(), analysis);
if (fromLink) toast(`Opened shared groove "${store.get().title}".`);
