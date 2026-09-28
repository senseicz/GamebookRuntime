/* GamebookRuntime frontend — vanilla JS, no build step, no dependencies. */
(() => {
  "use strict";

  const app = document.getElementById("app");
  const $ = (sel, root = document) => root.querySelector(sel);

  // ---------- state ----------
  const state = {
    meta: null,          // { id, title, author, language, start, labels, inventory }
    history: [],         // visited node keys — forward-only, used for saves
    diceLog: [],         // { node, value }
    inventory: [],       // granted item/knowledge keys (in discovery order)
    justGranted: [],     // keys granted on the current node, highlighted once
  };

  let customLabels = null;

  const inventoryDef = () => state.meta?.inventory ?? null;
  const inventoryEnabled = () => !!inventoryDef();

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
    saves.unshift({ name, node: state.history[state.history.length - 1], history: [...state.history], diceLog: [...state.diceLog], savedAt: Date.now() });
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

  // ---------- autosave (continue where you left off) ----------
  function saveProgress() {
    try {
      localStorage.setItem(`${baseKey()}:autosave`, JSON.stringify({ history: state.history, diceLog: state.diceLog, savedAt: Date.now() }));
    } catch { /* storage unavailable — play without saving */ }
  }
  function loadAutosave() {
    try {
      const p = JSON.parse(localStorage.getItem(`${baseKey()}:autosave`) ?? "null");
      return Array.isArray(p?.history) ? p : null;
    } catch { return null; }
  }

  function saveProgress() {
    try {
      localStorage.setItem(`${baseKey()}:autosave`, JSON.stringify({
        history: state.history, diceLog: state.diceLog, inventory: state.inventory, savedAt: Date.now(),
      }));
    } catch { /* storage unavailable — play without saving */ }
  }
  function loadAutosave() {
    try {
      const p = JSON.parse(localStorage.getItem(`${baseKey()}:autosave`) ?? "null");
      return Array.isArray(p?.history) ? p : null;
    } catch { return null; }
  }

  // ---------- inventory ----------
  // Items/knowledge are granted when a node is entered (node.grant) or when an
  // option is chosen (option.grant — what the player takes away from doing it),
  // and lost the same two ways (remove). Options are gated by requires (all of)
  // and requiresAny (at least one). Requires inventory to be enabled.

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

    // Prologue from the adventure file (markdown, same subset as node text). It scrolls inside
    // its own box, so a three-page introduction cannot push the start button off the screen.
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
        renderInventory();
        gotoNode(state.history[state.history.length - 1], { refetch: true });
      });
      tpl.querySelector(".start").prepend(cont);
      $(".btn-begin", tpl).classList.remove("btn-primary");
      $(".btn-begin", tpl).classList.add("btn-secondary");
      $(".btn-begin", tpl).textContent = t("restart");
      $(".btn-begin", tpl).addEventListener("click", () => { clearProgress(); state.history = []; state.diceLog = []; state.inventory = []; state.justGranted = []; renderInventory(); gotoNode(state.meta.start ?? "start"); });
    } else {
      $(".btn-begin", tpl).addEventListener("click", () => { state.history = []; state.diceLog = []; state.inventory = []; state.justGranted = []; renderInventory(); gotoNode(state.meta.start ?? "start"); });
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
      saveProgress();
      renderInventory();
      gotoNode(s.node, { refetch: true });
    });
    $(".btn-delete", item).textContent = t("delete");
    $(".btn-delete", item).addEventListener("click", () => { deleteSave(s.name); showStart(); });
    return item;
  }

  async function gotoNode(key, { refetch = false } = {}) {
    setLoading();
    try {
      const node = await api(`/api/node/${encodeURIComponent(key)}`);
      if (refetch) {
        // restoring: history/inventory already restored from the save
      } else {
        state.history.push(key);
      }
      removeItems(node.remove);
      grantItems(node.grant, { highlight: true });
      saveProgress();
      showNode(node);
    } catch (e) { showError(e); }
  }

  function showNode(node) {
    const tpl = $("#tpl-node").content.cloneNode(true);

    // top bar: save + theme. No back button — adventures are forward-only.
    const saveBtn = $(".btn-save", tpl);
    saveBtn.textContent = t("save");
    saveBtn.addEventListener("click", () => {
      const name = prompt(t("savePrompt"), `${state.meta.title} · ${state.history.length}`);
      if (!name) return;
      const saves = listSaves().filter((s) => s.name !== name);
      saves.unshift({ name, node: state.history[state.history.length - 1], history: [...state.history], diceLog: [...state.diceLog], inventory: [...state.inventory], savedAt: Date.now() });
      writeSaves(saves);
    });

    if (node.image) {
      const wrap = $(".node-image", tpl);
      wrap.classList.remove("hidden");
      $("img", wrap).src = node.image;
    }

    $(".node-text", tpl).innerHTML = renderMarkdown(node.text || "");

    const opts = $(".node-options", tpl);
    for (const opt of node.options ?? []) {
      const notes = lockNotes(opt);
      if (opt.dice) {
        opts.appendChild(buildDiceBlock(opt, notes));
      } else {
        const btn = $("#tpl-option").content.cloneNode(true).querySelector("button");
        if (notes.length) {
          // option is gated: player lacks required items/knowledge
          btn.disabled = true;
          btn.classList.add("btn-locked");
          btn.innerHTML = `🔒 ${esc(opt.text)} <span class="req-note">${esc(notes.join(" · "))}</span>`;
        } else {
          btn.textContent = opt.text;
          btn.addEventListener("click", () => { applyOption(opt); gotoNode(opt.next); });
        }
        opts.appendChild(btn);
      }
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
      renderInventory();
      showStart();
    } catch (e) { showError(e); }
  }

  boot();
})();
