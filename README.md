# Bassline Builder

Write a bassline on a grid, hear it loop with a metronome, and read it back as bass clef notation and tab. Every note is labeled by what it does against the chord (root, ♭3, 5, ♭7, approach note), so you learn why a line works while you write it.

Runs entirely in the browser. No build step, no server, no account.

## Features

Works on desktop (mouse + keyboard) and phones (touch). Every action has a button; desktop also gets shortcuts.

**Writing**
- Grid editor: tap/click to add, tap again to delete, drag to move, drag the right-edge handle to lengthen. A note you drag or stretch overwrites the notes it lands on.
- Techniques per note: ghost note (×), slide into the next note, hammer-on / pull-off into the next note. Shown on the grid, heard in playback, written in notation and tab.
- Quantize 1/4 to 1/16 triplets, 1–8 bars, any time signature from 2/2 to 12/8.
- 4, 5 or 6 strings, each open string retunable. Fingering stays in low positions automatically.
- Chord lane with chord-tone tinting, chord picker, "fits better" hints and next-chord suggestions.

**Playing**
- Loop, metronome, count-in, live BPM, tap tempo, bass and click volume sliders, bass mute.

**Grooves**
- Bank: 16 pads saved in your browser. Tap a pad to play it on loop. Tap another while it plays and it switches on the next loop. Empty pads save the current groove.
- Presets: 12 starter grooves, two each for Funk, Motown/Soul, Rock, Reggae, Jazz walking and Latin. Load and play, or add to the bank.
- Templates: 12 genre rhythm patterns that play over the chords you've set.
- Share links carry the whole groove in the URL.

**Desktop shortcuts**: Space play/stop · arrows move the selected note · Delete removes it · G ghost · S slide · H hammer · N normal · 1–9 trigger pads · Ctrl+Z / Ctrl+Shift+Z undo/redo.

## Deploy to GitHub Pages

1. Create a public repo named `bassline-builder` and push these files to `main`.
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. After about a minute the site is live at `https://<your-username>.github.io/bassline-builder/`.

Every push to `main` redeploys. There is no build, so no Actions workflow is needed.

## On your phone

- Sound starts on your first tap of Play (browsers require a tap before audio).
- On iPhone the app asks Safari to play through the ringer switch. If you still hear nothing, flip the switch off silent once.
- Add it to your home screen from the browser's share menu for a full-screen app feel.

## Project layout

```
index.html          layout + library script tags (pinned versions)
css/styles.css      theme tokens (light + dark) and all styles
js/main.js          wires everything together
js/state.js         the groove object, tick math, undo/redo
js/grid.js          piano-roll editor
js/controls.js      settings strip, tuning, chord picker
js/audio.js         Tone.js synth, metronome, loop
js/theory.js        chord tones, note labels, key guess, chord suggestions
js/fingering.js     string/fret assignment
js/notation.js      ticks → note values → VexFlow staff + tab
js/genres.js        genre templates and preset grooves
js/share.js         bank pads, preferences and share links
tests/run.mjs       unit tests for the logic
```

Time is stored in ticks at 12 per quarter note (1/8 = 6, 1/16 = 3, 1/8 triplet = 4), so changing the grid never moves notes.

## Tests

```
npm install
npm test
```

## Libraries

Loaded from jsDelivr, pinned: Tone.js 15.0.4 (audio), VexFlow 5.0.0 (notation), Tonal 6.4.2 (theory), lz-string 1.5.0 (share links).
