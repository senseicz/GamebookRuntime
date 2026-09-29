---
name: adventure-builder
description: Guide the user through writing a gamebook adventure (story, hero, branching, dice steps) and produce a valid adventure.json for the GamebookRuntime. Run the world-builder skill first.
---

# Adventure Builder

You are guiding the user through turning their world (from `world.md`, produced by the **world-builder** skill) into a playable gamebook. Work interactively, phase by phase, confirming decisions as you go.

Final deliverables:
1. `adventure.json` — valid for GamebookRuntime (validated rules below).
2. Step-by-step instructions for the user to push it to their GitHub repo and host it.

## Process

### 1. Hero & stakes

- Who does the **reader** play? Second person ("you") works best for gamebooks.
- What does the hero want, what happens if they fail, why today?
- 2–4 **possible endings** (at least one failure ending, ideally more than one success flavor).

### 2. Story spine

Design the backbone before branches:

- **Opening**: drop the reader into action within the first paragraph of node 1.
- **Middle**: 2–3 meaningful branch points. Avoid dead "illusion of choice" branches that immediately merge — let choices change *what happens*, not just the scenery.
- **Endings**: every branch must reach an ending; no loops without escape.

### 3. Node map

Draft the map as a list before writing prose:

```
start → crossroads → forest / village
forest → river (DICE) → success / failure → shrine / bad-ending
```

Rules of thumb:
- First adventures: 10–30 nodes.
- Every non-ending node: 1–6 options.
- Dice steps: only where tension is high and both outcomes lead somewhere interesting. Outcomes must cover 1..6 (ranges may be 1–3 / 4–6).
- The dice can be rolled by the system or entered manually by the reader — write text that works for both ("roll a die: 1–3 … 4–6 …").

### 4. Write the prose

- 60–150 words per node. Punchy paragraphs. End each node on momentum (a question, a threat, a discovery).
- **Language**: write in the language chosen in world.md. The runtime is language-agnostic; no translation step needed.
- **Images**: add `image` (URL) on key nodes (start, endings) or `![alt](url)` inline. Host images anywhere publicly accessible (or in the same GitHub repo and reference the raw URL).
- Second person, present tense, sensory detail.

### 5. Assemble adventure.json

Schema:

```json
{
  "id": "unique-stable-id",
  "title": "…",
  "author": "…",
  "language": "en",
  "start": "start",
  "intro": "Optional prologue shown on the title screen (markdown).",
  "chapters": ["chapters/part2.json", "chapters/part3.json"],
  "labels": { "cs": { "begin": "Začít", "theEnd": "Konec", "save": "Uložit postup" } },
  "nodes": { … }
}
```

**Chapters (long adventures):** if the story is long, split nodes across several JSON files. The main file lists them under `"chapters"` (paths relative to the main file). Each chapter file contains only `nodes` (and optionally `labels`); all nodes are merged into one adventure when the runtime loads it. Node keys must be unique across all files. Chapters are merged once at startup — do not expect changes to be picked up while running. Validation runs across the *merged* adventure.

**Inventory (items & knowledge):** optional per adventure. Enable with:

```json
"inventory": {
  "enabled": true,
  "title": "Inventory",
  "hideUndiscovered": true,
  "items": {
    "lantern-oil": { "name": "Vial of lantern oil", "description": "One refill." },
    "keepers-words": { "name": "The keeper's words", "description": "A remembered promise." }
  }
}
```

- `items` covers **both physical items and knowledge** the player gains (rumours, riddles, names, skills). It is a *list* — steps may require several at once.
- **Node `grant` = what lies here or what you find out** (applied when the node is entered). **Option `grant` = what the player takes away from doing it** (applied when the option is chosen). Use node grants for discoveries, option grants for acquisitions — and prefer option grants, they keep the graph small.
- Both can be mirrored with `remove` (node/option): something dropped, given away, seized or used up. When a move both gives and takes, the item leaves the bag first.
- Options gate progress with `"requires": ["lantern-oil", …]` (all keys must be present) and `"requiresAny": ["a", "b"]` (at least one). A locked option shows a lock and what is missing; dice steps can be gated too.
- `"lockedIfOwned": ["lantern-oil"]` is the mirror image: the option is **hidden** (not locked) as soon as the reader owns any of those keys. Use it for **hub nodes the reader can leave and return to** — once the oil is in the bag, the "buy a vial of oil" step must not be offered again, or the reader buys a second one. It shortens the hub list as the run progresses. Never let it close every exit of a node, and do not use it to consume an item (that is `remove`).
- Several options of the same node can grant *different* items and lead to the same next node — that is how you write "he answers exactly one question you ask".
- The inventory panel is always visible while playing (fixed bar on phones, sidebar on wider screens); undiscovered entries show as `???` when `hideUndiscovered` is true.
- Every `grant`/`remove`/`requires`/`requiresAny`/`lockedIfOwned` key must exist in `items`, and those fields are only allowed when the inventory is enabled — the runtime validates this at startup and refuses to boot otherwise.
- A dice step grants its `grant` when the reader rolls, not per outcome. When an outcome should change the reward, route the outcomes to different nodes that grant it.
- Design guidance: grant items *just before or where* they matter; always provide an alternative path when a gated option could otherwise dead-end the player; keep the catalog small (5–15 entries) by merging related things into one entry.

**Prologue (optional):** `"intro"` is prose for the title screen, above the start button, in the same markdown subset as node text — use it for a long opening instead of spending the first node on it. It renders in the same story panel as any other node, so keep it short enough to leave the start button visible without scrolling. Omit it and the title screen stays title + author + button.

**UI language:** the adventure file also drives the runtime UI (buttons like "Begin", "Save progress", "Roll the dice"). Provide a `"labels"` object keyed by language tag; any key you omit falls back to English. Available keys:

`loading, intro, begin, restart, restartQ, continue, save, savePrompt, saves, load, delete, inventory, undiscovered, needsItems, needsAny, noOptions, back, step, theme, roll, useValue, yourRoll, theEnd, error` (`noOptions` is shown when `lockedIfOwned` happens to close every option of a node; `back` and `step` only appear in the runtime's debug mode, which the *operator* turns on with `DEBUG__ENABLED` — not something the adventure file can enable)

Hard requirements (the runtime validates these at startup and refuses to boot otherwise):
- `id`, `title`, `start` present; `start` exists in `nodes`.
- Every `next` and every dice outcome points to an existing node.
- Non-ending nodes have ≥ 1 option; ending nodes set `"ending": true` (options not needed).
- Dice outcomes cover every value 1..sides with no gaps.
- Every inventory key used in `grant`/`remove`/`requires`/`requiresAny`/`lockedIfOwned` exists in `items` (only when the inventory is enabled).
- UTF-8 throughout — any language works.

### 6. Publish (hand these steps to the user)

1. `git init` a new GitHub repo (or reuse the world repo) and commit `adventure.json` (+ `chapters/`, `world.md`, images). Branches version the story: `main` = stable, `draft` = work in progress.
2. Deploy the runtime pointing at the repo — the deployment step downloads the adventure; the runtime reads only local files (full guide in the runtime's README — docker compose / Render / Fly / Azure).
   - Choose the branch **at deployment**: `ADVENTURE_REPO_BRANCH=main` for release, `draft` for testers (redeploy to switch).
   - Updating later: push commits, then restart with `ADVENTURE_FORCE_DOWNLOAD=1` (or no persistent volume, where restart always re-downloads).
3. The runtime cannot modify the adventure while running — changing the story is always a commit + redeploy.
