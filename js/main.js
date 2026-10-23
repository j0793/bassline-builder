import { createStore, demoGroove, blankGroove, barTicks, beatTicks } from './state.js';
import { analyze, midiName, prettyNote, pretty, spanAt } from './theory.js';
import { createGrid } from './grid.js';
import { renderNotation, highlightNotation } from './notation.js';
import { initSettings, initChordSheet } from './controls.js';
import { GENRES, TEMPLATES, presets, buildPreset, applyTemplate, genreName } from './genres.js';
import * as audio from './audio.js';
import * as share from './share.js';

const $ = sel => document.querySelector(sel);
const esc = str => String(str).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const prefs = share.loadPrefs();
['loop', 'metronome', 'countIn', 'bassOn', 'bassVol', 'clickVol'].forEach(k => {
  if (prefs[k] != null) audio.opts[k] = prefs[k];
});
const savePrefs = () => {
  const { loop, metronome, countIn, bassOn, bassVol, clickVol } = audio.opts;
  share.savePrefs({ loop, metronome, countIn, bassOn, bassVol, clickVol, activePad: ui.activePad });
};

const ui = {
  selected: null,
  rows: 'all',
  activePad: prefs.activePad ?? null, // which pad the groove in the editor came from
  dirty: false, // edited since it was loaded or saved
  queuedPad: null,
  tab: 'bank',
  genre: 'all',
  confirmClear: false,
};

const fromLink = share.fromHash();
const store = createStore(fromLink ?? share.loadCurrent() ?? demoGroove());
if (fromLink) {
  history.replaceState(null, '', location.pathname);
  ui.activePad = null;
}
let analysis = analyze(store.get());

// ----- Toast -----
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3400);
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

const ART_HELP = {
  ghost: 'Ghost note: mute the string with your fretting hand and pluck. You hear the rhythm, not a pitch.',
  slide: dir => `Slide ${dir}: pluck once, then slide the same finger to the next note without plucking again.`,
  hammer: up =>
    up
      ? 'Hammer-on: pluck, then hammer a higher finger down onto the next note. Only the first note is plucked.'
      : 'Pull-off: fret both notes, pluck, then pull the higher finger off to sound the lower note.',
};

function setArt(id, art) {
  const s = store.get();
  const i = s.notes.findIndex(x => x.id === id);
  if (i < 0) return;
  if ((art === 'slide' || art === 'hammer') && !s.notes[i + 1]) {
    return toast('Slides and hammer-ons connect to the next note. Add a note after this one first.');
  }
  store.update(t => {
    const x = t.notes.find(x => x.id === id);
    x.art = x.art === art ? null : art;
  });
  const n = store.get().notes.find(x => x.id === id);
  audio.ensureAudio().then(() => audio.preview(n.midi, n.art));
}

