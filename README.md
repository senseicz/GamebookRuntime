# GamebookRuntime

A tiny, self-hostable **.NET 10** runtime for gamebook-style text adventures.

- Adventures live as **JSON files in the author's own GitHub repository**.
- The runtime loads the adventure **server-side at startup** — the repo name, path and any token never reach the browser, and the adventure is read-only while running.
- **Branch selection** can be enabled at deploy time (great for testing drafts on a `draft` branch).
- Dice-driven steps (d6 by default): the reader can let the server roll, or type in the result of their own physical die.
- **Any language** — adventure text is untouched; UI strings can be overridden per language via the adventure file.
- **Images** are embedded with markdown `![alt](url)` or a node-level `image` field.
- **Progress is saved in the browser's localStorage** — no server-side player accounts.
- Responsive single-page UI (phone / tablet / desktop), no build step, no frontend dependencies.

## Quick start (local dev)

```bash
cd src/GamebookRuntime
dotnet run -- --Adventure:GitHubRepo "owner/adventure-repo"
# or, for testing with a local file (dev only):
dotnet run -- --Adventure:GitHubRepo "local:../../adventures/sample/adventure.json"
```

Then open the printed URL (e.g. http://localhost:5000).

## Configuration

| Setting | Env var | Default | Meaning |
|---|---|---|---|
| `Adventure:GitHubRepo` | `ADVENTURE__GITHUB_REPO` | — | `owner/repo` (required in production) or `local:<path>` for dev |
| `Adventure:Branch` | `ADVENTURE__BRANCH` | `main` | Branch to load when selection is disabled |
| `Adventure:FilePath` | `ADVENTURE__FILE_PATH` | `adventure.json` | Path to the JSON inside the repo |
| `Adventure:AllowBranchSelection` | `ADVENTURE__ALLOWBRANCHSELECTION` | `false` | Show a branch picker on the start screen |
| `Adventure:Token` | `ADVENTURE__TOKEN` | — | GitHub token (only needed for private repos) |

The adventure is fetched **once at startup** and cached in memory; GitHub is not called again during play. The runtime cannot modify the source repo — it has no write path.

## Adventure file format

```json
{
  "id": "unique-id",
  "title": "Adventure Title",
  "author": "Your Name",
  "language": "en",
  "start": "first-node-key",
  "labels": { "cs": { "begin": "Začít dobrodružství" } },
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

Rules enforced at startup (the runtime refuses to start on an invalid adventure):

- every `next` / dice outcome must point to an existing node,
- every non-ending node must have at least one option,
- dice outcomes must cover every value `1..sides`.

See [`adventures/sample/adventure.json`](adventures/sample/adventure.json) for a complete example (*The Lost Lantern*, 7 nodes with a dice step).

---

# Hosting your adventure — step by step

You host the runtime yourself; each author owns their adventure repo. The runtime never stores or serves anyone else's content.

## 1. Create the adventure repository

1. Create a new public GitHub repository, e.g. `your-name/my-adventure`.
2. Add `adventure.json` (format above — the easiest way is to copy and edit the sample, or use the **world-builder** and **adventure-builder** agent skills to design it).
3. Use branches to version your story: `main` = stable, `draft` = work in progress. Commit with normal git workflow.

## 2. Deploy the runtime

Pick **one** option. All of them run the Docker image and have free or near-free tiers.

### Option A — Render.com (free tier, easiest)

1. Push this runtime project to **your own GitHub repo** (you need your own copy to deploy).
2. On [render.com](https://render.com) → **New → Web Service** → connect your runtime repo.
3. Render detects the `Dockerfile` automatically.
4. Add environment variables:
   - `ADVENTURE__GITHUB_REPO` = `your-name/my-adventure`
   - `ADVENTURE__ALLOW_BRANCH_SELECTION` = `false` (or `true` for testing)
5. Deploy. Done — share the URL.

### Option B — Fly.io (small free allowance)

```bash
fly launch --image <your-registry>/gamebookruntime   # or deploy from the Dockerfile
fly secrets set ADVENTURE__GITHUB_REPO=your-name/my-adventure
fly deploy
```

### Option C — Azure Container Apps (free grant per subscription)

```bash
az containerapp up --name my-gamebook --image mcr.example/gamebookruntime \
  --env-vars ADVENTURE__GITHUB_REPO=your-name/my-adventure
```

### Option D — Any Docker host (VPS, Raspberry Pi, home server)

```bash
docker build -t gamebook .
docker run -d -p 8080:8080 \
  -e ADVENTURE__GITHUB_REPO=your-name/my-adventure \
  gamebook
```

## 3. (Optional) Allow branch selection for testing

Set `ADVENTURE__ALLOW_BRANCH_SELECTION=true`. The start screen then shows a branch dropdown fed by the GitHub API. Turn it off for the public release.

## 4. Update the adventure later

Just push a new commit / restart the container — the runtime reloads the adventure at startup. There is deliberately **no API to modify the adventure** while running.

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
