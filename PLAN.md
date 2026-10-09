# TILT — full project system (Home + Editor + SQLite)

## Goal

Turn the single-project viewer into an app with named projects: **New, Open, Save,
Save As, Rename, Duplicate, Delete, Import, Export, Recent**, backed by a real
local database, with a **CapCut / Picsart-inspired mobile homepage** as the entry
point and a touch-friendly editor.

Nothing in the existing 7 suites should regress.

---

## Decisions taken (from your answers)

| Question | Decision |
|---|---|
| Database | **SQLite via built-in `node:sqlite`** (verified working on this box: `DatabaseSync`), wrapped in a **thin driver seam** so Postgres could slot in later = your option 3 built on option 1. No Postgres daemon on a phone. |
| Project contents | **One scene per project** — mode, mounted presets, every control value, camera view, theme, plus name/created/modified metadata. |
| Undo/redo | **Not in this pass.** Separate editing feature, not a project-file feature. |
| Pages | **Home + Editor only.** |
| Navigation | **Homepage is the entry** — `/` serves `index.html`; a card routes to `TILT.html?p=<id>`. |
| Naming | App is **"TILT"** in the UI/title (dropping "O2-… Viewer"); `o2tilt-*` ids stay as-is internally. **Confirm this reading.** |

---

## Architecture

### 1. Storage

```
data/o2tilt.db          # gitignored, created on first boot
tools/sqlite-driver.mjs # node:sqlite → { all, get, run }  (the only file Postgres would replace)
tools/store.mjs         # schema + CRUD + validation, takes a driver
```

Schema (`PRAGMA user_version = 1`):

```sql
CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  thumb      TEXT,               -- data:image/jpeg;base64,... (480px wide) or NULL
  doc        TEXT NOT NULL       -- scene JSON
);
CREATE INDEX IF NOT EXISTS projects_updated ON projects(updated_at DESC);
```

- **Positional `?` parameters only** — `node:sqlite`'s named-parameter prefix rules
  are a footgun; nothing here needs them.
- `mkdir data/` before open; close the DB on `SIGTERM` so `serve.sh stop` never
  leaves a corrupt file.
- `DB_PATH` env override so tests can point at a temp file and never touch the real one.
- Existing `project.json` **stays** as the "last session" mirror: it is the `file://`
  fallback and `tests/test8.mjs` asserts those endpoints. Named projects are additive.

### 2. HTTP API (`tools/api.mjs`, mounted by `tools/serve.mjs`)

| Route | Does |
|---|---|
| `GET    /api/projects` | list `{id,name,createdAt,updatedAt,hasThumb}` sorted by `updated_at` desc |
| `POST   /api/projects` | create `{name, doc?}` → 201 |
| `GET    /api/projects/:id` | full doc |
| `PATCH  /api/projects/:id` | `{name?, doc?}` → bumps `updated_at` |
| `DELETE /api/projects/:id` | 204 |
| `POST   /api/projects/:id/duplicate` | 201, "Copy of X" |
| `GET    /api/projects/:id/thumb` | `image/jpeg` or 404 |
| `PUT    /api/projects/:id/thumb` | store base64 thumb |
| `GET    /api/projects/:id/export` | `Content-Disposition: attachment; name.tilt.json` |
| `POST   /api/projects/import` | raw JSON body → 201 |

- Doc sanitising **reuses `js/project.js`** — it is pure and has no imports, so
  `serve.mjs` can import it directly: one schema, both sides.
- `API_MAX_BODY` (512 KB) for import; `MAX_BODY = 128 * 1024` on `project.json`
  must stay literally as-is (test8 asserts it).
- **`/data/` and `*.db` must be refused before static resolution** — otherwise the
  database is downloadable.
- Saves are full-document PATCHes → last write wins, no merge logic needed.

### 3. Project document (v2, backward compatible)

```json
{
  "version": 2,
  "name": "Untitled project",
  "mode": "single", "activeId": "o2tilt-classic",
  "mounted": [], "overlayIds": [],
  "presets": { "o2tilt-classic": { "gap": 2 } },
  "view": { "position": [0,8,-25], "target": [0,4,0], "theme": "light" }
}
```

