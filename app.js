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

const GRID = {
  PAD: 16,
  GAP_X: 16,
  GAP_Y: 16,
  TILE_W: 420,
  TILE_H: 240
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
  const z = [...canvas.querySelectorAll(".tile")].map(t =>
    parseInt(t.style.zIndex || "0", 10)
  );
  const top = (z.length ? Math.max(...z) : 0) + 1;
  el.style.zIndex = String(top);
}

/* ---------------------------
   URL SHARE STATE (HASH)
   Format: #<name>=<base64url(json)>
   Example: #suhib-monitor=eyJ0aWxlcyI6...
--------------------------- */

let shareName = "suhib-monitor"; // default label in URL
let _hashUpdateTimer = null;
let _hashSuppress = false;

function base64UrlEncode(str) {
  // UTF-8 safe
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach(b => (bin += String.fromCharCode(b)));
  const b64 = btoa(bin);
  return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(b64url) {
  let b64 = b64url.replaceAll("-", "+").replaceAll("_", "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  const bytes = new Uint8Array([...bin].map(ch => ch.charCodeAt(0)));
  return new TextDecoder().decode(bytes);
}

function parseHashState() {
  // hash looks like: #name=data
  const h = (location.hash || "").replace(/^#/, "");
  if (!h) return null;

  const eq = h.indexOf("=");
  if (eq === -1) return null;

  const name = h.slice(0, eq).trim();
  const data = h.slice(eq + 1).trim();
  if (!name || !data) return null;

  try {
    const json = base64UrlDecode(data);
    const obj = JSON.parse(json);
    return { name, obj };
  } catch (e) {
    console.warn("Bad share hash:", e);
    return null;
  }
}

function scheduleHashUpdate() {
  if (_hashSuppress) return;

  // debounce to avoid spamming history
  clearTimeout(_hashUpdateTimer);
  _hashUpdateTimer = setTimeout(() => {
    const payload = currentLayout();
    // keep URLs smaller: store only what matters
    const compact = {
      autoGridOn: payload.autoGridOn,
      tiles: payload.tiles.map(t => ({
        n: t.name,
        u: t.url,
        x: t.x,
        y: t.y,
        w: t.w,
        h: t.h,
        z: t.z
      }))
    };

    const enc = base64UrlEncode(JSON.stringify(compact));
    const newHash = `#${encodeURIComponent(shareName)}=${enc}`;

    // replaceState so it updates URL without creating tons of back-button entries
    history.replaceState(null, "", newHash);
  }, 300);
}

function setShareNameFromUI() {
  // use "Layout" field as the share name if user types one
  const n = (layoutName.value || "").trim();
  if (n) shareName = n.toLowerCase().replaceAll(" ", "-");
}

/* ---------------------------
   GRID PACKER
--------------------------- */

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
    t.style.left = (PAD + col * stepX) + "px";
    t.style.top = (PAD + row * (TILE_H + GAP_Y)) + "px";
  });

  scheduleHashUpdate();
}

/* ---------------------------
   TILE
--------------------------- */

