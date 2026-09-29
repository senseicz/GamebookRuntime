/* GamebookRuntime frontend — vanilla JS, no build step, no dependencies. */
(() => {
  "use strict";

  const app = document.getElementById("app");
  const $ = (sel, root = document) => root.querySelector(sel);

  // ---------- state ----------
  const state = {
    meta: null,          // { id, title, author, language, start, labels, inventory, debug }
    history: [],         // visited node keys — forward-only, used for saves
    trail: [],           // per-step snapshot { key, inventory, diceCount } — backs debug "step back"
    diceLog: [],         // { node, value }
    inventory: [],       // granted item/knowledge keys (in discovery order)
    justGranted: [],     // keys granted on the current node, highlighted once
  };

  let customLabels = null;

  const inventoryDef = () => state.meta?.inventory ?? null;
  const inventoryEnabled = () => !!inventoryDef();
  // Debug mode is decided by the server (Debug:Enabled) and only mirrored here:
  // node keys on screen, and "step back" instead of forward-only.
  const debugOn = () => !!state.meta?.debug?.enabled;

  const baseKey = () => `gamebook:${state.meta?.id ?? "?"}`;

  // ---------- theme ----------
  const THEME_KEY = "gamebook:theme";
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
    updateThemeIcons();
  }
  function updateThemeIcons() {
    // called after every render so buttons created later get the right icon
    document.querySelectorAll(".btn-theme").forEach((b) => (b.textContent = document.documentElement.dataset.theme === "light" ? "🌙" : "☀️"));
  }
  function initTheme() {
    let theme = null;
    try { theme = localStorage.getItem(THEME_KEY); } catch {}
    if (!theme) theme = window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn-theme");
      if (btn) applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
    });
  }

  // ---------- saves (multiple named saves per adventure) ----------
  const savesKey = () => `${baseKey()}:saves`;

  function listSaves() {
    try {
      const raw = localStorage.getItem(savesKey());
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }

  function writeSaves(saves) {
    try { localStorage.setItem(savesKey(), JSON.stringify(saves)); } catch {}
  }

  function saveGame(name) {
    const saves = listSaves().filter((s) => s.name !== name);
    saves.unshift({ name, node: state.history[state.history.length - 1], history: [...state.history], trail: trailSnapshot(), diceLog: [...state.diceLog], inventory: [...state.inventory], savedAt: Date.now() });
    writeSaves(saves);
  }

  function deleteSave(name) {
    try {
      localStorage.setItem(savesKey(), JSON.stringify(listSaves().filter((s) => s.name !== name)));
    } catch {}
  }

  function clearProgress() {
    try { localStorage.removeItem(`${baseKey()}:autosave`); } catch {}
  }

  // ---------- utility rail (save + theme + debug back) ----------
  // The rail is static markup outside #app, so the utilities stay put across
  // every screen render. It is wired once here; only its labels and the save /
  // back buttons' visibility are refreshed.
  function initUtilRail() {
    $("#btn-save")?.addEventListener("click", () => {
      const name = prompt(t("savePrompt"), `${state.meta?.title ?? ""} · ${state.history.length}`);
      if (!name) return;
      saveGame(name);
    });
    $("#btn-back")?.addEventListener("click", () => stepBack());
  }

  function updateUtilRail() {
    const save = $("#btn-save");
    const theme = $("#btn-theme");
    const back = $("#btn-back");
    if (save) {
      save.textContent = "💾";
      save.title = save.setAttribute("aria-label", t("save"));
      save.classList.toggle("hidden", state.history.length === 0);
    }
    if (back) {
      back.textContent = "↩";
      back.title = back.setAttribute("aria-label", t("back"));
      // only testers get it, and never on the very first step
      back.classList.toggle("hidden", !debugOn());
      back.disabled = state.trail.length < 2;
    }
    if (theme) {
      theme.title = theme.setAttribute("aria-label", t("theme"));
    }
    updateThemeIcons();
  }

  // ---------- autosave (continue where you left off) ----------
  function saveProgress() {
    try {
      localStorage.setItem(`${baseKey()}:autosave`, JSON.stringify({
        history: state.history, trail: trailSnapshot(), diceLog: state.diceLog, inventory: state.inventory, savedAt: Date.now(),
      }));
    } catch { /* storage unavailable — play without saving */ }
  }
  function loadAutosave() {
    try {
      const p = JSON.parse(localStorage.getItem(`${baseKey()}:autosave`) ?? "null");
      return Array.isArray(p?.history) ? p : null;
    } catch { return null; }
  }

  // ---------- step trail (debug mode) ----------
  // One snapshot per visited node: the node key, the inventory as it was there,
  // and how many dice rolls had been made. Stepping back rewinds to the previous
  // snapshot, so the bag rolls back too instead of keeping items the reader no
  // longer "has" in the story. Saves keep the trail, so it survives a reload;
  // a save written by an older runtime falls back to a single snapshot and
  // simply cannot step back.
  function trailSnapshot() {
    return state.trail.map((s) => ({ key: s.key, inventory: [...s.inventory], diceCount: s.diceCount }));
  }
  function restoreTrail(savedTrail, node, inventory) {
    const t = Array.isArray(savedTrail) && savedTrail.length ? savedTrail : null;
    state.trail = t
      ? t.map((s) => ({ key: s.key, inventory: [...(s.inventory ?? [])], diceCount: s.diceCount ?? 0 }))
      : [{ key: node, inventory: [...inventory], diceCount: 0 }];
  }

  // Debug only: undo the last move completely — the node we came from, the bag
  // as it was, and the roll (if any) that got us here. Progress is a plain
  // rewind of local state; the adventure itself is immutable on the server.
  async function stepBack() {
    if (!debugOn() || state.trail.length < 2) return;
    state.trail.pop();
    const prev = state.trail[state.trail.length - 1];
    state.history.pop();
    state.inventory = [...prev.inventory];
    state.diceLog.length = Math.min(state.diceLog.length, prev.diceCount);
    state.justGranted = [];
    await gotoNode(prev.key, { push: false });
  }

  // ---------- inventory ----------
  // Items/knowledge are granted when a node is entered (node.grant) or when an
  // option is chosen (option.grant — what the player takes away from doing it),
  // and lost the same two ways (remove). Options are gated by requires (all of)
  // and requiresAny (at least one). lockedIfOwned goes the other way: the option
  // is not offered at all once the player owns any of those keys — the hub step
  // you can no longer take. Requires inventory to be enabled.

  function grantItems(keys, { highlight = false } = {}) {
    if (!inventoryEnabled()) return;
    for (const key of keys ?? []) {
      if (!state.inventory.includes(key)) state.inventory.push(key);
      if (highlight && !state.justGranted.includes(key)) state.justGranted.push(key);
    }
    renderInventory();
  }

  function removeItems(keys) {
    if (!inventoryEnabled()) return;
    const gone = keys ?? [];
    if (gone.length) state.inventory = state.inventory.filter((k) => !gone.includes(k));
    renderInventory();
  }

  // Applies what an option gives and takes. Order matters and is fixed:
  // the item leaves the bag first, the new one arrives after.
  function applyOption(opt) {
    removeItems(opt.remove);
    grantItems(opt.grant, { highlight: true });
  }

  function itemName(key) {
    return inventoryDef().items?.[key]?.name ?? key;
  }

  function missingItems(requires) {
    return (requires ?? []).filter((k) => !state.inventory.includes(k));
  }

  // Why an option is locked: parts of the "Requires: …" note, empty when the
  // option is usable. requires = all keys needed, requiresAny = at least one.
  function lockNotes(opt) {
    if (!inventoryEnabled()) return [];
    const notes = [];
    const missing = missingItems(opt.requires);
    if (missing.length) notes.push(`${t("needsItems")}: ${missing.map(itemName).join(", ")}`);
    const any = opt.requiresAny ?? [];
    const missingAny = missingItems(any);
    if (any.length && missingAny.length === any.length)
      notes.push(`${t("needsAny")}: ${any.map(itemName).join(", ")}`);
    return notes;
  }

  // An option that is not offered at all: the player already owns one of its
  // lockedIfOwned keys. Hidden rather than locked — a hub must not advertise the
  // "buy the vial of oil" step to someone who is already carrying the oil.
  function isHidden(opt) {
    if (!inventoryEnabled()) return false;
    return (opt.lockedIfOwned ?? []).some((k) => state.inventory.includes(k));
  }

  function renderInventory() {
    const def = inventoryDef();
    let panel = document.getElementById("inv-panel");
    if (!inventoryEnabled()) {
      panel?.remove();
      document.body.classList.remove("has-inventory");
      return;
    }

    document.body.classList.add("has-inventory");
    if (!panel) {
      panel = document.createElement("aside");
      panel.id = "inv-panel";
      document.body.appendChild(panel);
    }

    const title = esc(def.title ?? t("inventory"));
    const entries = Object.keys(def.items ?? {}).map((key) => {
      const item = def.items[key] ?? {};
      const known = state.inventory.includes(key);
      if (!known && def.hideUndiscovered) {
        return `<li class="inv-item undiscovered" title="${esc(t("undiscovered"))}"><span class="inv-icon">❓</span><span class="inv-name">???</span></li>`;
      }
      const just = state.justGranted.includes(key) ? " just-granted" : "";
      const desc = item.description ? `<span class="inv-desc">${esc(item.description)}</span>` : "";
      const tip = item.description ? ` title="${esc(item.description)}"` : "";
      return `<li class="inv-item${just}"${tip}><span class="inv-icon">✦</span><span class="inv-name">${esc(item.name ?? key)}</span>${desc}</li>`;
    }).join("");

    panel.innerHTML = `<div class="inv-title">${title}</div><ul class="inv-list">${entries}</ul>`;
  }

  // ---------- i18n ----------
  // English defaults; adventure.json "labels" (per language) overrides any of these,
  // so the adventure file drives the language of the whole UI.
  const labels = {
    loading: "Loading…",
    begin: "Begin the adventure",
    restart: "Start over",
    restartQ: "Start over from the beginning?",
    continue: "Continue where you left off",
    save: "Save progress",
    savePrompt: "Name this save:",
    saves: "Saved games",
    load: "Load",
    delete: "Delete",
    noSaves: "No saved games yet.",
    inventory: "Inventory",
    undiscovered: "Not discovered yet",
    needsItems: "Requires",
    needsAny: "Requires any of",
    noOptions: "There is nothing left for you to do here.",
    back: "Step back (debug mode)",
    step: "step",
    theme: "Switch between light and dark",
    roll: "Roll the dice",
    useValue: "Use value",
    yourRoll: "You rolled",
    theEnd: "The End",
    error: "Something went wrong",
    intro: "Prologue",
  };
  function t(key) {
    const lang = state.meta?.language?.split("-")[0] ?? "en";
    return customLabels?.[lang]?.[key] ?? labels[key] ?? key;
  }

  // ---------- tiny markdown renderer ----------
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  function renderMarkdown(src) {
    return src.trim().split(/\n{2,}/).map((b) => {
      const line = b.trim();
      const img = /^\!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(line);
      if (img) return `<img src="${esc(img[2])}" alt="${esc(img[1])}" loading="lazy">`;
      const h = /^(#{1,3})\s+(.*)$/.exec(line);
      if (h) { const l = h[1].length; return `<h${l}>${inline(h[2])}</h${l}>`; }
      return `<p>${inline(line).replace(/\n/g, "<br>")}</p>`;
    }).join("\n");
  }
  function inline(s) {
    return esc(s)
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  }

  // ---------- rendering ----------
  function showStart() {
    const tpl = $("#tpl-start").content.cloneNode(true);
    renderStartInto(tpl);
    app.replaceChildren(tpl);
    updateThemeIcons();
  }

  function renderStartInto(tpl) {
    $(".title", tpl).textContent = state.meta.title;
    $(".author", tpl).textContent = state.meta.author ? "— " + state.meta.author : "";

    // Prologue from the adventure file (markdown, same subset and same styling as node text).
    const intro = $(".intro", tpl);
    if (state.meta.intro) {
      intro.innerHTML = renderMarkdown(state.meta.intro);
      intro.classList.remove("hidden");
      intro.setAttribute("aria-label", t("intro"));
    }

    const hasProgress = !!loadAutosave();
    $(".btn-begin", tpl).textContent = t("begin");
    if (hasProgress) {
      const cont = document.createElement("button");
      cont.className = "btn btn-primary btn-continue";
      cont.textContent = t("continue");
      cont.addEventListener("click", () => {
        const p = loadAutosave();
        state.history = p.history; state.diceLog = p.diceLog ?? [];
        state.inventory = p.inventory ?? []; state.justGranted = [];
        restoreTrail(p.trail, p.history[p.history.length - 1], state.inventory);
        renderInventory();
        gotoNode(state.history[state.history.length - 1], { push: false });
      });
      tpl.querySelector(".start").prepend(cont);
      $(".btn-begin", tpl).classList.remove("btn-primary");
      $(".btn-begin", tpl).classList.add("btn-secondary");
      $(".btn-begin", tpl).textContent = t("restart");
      $(".btn-begin", tpl).addEventListener("click", resetAndStart);
    } else {
      $(".btn-begin", tpl).addEventListener("click", resetAndStart);
    }

    // saved games
    const saves = listSaves();
    const box = $(".saves", tpl);
    if (saves.length) {
      box.classList.remove("hidden");
      $(".saves-title", tpl).textContent = t("saves");
      const list = $(".saves-list", tpl);
      list.replaceChildren(...saves.map((s) => saveItem(s)));
    }
  }

  function resetAndStart() {
    clearProgress();
    state.history = []; state.trail = []; state.diceLog = []; state.inventory = []; state.justGranted = [];
    renderInventory();
    gotoNode(state.meta.start ?? "start");
  }

  function saveItem(s) {
    const item = $("#tpl-save-item").content.cloneNode(true);
    $(".save-name", item).textContent = s.name;
    const date = new Date(s.savedAt).toLocaleString();
    $(".save-meta", item).textContent = `${s.node} · ${date}`;
    $(".btn-load", item).textContent = t("load");
    $(".btn-load", item).addEventListener("click", () => {
      state.history = [...s.history]; state.diceLog = s.diceLog ?? [];
      state.inventory = s.inventory ?? [];
      state.justGranted = [];
      restoreTrail(s.trail, s.node, state.inventory);
      saveProgress();
      renderInventory();
      gotoNode(s.node, { push: false });
    });
    $(".btn-delete", item).textContent = t("delete");
    $(".btn-delete", item).addEventListener("click", () => { deleteSave(s.name); showStart(); });
    return item;
  }

  // push: false when re-rendering a node we are already on (restoring a save,
  // or stepping back in debug mode) — history and the trail stay as they are.
  async function gotoNode(key, { push = true } = {}) {
    setLoading();
    try {
      const node = await api(`/api/node/${encodeURIComponent(key)}`);
      if (push) state.history.push(key);
      removeItems(node.remove);
      grantItems(node.grant, { highlight: push });
      if (push) state.trail.push({ key, inventory: [...state.inventory], diceCount: state.diceLog.length });
      saveProgress();
      updateUtilRail();
      showNode(node);
    } catch (e) { showError(e); }
  }

  function showNode(node) {
    const tpl = $("#tpl-node").content.cloneNode(true);

    // Debug mode: the node key on screen, so a tester can report "step
    // `market` says the wrong thing" instead of guessing where they were.
    if (debugOn()) {
      const chip = document.createElement("div");
      chip.className = "debug-step";
      chip.textContent = `${t("step")}: ${node.key}`;
      tpl.querySelector(".node").prepend(chip);
    }

    if (node.image) {
      const wrap = $(".node-image", tpl);
      wrap.classList.remove("hidden");
      $("img", wrap).src = node.image;
    }

    $(".node-text", tpl).innerHTML = renderMarkdown(node.text || "");

    const opts = $(".node-options", tpl);
    let shown = 0;
    for (const opt of node.options ?? []) {
      if (isHidden(opt)) continue;
      shown++;
      const notes = lockNotes(opt);
      if (opt.dice) {
        opts.appendChild(buildDiceBlock(opt, notes));
      } else {
        const btn = $("#tpl-option").content.cloneNode(true).querySelector("button");
        // where this option leads — the other half of a tester's report
        const target = debugOn() ? ` <span class="debug-target">${esc(opt.next)}</span>` : "";
        if (notes.length) {
          // option is gated: player lacks required items/knowledge
          btn.disabled = true;
          btn.classList.add("btn-locked");
          btn.innerHTML = `🔒 ${esc(opt.text)}${target} <span class="req-note">${esc(notes.join(" · "))}</span>`;
        } else {
          btn.innerHTML = `${esc(opt.text)}${target}`;
          btn.addEventListener("click", () => { applyOption(opt); gotoNode(opt.next); });
        }
        opts.appendChild(btn);
      }
    }

    // lockedIfOwned can take every option away; say so rather than leaving the
    // reader on a node with no way forward.
    if (shown === 0 && !node.ending) {
      const empty = document.createElement("div");
      empty.className = "req-note node-empty";
      empty.textContent = t("noOptions");
      opts.appendChild(empty);
    }

    if (node.ending) {
      const end = $(".node-end", tpl);
      end.classList.remove("hidden");
      end.textContent = t("theEnd");
    }

    app.replaceChildren(tpl);
    updateThemeIcons();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function buildDiceBlock(opt, notes = []) {
    const tpl = $("#tpl-dice").content.cloneNode(true);
    const block = $(".dice-block", tpl);
    const sides = opt.dice.sides ?? 6;
    const input = $(".dice-input", block);
    input.min = 1; input.max = sides; input.placeholder = `1–${sides}`;

    // A gated dice step shows what is missing and cannot be rolled.
    if (notes.length) {
      const note = document.createElement("div");
      note.className = "req-note";
      note.textContent = `🔒 ${notes.join(" · ")}`;
      block.prepend(note);
    }

    const resolve = (value) => {
      const outcome = opt.dice.outcomes.find((o) => value >= o.from && value <= o.to) ?? opt.dice.outcomes[0];
      state.diceLog.push({ node: state.history[state.history.length - 1], value });
      applyOption(opt);
      gotoNode(outcome.next);
    };

    const rollBtn = $(".btn-dice-roll", block);
    rollBtn.textContent = opt.dice.label ?? `🎲 ${t("roll")}`;
    rollBtn.addEventListener("click", async () => {
      rollBtn.disabled = true; input.disabled = true;
      const res = await api(`/api/roll?sides=${sides}`);
      const resBox = $(".dice-result", block);
      resBox.classList.remove("hidden");
      $(".dice-value", resBox).textContent = `${t("yourRoll")}: ${res.value}`;
      setTimeout(() => resolve(res.value), 700);
    });

    $(".btn-dice-use", block).textContent = t("useValue");
    $(".btn-dice-use", block).addEventListener("click", () => {
      const v = parseInt(input.value, 10);
      if (!Number.isInteger(v) || v < 1 || v > sides) { input.focus(); return; }
      resolve(v);
    });

    if (notes.length) {
      $(".btn-dice-roll", block).disabled = true;
      $(".btn-dice-use", block).disabled = true;
      input.disabled = true;
    }

    return block;
  }

  function setLoading() { app.replaceChildren(Object.assign(document.createElement("div"), { className: "loading", textContent: t("loading") })); }
  function showError(e) {
    console.error(e);
    app.replaceChildren(Object.assign(document.createElement("div"), {
      className: "loading", textContent: `${t("error")}: ${e.message ?? e}`,
    }));
  }

  // ---------- api ----------
  async function api(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function boot() {
    initTheme();
    setLoading();
    try {
      state.meta = await api("/api/adventure");
      customLabels = state.meta.labels ?? null;
      document.title = state.meta.title ?? "Gamebook";
      initUtilRail();
      updateUtilRail();
      renderInventory();
      showStart();
    } catch (e) { showError(e); }
  }

  boot();
})();
