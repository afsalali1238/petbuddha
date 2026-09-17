# Bodhi Pomodoro

A calm Windows desktop pet. A tiny toon-shaded 3D Buddha meditates under a Bodhi tree
while you focus; when the session ends he stands up, hops off his cushion and waddles
off across your screen. **His absence is the break** — the screen is yours until he
walks back in.

No telemetry, no network calls, no accounts. Window titles, when read at all, are read
into memory and never leave the device.

```bash
npm install          # add --ignore-scripts on non-Windows boxes (see Notes)
npm run assets       # build the model, the sounds and the icons (see M0)
npm run dev          # run the pet
npm run test         # 236 pure-logic unit tests
npm run dist         # NSIS installer + portable exe
```

---

## The loop

```
[*] --> Idle --click/tray/shortcut--> Focus --timer 0--> Waking
Waking --stand up + hop off--> WalkingOut --exits screen--> Break
Break --timer 0--> Returning --hop on + sit--> Ready --click--> Focus
```

Pause is a *flag* on Focus/Break, never a phase. Skip performs the current phase's end
transition immediately. Every 4th session (2nd in Monk mode) the tree blossoms a new
foliage cluster and the break becomes a slower scenic stroll.

| Phase | What you see | Sound | Tray |
| --- | --- | --- | --- |
| Idle / Ready | seated, shades on, breathing, slow head tilt | — | Ready |
| Focus | shades off (or frosted), 5 s breath, gold aura fills, leaves drift, canopy sways | — | Meditating 24:59 |
| Focus (paused) | breathing and leaves freeze, aura dims to 30% | — | Paused 12:04 |
| Waking | stands up, hops off the cushion | temple bell (4 s) | Awakening |
| WalkingOut | waddles to the far edge at 100 px/s, dust at his feet | footsteps (opt-in) | Walking out |
| Break | empty cushion, floating countdown, rotating nudge ("drink water"…) | — | Out walking 04:59 |
| Returning | walks back in, hops up, sits | soft bell | Returning |

---

## How it is built

```
MAIN (single source of truth)
 ├─ stateMachine.ts   pure next(state, event)  ← 100% of transitions unit-tested
 ├─ timer.ts          endsAt + injected now(), 250 ms tick, powerMonitor reconcile
 ├─ displays.ts       work areas, mixed DPI, unplug/replug
 ├─ windows.ts        stage / laser / settings lifecycle
 ├─ tray.ts           icon, menu, live countdown tooltip
 ├─ focusWatcher.ts   one 1.5 s poll -> fullscreen guard + distraction escalation
 ├─ lasers.ts         blast orchestration, snooze
 └─ store.ts          settings.json + stats.json (versioned, migrated)
      │ typed preload bridge (contextIsolation on, nodeIntegration off)
 ├─ STAGE renderer    Three.js: actor, diorama, effects, HUD, hit-test   (dumb view)
 ├─ LASER renderer    2D canvas blast                                    (dumb view)
 └─ SETTINGS renderer form                                               (dumb view)
```

Renderers never run the timer and never decide a transition: they receive a state
object and draw it. The Walk is planned in main (DIP px along the work-area floor) and
animated inside the stage window — **no OS window ever moves**.

Everything expensive is pure and tested without Electron: `stateMachine`, `timer`,
`focusLogic` (grace/cooldown/escalation), `storeLogic` (migration/validation) and
`walkPath` (geometry). `npm test` runs them all.

### Milestones

| # | Status | Notes |
| --- | --- | --- |
| M0 Character pipeline | ✅ | `tools/build-model.mjs` builds the chibi and the tree procedurally and exports `bodhi.glb` (5.8k tris, ~400 KB) + `tree.glb` (2.2k tris, ~107 KB). All 12 contract clips, exact names and durations. Passes `gltf-validator` with **zero errors** (`npm run validate:glb`). |
| M1 Solid core | ✅ | State machine + timer + store + tray + settings + single-instance + session restore. **236 unit tests.** |
| M2 3D stage | ✅ | Stage window, toon renderer, ortho camera (1 unit = 1 DIP px), clip player, hit-test drag + click-through, walk along the floor with easing, mixed-DPI refit, fullscreen hide, render-on-demand with per-phase fps caps. |
| M3 Lasers | ✅ | Grace → glance → beam → sweep → sweep+shake, snooze, allow list wins, reduce-motion edge outline, photosensitivity cap, lens world→screen tracking. |
| M4 Polish | ✅ | Tree bloom ceremony, four time-of-day light rigs, break nudges, stats line, synthesized bell/soft-bell/pew, global shortcut, launch at login, "Take Bodhi for a walk". |
| M5 Ship | ⚠️ | NSIS + portable config, auto-update wiring, README, smoke tests are all in place. **Not done:** nothing is code-signed and no release has been published (both need certs/a real release). |

