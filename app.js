/* ============================
   MultiViewer app.js (API-backed short hash)
   - GitHub Pages URL: .../#suhib or .../#G
   - Saves/loads layout via API server
============================ */

const API_SERVER = "http://10.220.106.48:5000";

const canvas = document.getElementById("canvas");
const tpl = document.getElementById("tileTemplate");

const boxCount = document.getElementById("boxCount");
const applyBoxes = document.getElementById("applyBoxes");
const layoutName = document.getElementById("layoutName");
const loadLayoutBtn = document.getElementById("loadLayout");
const saveLayoutBtn = document.getElementById("saveLayout");
const clearAllBtn = document.getElementById("clearAll");
const gridSnapToggle = document.getElementById("gridSnapToggle");

let snapOn = true;
const SNAP = 20;

let autoGridOn = true;

// Default share name if no hash
let shareName = "default";

// debounce timers
let _saveTimer = null;
let _hashSuppress = false;

const GRID = {
  PAD: 16,
  GAP_X: 16,
  GAP_Y: 16,
  TILE_W: 420,
  TILE_H: 240,
};

function makeId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return (
    "id-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10)
  );
}

function snap(v) {
  return snapOn ? Math.round(v / SNAP) * SNAP : v;
}

function bringToFront(el) {
  const z = [...canvas.querySelectorAll(".tile")].map((t) =>
    parseInt(t.style.zIndex || "0", 10)
  );
  const top = (z.length ? Math.max(...z) : 0) + 1;
  el.style.zIndex = String(top);
}

function normalizeShareName(s) {
  const n = (s || "").trim();
  if (!n) return "default";
  // keep it simple for URLs/users
  return n.replace(/\s+/g, "-");
}

function setShareNameFromUI() {
  const n = normalizeShareName(layoutName.value);
  shareName = n;
}

function setShareNameFromHash() {
  const h = (location.hash || "").replace(/^#/, "").trim();
  if (h) {
    shareName = normalizeShareName(decodeURIComponent(h));
    layoutName.value = shareName;
  } else {
    setShareNameFromUI();
    // keep URL in sync
    history.replaceState(null, "", `#${encodeURIComponent(shareName)}`);
  }
}

/* ============================
   AutoGrid packer
============================ */
function packTilesToGrid() {
  if (!autoGridOn) return;

  const tiles = [...canvas.querySelectorAll(".tile")];
  if (!tiles.length) return;

  const c = canvas.getBoundingClientRect();
  const PAD = GRID.PAD;
  const GAP_X = GRID.GAP_X;
  const GAP_Y = GRID.GAP_Y;
  const TILE_W = GRID.TILE_W;
  const TILE_H = GRID.TILE_H;

  const usableW = Math.max(1, c.width - PAD * 2);
  const stepX = TILE_W + GAP_X;
  const cols = Math.max(1, Math.floor((usableW + GAP_X) / stepX));

  tiles.forEach((t, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);

    t.style.width = TILE_W + "px";
    t.style.height = TILE_H + "px";
    t.style.left = PAD + col * stepX + "px";
    t.style.top = PAD + row * (TILE_H + GAP_Y) + "px";
  });

  scheduleSave();
}

/* ============================
   Layout helpers
============================ */
function currentLayout() {
  const tiles = [...canvas.querySelectorAll(".tile")].map((t) => ({
    id: t.dataset.id,
    name: t.querySelector(".tileTitle").textContent,
    url: t.querySelector(".url").value.trim(),
    x: parseInt(t.style.left, 10) || 0,
    y: parseInt(t.style.top, 10) || 0,
    w: parseInt(t.style.width, 10) || GRID.TILE_W,
    h: parseInt(t.style.height, 10) || GRID.TILE_H,
    z: parseInt(t.style.zIndex || "1", 10),
  }));
  return { tiles, autoGridOn };
}

/* ============================
   API Save/Load
============================ */

function scheduleSave() {
  if (_hashSuppress) return;

  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    try {
      setShareNameFromUI(); // keep shareName consistent
      const payload = currentLayout();

      await fetch(`${API_SERVER}/layout/${encodeURIComponent(shareName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // keep URL short and stable
      history.replaceState(null, "", `#${encodeURIComponent(shareName)}`);
    } catch (e) {
      console.error("API save failed:", e);
    }
  }, 500);
}

