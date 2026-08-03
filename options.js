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
};

const BOOL_KEYS = ["ENABLE_IMAGE", "ENABLE_VIDEO"];
const NUM_KEYS = ["GESTURE_CYCLES", "GESTURE_WINDOW_SECONDS", "COOLDOWN_SECONDS"];
const ALL_KEYS = BOOL_KEYS.concat(NUM_KEYS);

const $ = (id) => document.getElementById(id);

// Fill the form from an effective config (defaults merged with stored values).
function fillForm(cfg) {
  BOOL_KEYS.forEach((k) => ($(k).checked = cfg[k] !== false));
  NUM_KEYS.forEach((k) => ($(k).value = cfg[k]));
}

function readForm() {
  const out = {};
  BOOL_KEYS.forEach((k) => (out[k] = $(k).checked));
  NUM_KEYS.forEach((k) => {
    const v = parseFloat($(k).value);
    out[k] = isNaN(v) ? DEFAULTS[k] : v;
  });
  // sanity clamps
  out.GESTURE_CYCLES = Math.max(1, Math.round(out.GESTURE_CYCLES));
  if (out.GESTURE_WINDOW_SECONDS <= 0) out.GESTURE_WINDOW_SECONDS = DEFAULTS.GESTURE_WINDOW_SECONDS;
  if (out.COOLDOWN_SECONDS < 0) out.COOLDOWN_SECONDS = 0;
  return out;
}

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
