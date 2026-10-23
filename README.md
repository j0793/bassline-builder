# Bassline Builder

Write a bassline on a grid, hear it loop with a metronome, and read it back as bass clef notation and tab. Every note is labeled by what it does against the chord (root, ♭3, 5, ♭7, approach note), so you learn why a line works while you write it.

Runs entirely in the browser. No build step, no server, no account.

## Features (Phase 1)

- Grid editor: tap to add, tap again to delete, drag to move, drag the right-edge handle to lengthen. Arrow keys and Delete work on desktop.
- Quantize: 1/4, 1/8, 1/16, 1/8 triplet, 1/16 triplet. Switching keeps your notes.
- 1–8 bars, any time signature from 2/2 to 12/8 (6/8, 9/8, 12/8 count in dotted quarters).
- 4, 5 or 6 strings, each open string retunable (low B, high C, drop D, anything).
- Chord lane: tap a chord to change it, split it mid-bar, or remove a change. The chord tones are tinted on the grid.
- Chord help: which diatonic chord your notes fit best, and common next chords with Roman numerals.
- Playback: loop, metronome, count-in, live BPM, tap tempo, bass mute (play along to the click).
- Notation + tab with chord symbols, repeat signs when looping, and auto fingering that keeps your hand in position.
- Key guess, undo/redo, save to this browser, and share links that carry the whole groove in the URL.

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
js/share.js         saved grooves and share links
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
