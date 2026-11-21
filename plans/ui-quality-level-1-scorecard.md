# TILT UI Quality — Level 1 Scorecard

- **Branch:** `ui-quality-level-1` (base `selection-save-reload` @ `3e6f901`)
- **Weights:** visual hierarchy 15%, consistency 15%, interaction feedback 20%,
  accessibility 20%, responsive/touch 15%, performance/resilience 15%.
- **Gate:** every P0/P1 surface weighted ≥ 3.5 with no dimension below 3; P2
  surfaces scored and scheduled.

**Method note.** Scores below are from static evidence (`file:line`). The
screenshot/axe/keyboard gates are still open — this environment has no browser
automation (plan §13.3), so they need one manual device pass. Treat every score
as provisional until the screenshot columns are filled.

## Weighted results

| # | Surface | Pri | VH | Cons | Inter | A11y | Touch | Perf | Weighted | Gate |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | Stage/canvas & selection | P0 | 4 | 3 | 4 | 3 | 4 | 4 | **3.65** | pass (provisional) |
| 2 | Look shelf: shadows, key box, quality | P0 | 4 | 4 | 4 | 4 | 4 | 4 | **4.00** | pass (provisional) |
| 3 | Shelf, tools, sheets, Objects tray | P0 | 3 | 3 | 4 | 3 | 4 | 4 | **3.50** | pass (provisional) |
| 4 | Project library / home | P1 | 4 | 3 | 4 | 4 | 4 | 4 | **3.85** | pass (provisional) |
| 5 | Editor shell / project bar | P1 | 4 | 3 | 4 | 4 | 4 | 4 | **3.85** | pass (provisional) |
| 6 | Flower Studio | P2 | 3 | 3 | 3 | 3 | 3 | 4 | **3.15** | scheduled |
| 7 | Render Studio | P2 | 3 | 3 | 3 | 3 | 3 | 3 | **3.00** | scheduled |
| 8 | Models catalog | P2 | 3 | 3 | 3 | 4 | 4 | 4 | **3.50** | pass (provisional) |
| 9 | Workflow page | P2 | 3 | 3 | 3 | 4 | 3 | 4 | **3.35** | scheduled |
| 10 | Standalone / PWA | P2 | 3 | 3 | 3 | 3 | 3 | 4 | **3.15** | scheduled |

No P0/P1 dimension scores below 3; all five P0/P1 surfaces are at or above 3.5.

---

## 1. Stage/canvas & selection — P0, 3.65

```text
score:      4 / 3 / 4 / 3 / 4 / 4
evidence:   js/viewer.js:183 (DPR capped at 2), :268-275 (composer only for
            cinematic or an active outline), :690-693 (OutlinePass),
            js/panel.js:619 (emptyNote), :939 (applyBusy), TILT.html:30-36
            (dock overlays the stage, shelf max 480/560)
top findings: canvas selection is pointer-first; keyboard reachability of
            selection unverified (A11y 3)
fixed in:   a05bff1 (render prefs, focus ring, compiled CSS)
remaining:  manual keyboard pass + screenshots at 4 widths
```

## 2. Look shelf: shadows, key box, quality — P0, 4.00

```text
score:      4 / 4 / 4 / 4 / 4 / 4
evidence:   js/viewer.js:22-67 (tilt-render-prefs-v1 contract + migration),
            :183 (shadow flag seeded before first render), :279-281 (restore
            order quality -> shadows -> key box, persist=false), :590/:604/:652
            (persist-gated setters), js/panel.js:2820 (shelf reads shadowInfo()),
            :297/:453 (aria-pressed on toggles)
top findings: none open — this was the Level 1 primary defect
fixed in:   a05bff1
remaining:  the shadow/reload acceptance matrix needs one manual run
```

## 3. Shelf, tools, sheets, Objects tray — P0, 3.50

