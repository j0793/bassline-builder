# Bassline Builder

Write a bassline on a grid, hear it loop with a metronome, and read it back as bass clef notation and tab. Every note is labeled by what it does against the chord (root, ♭3, 5, ♭7, approach note), so you learn why a line works while you write it.

Runs entirely in the browser. No build step, no server, no account.

## Features

Works on desktop (mouse + keyboard) and phones (touch). Every action has a button; desktop also gets shortcuts.

**Starting**
- Opening the app picks up whatever you were working on last. With nothing in progress it loads a random groove from your bank, or a random starter if the bank is empty.
- **Blank canvas** clears the notes and gives you one random chord to write over.
- **Generate** loads a typical line for the chosen genre (a genre rhythm over a typical progression, or one of your saved basslines in that genre).
- Nothing plays on its own: press Play (or Space), or tap the active pad.

**Writing**
- Grid editor: tap/click to add, tap again to delete, drag to move, drag the right-edge handle to lengthen. Notes can overlap: stack them into chords and double stops, hold one under a moving line, or run into a chord. Notation shows stacked notes and ties; tab gives each one its own string.
- Techniques per note: ghost note (×), slide into the next note, hammer-on / pull-off into the next note. Shown on the grid, heard in playback, written in notation and tab.
- Grid of 1/4, 1/8 or 1/16, each with a Triplet switch. 1–8 bars, any time signature from 2/2 to 12/8.
- 4, 5 or 6 strings, each open string retunable. Fingering stays in low positions automatically.
- Chord lane with chord-tone tinting, chord picker, "fits better" hints and next-chord suggestions.

**Teaching panel**
- Reads your line and chords and ranks what to try next: roots on the changes, a steady pulse, fifths and octaves, approach notes, chord tones on strong beats, a fill, genre moves (ghost notes for funk, an empty beat one for reggae, a walk for jazz) and where your progression could go next. Most suggestions have a one-tap button; undo reverses it.
- Shows the progression in Roman numerals and flags chords that use notes outside the key.

**Playing**
- Sampled electric bass (real recordings, pitch-shifted, so slides glide and chords ring). Chords backing track on an electric-piano sound.
- Loop, metronome, count-in with an on-screen countdown (one bar in the current time signature by default, or a fixed 1–8 beats), live BPM, tap tempo, bass, chords and click volume sliders, bass mute.

**Practice**
- Loop any range of bars; the rest of the grid dims.
- Tempo trainer: start slow and add a few BPM every N loops up to a target.
- Mute the bass and turn on Chords to play the line yourself over the changes.

**Export and offline**
- Save the notation and tab as a PNG, or export a MIDI file (bass on track 1, chords on track 2) for your DAW.
- Installable from the browser (Add to Home Screen) and works offline after the first visit.

**Grooves**
- Bank: 16 pads saved in your browser. Tap a pad to load it, tap it again to play it on loop. Tap another while one plays and it switches on the next loop. Empty pads save the current groove.
- Genres: six built-in (Funk, Motown/Soul, Rock, Reggae, Jazz walking, Latin) with two starters each. Create your own genres, edit or delete them, and save, update, rename or delete basslines in any genre. Generate draws from them.
- Templates: 12 genre rhythm patterns that play over the chords you've set.
- Share links carry the whole groove in the URL.

**Desktop shortcuts**: Space play/stop · arrows move the selected note · Delete removes it · G ghost · S slide · H hammer · N normal · 1–9 trigger pads · Ctrl+Z / Ctrl+Shift+Z undo/redo.

## Deploy to GitHub Pages

1. Create a public repo named `bassline-builder` and push these files to `main`.
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. After about a minute the site is live at `https://<your-username>.github.io/bassline-builder/`.

Every push to `main` redeploys. There is no build, so no Actions workflow is needed.

When you deploy changes, bump `VERSION` at the top of `sw.js` so installed copies pick up the new files.

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
js/genres.js        genres, templates, starters and Generate
js/coach.js         teaching panel suggestions and Roman numerals
js/share.js         bank pads, preferences and share links
js/export.js        MIDI file writer and image download
sw.js               offline cache (service worker)
manifest.webmanifest, icons/   install as an app
samples/bass/       electric bass samples (see CREDITS.txt)
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

## Credits

Electric bass samples by Karoryfer, distributed via [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments) under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Trimmed and re-encoded for size.
