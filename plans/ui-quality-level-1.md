# TILT UI Quality — Optimization Level 1

Status: **implemented on `ui-quality-level-1`** (Stages 0–8 code complete; Stage 9 handoff pending)  
Owner: UI Quality department (separate branch/team)  
Integration base: `selection-save-reload` at `3e6f901`  
Working branch: `ui-quality-level-1` (cut from `selection-save-reload`)  
Merge target: `selection-save-reload` only. No direct `main` merge.  
Baseline: 13/13 suites green before this branch; 14 suites green after Stage 8.

## 1. Level 1 outcome

Make every user-facing surface pass one shared, evidence-based quality bar:
visual hierarchy, consistency, interaction feedback, accessibility, responsive
behaviour, performance, and state persistence.

This is a **hardening and correction pass**, not an aesthetic reset. Keep the
existing TILT identity. Every change must map to a user task or a measured defect.

Primary functional correction:

- Shadow on/off, key-box visibility, and render quality must restore exactly
  after reload.
- The Look shelf must show the real viewer state, not a local guess.
- Quality mode and shadow mode must remain independent.

## 2. Non-negotiables

1. **Function first.** A control exists because it changes something the user can
   see or verify. No decoration-only controls.
2. **State truth.** A persisted preference is written once, restored once, and
   read back from one source of truth.
3. **Evidence.** Each surface gets screenshots, a score, and `file:line`
   findings. “Looks fine” is not evidence.
4. **No runtime CDN** in the editor or standalone bundle.
5. **No new runtime framework or UI dependency.**
6. **Existing tests stay green.** Current baseline: 13/13 suites pass.
7. **No `main` merge** until the collaborator’s pending commit is pushed and the
   integration branch is reconciled.

## 3. Surfaces in scope

Every surface is assessed. Priority controls execution order.

| Priority | Surface | Files | Main risk |
|---|---|---|---|
| P0 | Stage/canvas and selection | `js/viewer.js`, `js/scenes.js` | Reload state, picking, outline, shadow cost |
| P0 | Look shelf: shadows, key box, quality | `js/panel.js:2800+`, `js/viewer.js:500+` | Shadow reset on reload, state drift |
| P0 | Shelf, tools, sheets, Objects tray | `js/panel.js`, `js/objectchip.js` | Dense controls, focus, touch, state feedback |
| P1 | Project library/home | `index.html`, `home/*` | Empty/loading/error states, card actions |
| P1 | Editor shell/project bar | `TILT.html`, `js/editor.js` | Focus, safe areas, offline/save states |
| P2 | Flower Studio | `studio/*` | Token drift, dense form UI |
| P2 | Render Studio | `js/renderStudio.js` | Slider/quality feedback, mobile layout |
| P2 | Models catalog | `models.html`, `home/models.*` | Loading/error states, preview performance |
| P2 | Workflow page | `workflow.html` | Information density and navigation |
| P2 | Standalone/PWA | `TILT.standalone.html`, `sw.js` | Offline styling, cache correctness |

## 4. Research intake: `npx skills find`

Searches run:

```bash
npx skills find ui ux design
npx skills find design review accessibility
npx skills find frontend design
npx skills find openai design
npx skills find accessibility review
npx skills find design system tokens
```

Selected Level 1 reference pack:

| Source | Installs | Why it is used |
|---|---:|---|
| `vercel-labs/agent-skills@web-design-guidelines` | 873.3K | Concrete web UI audit rules: focus, forms, motion, touch, safe areas, anti-patterns |
| `anthropics/skills@frontend-design` | 1.1M | Deliberate visual direction, typography, restraint, self-critique |
| `pbakaus/impeccable@audit` | 81.9K | Severity-ranked audit across a11y, performance, theming, responsive, AI anti-patterns |
| `nextlevelbuilder/ui-ux-pro-max-skill@ui-ux-pro-max` | 457.2K | Priority-ranked UX rules, touch, responsive, design-system patterns |
| `anthropics/knowledge-work-plugins@accessibility-review` | 4.5K | WCAG 2.1/2.2 AA review structure |
| `addyosmani/web-quality-skills@web-quality-audit` | 37.9K | Runtime evidence before source conclusions; performance/a11y/SEO/best practices |
| `jakubkrehel/skills@better-interface` | 38.2K | Cross-discipline interface review: layout, type, colour, copy, motion |
| `openai/skills@figma-implement-design` | 7.1K | Reference only: design-to-code QA discipline |
| `openai/role-specific-plugins@design-qa` | 76 | Reference only: low adoption, narrow scope, not a dependency |