---

## The 110 px silhouette test (M0 acceptance)

The character is generated from code, so the silhouette test runs headless with no GPU:

```bash
npm run preview:ascii -- idle_sit 0          # any clip, any time
npm run preview:ascii -- --scene meditate 1.25   # the whole diorama
npm run preview                              # renders PNG contact sheets
```

`tools/lib/raster.mjs` is a small software rasteriser that reproduces the shipping look
(ortho camera, 3-step toon ramp, inverted-hull outline), so what you see in the
terminal is what the app draws. Current result for `idle_sit`: a 66 × 112 px silhouette
— big head, shades with lens highlights, topknot, pear body, sash.

---

## Assets are generated, not committed blind

| Script | Produces |
| --- | --- |
| `tools/build-model.mjs` | `assets/models/bodhi.glb`, `assets/models/tree.glb` |
| `tools/synth-audio.mjs` | `assets/sounds/{bell,soft-bell,pew}.wav` |
| `tools/build-icons.mjs` | `assets/icons/tray-{16,24,32,64,256}.png`, `icon.ico` |
| `tools/validate-glb.mjs` | glTF validation report (fails on any error) |
| `tools/preview*.mjs` | PNG + ASCII previews of every pose |
| `tools/model-viewer.html` | drop a `.glb` in a browser: lists and plays every clip |

`tools/` scripts import the palette and clip contract directly from `src/shared/*.ts`
(Node type-stripping), so art and app can never drift.

Total assets: ~800 KB. Scene: 7,984 triangles, 25 meshes, well inside the 13k-tri /
40-draw-call budget.

---

## Deliberate deviations from the spec

These are choices, not accidents. Each one is arguable; all are easy to reverse.

1. **Art route: procedural, not kitbash or commission** (§4.7 route 3). No artist was
   available, and a code-built model is original, CC0-safe, re-generable and passes the
   size budgets. The `.glb` loader path is unchanged, so a commissioned rig can replace
   `assets/models/bodhi.glb` with zero code changes as long as it keeps the clip names.
2. **Rigid-part rig instead of a skinned mesh.** The Buddha is a hierarchy of nodes
   (vinyl-figure style), which is both the intended toy look and what makes procedural
   generation viable. Consequence: there are no cloth/skirt bones — the robe hem is
   hand-animated via body scale and hip motion instead.
3. **Two companion clips.** `glance_right` and `walk_left` mirror `glance` and `walk` so
   he can aim at a window or walk to an edge on either side. All 12 contract clips
   exist with the exact names, durations and loop flags from §4.3; these two are extras.
4. **Outline width is clamped to ~1.8 px.** §5.2 says "0.004 units", but the model is
   normalised to 1.0 unit tall, which makes that ~0.4 px at 110 px — thinner than a
   pixel. The renderer uses `max(0.004, 1.8px / scale)`.
5. **Sounds are 22.05 kHz PCM WAV, not Vorbis.** No Ogg encoder is available in this
   environment. The loader asks for `.ogg` first and falls back to `.wav`, so dropping
   in real CC0 freesound recordings is a file swap with no code change.
6. **Reduce motion follows the setting, not the OS.** `reduceMotion: 'auto'` currently
   resolves to "off"; wiring it to the Windows `SystemParametersInfo` animation flag
   needs a native call and is left as a one-line TODO.

---

## Notes for Windows (the only supported platform)

- `get-windows` is a native N-API module. On Windows it installs a prebuilt binary; if
  you build from a checkout and see "was compiled against a different Node version",
  run `npm rebuild get-windows` (or `npx electron-builder install-app-deps`).
- On **non-Windows** machines use `npm install --ignore-scripts`: the Linux build of
  `get-windows` tries to compile from source and fails. The app itself stays runnable —
  the watcher degrades quietly and returns "no foreground window".
- Code signing (§7.7) is **not** configured. `electron-builder` will produce unsigned
  binaries that SmartScreen will warn about. Add `CSC_LINK`/`CSC_KEY_PASSWORD` (OV) or
  configure Azure Trusted Signing before publishing.
- Auto-update publishes to GitHub Releases; the portable build shows a download link
  instead of updating in place (portables cannot replace their own exe).

## What has *not* been verified on real hardware

This build was produced on Linux without a display, so the following are implemented
against the documented Electron API and type-check/bundle cleanly, but have not been
exercised on Windows: transparent-window compositing, always-on-top vs fullscreen
apps, tray rendering, mixed-DPI monitor moves, and the walk on a real desktop. The
logic behind all of them (state, timing, geometry, escalation) is unit-tested; the
rendering and windowing need one pass on a Windows machine — start with
`npm run preview` and the QA matrix in the spec (§10).
