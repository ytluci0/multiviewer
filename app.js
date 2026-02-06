/* ============================
   MultiViewer app.js (API-backed short hash + legacy migration)
   FIXED: do NOT overwrite shareName from UI during autosave
   - Short URL: .../#suhib or .../#G
   - Loads/Saves layout via API server
   - Migrates legacy long hash: #name=BASE64JSON -> saves to API -> becomes #name
============================ */

const API_SERVER = "http://10.220.106.48:5000";

// DOM
const canvas = document.getElementById("canvas");
const tpl = document.getElementById("tileTemplate");

const boxCount = document.getElementById("boxCount");
const applyBoxes = document.getElementById("applyBoxes");
const layoutName = document.getElementById("layoutName");
const loadLayoutBtn = document.getElementById("loadLayout");
const saveLayoutBtn = document.getElementById("saveLayout");
const clearAllBtn = document.getElementById("clearAll");
const gridSnapToggle = document.getElementById("gridSnapToggle");

// State
let snapOn = true;
const SNAP = 20;

let autoGridOn = true;
let shareName = "default";

let _saveTimer = null;
let _hashSuppress = false;

const GRID = {
  PAD: 16,
  GAP_X: 16,
  GAP_Y: 16,
  TILE_W: 420,
  TILE_H: 240,
};

// ---------- utils ----------
function normalizeShareName(s) {
  const n = (s || "").trim();
  if (!n) return "default";
  return n.replace(/\s+/g, "-");
}

function setShareNameFromUI() {
  shareName = normalizeShareName(layoutName.value);
}

function setHashShort(name) {
  history.replaceState(null, "", `#${encodeURIComponent(name)}`);
}

function setShareNameFromHashOrDefault() {
  const raw = (location.hash || "").replace(/^#/, "").trim();
  if (!raw) {
    shareName = normalizeShareName(layoutName.value) || "default";
    layoutName.value = shareName;
    setHashShort(shareName);
    return;
  }

  // legacy form: name=base64
  const eq = raw.indexOf("=");
  if (eq !== -1) {
    const nm = raw.slice(0, eq);
    shareName = normalizeShareName(decodeURIComponent(nm)) || "default";
    layoutName.value = shareName;
    return;
  }

  shareName = normalizeShareName(decodeURIComponent(raw)) || "default";
  layoutName.value = shareName;
}

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

// ---------- legacy decode ----------
function base64UrlToBase64(s) {
  return s.replace(/-/g, "+").replace(/_/g, "/");
}
function safeAtob(b64) {
  const s = base64UrlToBase64(b64);
  const pad = s.length % 4;
  const padded = pad ? s + "=".repeat(4 - pad) : s;
  return atob(padded);
}
function decodeLegacyLayout(base64Str) {
  try {
    const json = safeAtob(base64Str);
    return JSON.parse(json);
  } catch (e) {
    console.warn("Legacy decode failed:", e);
    return null;
  }
}

// ---------- layout helpers ----------
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

function applyLayoutObject(layout) {
  autoGridOn = layout?.autoGridOn ?? true;

  _hashSuppress = true;
  canvas.innerHTML = "";

  (layout?.tiles || []).forEach((t, i) => createTile(i, t));

  packTilesToGrid();
  updateAutoGridButton();

  _hashSuppress = false;
}

// ---------- API ----------
async function apiSave(name, payload) {
  await fetch(`${API_SERVER}/layout/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function apiLoad(name) {
  const res = await fetch(`${API_SERVER}/layout/${encodeURIComponent(name)}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data?.layout ?? null;
}

// ---------- AutoGrid packer ----------
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

// ---------- Save (debounced) ----------
// IMPORTANT FIX: autosave uses CURRENT shareName (hash), not UI input.
function scheduleSave() {
  if (_hashSuppress) return;

  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    try {
      const payload = currentLayout();
      await apiSave(shareName, payload);
      setHashShort(shareName);
    } catch (e) {
      console.error("API save failed:", e);
    }
  }, 500);
}

