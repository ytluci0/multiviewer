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

// Auto grid toggle (packs tiles to fill right side)
let autoGridOn = true;

// Fixed grid sizing (broadcast-style)
const GRID = {
  PAD: 16,
  GAP_X: 16,
  GAP_Y: 16,
  TILE_W: 420,
  TILE_H: 240
};

// ---- SAFE ID GENERATOR ----
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
  const z = [...canvas.querySelectorAll(".tile")].map(t =>
    parseInt(t.style.zIndex || "0", 10)
  );
  const top = (z.length ? Math.max(...z) : 0) + 1;
  el.style.zIndex = String(top);
}

// ---- GRID PACKER (perfect rows/cols) ----
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

    // enforce fixed size for perfect grid
    t.style.width = TILE_W + "px";
    t.style.height = TILE_H + "px";

    t.style.left = (PAD + col * stepX) + "px";
    t.style.top  = (PAD + row * (TILE_H + GAP_Y)) + "px";
  });
}

// ---- CREATE TILE ----
function createTile(i, preset = null) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = preset?.id ?? makeId();

  // Fixed size by default
  node.style.width = (preset?.w ?? GRID.TILE_W) + "px";
  node.style.height = (preset?.h ?? GRID.TILE_H) + "px";

  // Z
  node.style.zIndex = preset?.z ?? String(1 + i);

  // Position: if preset exists use it, else temporary position (packer will fix anyway)
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
    video.src = "";
  }

  function play() {
    const url = urlInput.value.trim();
    if (!url) return;

    stop();

    // Safari native HLS
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      video.play().catch(() => {});
      return;
    }

    // Chrome/Edge via hls.js
    if (window.Hls && window.Hls.isSupported()) {
      hls = new Hls({
        maxBufferLength: 10,
        liveSyncDurationCount: 3,
        lowLatencyMode: true
      });

      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        console.warn("HLS error:", data);
      });

      return;
    }

    alert("This browser can't play HLS.");
  }

  playBtn.addEventListener("click", play);

  // Tile buttons
  node.addEventListener("click", () => bringToFront(node));

  node.querySelectorAll("button.mini").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const act = btn.dataset.action;

      if (act === "mute") video.muted = !video.muted;
      if (act === "reload") play();
      if (act === "remove") {
        stop();
        node.remove();
        packTilesToGrid();
      }
    });
  });

  // Drag
  let dragging = false, dx = 0, dy = 0;

  topbar.addEventListener("mousedown", e => {
    dragging = true;
    bringToFront(node);

    const rect = node.getBoundingClientRect();
    dx = e.clientX - rect.left;
    dy = e.clientY - rect.top;

    e.preventDefault();
  });

  window.addEventListener("mousemove", e => {
    if (!dragging) return;

    // user manual mode
    autoGridOn = false;
    updateAutoGridButton();

    const c = canvas.getBoundingClientRect();
    const x = snap(e.clientX - c.left - dx);
    const y = snap(e.clientY - c.top - dy);

    node.style.left = Math.max(0, x) + "px";
    node.style.top = Math.max(0, y) + "px";
  });

  window.addEventListener("mouseup", () => (dragging = false));

  // Resize (only in manual mode)
  let resizing = false, rw = 0, rh = 0, rx = 0, ry = 0;

  resizer.addEventListener("mousedown", e => {
    resizing = true;
    bringToFront(node);

    const rect = node.getBoundingClientRect();
    rw = rect.width;
    rh = rect.height;
    rx = e.clientX;
    ry = e.clientY;

    e.preventDefault();
    e.stopPropagation();
  });

  window.addEventListener("mousemove", e => {
    if (!resizing) return;

    // user manual mode
    autoGridOn = false;
    updateAutoGridButton();

    const dw = e.clientX - rx;
    const dh = e.clientY - ry;

    const w = snap(Math.max(240, rw + dw));
    const h = snap(Math.max(180, rh + dh));

    node.style.width = w + "px";
    node.style.height = h + "px";
  });

  window.addEventListener("mouseup", () => (resizing = false));

  canvas.appendChild(node);
  return node;
}

// ---- LAYOUT SAVE/LOAD (LocalStorage for GitHub Pages) ----
function currentLayout() {
  const tiles = [...canvas.querySelectorAll(".tile")].map(t => ({
    id: t.dataset.id,
    name: t.querySelector(".tileTitle").textContent,
    url: t.querySelector(".url").value.trim(),
    x: parseInt(t.style.left, 10),
    y: parseInt(t.style.top, 10),
    w: parseInt(t.style.width, 10),
    h: parseInt(t.style.height, 10),
    z: parseInt(t.style.zIndex || "1", 10)
  }));
  return { tiles, autoGridOn };
}

async function saveLayout() {
  const name = (layoutName.value.trim() || "default").toLowerCase();
  const payload = currentLayout();
  localStorage.setItem("multiviewer_layout_" + name, JSON.stringify(payload));
  alert("Saved layout: " + name);
}

async function loadLayout() {
  const name = (layoutName.value.trim() || "default").toLowerCase();
  const raw = localStorage.getItem("multiviewer_layout_" + name);

  canvas.innerHTML = "";

  if (!raw) {
    packTilesToGrid();
    updateAutoGridButton();
    return;
  }

  const data = JSON.parse(raw);
  autoGridOn = data.autoGridOn ?? true;

  (data.tiles || []).forEach((tile, i) => createTile(i, tile));

  packTilesToGrid();
  updateAutoGridButton();
}

// ---- UI ----
function setBoxes(n) {
  const existing = canvas.querySelectorAll(".tile").length;

  if (n > existing) {
    for (let i = existing; i < n; i++) createTile(i);
  } else if (n < existing) {
    const tiles = [...canvas.querySelectorAll(".tile")];
    for (let i = tiles.length - 1; i >= n; i--) tiles[i].remove();
  }

  packTilesToGrid();
}

applyBoxes.addEventListener("click", () => {
  const n = Math.max(1, Math.min(64, parseInt(boxCount.value || "4", 10)));
  setBoxes(n);
});

loadLayoutBtn.addEventListener("click", loadLayout);
saveLayoutBtn.addEventListener("click", saveLayout);

clearAllBtn.addEventListener("click", () => {
  if (confirm("Clear all tiles?")) canvas.innerHTML = "";
});

gridSnapToggle.addEventListener("click", () => {
  snapOn = !snapOn;
  gridSnapToggle.textContent = `Snap: ${snapOn ? "ON" : "OFF"}`;
});

// ---- Add Auto Grid toggle button dynamically ----
function addAutoGridButton() {
  const parent = gridSnapToggle.parentElement;

  const btn = document.createElement("button");
  btn.id = "autoGridToggle";
  btn.className = "ghost";
  btn.textContent = `AutoGrid: ${autoGridOn ? "ON" : "OFF"}`;

  btn.addEventListener("click", () => {
    autoGridOn = !autoGridOn;
    updateAutoGridButton();
    packTilesToGrid();
  });

  parent.insertBefore(btn, gridSnapToggle);
}

function updateAutoGridButton() {
  const b = document.getElementById("autoGridToggle");
  if (b) b.textContent = `AutoGrid: ${autoGridOn ? "ON" : "OFF"}`;
}

// Re-pack on resize if AutoGrid ON
window.addEventListener("resize", () => {
  packTilesToGrid();
});

// ---- INIT ----
addAutoGridButton();
setBoxes(parseInt(boxCount.value || "4", 10));
