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
  "labels": { "cs": { "begin": "Začít", "theEnd": "Konec" } },
  "nodes": {
    "node-key": {
      "text": "Markdown: paragraphs, **bold**, *italic*, ## headings, ![alt](url) images",
      "image": "optional-image-url.jpg",
      "options": [
        { "text": "Choice label", "next": "other-node" },
        { "text": "Chance decides", "next": "fallback-node",
          "dice": { "sides": 6, "outcomes": [
            { "from": 1, "to": 3, "next": "failure" },
            { "from": 4, "to": 6, "next": "success" }
          ] } }
      ],
      "ending": false
    }
  }
}
```

Hard requirements (the runtime validates these at startup and refuses to boot otherwise):
- `id`, `title`, `start` present; `start` exists in `nodes`.
- Every `next` and every dice outcome points to an existing node.
- Non-ending nodes have ≥ 1 option; ending nodes set `"ending": true` (options not needed).
- Dice outcomes cover every value 1..sides with no gaps.
- UTF-8 throughout — any language works.

### 6. Publish (hand these steps to the user)

1. `git init` a new GitHub repo (or reuse the world repo) and commit `adventure.json` (plus `world.md`, images).
2. Deploy the runtime with their repo: `ADVENTURE__GITHUB_REPO=<owner>/<repo>` (full guide in the runtime's README — Render/Fly/Azure/Docker).
3. For testing drafts: work on a branch (e.g. `draft`) and set `ADVENTURE__ALLOW_BRANCH_SELECTION=true` at deployment so testers can pick the branch at start.
4. Reload = restart the container; the adventure loads fresh from GitHub at startup and cannot be edited through the runtime.
