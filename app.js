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

// ---- GRID PACKER (fills to the right) ----
function packTilesToGrid() {
  if (!autoGridOn) return;

  const tiles = [...canvas.querySelectorAll(".tile")];
  if (!tiles.length) return;

  const c = canvas.getBoundingClientRect();

  const PAD = 20;
  const GAP_X = 20;
  const GAP_Y = 20;

  // Use first tile size as base grid unit (works even if resized; still packs nicely)
  const baseW = parseInt(tiles[0].style.width || "420", 10);
  const baseH = parseInt(tiles[0].style.height || "260", 10);

  const usableW = Math.max(1, c.width - PAD * 2);
  const stepX = baseW + GAP_X;
  const cols = Math.max(1, Math.floor((usableW + GAP_X) / stepX));

  tiles.forEach((t, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    t.style.left = (PAD + col * stepX) + "px";
    t.style.top  = (PAD + row * (baseH + GAP_Y)) + "px";
  });
}

// ---- CREATE TILE ----
function createTile(i, preset = null) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = preset?.id ?? makeId();

  // Default size
  node.style.width = (preset?.w ?? 420) + "px";
  node.style.height = (preset?.h ?? 260) + "px";

  // Default Z
  node.style.zIndex = preset?.z ?? String(1 + i);

  // Default position: dynamic columns based on canvas width
  const PAD = 20;
  const GAP_X = 20;
  const GAP_Y = 20;

  const tileW = preset?.w ?? 420;
  const tileH = preset?.h ?? 260;

  const c = canvas.getBoundingClientRect();
  const usableW = Math.max(1, c.width - PAD * 2);
  const stepX = tileW + GAP_X;
  const cols = Math.max(1, Math.floor((usableW + GAP_X) / stepX));

  const col = i % cols;
  const row = Math.floor(i / cols);

  node.style.left = (preset?.x ?? (PAD + col * stepX)) + "px";
  node.style.top  = (preset?.y ?? (PAD + row * (tileH + GAP_Y))) + "px";

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
  let dragging = false,
    dx = 0,
    dy = 0;

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

    autoGridOn = false; // user started manual layout

    const c = canvas.getBoundingClientRect();
    const x = snap(e.clientX - c.left - dx);
    const y = snap(e.clientY - c.top - dy);

    node.style.left = Math.max(0, x) + "px";
    node.style.top = Math.max(0, y) + "px";
  });

  window.addEventListener("mouseup", () => (dragging = false));

  // Resize
  let resizing = false,
    rw = 0,
    rh = 0,
    rx = 0,
    ry = 0;

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

    autoGridOn = false; // user started manual layout

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

// ---- LAYOUT SAVE/LOAD ----
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
  const name = layoutName.value.trim() || "default";
  await fetch(`/api/layout/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(currentLayout())
  });
}

async function loadLayout() {
  const name = layoutName.value.trim() || "default";

  const r = await fetch(`/api/layout/${encodeURIComponent(name)}`);
  const data = await r.json();

  canvas.innerHTML = "";

  autoGridOn = data.autoGridOn ?? true;

  (data.tiles || []).forEach((tile, i) => createTile(i, tile));

  // Pack only if autoGridOn
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
  if (confirm("Clear all tiles?")) {
    canvas.innerHTML = "";
  }
});

gridSnapToggle.addEventListener("click", () => {
  snapOn = !snapOn;
  gridSnapToggle.textContent = `Snap: ${snapOn ? "ON" : "OFF"}`;
});

// ---- Add Auto Grid toggle button dynamically ----
function addAutoGridButton() {
  // put it next to Snap button
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

// Re-pack on resize if autoGridOn
window.addEventListener("resize", () => {
  packTilesToGrid();
});

// ---- INIT ----
addAutoGridButton();
setBoxes(parseInt(boxCount.value || "4", 10));