function renderLearn() {
  const s = store.get();
  const a = analysis;
  const i = s.notes.findIndex(x => x.id === ui.selected);
  const n = s.notes[i];
  const bar = barTicks(s);
  const beat = beatTicks(s);
  let html = '';

  if (n) {
    const info = a.notes[n.id];
    const next = s.notes[i + 1];
    const where = `bar ${Math.floor(n.start / bar) + 1}, beat ${(((n.start % bar) / beat) + 1).toFixed(2).replace(/\.?0+$/, '')}`;
    const string = info.string != null ? `${prettyNote(s.tuning[info.string].replace(/-?\d+$/, ''))} string, ${info.fret === 0 ? 'open' : `fret ${info.fret}`}` : 'out of range for this tuning';
    const role = info.approach
      ? `${info.approach.chromatic ? 'Chromatic' : 'Scale-step'} approach into ${pretty(info.approach.to)}`
      : info.cat === 'root' || info.cat === 'chord'
        ? `${pretty(info.label)} of ${pretty(info.symbol)}, ${CAT_TEXT[info.cat]}`
        : `${pretty(info.label)} over ${pretty(info.symbol)}, ${CAT_TEXT[info.cat]}`;
    const up = next ? next.midi >= n.midi : true;
    const help =
      n.art === 'ghost' ? ART_HELP.ghost
      : n.art === 'slide' ? ART_HELP.slide(next ? `${up ? 'up' : 'down'} to ${prettyNote(midiName(next.midi, a.flats))}` : 'into the next note')
      : n.art === 'hammer' ? ART_HELP.hammer(up)
      : '';
    const artBtn = (art, label, key, disabled = false) =>
      `<button type="button" data-art="${art}" aria-pressed="${(n.art ?? 'none') === art}" ${disabled ? 'disabled' : ''} title="Shortcut: ${key}">${label}<kbd>${key}</kbd></button>`;
    html += `
      <div class="now">
        <div class="now-note cat-${info.cat}${info.approach ? ' approach' : ''}${n.art === 'ghost' ? ' ghosted' : ''}">${n.art === 'ghost' ? '×' : prettyNote(midiName(n.midi, a.flats))}</div>
        <div class="now-text">
          <p class="now-role">${role}</p>
          <p class="now-meta">${string} · ${where}</p>
        </div>
        <button type="button" id="delete-note" class="ghost" title="Shortcut: Delete">Delete</button>
      </div>
      <div class="art-row">
        <span class="label">Technique</span>
        <div class="seg art-seg" role="group" aria-label="Technique">
          ${artBtn('none', 'Normal', 'N')}
          ${artBtn('ghost', 'Ghost ×', 'G')}
          ${artBtn('slide', 'Slide', 'S', !next)}
          ${artBtn('hammer', up ? 'Hammer-on' : 'Pull-off', 'H', !next)}
        </div>
      </div>
      ${help ? `<p class="art-help">${help}</p>` : ''}`;
  } else {
    html += `<p class="hint">Tap a cell to add a note. Tap a note to see what it does and choose a technique, tap it again to delete it, drag it to move, drag its right edge to lengthen.</p>
      <p class="hint keys">Keys: <kbd>Space</kbd> play · <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> move note · <kbd>Del</kbd> delete · <kbd>G</kbd> ghost · <kbd>S</kbd> slide · <kbd>H</kbd> hammer · <kbd>1</kbd>–<kbd>9</kbd> pads · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo</p>`;
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
  const b = e.target.closest('button');
  if (!b || !ui.selected) return;
  if (b.id === 'delete-note') {
    const id = ui.selected;
    ui.selected = null;
    store.update(s => {
      s.notes = s.notes.filter(x => x.id !== id);
    });
  } else if (b.dataset.art) {
    if (b.dataset.art === 'none') {
      store.update(s => {
        s.notes.find(x => x.id === ui.selected).art = null;
      });
    } else setArt(ui.selected, b.dataset.art);
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
  $('#vol-bass').value = audio.opts.bassVol;
  $('#vol-click').value = audio.opts.clickVol;
  $('#vol-bass-out').textContent = audio.opts.bassVol;
  $('#vol-click-out').textContent = audio.opts.clickVol;
}

function setPlaying(on) {
  const b = $('#play');
  b.setAttribute('aria-pressed', on);
  b.querySelector('span').textContent = on ? 'Stop' : 'Play';
  document.body.classList.toggle('playing', on);
  renderPads();
}

async function startPlayback() {
  const ok = await audio.play(store.get(), () => {
    setPlaying(false);
    grid.setPlayhead(null);
    highlightNotation(null);
    ui.queuedPad = null;
    renderPads();
  });
  if (!ok) return toast('Sound engine did not load. Check your connection and reload.');
  setPlaying(true);
  requestAnimationFrame(follow);
}

$('#play').addEventListener('click', () => (audio.isPlaying() ? audio.stop() : startPlayback()));

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
    savePrefs();
    renderTransport();
    if (audio.isPlaying()) audio.schedule(store.get());
    if (id === 'loop') drawNotation();
  })
);

[['vol-bass', 'bassVol'], ['vol-click', 'clickVol']].forEach(([id, key]) => {
  $(`#${id}`).addEventListener('input', e => {
    audio.opts[key] = Number(e.target.value);
    $(`#${id}-out`).textContent = audio.opts[key];
    audio.applyVolumes();
  });
  $(`#${id}`).addEventListener('change', savePrefs);
});

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
$('#title').addEventListener('change', e => store.update(s => (s.title = e.target.value.trim() || 'Untitled groove'), { history: false }));

