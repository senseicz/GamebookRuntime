/* GamebookRuntime frontend — vanilla JS, no build step, no dependencies. */
(() => {
  "use strict";

  const app = document.getElementById("app");
  const $ = (sel, root = app) => root.querySelector(sel);

  // ---------- state ----------
  const state = {
    meta: null,          // { id, title, author, language }
    branches: [],        // branch names, empty when selection disabled
    branch: null,        // chosen branch or null
    history: [],         // visited node keys
    diceLog: [],         // { node, value }
  };

  const storageKey = () => `gamebook:${state.meta?.id ?? "?"}:branch:${state.branch ?? "default"}`;

  function saveProgress() {
    try {
      localStorage.setItem(storageKey(), JSON.stringify({
        history: state.history,
        diceLog: state.diceLog,
        savedAt: Date.now(),
      }));
    } catch { /* storage unavailable — play without saving */ }
  }

  function loadProgress() {
    try {
      const raw = localStorage.getItem(storageKey());
      if (!raw) return null;
      const p = JSON.parse(raw);
      return Array.isArray(p.history) ? p : null;
    } catch { return null; }
  }

  function clearProgress() {
    try { localStorage.removeItem(storageKey()); } catch {}
  }

  // ---------- i18n (UI strings; adventure text is whatever the author wrote) ----------
  const labels = {
    en: {
      loading: "Loading…", begin: "Begin the adventure", continue: "Continue where you left off",
      restart: "Start over", branch: "Story version (branch)", reload: "Refresh branches",
      roll: "Roll the dice", useValue: "Use value", yourRoll: "You rolled", theEnd: "The End",
      restartQ: "Start over from the beginning?", back: "Back", error: "Something went wrong",
    },
  };
  function t(key) {
    // 1) adventure-provided labels for its language, 2) built-in english, 3) key itself
    const lang = state.meta?.language?.split("-")[0] ?? "en";
    const custom = state.meta && customLabels && customLabels[lang]?.[key];
    return custom ?? labels.en[key] ?? key;
  }
  let customLabels = null;

  // ---------- tiny markdown renderer ----------
  // Supports: #/##/### headings, paragraphs, **bold**, *italic*, [text](url), ![alt](url)
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  function renderMarkdown(src) {
    const blocks = src.trim().split(/\n{2,}/);
    const html = blocks.map((b) => {
      const line = b.trim();
      const img = /^\!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(line);
      if (img) return `<img src="${esc(img[2])}" alt="${esc(img[1])}" loading="lazy">`;
      const h = /^(#{1,3})\s+(.*)$/.exec(line);
      if (h) { const l = h[1].length; return `<h${l}>${inline(h[2])}</h${l}>`; }
      return `<p>${inline(line).replace(/\n/g, "<br>")}</p>`;
    });
    return html.join("\n");
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
    $(".title", tpl).textContent = state.meta.title;
    $(".author", tpl).textContent = state.meta.author ? "— " + state.meta.author : "";
    $(".btn-begin", tpl).textContent = state.meta.startLabel ?? t("begin");

    const hasProgress = !!loadProgress();
    if (hasProgress) {
      const cont = document.createElement("button");
      cont.className = "btn btn-primary btn-continue";
      cont.textContent = t("continue");
      cont.addEventListener("click", () => {
        const p = loadProgress();
        state.history = p.history; state.diceLog = p.diceLog ?? [];
        showNode(state.history[state.history.length - 1]);
      });
      tpl.querySelector(".start").prepend(cont);
      $(".btn-begin", tpl).classList.remove("btn-primary");
      $(".btn-begin", tpl).classList.add("btn-secondary");
      $(".btn-begin", tpl).textContent = t("restart");
      $(".btn-begin", tpl).addEventListener("click", () => { clearProgress(); state.history = []; state.diceLog = []; gotoNode(state.meta.start ?? "start"); });
    } else {
      $(".btn-begin", tpl).addEventListener("click", () => { state.history = []; state.diceLog = []; gotoNode(state.meta.start ?? "start"); });
    }

    if (state.branches.length > 1) {
      const picker = $(".branch-picker", tpl);
      picker.classList.remove("hidden");
      $(".branch-label", tpl).textContent = t("branch");
      $(".btn-branch-reload", tpl).textContent = t("reload");
      const sel = $("#branch", tpl);
      sel.innerHTML = "";
      for (const b of state.branches) {
        const opt = document.createElement("option");
        opt.value = b; opt.textContent = b;
        if (b === state.branch) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener("change", async () => {
        state.branch = sel.value || null;
        state.meta = await api(`/api/adventure${state.branch ? `?branch=${encodeURIComponent(state.branch)}` : ""}`);
        clearProgress(); state.history = [];
        showStart();
      });
      $(".btn-branch-reload", tpl).addEventListener("click", async () => {
        await initBranches(); showStart();
      });
    }

    app.replaceChildren(tpl);
  }

  async function gotoNode(key) {
    setLoading();
    try {
      const q = state.branch ? `?branch=${encodeURIComponent(state.branch)}` : "";
      const node = await api(`/api/node/${encodeURIComponent(key)}${q}`);
      state.history.push(key);
      saveProgress();
      showNode(node);
    } catch (e) { showError(e); }
  }

  function showNode(node) {
    const tpl = $("#tpl-node").content.cloneNode(true);
    const art = $(".node", tpl);
    art.dataset.key = node.key;

    // top bar: back + restart
    const bar = document.createElement("div");
    bar.className = "topbar";
    const backBtn = document.createElement("button");
    backBtn.className = "btn btn-secondary";
    backBtn.textContent = `← ${t("back")}`;
    backBtn.disabled = state.history.length <= 1;
    backBtn.addEventListener("click", () => {
      state.history.pop(); saveProgress();
      showNodeFromCache(state.history[state.history.length - 1]) ?? gotoNode(state.history[state.history.length - 1]);
    });
    const restartBtn = document.createElement("button");
    restartBtn.className = "btn btn-secondary";
    restartBtn.textContent = t("restart");
    restartBtn.addEventListener("click", () => {
      if (confirm(t("restartQ"))) { clearProgress(); state.history = []; state.diceLog = []; gotoNode(state.meta.start ?? "start"); }
    });
    bar.append(backBtn, restartBtn);
    art.prepend(bar);

    if (node.image) {
      const wrap = $(".node-image", tpl);
      wrap.classList.remove("hidden");
      $("img", wrap).src = node.image;
    }

    $(".node-text", tpl).innerHTML = renderMarkdown(node.text || "");

    const opts = $(".node-options", tpl);
    for (const opt of node.options ?? []) {
      if (opt.dice) {
        opts.appendChild(buildDiceBlock(opt));
      } else {
        const btn = $("#tpl-option").content.cloneNode(true).querySelector("button");
        btn.textContent = opt.text;
        btn.addEventListener("click", () => gotoNode(opt.next));
        opts.appendChild(btn);
      }
    }

    if (node.ending) {
      const end = $(".node-end", tpl);
      end.classList.remove("hidden");
      end.textContent = t("theEnd");
    }

    app.replaceChildren(tpl);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Rendering the previous node when going back requires refetch; simple approach:
  function showNodeFromCache() { return null; }

  function buildDiceBlock(opt) {
    const tpl = $("#tpl-dice").content.cloneNode(true);
    const block = $(".dice-block", tpl);
    const sides = opt.dice.sides ?? 6;
    const input = $(".dice-input", block);
    input.min = 1; input.max = sides; input.placeholder = `1–${sides}`;

    const resolve = (value) => {
      const outcome = opt.dice.outcomes.find((o) => value >= o.from && value <= o.to) ?? opt.dice.outcomes[0];
      state.diceLog.push({ node: state.history[state.history.length - 1], value });
      gotoNode(outcome.next);
    };

    const rollBtn = $(".btn-dice-roll", block);
    rollBtn.textContent = opt.dice.label ?? `🎲 ${t("roll")}`;
    rollBtn.addEventListener("click", async () => {
      rollBtn.disabled = true; input.disabled = true;
      const res = await api(`/api/roll?sides=${sides}${state.branch ? `&branch=${encodeURIComponent(state.branch)}` : ""}`);
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

  async function initBranches() {
    try {
      const info = await api("/api/branches");
      state.branches = info.allowed ? info.branches : [];
      if (state.branch && !state.branches.includes(state.branch)) state.branch = null;
      if (!state.branch && state.branches.length) state.branch = state.branches[0];
    } catch { state.branches = []; }
  }

  async function boot() {
    setLoading();
    try {
      await initBranches();
      const q = state.branch ? `?branch=${encodeURIComponent(state.branch)}` : "";
      state.meta = await api(`/api/adventure${q}`);
      customLabels = state.meta.labels ?? null;
      showStart();
    } catch (e) { showError(e); }
  }

  boot();
})();