```text
score:      3 / 3 / 4 / 3 / 4 / 4
evidence:   js/panel.js:1049 (section() gates by tool), :1264/:1306 (Shape/
            Colour blocks), :1326/:1331 (Pillars/Lights blocks), :619
            (emptyNote for every empty state), TILT.html:556-558 (44px coarse
            pointer targets), :323/:567 (reduced motion)
top findings: dense controls + shelf overlay trade-off; one card body holds
            many controls (Hierarchy 3); chip/focus patterns split between
            inline Tailwind classes and the inline <style> block (Consistency 3)
fixed in:   a05bff1 (focus ring, compiled utilities, transition hardening)
remaining:  screenshots at 360/390 to confirm no overflow; focus-return pass
```

## 4. Project library / home — P1, 3.85

```text
score:      4 / 3 / 4 / 4 / 4 / 4
evidence:   index.html:46-60 (aria-label on every icon-only control), :68
            (nav landmark), :105/:111 (empty state + action), home/home.css:87
            (global :focus-visible), :159 (.search:focus-within), :295
            (explicit chip transition), :603 (reduced motion), :595-602
            (coarse pointer 44px), home/home.js:265-287 (empty/notice states)
top findings: `#notice` (index.html:114) and `#toast` (:130) were not live
            regions — screen readers never heard import/save feedback
            (Medium, fixed); tokens diverged from the shell (Medium, fixed)