// ---------- Load from hash (short) OR migrate legacy (long) ----------
async function loadFromHash() {
  const raw = (location.hash || "").replace(/^#/, "").trim();
  if (!raw) return false;

  const eqIdx = raw.indexOf("=");
  if (eqIdx !== -1) {
    const legacyName = normalizeShareName(decodeURIComponent(raw.slice(0, eqIdx)));
    const legacyBlob = raw.slice(eqIdx + 1);

    const decoded = decodeLegacyLayout(legacyBlob);
    if (decoded) {
      shareName = legacyName || "default";
      layoutName.value = shareName;

      applyLayoutObject(decoded);

      try {
        await apiSave(shareName, decoded);
      } catch (e) {
        console.error("Legacy migration save failed:", e);
      }

      setHashShort(shareName);
      return true;
    } else {
      shareName = legacyName || "default";
      layoutName.value = shareName;
      setHashShort(shareName);
    }
  } else {
    shareName = normalizeShareName(decodeURIComponent(raw));
    layoutName.value = shareName;
  }

  try {
    const layout = await apiLoad(shareName);
    if (!layout) return false;

    applyLayoutObject(layout);
    setHashShort(shareName);
    return true;
  } catch (e) {
    console.error("API load failed:", e);
    return false;
  }
}

// ---------- Buttons ----------
async function saveLayoutToAPI() {
  try {
    // explicit save uses UI name
    setShareNameFromUI();
    const payload = currentLayout();
    await apiSave(shareName, payload);
    setHashShort(shareName);
    alert(`Saved to server as: ${shareName}`);
  } catch (e) {
    alert("Save failed. Check console.");
    console.error(e);
  }
}

async function loadLayoutFromAPI() {
  // explicit load uses UI name
  setShareNameFromUI();
  setHashShort(shareName);
  const ok = await loadFromHash();
  if (!ok) alert(`No layout found on server for: ${shareName}`);
}

// ---------- Tile creation ----------
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

    if (location.protocol === "https:" && url.startsWith("http://")) {
      alert(
        "Blocked: this page is HTTPS but your stream is HTTP.\nUse https:// link or enable HTTPS on your HLS server."
      );
      return;
    }

    stop();

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      video.play().catch(() => {});
      scheduleSave();
      return;
    }

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
    play();
  });

  urlInput.addEventListener("input", () => {
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
  let dragging = false, dx = 0, dy = 0;

  topbar.addEventListener("mousedown", (e) => {
    dragging = true;
    bringToFront(node);

    const rect = node.getBoundingClientRect();
    dx = e.clientX - rect.left;
    dy = e.clientY - rect.top;

    autoGridOn = false;
    updateAutoGridButton();

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
  let resizing = false, rw = 0, rh = 0, rx = 0, ry = 0;

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

// ---------- Boxes logic ----------
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

// ---------- AutoGrid toggle ----------
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

// ---------- UI events ----------
applyBoxes.addEventListener("click", () => {
  const n = Math.max(1, Math.min(64, parseInt(boxCount.value || "4", 10)));
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
  // typing changes only the UI + hash, doesn't force autosave name
  setShareNameFromUI();
  setHashShort(shareName);
});

window.addEventListener("resize", () => packTilesToGrid());

// if user changes hash manually: load that layout
window.addEventListener("hashchange", async () => {
  setShareNameFromHashOrDefault();
  const ok = await loadFromHash();
  if (!ok) {
    // if doesn't exist, stay on that name and create blank layout
    const n = Math.max(1, Math.min(64, parseInt(boxCount.value || "4", 10)));
    canvas.innerHTML = "";
    setBoxes(n);
    setHashShort(shareName);
    scheduleSave();
  }
});

// ---------- INIT ----------
addAutoGridButton();
updateAutoGridButton();

(async () => {
  setShareNameFromHashOrDefault();

  const loaded = await loadFromHash();

  if (!loaded) {
    const n = Math.max(1, Math.min(64, parseInt(boxCount.value || "4", 10)));
    setBoxes(n);
    setHashShort(shareName);
    scheduleSave();
  }
})();
