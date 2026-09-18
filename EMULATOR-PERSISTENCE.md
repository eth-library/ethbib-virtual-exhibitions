# Firebase Emulator: Persisting Local Data

A step-by-step guide to making the Firebase Emulator Suite **save its state on shutdown and load it
again on the next start** — so you stop rebuilding test data from scratch every morning.

This concerns Firestore above all, but the same mechanism also covers Authentication.

**Audience:** a developer who can already run `firebase emulators:start` and deploy, but has not yet
set up local persistence.

**Time:** about 10 minutes, plus however long you spend creating test content.

---

## The short version

```bash
# Once: create the seed, then quit with Ctrl+C
firebase emulators:start --export-on-exit=./emulator-data

# Every time after that
firebase emulators:start --import=./emulator-data --export-on-exit
```

If that already makes sense to you, skip to [Step 5](#step-5--verify-the-round-trip) to verify it
works. Otherwise read on — there is one prerequisite that silently breaks everything.

---

## How it works

By default the emulators keep **everything in memory**. When the process ends, the database is gone.
That is deliberate: every test run starts from a known-empty state.

Two flags change this:

| Flag | Effect |
|---|---|
| `--export-on-exit[=DIR]` | On a **clean** shutdown, write the current state to `DIR` |
| `--import=DIR` | On startup, load a previously exported state from `DIR` |

Used together, the emulator behaves like a normal local database that remembers your data.

Passing `--export-on-exit` **without** a value reuses the `--import` directory, which is why the
everyday command needs the path only once.

### What is and is not saved

| Saved | Not saved |
|---|---|
| Firestore documents and collections | Firestore **indexes** (these come from `firestore.indexes.json`) |
| Auth accounts and config | Security rules (these come from `firestore.rules`) |
| | Hosting files (served live from disk) |

Rules and indexes are read from the project files on every start, so changing them only requires a
restart, never a re-seed.

---

## Step 0 — Prerequisite: Java 21 or newer

**This is where most setups fail, and the error message appears only at startup.**

`firebase-tools` 15.x refuses to run the Firestore emulator on anything older than Java 21:

```
Error: firebase-tools no longer supports Java version before 21.
Please install a JDK at version 21 or above to get a compatible runtime.
```

### The trap

The Firebase CLI resolves `java` from your **`PATH`**. It does **not** use `JAVA_HOME`.

On the machine this guide was written on, `JAVA_HOME` pointed at a perfectly good JDK 25 — but an
old JRE 8 sat earlier in the `PATH`, so the emulator refused to start. Having a modern JDK installed
is not enough; it has to be the one `PATH` finds first.

### Check what you have

```bash
java -version
```

You need `21` or higher. If you see `1.8.0_xxx`, `11.x` or `17.x`, fix it before continuing.

### Fix it

**Windows — current PowerShell session only** (good for a quick test):

```powershell
$env:PATH = "C:\Program Files\Eclipse Adoptium\jdk-25.0.2.10-hotspot\bin;$env:PATH"
java -version    # must now report 25
```

**Windows — permanently:** *System Properties → Advanced → Environment Variables*. In `Path`, move
the JDK's `bin` directory **above** any old JRE entry, or remove the old JRE entry entirely. Open a
new terminal afterwards — existing ones keep the old `PATH`.

**macOS / Linux — current shell:**

```bash
export PATH="$JAVA_HOME/bin:$PATH"
java -version
```

**macOS / Linux — permanently:** add that line to `~/.zshrc` or `~/.bashrc`, or manage versions with
`sdkman` / `jenv`.

No JDK at all? Install one from [Adoptium](https://adoptium.net) — choose a **JDK**, version 21 or
later. A JRE is not sufficient.

---

## Step 1 — First start, with export armed

From the project root:

```bash
firebase emulators:start --export-on-exit=./emulator-data
```

`./emulator-data` does not have to exist; the CLI creates it on exit.

Wait for:

```
✔  All emulators ready! It is now safe to connect your app.
```

together with a table of ports. For this project:

| Emulator | Address |
|---|---|
| Application (Hosting) | http://127.0.0.1:5000 |
| Emulator UI | http://127.0.0.1:4000 |
| Firestore | 127.0.0.1:8080 |
| Authentication | 127.0.0.1:9099 |
| Emulator Hub | 127.0.0.1:4400 |

> **An `Authentication Error: Your credentials are no longer valid` line during startup is harmless
> here.** That is the CLI's *cloud* login, unrelated to the emulators. It only matters for
> deployments — fix it with `firebase login --reauth` when you next deploy.

**Leave this terminal open.** It owns the emulator process, and you will need it in Step 3.

---

## Step 2 — Create your test data

The database is empty. Fill it now — this is the content you will be persisting.

Two ways, both fine:

- **Emulator UI** (http://127.0.0.1:4000 → *Firestore*) — quickest for single documents.
- **The application's own admin panel** (http://127.0.0.1:5000/admin) — slower, but produces
  correctly shaped documents and exercises real code.

For this project, a useful minimum is an `admins/<your-email>` document, one published exhibition,
and a handful of `exhibit_items`. The internal Confluence page *Virtual IIIF Exhibitions* has a
detailed seeding recipe including which edge cases are worth covering.

> The Auth emulator verifies nothing. Any email address works — but it must match the `admins`
> document ID **exactly**, because the security rules look the document up by that ID.

---

## Step 3 — Write the state to disk

Go back to the terminal running the emulators and press **`Ctrl+C`**.

You will see the emulators shut down, and the export being written.

### This is the part people get wrong

**Only a clean shutdown exports.** Verified behaviour:

| How you end it | Exports? |
|---|---|
| `Ctrl+C` in the terminal | **Yes** |
| Closing the terminal window | No |
| `Stop-Process` / `kill` / Task Manager | No |
| Rebooting, or a crash | No |

This was tested explicitly: after killing the process, every file in the export directory still
carried the timestamp of the previous export. Everything since then was silently lost.

So: get into the habit of `Ctrl+C`, and see [Manual snapshots](#manual-snapshots) for a safety net.

---

## Step 4 — Confirm the export exists

```bash
ls emulator-data
```

You should see exactly this structure:

```
emulator-data/
├── firebase-export-metadata.json
├── auth_export/
│   ├── accounts.json
│   └── config.json
└── firestore_export/
    ├── firestore_export.overall_export_metadata
    └── all_namespaces/
        └── all_kinds/
            ├── all_namespaces_all_kinds.export_metadata
            └── output-0
```

`firebase-export-metadata.json` records which emulator versions produced the export:

```json
{
  "version": "15.12.0",
  "firestore": { "version": "1.20.4", "path": "firestore_export", ... },
  "auth":      { "version": "15.12.0", "path": "auth_export" }
}
```

The `output-0` file is a binary Firestore export — do not try to edit it by hand. To change the
data, import it, edit through the UI or the app, and export again.

---

## Step 5 — Verify the round trip

Start again, this time importing:

```bash
firebase emulators:start --import=./emulator-data --export-on-exit
```

In the startup log you should see lines like:

```
i  firestore: Importing data from .../emulator-data/firestore_export/firestore_export.overall_export_metadata
i  auth: Importing config from .../emulator-data/auth_export/config.json
i  auth: Importing accounts from .../emulator-data/auth_export/accounts.json
```

Then confirm the data is really there — open http://127.0.0.1:4000/firestore, or check from the
command line without touching the browser:

**PowerShell**

```powershell
$base = "http://127.0.0.1:8080/v1/projects/ethbib-virtual-exhibitions/databases/(default)/documents"
Invoke-RestMethod -Uri "$base/exhibitions" -Headers @{ Authorization = "Bearer owner" }
```

**bash / curl**

```bash
curl -H "Authorization: Bearer owner" \
  "http://127.0.0.1:8080/v1/projects/ethbib-virtual-exhibitions/databases/(default)/documents/exhibitions"
```

The emulator accepts the literal token `owner` as full admin access — it performs no real
authentication. This is also the quickest way to script local checks.

From now on, this one command is your everyday start. Changes you make while working are carried
into the next session automatically, because `--export-on-exit` reuses the `--import` directory.

---

## Manual snapshots

You do not have to quit to save. With the emulators **running**, open a second terminal:

```bash
firebase emulators:export ./emulator-data --force
```

`--force` is required to overwrite an existing export directory; without it the command refuses.

Useful for:

- taking a checkpoint before a risky experiment,
- saving work when you are unsure the session will end cleanly,
- keeping several named states: `firebase emulators:export ./seed-minimal`, then start with
  `--import=./seed-minimal`.

Switching between named seeds is just a matter of which directory you pass to `--import`.

---

## Making it convenient

This project has no `package.json`, so there are no npm scripts to hang this off. Use a shell alias.

**PowerShell** — add to your profile (`notepad $PROFILE`):

```powershell
function fbe { firebase emulators:start --import=./emulator-data --export-on-exit }
```

**bash / zsh** — add to `~/.bashrc` or `~/.zshrc`:

```bash
alias fbe='firebase emulators:start --import=./emulator-data --export-on-exit'
```

---

## Keep the export out of Git

`emulator-data/` is listed in `.gitignore` and should stay there. It contains an email address as an
`admins` document ID and local Auth accounts — personal data that does not belong in a public
repository. Every developer creates their own seed once.

Also worth knowing for this project: Hosting is configured with `"public": "."`, so **everything in
the working directory gets deployed**, gitignored files included. `emulator-data/` is not currently
excluded from deployment — it is harmless (a binary blob with no secrets beyond a test email) but if
that bothers you, add it to the `hosting.ignore` array in `firebase.json`.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `no longer supports Java version before 21` | An old JRE is first on `PATH`. See [Step 0](#step-0--prerequisite-java-21-or-newer). `JAVA_HOME` is ignored |
| Emulator starts, but the database is empty | `--import` missing or pointing at the wrong path. The startup log names the file it imports — if there is no `Importing data from` line, it imported nothing |
| Yesterday's changes are gone | The process did not end with `Ctrl+C`. Nothing to recover; re-seed and use [manual snapshots](#manual-snapshots) in future |
| `Export directory exists and is not empty` | Add `--force` to `firebase emulators:export` |
| `Port 8080 is not open` / `already in use` | A previous emulator is still running. Find and end it, then check the port is free before restarting |
| `Authentication Error ... credentials are no longer valid` at startup | Unrelated to the emulators — that is the cloud login. Only fix it (`firebase login --reauth`) before deploying |
| Rules changes have no effect | Rules are read at startup. Restart the emulators; no re-seed needed |

---

## Verified environment

Every command and behaviour above was executed and confirmed on:

| | |
|---|---|
| OS | Windows 11 |
| firebase-tools | 15.12.0 |
| Firestore emulator | 1.20.4 |
| Java | OpenJDK 25.0.2 (JDK 8 on `PATH` reproduced the failure) |
| Project | `ethbib-virtual-exhibitions` |

The round trip was confirmed by writing a document, exporting, killing the emulator, restarting with
`--import`, and reading the document back unchanged.
