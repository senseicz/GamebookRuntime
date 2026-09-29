# GamebookRuntime

A tiny, self-hostable **.NET 10** runtime for gamebook-style text adventures.

- Adventures live as **JSON files in the author's own GitHub repository**.
- The adventure is **downloaded at deployment time** into a local data directory; the runtime reads **local files only** — no GitHub calls while playing, instant startup, read-only for its whole lifetime.
- **Branch selection happens at deployment** (`ADVENTURE_REPO_BRANCH` in docker compose): point the runtime at `main` for the public release or a draft branch for testing.
- Dice-driven steps (d6 by default): the runtime throws the die, and the step says in its own text what the reader is attempting and on which values it succeeds.
- **Any language** — adventure text is untouched; the **whole UI** (buttons, prompts) is driven by the adventure's `labels`, so the reader sees a single consistent language.
- **Images** are embedded with markdown `![alt](url)` or a node-level `image` field.
- **Progress is saved in the browser's localStorage** — automatic "continue" plus multiple named saves per adventure.
- **Chapters** — long adventures can be split across multiple JSON files, merged at load time.
- **Dark & light theme** — follows the system preference by default, switchable in the UI.
- **Forward-only** — no undo: there is no back button; if the story allows backtracking, it's an explicit adventure option.
- Responsive single-page UI (phone / tablet / desktop), no build step, no frontend dependencies.
- **Utility rail** — save and theme sit in one always-visible corner, out of the story's way, and survive every screen change.

## Quick start (local dev)

```bash
# point the runtime at a directory containing adventure.json:
cd src/GamebookRuntime
dotnet run -- --Adventure:DataDir "../../adventures/sample"
```