Adaptation rule: install or vendor these in Stage 0, record the source commit,
and distill the applicable rules into this project’s rubric. Do not add them as
runtime dependencies and do not copy generic style opinions into TILT.

## 5. Adapted quality rules

1. **Semantic controls.** Buttons are `<button>`, navigation is `<a>`, every
   icon-only control has an accessible name.
2. **Visible focus.** No `outline: none` without a `:focus-visible` replacement.
3. **State must survive reload.** Toggles, quality, key box, theme, and camera
   restore from storage. A denied storage API must not break boot.
4. **One source of truth.** The viewer owns render state; panels read it back.
5. **No `transition: all`.** List animated properties explicitly.
6. **Reduced motion.** Every transition/animation has a reduced-motion path.
7. **Touch first.** 44px targets, no hover-only actions, no horizontal overflow,
   safe-area padding on sheets and docks.
8. **Function-shaped hierarchy.** Stage first, selection second, tools third,
   secondary settings last.
9. **Every state is designed.** Loading, empty, error, offline, saving, saved,
   disabled, selected, and destructive states are all explicit.
10. **Performance is part of quality.** No runtime CDN, bounded shadow/composer
    cost, and no layout thrash in hot paths.

## 6. Baseline findings from static inspection

These are candidate findings. Stage 1 confirms them with browser evidence.

| Finding | Evidence | Impact |
|---|---|---|
| Shadows always boot on | `js/viewer.js:134` sets `shadowMap.enabled = true`; `setShadowsEnabled` at `:541` does not persist | User turns shadows off, reload turns them back on |
| Key-box visibility is ephemeral | `setShadowBoxVisible` at `js/viewer.js:550` has no storage | Debug overlay resets every reload |
| Quality persists, shadow state does not | `js/viewer.js:147` and `:617` persist quality only | Render preferences are inconsistent |
| Panel reads initial shadow state correctly but cannot restore it | `js/panel.js:2820` reads `shadowInfo()`; no saved value exists | UI and viewer agree on the wrong default |
| Editor depends on Tailwind CDN | `TILT.html:10`, `TILT.standalone.html:10` | Offline styling risk, render-blocking network dependency, third-party failure |
| Token systems are split | home uses `--bg/--surface`; shell uses `--ui-*`; studio uses `--paper` | Drift across pages that should feel like one product |
| Some focus/outline exceptions are implicit | `home/home.css:133`, `:457`, `TILT.html:560` | Risk of invisible keyboard focus |
| One broad transition remains | `home/home.css:258` uses `transition: all` | Unpredictable animation and non-compositor properties |
| Existing quality integration is pinned | `tests/test10.mjs` covers composer + `viewerQuality` | Good baseline; extend rather than replace |

## 7. Per-surface scorecard

Score each dimension 0–4.

| Dimension | Weight | What “4” means |
|---|---:|---|
| Visual hierarchy | 15% | Primary task is obvious at first glance; no competing accents |
| Consistency | 15% | Tokens, spacing, radius, type, and states match across surfaces |
| Interaction feedback | 20% | Every action has immediate, specific, recoverable feedback |
| Accessibility | 20% | WCAG 2.2 AA, keyboard complete, focus visible, contrast sound |
| Responsive/touch | 15% | 360px–1440px, safe areas, 44px targets, no overflow |
| Performance/resilience | 15% | No runtime CDN, bounded GL cost, no layout thrash, graceful failure |

Level 1 gate:

- No dimension below 3.
- Weighted score at least 3.5.
- No open Critical or High finding.
- Every score backed by a screenshot and a `file:line` reference.

Each surface gets:

```text
surface:
  score:
  evidence:
  top findings:
  fixed in:
  remaining risk:
```

## 8. Stages

### Stage 0 — Branch, skill pack, evidence harness (0.5–1 day)

- Cut `ui-quality-level-1` from `selection-save-reload`.
- Record current commit and 13/13 test baseline.
- Vendor or install the reference pack in a non-runtime location.
- Record source commits and the exact adapted rules used.
- Add screenshot/audit folders and a repeatable run command.
- Decide whether browser automation is available; if not, define a manual
  screenshot protocol with fixed viewports and states.

Exit: clean branch, pinned references, baseline evidence, no runtime code change.

### Stage 1 — Surface inventory and audit (1–2 days)

- Enumerate every surface and state:
  - home: empty, loading, error, populated, search-empty, action sheet;
  - editor: boot, no selection, frame/pillar/light/flower/decor selection;
  - Look shelf: shadows on/off, key box on/off, standard/cinematic;
  - shelf/tray/sheets open/closed;
  - save states: saving, saved, offline, failed;
  - 360/390/768/1024/1440 widths, light/dark, reduced motion.
- Run static audit plus browser evidence.
- Produce one scorecard per surface.
- Rank findings Critical/High/Medium/Low.

Exit: every surface scored; top 20 findings have evidence; no speculative fixes.

### Stage 2 — Render state and persistence (1–2 days, first code change)

- Introduce one render-preference contract:
  - `quality`: `standard | cinematic`;
  - `shadows`: `on | off`;
  - `shadowBox`: `on | off`.
- Use versioned, namespaced storage keys and migrate the existing
  `tilt-render-quality` value.
- Apply preferences in this order: lights/scene exist → quality → shadows →
  key box.
- Make `shadowInfo()` and the panel read the restored state.
- Ensure user-initiated writes persist; boot-time restore does not rewrite.
- Handle denied/quota-exceeded storage without breaking boot.

Exit: shadow/reload acceptance matrix passes; tests cover keys, migration, and
restore order.

### Stage 3 — Tokens and primitives (1–2 days)

- Define the shared UI token bridge: colour, surface, line, text, muted, accent,
  danger, radius, shadow, tap target, focus ring.
- Align home, shell, and studio tokens without rewriting every class.
- Harden primitives: button, chip, segmented control, switch, field, sheet,
  modal, toast, empty state.
- Replace touched one-off colours with tokens.
- Remove `transition: all` in touched areas.

Exit: changed surfaces use the shared tokens; no new hardcoded colours; visual
diff reviewed.

### Stage 4 — Interaction hardening (2–3 days)

- Define explicit states: default, hover, active, focus-visible, selected,
  disabled, loading, error, success.
- Add feedback to every destructive or async action.
- Verify sheet/tray open-close, escape/backdrop, focus return, and scroll lock.
- Verify long-press/menu alternatives for touch.
- Remove hover-only affordances.

Exit: keyboard and touch flows complete; no dead-end action.

### Stage 5 — Responsive, touch, safe areas (1–2 days)

- Test 360×800, 390×844, 768×1024, 1024×768, 1440×900.
- Verify 44px targets, safe-area insets, dock/sheet height, canvas resize.
- Eliminate horizontal overflow and clipped controls.
- Verify text scaling and long labels.

Exit: screenshot matrix passes; no horizontal scroll; no control under the notch.

### Stage 6 — Accessibility, WCAG 2.2 AA (1–2 days)

- Run axe or equivalent; fix Critical/Serious issues.
- Verify contrast, headings, landmarks, names, roles, states, live regions.
- Complete keyboard tab order and focus return.
- Verify reduced-motion behaviour.
- Verify canvas alternatives: selection is also reachable without tapping the
  stage.

Exit: no Critical/Serious automated findings; manual keyboard pass complete.

### Stage 7 — Performance and rendering quality (1–2 days)