async function loadFromHashIfPresent() {
  const name = (location.hash || "").replace(/^#/, "").trim();
  if (!name) return false;

  shareName = normalizeShareName(decodeURIComponent(name));
  layoutName.value = shareName;

  try {
    const res = await fetch(
      `${API_SERVER}/layout/${encodeURIComponent(shareName)}`
    );
    if (!res.ok) return false;

    const data = await res.json();
    const layout = data.layout;

    autoGridOn = layout.autoGridOn ?? true;

    _hashSuppress = true;
    canvas.innerHTML = "";

    (layout.tiles || []).forEach((t, i) => createTile(i, t));

    packTilesToGrid();
    updateAutoGridButton();

    _hashSuppress = false;

    // keep URL short
    history.replaceState(null, "", `#${encodeURIComponent(shareName)}`);
    return true;
  } catch (e) {
    console.error("API load failed:", e);
    return false;
  }
}

/* ============================
   UI buttons: Save/Load using API
============================ */

async function saveLayoutToAPI() {
  try {
    setShareNameFromUI();
    const payload = currentLayout();

    await fetch(`${API_SERVER}/layout/${encodeURIComponent(shareName)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    history.replaceState(null, "", `#${encodeURIComponent(shareName)}`);
    alert(`Saved to server as: ${shareName}`);
  } catch (e) {
    alert("Save failed. Check console.");
    console.error(e);
  }
}

async function loadLayoutFromAPI() {
  setShareNameFromUI();
  // set hash then load
  history.replaceState(null, "", `#${encodeURIComponent(shareName)}`);
  const ok = await loadFromHashIfPresent();
  if (!ok) {
    alert(`No layout found on server for: ${shareName}`);
  }
}

/* ============================
   Tile creation
============================ */

function createTile(i, preset = null) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = preset?.id ?? makeId();

  node.style.width = (preset?.w ?? GRID.TILE_W) + "px";
  node.style.height = (preset?.h ?? GRID.TILE_H) + "px";
  node.style.zIndex = String(preset?.z ?? (1 + i));

  node.style.left = (preset?.x ?? GRID.PAD) + "px";
  node.style.top = (preset?.y ?? GRID.PAD) + "px";

  const title = node.querySelector(".tileTitle");
  title.textContent = preset?.name ?? `Stream ${i + 1}`;

  const video = node.querySelector("video");
  const urlInput = node.querySelector(".url");
  const playBtn = node.querySelector(".play");
  const topbar = node.querySelector(".tileTop");
  const resizer = node.querySelector(".resizer");

  if (preset?.url) urlInput.value = preset.url;

  let hls = null;

  function stop() {
    if (hls) {
      hls.destroy();
      hls = null;
    }
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  function play() {
    const url = urlInput.value.trim();
    if (!url) return;

    // prevent mixed content when site is https
    if (location.protocol === "https:" && url.startsWith("http://")) {
      alert(
        "Blocked: this page is HTTPS but your stream is HTTP.\nUse https:// link or enable HTTPS on your HLS server."
      );
      return;
    }

    stop();

    // Safari native HLS
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      video.play().catch(() => {});
      scheduleSave();
      return;
    }

    // Chrome/Edge via hls.js
    if (window.Hls && window.Hls.isSupported()) {
      hls = new Hls({
        maxBufferLength: 10,
        liveSyncDurationCount: 3,
        lowLatencyMode: true,
      });

      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
        scheduleSave();
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        console.warn("HLS error:", data);
      });

      return;
    }

    alert("This browser can't play HLS.");
  }

  playBtn.addEventListener("click", () => {
    setShareNameFromUI();
    play();
  });

  // update save when typing url
  urlInput.addEventListener("input", () => {
    setShareNameFromUI();
    scheduleSave();
  });

  node.addEventListener("click", () => bringToFront(node));

  node.querySelectorAll("button.mini").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const act = btn.dataset.action;

      if (act === "mute") {
        video.muted = !video.muted;
        scheduleSave();
      }
      if (act === "reload") {
        setShareNameFromUI();
        play();
      }
      if (act === "remove") {
        stop();
        node.remove();
        packTilesToGrid();
        scheduleSave();
      }
    });
  });

  // Drag
  let dragging = false,
    dx = 0,
    dy = 0;

  topbar.addEventListener("mousedown", (e) => {
    dragging = true;
    bringToFront(node);

    const rect = node.getBoundingClientRect();
    dx = e.clientX - rect.left;
    dy = e.clientY - rect.top;

    autoGridOn = false;
    updateAutoGridButton();
    setShareNameFromUI();

    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;

    const c = canvas.getBoundingClientRect();
    const x = snap(e.clientX - c.left - dx);
    const y = snap(e.clientY - c.top - dy);

    node.style.left = Math.max(0, x) + "px";
    node.style.top = Math.max(0, y) + "px";

    scheduleSave();
  });

  window.addEventListener("mouseup", () => (dragging = false));

  // Resize
  let resizing = false,
    rw = 0,
    rh = 0,
    rx = 0,
    ry = 0;

  resizer.addEventListener("mousedown", (e) => {
    resizing = true;
    bringToFront(node);

    const rect = node.getBoundingClientRect();
    rw = rect.width;
    rh = rect.height;
    rx = e.clientX;
    ry = e.clientY;

    autoGridOn = false;
    updateAutoGridButton();
    setShareNameFromUI();

    e.preventDefault();
    e.stopPropagation();
  });

  window.addEventListener("mousemove", (e) => {
    if (!resizing) return;

    const dw = e.clientX - rx;
    const dh = e.clientY - ry;

    const w = snap(Math.max(240, rw + dw));
    const h = snap(Math.max(180, rh + dh));

    node.style.width = w + "px";
    node.style.height = h + "px";

    scheduleSave();
  });

  window.addEventListener("mouseup", () => (resizing = false));

  canvas.appendChild(node);
  return node;
}