`parseProject` accepts v1 (no `name`/`view`) unchanged — test8's shape assertions still hold.

### 4. Homepage (`index.html` + `home/home.js` + `home/home.css`)

Mobile-first, CapCut/Picsart flavoured, Tailwind CDN + own CSS, light/dark via the
same `darkMode:'class'` trick the editor uses.

- **Sticky top bar**: `TILT` wordmark, live search field, Import (file input).
- **"New project" hero tile** — first cell of the grid, large `+`, CapCut's new-project tile.
- **Sort chips**: Recent · Name · Oldest.
- **Project grid**: 2 columns on phones, 3–4 from `md`; 4:3 thumbnail (or gradient
  placeholder), name, relative time ("Edited 12m ago").
- **Card `⋮` / long-press → bottom action sheet**: Rename, Duplicate, Export, Delete.
- **FAB** appears once you scroll past the hero (Picsart), = New project.
- **Empty state**: "Create your first project".
- **`home/home.js` is a classic script** (no ES module) so `index.html` also opens
  from `file://`, where it shows a "serve this folder" launch card instead of failing.

`serve.mjs` already maps a directory to `index.html`, so `/` works with no routing change.

### 5. Editor (`TILT.html` + `js/app.js` + `js/viewer.js`)

**Top bar** (new, above the canvas):
`‹` back to home · project name (tap → rename sheet) · save-status pill
(`● Saved` / `● Saving…` / `● Offline`) · `⋮` overflow
(Save now, Duplicate, Rename, Export, Reset settings, Projects).

**Boot**: `?p=<id>` → `GET /api/projects/<id>`; 404 or no param → current session-mirror
path (so `TILT.standalone.html` and `file://` keep working unchanged).

**Autosave**: same 500 ms debounce, now `PATCH /api/projects/<id>` + session mirror.
Status pill reflects the last attempt. `pagehide` → `navigator.sendBeacon` so nothing
is lost on back-navigation. `saveTimer` is cleared before opening another project.

**Camera**: `viewer.getCameraState()` / `setCameraState()`; restore *after* the first
`frameScene()` or the framing wipes it.

**Thumbnail**: `viewer.captureThumbnail()` renders and reads the canvas **in the same
tick** (no `preserveDrawingBuffer`), drawing into a 480px 2D canvas first — a
full-res base64 JPEG in a TEXT column would bloat the DB. Fired ~5 s after a save.

**Mobile layout** — there are currently *no* media queries in `TILT.html`:

```css
@media (max-width: 640px) {
  .ui-panel { /* left overlay → bottom sheet */
    left: 0; right: 0; bottom: 0; top: auto; width: 100%;
    max-width: none; border-radius: 16px 16px 0 0;
    max-height: 60vh;
    padding-bottom: env(safe-area-inset-bottom);
  }
}
@media (pointer: coarse) { button, select { min-height: 44px; } }
```

Plus a grab-handle bar; the existing minimize button becomes the sheet chevron.

---

## Files

**New:** `index.html`, `home/home.js`, `home/home.css`, `tools/store.mjs`,
`tools/sqlite-driver.mjs`, `tools/api.mjs`, `tests/test9.mjs`, `tests/test10.mjs`,
`js/scenes.js`, `js/layouts.js`, `js/objects/pillar.js`, `data/` (gitignored).

**Changed:** `tools/serve.mjs`, `serve.sh`, `.gitignore`, `TILT.html`,
`js/app.js`, `js/viewer.js`, `js/project.js`, `tests/test8.mjs` (only if unavoidable),
`TILT.standalone.html` (regenerated).

**Deliberately not under `js/`:** `home/home.js`. `tools/build.mjs`'s `ORDER` is the
editor bundle and `tests/test6.mjs` asserts *every* file under `js/` is in `ORDER` —
the homepage needs no bundling, so it lives in `home/` and that invariant stays intact.

---

## Stages (one commit each, matching repo style)

1. **Store** — `tools/sqlite-driver.mjs` + `tools/store.mjs`, `.gitignore` gets `data/`,
   `DB_PATH` override, unit tests (create/list/get/update/delete/duplicate/ordering/validation,
   doc sanitising through `parseProject`, corrupt JSON rejected).
