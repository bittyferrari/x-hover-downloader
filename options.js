// Options page logic.
//
// Defaults come from config.js (window.XID_CONFIG). Saved values live in
// chrome.storage.sync and override the defaults; content.js reads the same
// keys and applies changes live.

const DEFAULTS = window.XID_CONFIG || {
  ENABLE_IMAGE: true,
  ENABLE_VIDEO: true,
  GESTURE_CYCLES: 2,
  GESTURE_WINDOW_SECONDS: 2,
  COOLDOWN_SECONDS: 3,
  GRID_MEDIA: true,
  GRID_COLUMNS: 2,
  ENABLE_GESTURE: true,
  ENABLE_PREVIEW: true,
  PREVIEW_DELAY_MS: 0,
  PREVIEW_LEFT: 65,
  PREVIEW_RIGHT: 1,
  PREVIEW_TOP: 1,
  PREVIEW_BOTTOM: 1,
  PREVIEW_BACKDROP: true,
  PREVIEW_INFO: true,
  PREVIEW_ANIM: "random",
  PREVIEW_ANIM_MS: 100,
  PREVIEW_ANIM_DISTANCE: 40,
  SAVE_KEY: "s",
  SAVE_KEY_CTRL: false,
  SAVE_KEY_ALT: false,
  SAVE_KEY_SHIFT: false,
  ENABLE_VIDEO_KEY: true,
  VIDEO_KEY_HINT: true,
  ENABLE_TRACE: true,
  TRACE_CIRCLE: true,
  TRACE_ZIGZAG_X: true,
  TRACE_ZIGZAG_Y: true,
  TRACE_WINDOW_SECONDS: 1.2,
  TRACE_CIRCLE_TURNS: 1,
  TRACE_CIRCLE_RADIUS: 25,
  TRACE_ZIGZAG_SWINGS: 4,
  TRACE_ZIGZAG_MIN_PX: 30,
};

const BOOL_KEYS = [
  "ENABLE_IMAGE",
  "ENABLE_VIDEO",
  "GRID_MEDIA",
  "ENABLE_GESTURE",
  "ENABLE_PREVIEW",
  "PREVIEW_BACKDROP",
  "PREVIEW_INFO",
  "SAVE_KEY_CTRL",
  "SAVE_KEY_ALT",
  "SAVE_KEY_SHIFT",
  "ENABLE_VIDEO_KEY",
  "VIDEO_KEY_HINT",
  "ENABLE_TRACE",
  "TRACE_CIRCLE",
  "TRACE_ZIGZAG_X",
  "TRACE_ZIGZAG_Y",
];
const NUM_KEYS = [
  "GESTURE_CYCLES",
  "GESTURE_WINDOW_SECONDS",
  "COOLDOWN_SECONDS",
  "GRID_COLUMNS",
  "PREVIEW_DELAY_MS",
  "PREVIEW_LEFT",
  "PREVIEW_RIGHT",
  "PREVIEW_TOP",
  "PREVIEW_BOTTOM",
  "PREVIEW_ANIM_MS",
  "PREVIEW_ANIM_DISTANCE",
  "TRACE_WINDOW_SECONDS",
  "TRACE_CIRCLE_TURNS",
  "TRACE_CIRCLE_RADIUS",
  "TRACE_ZIGZAG_SWINGS",
  "TRACE_ZIGZAG_MIN_PX",
];
const STR_KEYS = ["SAVE_KEY", "PREVIEW_ANIM"];
const ALL_KEYS = BOOL_KEYS.concat(NUM_KEYS, STR_KEYS);

// Checkboxes that default to OFF (everything else defaults to ON when absent).
const BOOL_OFF_BY_DEFAULT = ["SAVE_KEY_CTRL", "SAVE_KEY_ALT", "SAVE_KEY_SHIFT"];

const $ = (id) => document.getElementById(id);

function keyLabel(key, ctrl, alt, shift) {
  const k = key || "s";
  return (
    (ctrl ? "Ctrl + " : "") +
    (alt ? "Alt + " : "") +
    (shift ? "Shift + " : "") +
    (k.length === 1 ? k.toUpperCase() : k)
  );
}

function refreshKeyLabel() {
  const box = $("SAVE_KEY");
  box.value = keyLabel(
    box.dataset.key,
    $("SAVE_KEY_CTRL").checked,
    $("SAVE_KEY_ALT").checked,
    $("SAVE_KEY_SHIFT").checked
  );
}

// Fill the form from an effective config (defaults merged with stored values).
function fillForm(cfg) {
  BOOL_KEYS.forEach((k) => {
    $(k).checked = BOOL_OFF_BY_DEFAULT.includes(k)
      ? cfg[k] === true
      : cfg[k] !== false;
  });
  NUM_KEYS.forEach((k) => ($(k).value = cfg[k]));
  $("PREVIEW_ANIM").value = cfg.PREVIEW_ANIM || "random";
  $("SAVE_KEY").dataset.key = cfg.SAVE_KEY || "s";
  refreshKeyLabel();
}