Then open the printed URL (e.g. http://localhost:5000).

## Configuration

| Setting | Env var | Default | Meaning |
|---|---|---|---|
| `Adventure:DataDir` | `ADVENTURE__DATADIR` | `data` (`/data` in Docker) | Directory holding the downloaded adventure |
| `Adventure:FilePath` | `ADVENTURE__FILEPATH` | `adventure.json` | Main adventure JSON, relative to the data dir |
| `Debug:Enabled` | `DEBUG__ENABLED` | `false` | **Testers only** — show node keys and allow stepping back (see [Debug mode](#debug-mode-for-testers)) |

The entrypoint script (`docker-entrypoint.sh`) handles the deployment-time download:

| Env var (entrypoint) | Default | Meaning |
|---|---|---|
| `ADVENTURE_REPO` | — | `owner/name` of the adventure repo on GitHub |
| `ADVENTURE_REPO_BRANCH` | `main` | Branch, tag or commit to download |
| `ADVENTURE_FILE_PATH` | `adventure.json` | Path to the main JSON inside the repo |
| `ADVENTURE_TOKEN` | — | GitHub token (private repos / rate limits) |
| `ADVENTURE_FORCE_DOWNLOAD` | unset | Set to `1` to re-download even if the file exists |

The adventure is read from disk **once at startup** and held in memory; the running instance is immutable and has no write path.

## Adventure file format

```json
{
  "id": "unique-id",
  "title": "Adventure Title",
  "author": "Your Name",
  "language": "en",
  "start": "first-node-key",
  "chapters": ["chapters/part2.json", "chapters/part3.json"],
  "labels": { "cs": { "begin": "Začít dobrodružství", "save": "Uložit postup" } },
  "inventory": {
    "enabled": true,
    "items": {
      "lantern-oil": { "name": "Vial of lantern oil", "description": "One refill." }
    }
  },
  "nodes": {
    "first-node": {
      "text": "Story text. **Markdown subset** supported: # headings, **bold**, *italic*, [links](https://…), ![images](https://…).",
      "grant": ["lantern-oil"],
      "image": "https://example.com/cover.jpg",
      "options": [
        { "text": "Go left.", "next": "left-node" },
        { "text": "Use the oil.", "next": "ritual", "requires": ["lantern-oil"] },
        { "text": "Roll for it.", "dice": {
            "sides": 6,
            "outcomes": [
              { "from": 1, "to": 3, "next": "bad-luck" },
              { "from": 4, "to": 6, "next": "good-luck", "success": true }
            ]
          }
        }
      ]
    },
    "bad-luck": { "text": "…", "ending": false, "options": [ … ] },
    "the-end":  { "text": "The End.", "ending": true }
  }
}
```

### Chapters (long adventures)

Very long adventures can be split across multiple JSON files. In the main file, list them under `"chapters"` (paths relative to the main file). A chapter file contains only `nodes` (and optionally `labels`); all nodes are merged into one adventure at load time. Node keys must be unique across all files, and validation runs across the merged result. Chapters are read once at startup — the adventure is immutable while running.

### Prologue (`intro`, optional)

`"intro"` is prose shown on the title screen above the start button — for a long opening that
should not have to be the first node. It uses the same markdown subset and renders in the same
story panel as any other node, so the title page flows like the rest of the game — keep it short
enough to leave the start button visible without scrolling.
Omit it and the title screen is title + author + button, as before.

### Dice steps

An option with a `dice` block is resolved by a throw instead of going straight to `next`. Its `text` is shown like any other option's — *what the reader is attempting* — the runtime throws the die, and the outcome range the roll landed in decides the node.

The reader does **not** type in a value of their own: a dice step has one button, and the runtime rolls. Readers who like a physical die can still throw one next to the phone — they just have to live with the number they get, which is the point.

Mark the winning range with `"success": true` and the step shows the values it takes to succeed (`🎯 Succeeds on 4–6`, `successOn` in `labels`):

```jsonc
{
  "text": "Attempt to move the boulder.",
  "dice": {
    "sides": 6,
    "label": "🎲 Roll to shove it aside",   // optional; overrides the default button text
    "outcomes": [
      { "from": 1, "to": 3, "next": "boulder-fail" },
      { "from": 4, "to": 6, "next": "boulder-success", "success": true }
    ]
  }
}
```

Success ranges may be several (`1–2` and `5–6` → `Succeeds on 1–2, 5–6`); they are shown collapsed. An adventure that marks none simply does not advertise odds. The values themselves are never shown before the roll — only which of them succeed.

### UI language (`labels`)

The adventure file drives the runtime UI. Provide a `"labels"` object keyed by language tag (matching the adventure's `language`); any key you omit falls back to English. Available keys: `loading, intro, begin, restart, restartQ, continue, save, savePrompt, saves, load, delete, branch, reload, inventory, undiscovered, needsItems, needsAny, noOptions, back, step, theme, roll, successOn, yourRoll, theEnd, error`.

Rules enforced at startup (the runtime refuses to start on an invalid adventure):

- every `next` / dice outcome must point to an existing node (across all chapters),
- every non-ending node must have at least one option,
- dice outcomes must cover every value `1..sides`,
- node keys must be unique across the main file and all chapters,
- every `grant` / `remove` / `requires` / `requiresAny` / `lockedIfOwned` key must exist in the inventory catalog and are only allowed when `inventory.enabled` is true.

### Inventory (optional)

When the adventure defines `"inventory": { "enabled": true, "items": { … } }`, the player sees an always-visible inventory panel (fixed bottom bar on phones, sidebar on desktop) listing physical items **and knowledge**. Progress (including inventory) is part of autosave and named saves. Omit the `inventory` block entirely and no inventory UI appears.

| Where | Field | Meaning |
|---|---|---|
| node | `grant` | gained by **entering** the node — what lies here, what you find out |
| node | `remove` | lost on entering — dropped, taken away, used up |
| option | `grant` | gained by **choosing** the option — what you take away from doing it |
| option | `remove` | lost by choosing it — given away, spent, seized |
| option | `requires` | all listed keys must be owned |
| option | `requiresAny` | **at least one** of the listed keys must be owned |
| option | `lockedIfOwned` | the option is **not offered at all** when **any** of the listed keys is owned |

An option is usable when every `requires` key is owned *and* at least one `requiresAny` key is owned; both lists may be combined. Locked options (including [dice steps](#dice-steps)) show a lock and what is missing, and cannot be picked or rolled. When a move both gives and takes, the item leaves the bag first and the new one arrives after; a dice step gives its `grant` when the reader rolls, not per outcome — route outcomes to different nodes when an outcome should change the reward.

```jsonc
{
  "text": "Ask the man in the dark coat what the light was for.",
  "next": "shrine",
  "grant": ["keepers-words"],   // you learned something
  "remove": ["lantern-oil"],     // he kept the oil
  "requiresAny": ["lantern-oil", "spirits-riddle"]
}
```

#### Hub steps (`lockedIfOwned`)

`requires` answers *can the reader do this?* — it needs an item the reader has not got yet. `lockedIfOwned` answers the opposite: *is this step still on the table now that the reader has it?* On a hub node the reader can leave and return to, an acquisition step that stays enabled after the item is already in the bag is a bug: the reader buys a second vial of oil, or claims the same clue twice.

`lockedIfOwned` **hides** such an option (it is not shown greyed out with a lock — the branch simply is not offered), so the hub list gets shorter as the reader progresses. It combines with `requires`/`requiresAny` and applies to dice steps too.

```jsonc
// market square — a hub the reader can come back to from anywhere
{
  "text": "The stallholder is counting coins by lamplight.",
  "options": [
    // shown until the reader owns the oil; then gone
    { "text": "Buy the last vial of lantern oil.", "next": "market-bought",
      "grant": ["lantern-oil"], "lockedIfOwned": ["lantern-oil"] },
    { "text": "Climb the hill to the shrine.", "next": "shrine" }
  ]
}
```

Two rules for hub nodes: never let `lockedIfOwned` close **every** exit of a node (the runtime then shows a "nothing left to do here" note instead of a dead end — use `noOptions` in `labels` to word it), and do not use it to *consume* an item — that is what `remove` on the option is for.

See [`adventures/sample/adventure.json`](adventures/sample/adventure.json) for a complete example (*The Lost Lantern*, 12 nodes across two files, with a dice step, option rewards, a returnable hub node with `lockedIfOwned` and Czech UI labels).

---

## Debug mode (for testers)

Two things a reader cannot do in a normal game, enabled by one **server-side** setting:

- **Node keys on screen** — every step shows its key (`step: market`), and every option shows
  the key it leads to. A tester can report *"step `market` offers `buy-oil` after the shrine"*
  instead of guessing where they were.
- **Step back** — a `↩` button in the utility rail rewinds to the previous step: the node, the
  inventory as it was there, and the dice roll that got you there (rolls made on the reverted move
  are dropped). Progress rewinds as a whole; the adventure itself is untouched.

Enable it on the deployment, not in the adventure file:

```bash
# docker compose
DEBUG__ENABLED: "true"
# Render / Fly / any host
DEBUG__ENABLED=true
# local dev
dotnet run -- --Adventure:DataDir ../../adventures/sample --Debug:Enabled true
```

**Why a player cannot switch it on:** the flag is read from the runtime's own configuration at
startup, sent to the browser as `debug.enabled` in `/api/adventure`, and the page only *mirrors*
what the server said. It is not part of `adventure.json`, it is not read from `localStorage`, and
there is no UI switch — a production deployment that does not set `DEBUG__ENABLED` sends
`debug.enabled: false` and the key display and back button never exist in the page. (Anyone can
of course edit their own browser's DOM; that changes nothing on the server — the runtime is
read-only, and stepping back only rewinds the reader's own local progress.) The runtime logs a
warning at startup when debug mode is on, so it is visible in the deploy log if it was left on by
accident.

---

# Hosting your adventure — step by step

You host the runtime yourself; each author owns their adventure repo. The runtime never stores or serves anyone else's content.

## 1. Create the adventure repository

1. Create a new public GitHub repository, e.g. `your-name/my-adventure`.
2. Add `adventure.json` (format above — the easiest way is to copy and edit the sample, or use the **world-builder** and **adventure-builder** agent skills to design it).
3. Use branches to version your story: `main` = stable, `draft` = work in progress. Commit with normal git workflow.

## 2. Deploy the runtime

Pick **one** option. The deployment step downloads your adventure from GitHub into the container's data volume; the runtime itself never talks to GitHub.

### Option A — Docker Compose (recommended, works anywhere)

1. Push this runtime project to **your own GitHub repo** (you need your own copy to deploy).
2. Copy `compose.yml`, set your adventure repo:
   ```yaml
   environment:
     ADVENTURE_REPO: your-name/my-adventure
     ADVENTURE_REPO_BRANCH: main      # or "draft" while testing
   volumes:
     - adventure-data:/data
   ```
3. `docker compose up -d` — the entrypoint downloads the repo tarball into the volume, then starts the runtime.

### Option B — Render.com (free tier)

1. Connect your runtime repo as a **Web Service**. Render builds the Dockerfile automatically.
2. Environment variables:
   ```
   ADVENTURE_REPO      = your-name/my-adventure
   ADVENTURE_REPO_BRANCH = main
   ADVENTURE_FILE_PATH = adventure.json          # or docs/my-adventure/adventure.json
   ADVENTURE_TOKEN     = github_pat_…            # optional, see below
   ```
   `ADVENTURE_FILE_PATH` may be a subdirectory — chapter paths are resolved relative to it.
3. **Do not add a persistent disk.** Without one the filesystem is ephemeral, so every deploy and
   every cold start downloads the adventure fresh — that is what you want for updates anyway. A
   disk would pin a stale copy and silently keep serving old story text.
4. The entrypoint listens on `$PORT` when the host sets it (Render does), so the service needs no
   extra configuration; keep Render's generated port setting as it is.
5. `ADVENTURE_TOKEN` is optional for public repos, but the tarball endpoint is rate-limited per IP
   (60/hour anonymously) and Render's outbound IPs are shared — a fine-grained token with read-only
   `Contents` access on that one repo removes the risk of a failed cold start.

Deploys are free-tier shaped: the service sleeps after inactivity and the first request after that
re-downloads the adventure, so a cold start takes a few seconds longer.

### Option C — Fly.io

```bash
fly launch            # detects the Dockerfile
fly secrets set ADVENTURE_REPO=your-name/my-adventure ADVENTURE_REPO_BRANCH=main
fly deploy
```

### Option D — Azure Container Apps

```bash
az containerapp up --name my-gamebook --image <your-registry>/gamebookruntime \
  --env-vars ADVENTURE_REPO=your-name/my-adventure ADVENTURE_REPO_BRANCH=main
```

### Option E — Any Docker host (VPS, Raspberry Pi, home server)

```bash
docker build -t gamebook .
docker run -d -p 8080:8080 \
  -e ADVENTURE_REPO=your-name/my-adventure \
  -v adventure-data:/data \
  gamebook
```

## 3. Versioning with branches

Branch selection happens **at deployment**, not in the UI:

- public release: `ADVENTURE_REPO_BRANCH=main`
- testing a draft: set `ADVENTURE_REPO_BRANCH=draft` and redeploy (a second instance on another port/subdomain works well for parallel testing)
- tags and commit SHAs work too — pin a release with `ADVENTURE_REPO_BRANCH=v1.0`

## 4. Update the adventure later

Push new commits to GitHub, then redeploy/restart:

- With no persistent volume (Render without disk, most PaaS): every restart downloads fresh. Done.
- With a volume (compose/Fly): set `ADVENTURE_FORCE_DOWNLOAD=1` for one restart, or delete the volume contents. With `docker compose`, that's:
  ```bash
  ADVENTURE_FORCE_DOWNLOAD=1 docker compose up -d --force-recreate
  ```

There is deliberately **no API to modify the adventure** while running.

---

# Repo layout

```
src/GamebookRuntime/     .NET 10 runtime (API + static web UI)
adventures/sample/       Sample adventure (7 nodes, dice step)
docs/                    Adventure authoring guide
.agent/skills/world-builder/       Agent skill: world design
.agent/skills/adventure-builder/   Agent skill: adventure writing
Dockerfile
```