function createTile(i, preset = null) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = preset?.id ?? makeId();

  node.style.width = (preset?.w ?? GRID.TILE_W) + "px";
  node.style.height = (preset?.h ?? GRID.TILE_H) + "px";
  node.style.zIndex = preset?.z ?? String(1 + i);

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

    stop();

    // Safari native HLS
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      video.play().catch(() => {});
      scheduleHashUpdate();
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
        scheduleHashUpdate();
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

  // update URL when user types URL (debounced)
  urlInput.addEventListener("input", () => {
    setShareNameFromUI();
    scheduleHashUpdate();
  });

  node.addEventListener("click", () => bringToFront(node));

  node.querySelectorAll("button.mini").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const act = btn.dataset.action;

      if (act === "mute") {
        video.muted = !video.muted;
      }
      if (act === "reload") {
        setShareNameFromUI();
        play();
      }
      if (act === "remove") {
        stop();
        node.remove();
        packTilesToGrid();
        scheduleHashUpdate();
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

    autoGridOn = false;
    updateAutoGridButton();
    setShareNameFromUI();

    e.preventDefault();
  });

  window.addEventListener("mousemove", e => {
    if (!dragging) return;

    const c = canvas.getBoundingClientRect();
    const x = snap(e.clientX - c.left - dx);
    const y = snap(e.clientY - c.top - dy);

    node.style.left = Math.max(0, x) + "px";
    node.style.top = Math.max(0, y) + "px";

    scheduleHashUpdate();
  });

  window.addEventListener("mouseup", () => (dragging = false));

  // Resize
  let resizing = false, rw = 0, rh = 0, rx = 0, ry = 0;

  resizer.addEventListener("mousedown", e => {
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

  window.addEventListener("mousemove", e => {
    if (!resizing) return;

    const dw = e.clientX - rx;
    const dh = e.clientY - ry;

    const w = snap(Math.max(240, rw + dw));
    const h = snap(Math.max(180, rh + dh));

    node.style.width = w + "px";
    node.style.height = h + "px";

    scheduleHashUpdate();
  });

  window.addEventListener("mouseup", () => (resizing = false));

  canvas.appendChild(node);
  return node;
}

/* ---------------------------
   LAYOUT SAVE/LOAD (LocalStorage)
--------------------------- */

function currentLayout() {
  const tiles = [...canvas.querySelectorAll(".tile")].map(t => ({
    id: t.dataset.id,
    name: t.querySelector(".tileTitle").textContent,
    url: t.querySelector(".url").value.trim(),
    x: parseInt(t.style.left, 10) || 0,
    y: parseInt(t.style.top, 10) || 0,
    w: parseInt(t.style.width, 10) || GRID.TILE_W,
    h: parseInt(t.style.height, 10) || GRID.TILE_H,
    z: parseInt(t.style.zIndex || "1", 10)
  }));
  return { tiles, autoGridOn };
}

async function saveLayout() {
  const name = (layoutName.value.trim() || "default").toLowerCase();
  localStorage.setItem("multiviewer_layout_" + name, JSON.stringify(currentLayout()));
  alert("Saved layout: " + name);
  setShareNameFromUI();
  scheduleHashUpdate();
}

async function loadLayout() {
  const name = (layoutName.value.trim() || "default").toLowerCase();
  const raw = localStorage.getItem("multiviewer_layout_" + name);

  canvas.innerHTML = "";

  if (!raw) {
    packTilesToGrid();
    updateAutoGridButton();
    setShareNameFromUI();
    scheduleHashUpdate();
    return;
  }

  const data = JSON.parse(raw);
  autoGridOn = data.autoGridOn ?? true;

  (data.tiles || []).forEach((tile, i) => createTile(i, tile));

  packTilesToGrid();
  updateAutoGridButton();
  setShareNameFromUI();
  scheduleHashUpdate();
}

/* ---------------------------
   UI
--------------------------- */

function setBoxes(n) {
  const existing = canvas.querySelectorAll(".tile").length;

  if (n > existing) {
    for (let i = existing; i < n; i++) createTile(i);
  } else if (n < existing) {
    const tiles = [...canvas.querySelectorAll(".tile")];
    for (let i = tiles.length - 1; i >= n; i--) tiles[i].remove();
  }

  packTilesToGrid();
  scheduleHashUpdate();
}

applyBoxes.addEventListener("click", () => {
  const n = Math.max(1, Math.min(64, parseInt(boxCount.value || "4", 10)));
  setShareNameFromUI();
  setBoxes(n);
});

loadLayoutBtn.addEventListener("click", loadLayout);
saveLayoutBtn.addEventListener("click", saveLayout);

clearAllBtn.addEventListener("click", () => {
  if (confirm("Clear all tiles?")) {
    canvas.innerHTML = "";
    scheduleHashUpdate();
  }
});

gridSnapToggle.addEventListener("click", () => {
  snapOn = !snapOn;
  gridSnapToggle.textContent = `Snap: ${snapOn ? "ON" : "OFF"}`;
  scheduleHashUpdate();
});

// ---- AutoGrid toggle button ----
function addAutoGridButton() {
  const parent = gridSnapToggle.parentElement;
  const btn = document.createElement("button");
  btn.id = "autoGridToggle";
  btn.textContent = `AutoGrid: ${autoGridOn ? "ON" : "OFF"}`;

  btn.addEventListener("click", () => {
    autoGridOn = !autoGridOn;
    updateAutoGridButton();
    packTilesToGrid();
    scheduleHashUpdate();
  });

  parent.insertBefore(btn, gridSnapToggle);
}

function updateAutoGridButton() {
  const b = document.getElementById("autoGridToggle");
  if (b) b.textContent = `AutoGrid: ${autoGridOn ? "ON" : "OFF"}`;
}

window.addEventListener("resize", () => packTilesToGrid());

/* ---------------------------
   BOOT: load from URL hash if exists
--------------------------- */

function loadFromHashIfPresent() {
  const parsed = parseHashState();
  if (!parsed) return false;

  shareName = decodeURIComponent(parsed.name) || "suhib-monitor";
  layoutName.value = shareName;

  const data = parsed.obj;

  // convert compact -> full expected
  const tiles = (data.tiles || []).map((t, i) => ({
    id: makeId(),
    name: t.n ?? `Stream ${i + 1}`,
    url: t.u ?? "",
    x: t.x ?? GRID.PAD,
    y: t.y ?? GRID.PAD,
    w: t.w ?? GRID.TILE_W,
    h: t.h ?? GRID.TILE_H,
    z: t.z ?? (i + 1)
  }));

  autoGridOn = data.autoGridOn ?? true;

  _hashSuppress = true;
  canvas.innerHTML = "";
  tiles.forEach((tile, i) => createTile(i, tile));
  packTilesToGrid();
  updateAutoGridButton();
  _hashSuppress = false;

  // keep URL stable
  scheduleHashUpdate();
  return true;
}

/* ---------------------------
   INIT
--------------------------- */

addAutoGridButton();

// 1) try hash load
const loaded = loadFromHashIfPresent();

if (!loaded) {
  // 2) default setup
  setBoxes(parseInt(boxCount.value || "4", 10));
  setShareNameFromUI();
  scheduleHashUpdate();
}

// If user edits the "Layout" field, use it as shareName
layoutName.addEventListener("input", () => {
  setShareNameFromUI();
  scheduleHashUpdate();
});
