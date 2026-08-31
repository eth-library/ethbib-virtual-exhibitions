# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions
as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

This project has **no test suite and no test runner**. "Verify" means exercising the running app,
not writing tests. Don't introduce a test framework unless explicitly asked — that would violate
rules 2 and 3.

Transform tasks into verifiable goals:
- "Fix the bug" → "Name the exact steps that reproduce it, fix, then walk those steps in the emulator"
- "Add a metadata field" → "Save it in `/admin`, reload, confirm it renders in the viewer"
- "Refactor X" → "List the views X touches, confirm each still behaves the same"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

When a change can only be verified by clicking through the UI, say so and name the exact steps to
click. Don't report "done" for something you could not check — report what you changed and what
still needs a look.

---

# Project Context

## Stack

Vanilla JS (ES modules), HTML, CSS. **No build step, no bundler, no `package.json`.** Files are
served as-is by Firebase Hosting. Never propose npm, a framework, or a build pipeline.

Backend is Firebase: Firestore (region `europe-west6`), Google Auth, Hosting.

| Entry point | Files |
|---|---|
| Public viewer `/` | `index.html`, `js/viewer.js`, `css/viewer.css` |
| Admin panel `/admin` | `admin.html`, `js/admin.js`, `css/admin.css` |
| Shared IIIF logic | `js/iiif-helper.js` |
| Firebase init | `js/firebase-config.js` |

`js/iiif-helper.js` is a **classic script**, not a module — it attaches `window.IIIFHelper` and must
stay loaded before `viewer.js`/`admin.js`. Everything else is `type="module"`.

External dependencies are pinned CDN URLs, not installed: Firebase SDK 11.3.1 (gstatic),
OpenSeadragon 5.0, Font Awesome 6.4.0 (both jsDelivr), Google Fonts. When bumping a version, bump it
in *every* file that references it — the Firebase SDK is pinned in `firebase-config.js`, the other
CDN URLs in `index.html` and `admin.html`.

## Running and verifying locally

```bash
firebase emulators:start
```
- App: `http://localhost:5000` · Emulator UI: `http://localhost:4000`
- Requires Java 11+ for the Firestore emulator.
- `js/firebase-config.js` auto-switches to the emulators on `localhost` / `127.0.0.1`. Nothing to
  toggle by hand.
- Test data (an `admins/<email>` doc, an exhibition, items) has to be created in the Emulator UI —
  it does not carry over from production.

## Deployment

`firebase deploy` publishes **straight to production** — there is no staging environment. Only run
it when explicitly asked, and say what it will push (hosting files, `firestore.rules`,
`firestore.indexes.json`).

## Firestore data model

| Collection | Notes |
|---|---|
| `exhibitions` | `title`, `subtitle`, `curator`, `institution`, `year`, `slug`, `description`, `accent_color`, `cover_image_url`, `is_published`, `created_at`, `updated_at` |
| `exhibit_items` | `exhibition_id`, `sort_order`, `iiif_url`, `iiif_type` (`image` \| `manifest`), metadata (`title`, `artist`, `date`, `medium`, `dimensions`, `collection`, …), region fields `region_x/y/w/h`, `region_pct`, `region_label`, and two free slots `custom_label_1/2` + `custom_value_1/2` |
| `settings/global` | Single doc. `theme: "light"` makes the viewer add `.light-mode` to `:root` |
| `admins/{email}` | Document ID **is** the email address. Rules forbid writes — managed in the Firebase Console only |

Two things that bite:
- **Adding a query means adding an index.** New `where`/`orderBy` combinations need an entry in
  `firestore.indexes.json`, or they fail only in production.
- **Saving an exhibition deletes orphans.** `saveExhibition()` in `js/admin.js` writes one batch that
  removes every `exhibit_items` doc no longer present in the DOM. Be careful when touching that path.

## Routing

`firebase.json` rewrites `**` to `index.html` with `cleanUrls`. Static files win first, so `/admin`
still resolves to `admin.html`. `viewer.js` reads the exhibition slug from `location.pathname` and
navigates via the History API — no page reloads, no hash routes.

## Conventions

- Firestore field names are `snake_case`; the JS around them is `camelCase`. Don't unify them.
- Code, comments, and identifiers in **English**. UI strings and user-facing messages in **German**.
- CSS is custom properties on `:root`, overridden by `:root.light-mode`. Add both variants for any
  new color — see the top of `css/viewer.css`.
- `admin.html` cache-busts its own assets with `?v=1.1`. Bump that when changing `admin.css`/`admin.js`.
- `js/viewer.js` sends Matomo virtual page views via `window._paq` on navigation. Keep that intact
  when touching the routing or slide logic.

## Repo notes

- **Hosting serves the working directory, not the repo.** `public: "."` means gitignored files are
  deployed too, and deleting a file locally only removes it from the live site on the next
  `firebase deploy --only hosting`. `.gitignore` says nothing about what is public.
- `firestore-debug.log` and `TECHNICAL-OVERVIEW.md` are gitignored — ignore them when reasoning
  about the project.