/* ============================
   Boxes logic
============================ */

function setBoxes(n) {
  const existing = canvas.querySelectorAll(".tile").length;

  if (n > existing) {
    for (let i = existing; i < n; i++) createTile(i);
  } else if (n < existing) {
    const tiles = [...canvas.querySelectorAll(".tile")];
    for (let i = tiles.length - 1; i >= n; i--) tiles[i].remove();
  }

  packTilesToGrid();
  scheduleSave();
}

/* ============================
   AutoGrid toggle
============================ */
function addAutoGridButton() {
  const parent = gridSnapToggle.parentElement;
  const btn = document.createElement("button");
  btn.id = "autoGridToggle";
  btn.textContent = `AutoGrid: ${autoGridOn ? "ON" : "OFF"}`;

  btn.addEventListener("click", () => {
    autoGridOn = !autoGridOn;
    updateAutoGridButton();
    packTilesToGrid();
    scheduleSave();
  });

  parent.insertBefore(btn, gridSnapToggle);
}

function updateAutoGridButton() {
  const b = document.getElementById("autoGridToggle");
  if (b) b.textContent = `AutoGrid: ${autoGridOn ? "ON" : "OFF"}`;
}

/* ============================
   UI events
============================ */

applyBoxes.addEventListener("click", () => {
  const n = Math.max(1, Math.min(64, parseInt(boxCount.value || "4", 10)));
  setShareNameFromUI();
  setBoxes(n);
});

loadLayoutBtn.addEventListener("click", loadLayoutFromAPI);
saveLayoutBtn.addEventListener("click", saveLayoutToAPI);

clearAllBtn.addEventListener("click", () => {
  if (confirm("Clear all tiles?")) {
    canvas.innerHTML = "";
    scheduleSave();
  }
});

gridSnapToggle.addEventListener("click", () => {
  snapOn = !snapOn;
  gridSnapToggle.textContent = `Snap: ${snapOn ? "ON" : "OFF"}`;
  scheduleSave();
});

layoutName.addEventListener("input", () => {
  setShareNameFromUI();
  // update hash but don't spam-save just from typing name
  history.replaceState(null, "", `#${encodeURIComponent(shareName)}`);
});

window.addEventListener("resize", () => packTilesToGrid());

/* ============================
   INIT
============================ */

addAutoGridButton();
updateAutoGridButton();

// 1) prefer hash name
setShareNameFromHash();

// 2) try load from API if hash exists
(async () => {
  const loaded = await loadFromHashIfPresent();

  if (!loaded) {
    // default initial tiles
    const n = Math.max(1, Math.min(64, parseInt(boxCount.value || "4", 10)));
    setBoxes(n);
    // keep hash short
    history.replaceState(null, "", `#${encodeURIComponent(shareName)}`);
    scheduleSave();
  }
})();