// Desktop keyboard shortcuts. Touch users get the same actions as buttons.
document.addEventListener('keydown', e => {
  if (e.target.closest('input, select, textarea') || !$('#chord-sheet').hidden) return;
  const k = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && k === 'z') {
    e.preventDefault();
    e.shiftKey ? store.redo() : store.undo();
  } else if ((e.metaKey || e.ctrlKey) && k === 'y') {
    e.preventDefault();
    store.redo();
  } else if (e.metaKey || e.ctrlKey || e.altKey) {
    return;
  } else if (e.code === 'Space' && !e.target.closest('button')) {
    e.preventDefault();
    $('#play').click();
  } else if (/^[1-9]$/.test(e.key)) {
    triggerPad(Number(e.key) - 1);
  } else if (ui.selected && ['g', 's', 'h'].includes(k)) {
    setArt(ui.selected, { g: 'ghost', s: 'slide', h: 'hammer' }[k]);
  } else if (ui.selected && k === 'n') {
    store.update(s => (s.notes.find(x => x.id === ui.selected).art = null));
  } else if (ui.selected && k === 'escape') {
    ui.selected = null;
    renderAll();
  }
});

// ----- Current chord readout -----
function renderNowChord(sp) {
  const span = sp ?? spanAt(analysis.spans, store.get().notes.find(n => n.id === ui.selected)?.start ?? 0);
  const c = span.chord;
  $('#now-chord').innerHTML = c
    ? `<b>${pretty(span.symbol)}</b><span class="tones-inline">${c.notes.map((n, i) => `<span class="${i === 0 ? 'r' : ''}">${prettyNote(n)}</span>`).join('')}</span><span class="legend"><i class="lg root"></i>root <i class="lg chord"></i>chord tone <i class="lg scale"></i>in key <i class="lg chromatic"></i>outside <i class="lg ghostlg">×</i>ghost</span>`
    : `<b>${pretty(span.symbol)}</b> isn't a chord I recognise`;
}

// ----- Grooves: bank, presets, templates -----
function load(groove, { pad = null, message } = {}) {
  const switchNow = () => {
    ui.selected = null;
    ui.activePad = pad;
    ui.dirty = false;
    ui.queuedPad = null;
    store.replace(groove, { kind: 'load' });
    savePrefs();
    grid.scrollToContent(store.get(), analysis);
    renderPads();
    if (message) toast(message);
  };
  if (audio.isPlaying() && audio.opts.loop) {
    // Wait for the current loop to come round so the switch lands on the one.
    ui.queuedPad = pad;
    audio.queueSwitch(structuredClone(groove), switchNow, store.get());
    renderPads();
    toast(`${groove.title} plays next time round.`);
  } else {
    if (audio.isPlaying()) audio.stop();
    switchNow();
  }
}

function saveToPad(i) {
  const s = store.get();
  if (!share.setPad(i, s)) return toast('This browser blocked saving. Use the share link instead.');
  ui.activePad = i;
  ui.dirty = false;
  savePrefs();
  renderPads();
  toast(`Saved "${s.title}" to pad ${i + 1}.`);
}

const firstEmptyPad = () => share.bank().findIndex(g => !g);

function triggerPad(i) {
  const pads = share.bank();
  const g = pads[i];
  if (!g) return saveToPad(i);
  if (i === ui.activePad && ui.queuedPad == null) {
    return audio.isPlaying() ? audio.stop() : startPlayback();
  }
  load(g, { pad: i });
  if (!audio.isPlaying()) startPlayback();
}