2. **API** — `tools/api.mjs` mounted in `serve.mjs`, `/data/` + `*.db` blocked,
   `WATCHED += index.html, home` (never `data/`), SIGTERM closes the DB, `serve.sh url() → /`.
   Integration tests against a spawned server on a free port.
3. **Homepage** — `index.html`, `home/home.js`, `home/home.css`; grid, search, sort,
   action sheets, empty state, import, file:// launch card.
4. **Editor integration** — `?p=` boot, top bar + save status + overflow, autosave → API,
   camera state save/restore, thumbnail capture, back navigation.
5. **Mobile + polish** — bottom-sheet CSS, 44px targets, grab handle, `test10.mjs`,
   `node tools/build.mjs`, full suite run.
6. **Scenes** — `js/scenes.js` (`SCENES`, `SceneRig`) gives every set a world to stand
   in: **Studio** (the grid void, unchanged), **White Room Stage** (the reference scene:
   white walls, wall panels, sconces, raised stage with a red mat), **Ballroom Stage**
   (carpet, pilasters, chandelier), **Garden at Night** (grass, gradient sky, fog, trees,
   a sagging bulb string), **Sunset Terrace** (plank deck, sunset sky, parapet). The
   project document gains `scene`, the panel a Scene picker, `viewer.setScene()` rebuilds
   the rig and re-points the three fixed lights, background and fog. The models never
   move: a raised stage drops the floor *below* y = 0 instead of lifting the frames.
7. **SET layouts** — `js/layouts.js` turns the boards' top-view diagrams into placements
   in feet (Classic Symmetry, Cross-Flow Draping, Divided Entrance, Depth Stagger,
   Diagonal Flow, Grand Entrance) and `js/objects/pillar.js` adds O1, the classical
   column. A SET (`layout` in the document, a picker above Scene) replaces the
   side-by-side row: frames fill the layout's frame slots in display order - one
   preset repeats into both slots, which is how a symmetric set gets built from a
   single model choice - and the pillars come with the set. `syncSet` rebuilds from
   the slots every time, `placeSet` puts every model on its spot; free placement is
   untouched.

---

## Verification (no browser here — node only)

- `tests/test9.mjs` — store unit + API integration (spawned server, `DB_PATH` in a
  temp dir, cleaned up in `finally`).
- `tests/test10.mjs` — homepage/editor source assertions: `index.html` exists and is
  served at `/`, `/data/x.db` → 403, `home/home.js` is a classic script, media queries
  present, `?p=` wiring present, `ORDER` unchanged, `.gitignore` covers `data/`,
  `WATCHED` includes `index.html` + `home` and not `data/`.
- `node --check` on every JS file; `node tools/build.mjs`; `node tests/run.mjs` →
  **10/10 suites**.
- Live server smoke test by hand: `bash serve.sh restart` → `http://localhost:8080/`.

## Gotchas already known

1. `data/` must never be in `WATCHED` (DB writes would reload the page forever).
2. `data/*.db` must never be statically served (leak).
3. `stripExports` rejects `export {}` / `export default` — `js/project.js` stays named-export.
4. test8 pins `MAX_BODY = 128 * 1024` and asserts `WATCHED` excludes `project.json` and `.`.
5. test6 pins `ORDER` vs everything under `js/`, and pins `TILT.standalone.html` freshness —
   rebuild after every `js/` + `TILT.html` edit.
6. Two windows (home + editor open) both PATCH → last write wins; the client always sends
   the whole doc, so there is no partial-merge bug.
7. `js/project.js` may only import modules with no dependencies of their own: the tests
   import it in plain Node, where `three` does not resolve. It checks `scene` against a
   shape regex and `layout` against `js/layouts.js`, which is pure data.
8. `js/layouts.js` must stay three-free for the same reason - it is the only thing the
   project parser pulls in.

## Needs your confirmation

- **Name**: I read "the naming of this is tilt only … no need … viewer" as *brand the app
  "TILT" and drop "O2-… Viewer" from user-facing strings* (model ids stay `o2tilt-*`).
  Say if you meant something else.