- Remove the Tailwind CDN from `TILT.html` and the standalone build; ship
  compiled/self-hosted CSS.
- Confirm the editor is fully styled offline.
- Verify composer only mounts when needed; bloom is off in standard mode;
  outline reuses the composer.
- Bound shadow map cost by quality mode; verify DPR cap.
- Check bundle growth and PWA cache version.

Exit: no runtime CDN; offline styling works; quality modes stay within budget.

### Stage 8 — Visual QA and regression automation (1–2 days)

- Add `tests/test14-ui-quality.mjs` for static UI contracts:
  - shadow/quality storage keys and restore order;
  - no `transition: all` in touched CSS;
  - no `outline: none` without focus replacement;
  - required ARIA/focus markers;
  - no runtime CDN in the editor.
- Add screenshot baselines per surface/state.
- Add the new suite to `tests/run.mjs`.

Exit: 13 existing suites + new suite pass; visual diffs reviewed.

### Stage 9 — Release gate and handoff (0.5 day)

- Review the full branch diff against the Level 1 gate.
- Merge into `selection-save-reload` only after all gates pass.
- Document remaining Medium/Low findings for Level 2.
- Record rollback: revert the merge commit; storage migration is additive.
- Do not merge to `main` until the collaborator’s commit is reconciled.

Exit: signed checklist, green tests, known residual risks.

## 9. Shadow/reload acceptance matrix

| Scenario | Expected |
|---|---|
| Fresh install | Shadows on, key box off, quality standard |
| User turns shadows off, reloads | Shadows remain off; button says “Shadows off”; no cast shadows |
| User turns shadows on, reloads | Shadows remain on |
| Cinematic + shadows off, reloads | Bloom/cinematic stays on; shadows stay off |
| Key box on, reloads | Box is visible after scene/lights restore |
| Scene switch with key box on | Box remains visible and coverage counts recalculate |
| Storage denied | Defaults apply; no boot failure |
| Project switch | Global render preferences remain consistent |
| Standard + selection active | Outline works through composer; bloom stays off |

Decision needed: confirm render preferences are device-global, not per-project.
Recommended: global, matching the current quality key.

## 10. Quality gates

- Existing 13 suites plus new UI suite pass.
- No Critical/High findings open.
- Scorecard gate met on every P0/P1 surface; P2 surfaces scored and scheduled.
- Screenshots at 360/390/768/1440, light/dark, for every P0 surface.
- No runtime CDN in editor/standalone.
- No console errors in boot, reload, selection, shadow, and quality flows.
- No horizontal overflow at any tested width.
- Keyboard-only pass on home, editor shell, shelf, Look shelf, and tray.
- `git diff --check` clean.

## 11. Branch and team workflow

- `selection-save-reload` is the integration branch owned by this department.
- Cut `ui-quality-level-1` from it.
- One commit per stage or smaller coherent unit.
- PR back into `selection-save-reload`; no direct `main`.
- Reviewers: UI Quality owner plus the original branch owner.
- Every PR includes: scorecard delta, screenshots, test command, residual risk.
- Rollback is a revert of the stage merge; preference migration is additive.

## 12. Likely files touched

- `js/viewer.js` — render preferences, restore order, shadow/quality state.
- `js/panel.js` — Look shelf reads restored state; focus/state hardening.
- `js/app.js` — boot wiring, save/reload interactions, preference migration.
- `TILT.html` — shell tokens, focus, motion, CDN removal.
- `home/home.css` — tokens, `transition: all`, focus exceptions.
- `home/home.js` — empty/loading/error and action feedback.
- `studio/styles.css` — token bridge and focus consistency.
- `tools/build.mjs` — compiled CSS step if the CDN is removed.
- `TILT.standalone.html` — regenerated bundle.
- `tests/test10.mjs` / `tests/test14-ui-quality.mjs` — regression coverage.

## 13. Open decisions

1. Global vs per-project render preferences. **Resolved: global**, matching the
   existing `tilt-render-quality` key. One device, one Look shelf.