function renderPads() {
  const pads = share.bank();
  const playing = document.body.classList.contains('playing'); // the audio clock starts a beat later
  const filter = ui.genre;
  $('#pads').innerHTML = pads
    .map((g, i) => {
      const active = i === ui.activePad;
      const dim = g && filter !== 'all' && g.genre !== filter;
      const state = [
        g ? 'filled' : 'empty',
        active ? 'active' : '',
        active && playing && ui.queuedPad == null ? 'live' : '',
        ui.queuedPad === i ? 'queued' : '',
        dim ? 'dim' : '',
      ].join(' ');
      const status = ui.queuedPad === i ? 'Next' : active && playing ? 'Playing' : active && ui.dirty ? 'Edited' : '';
      return g
        ? `<button type="button" class="pad ${state}" data-pad="${i}" aria-label="Pad ${i + 1}: ${esc(g.title)}. ${active && playing ? 'Tap to stop.' : 'Tap to play.'}">
            <span class="pad-n">${i + 1}${status ? `<em>${status}</em>` : ''}</span>
            <span class="pad-title">${esc(g.title)}</span>
            <span class="pad-meta">${genreName(g.genre)} · ${g.bpm}</span>
          </button>`
        : `<button type="button" class="pad ${state}" data-pad="${i}" aria-label="Pad ${i + 1}: empty. Tap to save the current groove here.">
            <span class="pad-n">${i + 1}</span><span class="pad-empty">Save here</span>
          </button>`;
    })
    .join('');

  const s = store.get();
  const ap = ui.activePad;
  const hasPad = ap != null && pads[ap];
  const empty = firstEmptyPad();
  $('#pad-actions').innerHTML = `
    <p class="pad-status">${hasPad ? `Editing pad ${ap + 1}${ui.dirty ? ', unsaved changes' : ''}.` : `"${esc(s.title)}" isn't on a pad yet.`}</p>
    <div class="row-btns">
      ${hasPad ? `<button type="button" id="pad-update" ${ui.dirty ? '' : 'disabled'}>Save to pad ${ap + 1}</button>` : ''}
      <button type="button" id="pad-new" class="${hasPad ? 'ghost' : ''}" ${empty < 0 ? 'disabled' : ''}>${empty < 0 ? 'Bank is full' : `Save to pad ${empty + 1}`}</button>
      ${hasPad ? (ui.confirmClear ? `<span class="confirm">Clear pad ${ap + 1}? <button type="button" id="pad-clear-yes">Clear</button><button type="button" id="pad-clear-no">Keep</button></span>` : `<button type="button" id="pad-clear" class="ghost">Clear pad ${ap + 1}</button>`) : ''}
    </div>`;
}

$('#pane-bank').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.pad) return triggerPad(Number(b.dataset.pad));
  if (b.id === 'pad-update') saveToPad(ui.activePad);
  else if (b.id === 'pad-new') saveToPad(firstEmptyPad());
  else if (b.id === 'pad-clear') ui.confirmClear = true;
  else if (b.id === 'pad-clear-yes') {
    share.setPad(ui.activePad, null);
    toast(`Cleared pad ${ui.activePad + 1}. The groove is still in the editor.`);
    ui.activePad = null;
    ui.confirmClear = false;
    savePrefs();
  } else if (b.id === 'pad-clear-no') ui.confirmClear = false;
  renderPads();
});

function rhythmStrip(t) {
  const cells = Array.from({ length: 16 }, () => '');
  t.steps.forEach(([st, len, deg]) => {
    cells[st] = deg === 'x' ? 'x' : 'on';
    for (let k = 1; k < len && st + k < 16; k++) cells[st + k] ||= 'hold';
  });
  return `<span class="strip" aria-hidden="true">${cells.map((c, i) => `<i class="${c}${i % 4 === 0 ? ' beat' : ''}">${c === 'x' ? '×' : ''}</i>`).join('')}</span>`;
}

function renderGroovesPanes() {
  document.querySelectorAll('#grooves [data-tab]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tab === ui.tab));
  document.querySelectorAll('#genre-chips [data-genre]').forEach(b => b.setAttribute('aria-pressed', b.dataset.genre === ui.genre));
  $('#pane-bank').hidden = ui.tab !== 'bank';
  $('#pane-presets').hidden = ui.tab !== 'presets';
  $('#pane-templates').hidden = ui.tab !== 'templates';
  const g = GENRES.find(x => x.id === ui.genre);
  $('#genre-blurb').textContent = g ? g.blurb : 'Pick a genre to see its presets and rhythm templates, or browse them all.';

  $('#preset-list').innerHTML = presets()
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => ui.genre === 'all' || p.genre === ui.genre)
    .map(
      ({ p, i }) => `<li class="card">
        <div class="card-head"><b>${esc(p.title)}</b><span class="tag">${genreName(p.genre)}</span></div>
        <p class="card-meta">${p.chords.map(pretty).join(' · ')} · ${p.bpm} BPM</p>
        ${rhythmStrip(TEMPLATES.find(t => t.id === p.template))}
        <div class="row-btns"><button type="button" data-preset="${i}">Load and play</button><button type="button" class="ghost" data-preset-bank="${i}">Add to bank</button></div>
      </li>`
    )
    .join('');

  $('#template-list').innerHTML = TEMPLATES.filter(t => ui.genre === 'all' || t.genre === ui.genre)
    .map(
      t => `<li class="card">
        <div class="card-head"><b>${esc(t.name)}</b><span class="tag">${genreName(t.genre)}</span></div>
        <p class="card-meta">${esc(t.teaches)}</p>
        ${rhythmStrip(t)}
        <div class="row-btns"><button type="button" data-template="${t.id}">Apply to my chords</button></div>
      </li>`
    )
    .join('');
}

$('#grooves').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.tab) {
    ui.tab = b.dataset.tab;
    renderGroovesPanes();
  } else if (b.dataset.genre) {
    ui.genre = b.dataset.genre;
    renderGroovesPanes();
    renderPads();
  } else if (b.dataset.preset) {
    const p = presets()[Number(b.dataset.preset)];
    load(buildPreset(p, store.get().tuning), { message: `Loaded "${p.title}". Save it to a pad to keep your edits.` });
    if (!audio.isPlaying()) startPlayback();
  } else if (b.dataset.presetBank) {
    const p = presets()[Number(b.dataset.presetBank)];
    const i = firstEmptyPad();
    if (i < 0) return toast('The bank is full. Clear a pad first.');
    share.setPad(i, buildPreset(p, store.get().tuning));
    renderPads();
    toast(`Added "${p.title}" to pad ${i + 1}.`);
  } else if (b.dataset.template) {
    const t = TEMPLATES.find(x => x.id === b.dataset.template);
    let meter = false;
    store.update(s => {
      meter = applyTemplate(s, t).changedMeter;
    });
    ui.selected = null;
    toast(`Applied "${t.name}" over your chords${meter ? ' and switched to 4/4' : ''}. Undo to go back.`);
  } else if (b.id === 'copy-link') {
    copyLink();
  } else if (b.id === 'new') {
    if (audio.isPlaying()) audio.stop();
    ui.selected = null;
    ui.activePad = null;
    store.replace(blankGroove(store.get()), { kind: 'load' });
    toast('New groove. Undo brings the last one back.');
    renderPads();
  }
});

async function copyLink() {
  const link = share.shareLink(store.get());
  const out = $('#share-out');
  out.value = link;
  out.hidden = false;
  try {
    await navigator.clipboard.writeText(link);
    toast('Share link copied.');
  } catch {
    out.select();
    toast('Link selected below. Copy it from there.');
  }
}

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
store.subscribe((s, meta) => {
  analysis = analyze(s);
  if (meta?.kind !== 'load') {
    if (!ui.dirty) {
      ui.dirty = true;
      renderPads();
    }
  }
  renderAll();
  // A queued bank switch already scheduled its own audio.
  if (audio.isPlaying() && meta?.kind !== 'load') audio.schedule(s);
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

$('#genre-chips').innerHTML = [{ id: 'all', name: 'All' }, ...GENRES]
  .map(g => `<button type="button" data-genre="${g.id}" aria-pressed="false">${g.name}</button>`)
  .join('');

renderAll();
renderPads();
renderGroovesPanes();
grid.scrollToContent(store.get(), analysis);
if (fromLink) toast(`Opened shared groove "${store.get().title}".`);