fixed in:   a05bff1 (focus-within, transition, motion), this commit (#live)
remaining:  screenshots + axe
```

## 5. Editor shell / project bar — P1, 3.85

```text
score:      4 / 3 / 4 / 4 / 4 / 4
evidence:   TILT.html:15-23 (global :focus-visible), :111/:122 (safe-area top,
            44px bar buttons), :33 (safe-area bottom on the dock), :578
            (range :focus-visible), js/editor.js:46-88 (saving/saved/offline
            states), :292 (initial 'saved')
top findings: `#save-status` (TILT.html:694) was visual-only — no role/
            aria-live, so async save outcomes were not announced (Medium,
            fixed via #save-announce at TILT.html:699)
fixed in:   a05bff1 (focus ring, compiled sheet, local three), this commit
remaining:  screenshots + keyboard pass
```

## 6. Flower Studio — P2, 3.15 (scheduled)

```text
score:      3 / 3 / 3 / 3 / 3 / 4
evidence:   studio/index.html:34 (canvas labelled), :43-67 (aria-expanded/
            aria-pressed/tablist+tabs), studio/styles.css:66/:123 (focus
            outlines), :189 (reduced motion added), :169-172 (44px under
            coarse/small breakpoints), studio/index.html:10-15 (now local three)
top findings: `.picker-item{outline:none}` relies on a background change alone
            (studio/styles.css:70-71) (Medium); base `.btn`/`.chip`/`.seg label`
            are 40px and only reach 44px in media queries (:4, :38, :119,
            :169-184) (Medium); own `--paper/--green/--pill` token set diverges
            from home and shell (Medium)
fixed in:   a05bff1 (reduced motion), this commit (local three)
remaining:  Level 2 visual pass per decision §13.4
```

## 7. Render Studio — P2, 3.00 (scheduled)

```text
score:      3 / 3 / 3 / 3 / 3 / 3
evidence:   js/renderStudio.js:95/:142/:145 (aria-pressed on quality toggles)
top findings: no 44px target rules, no reduced-motion rule, no safe-area
            handling found (Medium); slider feedback and mobile layout not
            audited (Medium)
fixed in:   — (out of Level 1 fix scope, decided §13.4)
remaining:  Level 2 audit
```

## 8. Models catalog — P2, 3.50 (provisional pass)

```text
score:      3 / 3 / 3 / 4 / 4 / 4
evidence:   home/models.css:72 (global :focus-visible), :212 (.search:focus-within),
            :733 (coarse pointer 44px), :739 (reduced motion), models.html:36-41
            (local three import map)
top findings: split focus mechanisms between `.search:focus-within` and the
            global outline (Low)
fixed in:   a05bff1 (focus-within), this commit (local three)
remaining:  screenshots at 4 widths
```

## 9. Workflow page — P2, 3.35 (scheduled)

```text
score:      3 / 3 / 3 / 4 / 3 / 4
evidence:   workflow.html:85 (a:focus-visible), :92-94 (landmarked nav links),
            no transitions/animations to tame; static document, no CDN
top findings: no 44px target rules (Medium); no reduced-motion rule, but the
            page has no motion to reduce (Low)
fixed in:   —
remaining:  Level 2 (target sizes, density review)
```

## 10. Standalone / PWA — P2, 3.15 (scheduled)

```text
score:      3 / 3 / 3 / 3 / 3 / 4
evidence:   TILT.standalone.html (CSS inlined, no CDN, no external link),
            sw.js:8-18 (tilt-v4 shell now carries /css/tailwind.css),
            tests/test14 (pins no-CDN + inlined sheet)
top findings: CSS is served cache-first while scripts are network-first, so a
            stylesheet can lag a deploy until background refresh (Low)
fixed in:   a05bff1 + this commit
remaining:  offline cold-load test on a device
```

---

## Level 2 backlog

| Sev | Finding | Evidence | Status |
|---|---|---|---|
| Medium | `#notice` / `#toast` are not live regions | `index.html:114`, `:130` | fixed — `#live` region (`index.html:133`), mirrored by `announce()` (`home/home.js`) |
| Medium | `#save-status` has no `role="status"`/`aria-live` | `TILT.html:694`, `js/editor.js:68-88` | fixed — `#save-announce` (`TILT.html:699`) carries offline + flash only |
| Medium | Three divergent token sets (`--bg/--surface`, `--ui-*`, `--paper`) | `home/home.css:5-32`, `TILT.html:339-375`, `studio/styles.css:1-2` | fixed — canonical `--ui-*` bridge mapped on all four pages, values unchanged |
| Medium | Flower Studio `.picker-item` focus = colour change only | `studio/styles.css:70-71` | open |
| Medium | Flower Studio base controls are 40px, 44px only in media queries | `studio/styles.css:4,38,119,169-184` | open (`--ui-tap` already states 44px) |
| Medium | Render Studio: no touch-target, motion or safe-area rules | `js/renderStudio.js` | open |
| Medium | Workflow page: no 44px target rules | `workflow.html` | open |
| Medium | Shell body keeps `bg-gray-100` in dark mode (it sits under the canvas, so `--ui-bg` does not flip with the theme) | `TILT.html:681`, `TILT.html:357` | open — found while mapping `--ui-bg` |
| Low | Two focus mechanisms for the search field (global outline + `:focus-within` ring) | `home/home.css:87`,`:159`, `home/models.css:72`,`:212` | open |
| Low | CSS cache-first vs scripts network-first | `sw.js:60-80` | open |
| Low | three vendored twice (0.160 ESM + 0.128 UMD, ~1.96 MB) | `vendor/three/`, `vendor/three0128/` | open |
| Low | `workflow.html` has no reduced-motion block (no motion today) | `workflow.html` | open |

Level 2 code items above are guarded by `tests/test15-level2.mjs`
(live-region contract + full canonical token set per page, aliases only
resolving to tokens the same file defines). The bridge is vocabulary plus a
per-page mapping rather than one shared stylesheet: a shared *value* layer
would have to win or lose the cascade against three different dark-mode
selectors (`.dark`, `:root[data-theme="dark"]`), and with no browser here
that order is a regression nobody can screenshot.

## Stage 9 manual protocol (to close the open gates)

1. Serve with `bash serve.sh`; keep DevTools console open for the whole pass.
2. Viewports: 360×800, 390×844, 768×1024, 1024×768, 1440×900; light + dark.
3. Capture each P0 surface (stage, Look shelf, shelf/tray open, Objects tray)
   at each width — 4 shots per state, named `NN-surface-wW-<theme>.png`.
4. Run the §9 shadow matrix: off→reload, on→reload, cinematic+shadows off→reload,
   key box on→reload, scene switch with key box on.
5. Keyboard pass: Tab through home, top bar, shelf chips, Look shelf, tray;
   confirm a visible ring and focus return after Escape on sheet/tray.
6. axe (browser DevTools or `@axe-core/cli` against the local server): zero
   Critical/Serious.
7. Re-run `node tests/run.mjs` and `git diff --check`; then merge this branch
   into `selection-save-reload`.
