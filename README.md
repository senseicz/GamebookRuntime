# GamebookRuntime

A tiny, self-hostable **.NET 10** runtime for gamebook-style text adventures.

- Adventures live as **JSON files in the author's own GitHub repository**.
- The adventure is **downloaded at deployment time** into a local data directory; the runtime reads **local files only** — no GitHub calls while playing, instant startup, read-only for its whole lifetime.
- **Branch selection happens at deployment** (`ADVENTURE_REPO_BRANCH` in docker compose): point the runtime at `main` for the public release or a draft branch for testing.
- Dice-driven steps (d6 by default): the reader can let the server roll, or type in the result of their own physical die.
- **Any language** — adventure text is untouched; the **whole UI** (buttons, prompts) is driven by the adventure's `labels`, so the reader sees a single consistent language.
- **Images** are embedded with markdown `![alt](url)` or a node-level `image` field.
- **Progress is saved in the browser's localStorage** — automatic "continue" plus multiple named saves per adventure.
- **Chapters** — long adventures can be split across multiple JSON files, merged at load time.
- **Dark & light theme** — follows the system preference by default, switchable in the UI.
- **Forward-only** — no undo: there is no back button; if the story allows backtracking, it's an explicit adventure option.
- Responsive single-page UI (phone / tablet / desktop), no build step, no frontend dependencies.

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
  "nodes": {
    "first-node": {
      "text": "Story text. **Markdown subset** supported: # headings, **bold**, *italic*, [links](https://…), ![images](https://…).",
      "image": "https://example.com/cover.jpg",
      "options": [
        { "text": "Go left.", "next": "left-node" },
        { "text": "Roll for it.", "dice": {
            "sides": 6,
            "outcomes": [
              { "from": 1, "to": 3, "next": "bad-luck" },
              { "from": 4, "to": 6, "next": "good-luck" }
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

### UI language (`labels`)

The adventure file drives the runtime UI. Provide a `"labels"` object keyed by language tag (matching the adventure's `language`); any key you omit falls back to English. Available keys: `loading, begin, restart, restartQ, continue, save, savePrompt, saves, load, delete, branch, reload, roll, useValue, yourRoll, theEnd, error`.

Rules enforced at startup (the runtime refuses to start on an invalid adventure):

- every `next` / dice outcome must point to an existing node (across all chapters),
- every non-ending node must have at least one option,
- dice outcomes must cover every value `1..sides`,
- node keys must be unique across the main file and all chapters.

See [`adventures/sample/adventure.json`](adventures/sample/adventure.json) for a complete example (*The Lost Lantern*, 8 nodes across two files, with a dice step and Czech UI labels).

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

1. Connect your runtime repo, Render builds the Dockerfile automatically.
2. Environment variables: `ADVENTURE_REPO=your-name/my-adventure`, `ADVENTURE_REPO_BRANCH=main`.
3. (Optional) add a persistent disk mounted at `/data` so restarts skip re-downloading. Without a disk, every deploy re-downloads — which is exactly what you want for updates anyway.

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
