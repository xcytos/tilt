# Plan: Stage auto-sizes to the structure + room realism upgrades

## 1. Bug: stage is a constant, structure is not — Round 9

### Diagnosis (verified in code)
- `js/scenes.js` hard-codes ONE stage for every indoor room:
  `STAGE_W=60, STAGE_D=16, STAGE_H=1.2`, walls at `WALL_X=30` (= stage edge), `WALL_Z=16`.
- One S Curve frame spans **gap + 24 ft** (`RAIL_LENGTH=12` per side). The SETs place frames at x=±15, so:
  - `cross-flow` at ry=±40° swings rail ends to z≈±8.7 → **past the stage's z=±8 edge** (panels/stands hang off the stage back/front).
  - `gap` slider at max 10 widens a frame to 34 ft → outer edge x≈31.7 → **past x=±30, poles hover 1.2 ft over the lower floor** ("structure flies").
  - `pitch`/`decline`/`pan` push rails and strips further in z.
  - Any user-moved or added frame (free placement, up to 20 elements) can leave the 60×16 box entirely.
- Garden/Terrace have no raised stage (ground at y=0) → no fly issue. Studio: untouched per user.

### Fix: derive the stage from the content's footprint
- **`js/scenes.js`**
  - Export pure `computeStageSize(footprint)` — no three.js math:
    - input `{minX,maxX,minZ,maxZ}` of all models,
    - margins 3.5 ft sides / 3 ft front-back, quantize to 2 ft,
    - clamps: W 44–140, D 18–60, H fixed 1.2,
    - returns `{w, d, h, wallX, wallZ, wallH}` with walls derived (`wallX=w/2+8`, `wallZ=max(16,d/2+8)`, `wallH` scales mildly with w).
  - `sceneRoom(group, size, colors…)` and the builders take `size` (default `DEFAULT_STAGE_SIZE`).
  - Decor (sconces, pilasters, chandelier, uplights) positioned as **fractions of wallX/wallZ** so a grown room keeps its fittings on the walls.
  - `SceneRig.build(id, size)` stores the size; studio still builds nothing.
- **`js/viewer.js`**
  - `stageFootprint()`: `Box3.setFromObject` over `this.models` (world matrices updated).
  - `setScene(id)` rebuilds with the fresh size; new `refreshStageSize()` — recompute, quantize-compare, rebuild scene only when the quantized size actually changed.
- **`js/app.js`**
  - Call `viewer.refreshStageSize()` from `refreshElementPlaces()` (debounced ~250 ms, non-studio only) → fires on placement edits, SET switch, load, add/remove.
- Camera: existing `frameCamera` already frames content bounds — no change.
- Saved projects: nothing persisted; size is always derived (no stale-state risk).

### Verification
- New harness `tests/.tmp/stage-size.mjs`: imports `computeStageSize` (vendored three like strip-profile); unit cases — default SET footprint → ≈60×16; cross-flow z-swing → deeper stage; gap-10 + wide custom frame → clamped 140×60; tiny single frame → mins; wallX always > stage edge.
- test8 contracts: `computeStageSize` export, `rig.build(` with size arg, `refreshStageSize` call site, Studio path unchanged.
- Full loop: parse-check → build → 10/10 → all harnesses. Client-only → hard-reload to inspect.

## 2. Room realism — Rounds 10–13 (Studio stays exactly as-is)

Grounded in real ballroom vocabulary (researched: coffered ceilings, crystal chandeliers, gilded moldings, marble columns, parquet/marble dance floors, cove lighting, draperies, sconces — Lucien's Manor, Grand Galvez, Waldorf, Chateau le Jardin). All procedural (geometry + canvas textures, no external assets), décor scales with the Round-9 size, dispose-safe, InstancedMesh for repeats, capped poly counts for phone boot.

- **R10 — Ballroom Stage** (biggest leap): coffered ceiling (beam grid + recessed panels + cove glow), 3 crystal chandeliers (ring + strand bulbs, center + flanks), gold molding bands + framed wall panels, fluted columns with capitals along the side walls, parquet dance-floor inset in front of the stage, richer sconces.
- **R11 — White Room Stage** → modern banquet hall: flat ceiling with recessed downlight grid + perimeter cove, painted wall-panel trim frames, drapery panels flanking the back wall, shallow center stage steps, keep white/red identity.
- **R12 — Garden at Night**: hedge rows flanking a stone path, flower-bed instances, path lanterns, moon disc + star field, distant tree-line silhouette ring, second festoon span.
- **R13 — Sunset Terrace**: full-width railing/glass balustrade, pergola beam row with hanging warm bulbs, planters, skyline silhouette band on the horizon, lounge-furniture silhouettes.
- Optional later (ask user): banquet tables + chairs in ballroom (realism vs clutter/perf).

## 3. Execution order — DONE (all committed)
1. **Commit A `0890af7`**: Round-8 neon-strip work.
2. **Commit B `9b40ce2`**: stage auto-size (R9).
3. **R10 `31292c3`** ballroom, **R11 `ca188e7`** white room, **R12 `1b00c22`** garden, **R13 `0bdc50b`** terrace — each verified (stage-size harness now builds all four rooms under a canvas stub; test8 contracts per room), full suite 10/10 green throughout.
4. Open for later: banquet tables + chairs in the ballroom (user's call).