2. Remove Tailwind CDN in Level 1 or defer. **Resolved: removed in Level 1.**
   `css/tailwind.css` is compiled ahead of time (`tailwind.config.cjs` +
   `tools/tailwind.input.css`) and inlined into `TILT.standalone.html` by
   `tools/build.mjs`.
3. Browser automation availability. **No browser automation in this
   environment**, so Stage 8 shipped as static contract tests
   (`tests/test14-ui-quality.mjs`, 70+ checks). Screenshot/axe passes remain a
   manual Stage 9 item on a device.
4. Whether Level 1 includes the Flower Studio visual pass or only scores it and
   schedules fixes for Level 2. **Resolved: score now, fix only P0/P1 issues.**
   Studio got the reduced-motion path and touch-target sizes; token alignment is
   Level 2.

## 14. S Curve vs generic code audit (Stage 1 finding)

The frame pipeline is generic; the *SET drawings* and the *model catalog* are
S Curve. Everything was checked for leakage and the boundary was made explicit:

| Area | Was | Now |
|---|---|---|
| SET shape keys | Duplicated as `SET_SHAPE_KEYS` in `app.js` **and** `DOC_SET_SHAPE_KEYS` in `project.js` | One frozen list in `js/setShape.js`, imported by both |
| Applying a SET | `applySetParams()` clamped against the S Curve `PARAMS` import for *any* frame | Reads each model's own registered `m.params` schema; `PARAMS` is bound once at `registry.register()` |
| Selection comment | “break the S Curve into parts” | “break the frame into parts” (`js/selection.js`) |
| Light family comments | “S-curve rail”, “one S-curve route” | “the frame's rail”, “the frame's route” (`js/elements/light.js`) — the code was always anchor-driven |
| Model catalog | — | Correct home: `registry.js` / `o2tilt.js` keep `S Curve` as the display name; the on-disk id `o2tilt` is unchanged (`PLAN.md`) |
| Layout boards | — | Correct home: `layouts.js` genuinely describes S Curve SET geometry; left named and commented |
| Chips | Frame cycles `shape / colour / lights`, pillar `pillars`, light `lights`, flower `flowers`, decor `stage` | Unchanged and verified: each chip renders its own subject block in `panel.section()` |

Not a leak: `js/app.js` legacy id map (`o2tilt-classic → o2tilt`) is disk
migration and stays. Guarded by `tests/test14-ui-quality.mjs`.

## 15. Implemented on this branch

| Finding (§6) | Fix | Evidence |
|---|---|---|
| Shadows always boot on | `tilt-render-prefs-v1` object; `renderer.shadowMap.enabled` seeded from storage | `js/viewer.js:22-67, 180` |
| Key-box ephemeral | `setShadowBoxVisible(on, persist)` writes the same contract | `js/viewer.js:604, 628` |
| Quality/shadow inconsistent | One contract: `quality`, `shadows`, `shadowBox`; legacy `tilt-render-quality` migrated on read | `js/viewer.js:49-53` |
| Panel guessed state | Look shelf reads `shadowInfo()`; restore order quality → shadows → key box, `persist=false` on boot | `js/viewer.js:279-281` |
| Tailwind CDN | Compiled sheet + inlined standalone; build fails if unlinked | `TILT.html:10-15`, `tools/build.mjs` |
| three via unpkg | Vendored `vendor/three/` (14 files) + local import map in `TILT.html` and `models.html` | `tools/vendor-three.mjs` |
| `transition: all` | Explicit property list on `.chip` | `home/home.css` |
| Focus exceptions | `:where(...):focus-visible` ring, range `:focus-visible`, `.search:focus-within` (home + models) | `TILT.html`, `home/*.css` |
| Reduced motion missing in Studio | `@media (prefers-reduced-motion: reduce)` block | `studio/styles.css` |
| Offline shell | `sw.js` `tilt-v3` caches `/css/tailwind.css` | `sw.js` |

Residual (Level 2): `studio/index.html` still loads three 0.128 from jsdelivr
(separate major version, P2 surface); home/shell/studio token systems are still
separate; Flower Studio visual pass unscored here.