function readForm() {
  const out = {};
  BOOL_KEYS.forEach((k) => (out[k] = $(k).checked));
  NUM_KEYS.forEach((k) => {
    const v = parseFloat($(k).value);
    out[k] = isNaN(v) ? DEFAULTS[k] : v;
  });
  out.SAVE_KEY = $("SAVE_KEY").dataset.key || "s";
  out.PREVIEW_ANIM = $("PREVIEW_ANIM").value || "random";
  // sanity clamps
  out.GESTURE_CYCLES = Math.max(1, Math.round(out.GESTURE_CYCLES));
  if (out.GESTURE_WINDOW_SECONDS <= 0) out.GESTURE_WINDOW_SECONDS = DEFAULTS.GESTURE_WINDOW_SECONDS;
  if (out.COOLDOWN_SECONDS < 0) out.COOLDOWN_SECONDS = 0;
  out.GRID_COLUMNS = Math.min(6, Math.max(1, Math.round(out.GRID_COLUMNS)));
  if (out.PREVIEW_DELAY_MS < 0) out.PREVIEW_DELAY_MS = 0;
  if (out.PREVIEW_ANIM_MS < 0) out.PREVIEW_ANIM_MS = 0;
  if (out.PREVIEW_ANIM_DISTANCE < 0) out.PREVIEW_ANIM_DISTANCE = 0;
  // trace gesture sanity clamps
  if (out.TRACE_WINDOW_SECONDS <= 0)
    out.TRACE_WINDOW_SECONDS = DEFAULTS.TRACE_WINDOW_SECONDS;
  out.TRACE_CIRCLE_TURNS = Math.max(0.5, out.TRACE_CIRCLE_TURNS);
  out.TRACE_CIRCLE_RADIUS = Math.max(5, out.TRACE_CIRCLE_RADIUS);
  out.TRACE_ZIGZAG_SWINGS = Math.max(2, Math.round(out.TRACE_ZIGZAG_SWINGS));
  out.TRACE_ZIGZAG_MIN_PX = Math.max(5, out.TRACE_ZIGZAG_MIN_PX);
  // Keep the preview box inside the viewport and non-degenerate.
  ["PREVIEW_LEFT", "PREVIEW_RIGHT", "PREVIEW_TOP", "PREVIEW_BOTTOM"].forEach(
    (k) => (out[k] = Math.min(95, Math.max(0, out[k])))
  );
  if (out.PREVIEW_LEFT + out.PREVIEW_RIGHT > 95) {
    out.PREVIEW_LEFT = DEFAULTS.PREVIEW_LEFT;
    out.PREVIEW_RIGHT = DEFAULTS.PREVIEW_RIGHT;
  }
  if (out.PREVIEW_TOP + out.PREVIEW_BOTTOM > 95) {
    out.PREVIEW_TOP = DEFAULTS.PREVIEW_TOP;
    out.PREVIEW_BOTTOM = DEFAULTS.PREVIEW_BOTTOM;
  }
  return out;
}

// --- save-key recorder ------------------------------------------------------
// Click the box, press the key you want. Modifiers held while pressing are
// picked up too, and the three checkboxes stay in sync.
(function setupKeyRecorder() {
  const box = $("SAVE_KEY");
  const MODS = ["Control", "Alt", "Shift", "Meta"];
  box.addEventListener("focus", () => {
    box.classList.add("recording");
    box.value = "請按下按鍵…";
  });
  box.addEventListener("blur", () => {
    box.classList.remove("recording");
    refreshKeyLabel();
  });
  box.addEventListener("keydown", (e) => {
    e.preventDefault();
    if (MODS.includes(e.key)) return; // wait for a real key
    box.dataset.key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    $("SAVE_KEY_CTRL").checked = e.ctrlKey;
    $("SAVE_KEY_ALT").checked = e.altKey;
    $("SAVE_KEY_SHIFT").checked = e.shiftKey;
    refreshKeyLabel();
    box.blur();
  });
  ["SAVE_KEY_CTRL", "SAVE_KEY_ALT", "SAVE_KEY_SHIFT"].forEach((k) =>
    $(k).addEventListener("change", refreshKeyLabel)
  );
})();

function flash(text) {
  const s = $("status");
  s.textContent = text;
  s.classList.add("show");
  setTimeout(() => s.classList.remove("show"), 1400);
}

// Load: merge defaults with whatever is stored.
chrome.storage.sync.get(null, (stored) => {
  fillForm(Object.assign({}, DEFAULTS, stored || {}));
});

$("save").addEventListener("click", () => {
  const cfg = readForm();
  chrome.storage.sync.set(cfg, () => {
    fillForm(Object.assign({}, DEFAULTS, cfg));
    flash("已儲存 ✔");
  });
});

$("reset").addEventListener("click", () => {
  chrome.storage.sync.remove(ALL_KEYS, () => {
    fillForm(DEFAULTS);
    flash("已還原預設值");
  });
});
