// X Image Downloader - content script
//
// Gesture: quickly move the mouse ONTO an image and OFF it, then ONTO and OFF
// again — i.e. two fast hover-in/hover-out cycles within 2 seconds. Doing so
// auto-downloads that image at its original (largest) size.
//
// Detection notes:
//   - X stacks several layers over a photo (the <img>, a background <div>, an
//     aria-label wrapper, and an outer <a> photo link). The reliable, stable
//     boundary is the photo LINK <a href=".../photo/N">, so we treat that whole
//     link as one "region" and ignore every move between its inner layers.
//   - We emulate real mouseenter/mouseleave from the bubbling mouseover/mouseout
//     events using relatedTarget containment checks. A gesture cycle is a full
//     enter -> leave. The download fires on the SECOND leave (i.e. after an
//     actual mouse-out), so simply hovering onto an image can never trigger it.

(function () {
  if (window.__xidInjected) return;
  window.__xidInjected = true;

  // ---- settings -------------------------------------------------------------
  // Defaults come from config.js; the Options page overrides them via
  // chrome.storage.sync. Changes there apply live (no reload needed).
  const DEFAULTS = window.XID_CONFIG || {};
  const pos = (v, d) => (typeof v === "number" && v > 0 ? v : d);

  let ENABLE_IMAGE, ENABLE_VIDEO, WINDOW, NEEDED, COOLDOWN, ENABLE_GESTURE;

  // Fixed-box preview + save hotkey settings.
  const PV = {
    on: true,
    delay: 0,
    left: 65,
    right: 1,
    top: 1,
    bottom: 1,
    backdrop: true,
    info: true,
    anim: "slide-right",
    animMs: 100,
    animDist: 40,
  };

  const ANIMS = [
    "none",
    "fade",
    "slide-right",
    "slide-left",
    "slide-up",
    "slide-down",
    "zoom",
    "zoom-out",
  ];
  const SAVE_KEY = { key: "s", ctrl: false, alt: false, shift: false };

  // Preview state (declared up here so applySettings() can run immediately).
  let pvEl = null;
  let pvImg = null;
  let pvInfo = null;
  let pvTimer = null;
  let pvRegion = null; // region currently previewed
  let pvTarget = null; // { url, filename }

  const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);

  // Flatten X's swipe-carousel into a wrapping grid. All of the work is done
  // by content.css; here we only flip the html.xid-grid class and the column
  // count, so the Options page can toggle it live.
  function applyGrid(c) {
    const on = c.GRID_MEDIA !== false;
    const cols = Math.max(1, Math.round(pos(c.GRID_COLUMNS, 2)));
    const root = document.documentElement;
    root.classList.toggle("xid-grid", on);
    root.style.setProperty("--xid-cols", String(cols));
  }
  function applySettings(cfg) {
    const c = Object.assign({}, DEFAULTS, cfg || {});
    ENABLE_IMAGE = c.ENABLE_IMAGE !== false;
    ENABLE_VIDEO = c.ENABLE_VIDEO !== false;
    WINDOW = pos(c.GESTURE_WINDOW_SECONDS, 2) * 1000; // gesture time window
    NEEDED = Math.max(1, Math.round(pos(c.GESTURE_CYCLES, 2))); // hover cycles
    COOLDOWN = pos(c.COOLDOWN_SECONDS, 3) * 1000; // per-media cooldown
    ENABLE_GESTURE = c.ENABLE_GESTURE !== false;

    PV.on = c.ENABLE_PREVIEW !== false;
    PV.delay = Math.max(0, num(c.PREVIEW_DELAY_MS, 0));
    PV.left = num(c.PREVIEW_LEFT, 65);
    PV.right = num(c.PREVIEW_RIGHT, 1);
    PV.top = num(c.PREVIEW_TOP, 1);
    PV.bottom = num(c.PREVIEW_BOTTOM, 1);
    PV.backdrop = c.PREVIEW_BACKDROP !== false;
    PV.info = c.PREVIEW_INFO !== false;
    PV.anim = ANIMS.includes(c.PREVIEW_ANIM) ? c.PREVIEW_ANIM : "slide-right";
    PV.animMs = Math.max(0, num(c.PREVIEW_ANIM_MS, 100));
    PV.animDist = Math.max(0, num(c.PREVIEW_ANIM_DISTANCE, 40));

    SAVE_KEY.key = typeof c.SAVE_KEY === "string" && c.SAVE_KEY ? c.SAVE_KEY : "s";
    SAVE_KEY.ctrl = c.SAVE_KEY_CTRL === true;
    SAVE_KEY.alt = c.SAVE_KEY_ALT === true;
    SAVE_KEY.shift = c.SAVE_KEY_SHIFT === true;

    if (!PV.on) hidePreview();
    else applyPreviewBox();

    applyGrid(c);
  }
  applySettings(); // start from config.js defaults immediately

  try {
    chrome.storage.sync.get(null, (stored) => {
      if (!chrome.runtime.lastError && stored) applySettings(stored);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      chrome.storage.sync.get(null, (stored) => applySettings(stored || {}));
    });
  } catch (e) {
    /* storage unavailable -> keep config.js defaults */
  }

  // Stable regions: the photo link for images, the video component for videos.
  const REGION_SEL =
    'a[href*="/photo/"], [data-testid="tweetPhoto"], ' +
    '[data-testid="videoComponent"], [data-testid="videoPlayer"]';

  const regionOf = (el) => (el && el.closest ? el.closest(REGION_SEL) : null);

  const isVideo = (r) =>
    r.matches(
      '[data-testid="videoComponent"], [data-testid="videoPlayer"]'
    ) || !!r.querySelector("video");

  // ---- captured video variants (from injected.js, keyed by tweet id) --------

  const captured = Object.create(null);
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d.__xidVideo !== true || !d.variants) return;
    for (const id in d.variants) {
      const list = d.variants[id];
      if (list && list.length) captured[id] = list;
    }
  });

  // Per-region "is the pointer currently inside" flag (for enter/leave detection).
  const inside = new WeakMap();

  // A stable identity for a piece of media, so the gesture is counted per IMAGE
  // (not per DOM element). This is what stops a swipe across a 4-image post from
  // accumulating a cycle on each photo it passes over.
  const uids = new WeakMap();
  let uidN = 0;
  function mediaKey(r) {
    const a = r.closest && r.closest('a[href*="/photo/"]');
    if (a && a.getAttribute("href")) return "p:" + a.getAttribute("href");
    const img =
      r.querySelector && r.querySelector('img[src*="pbs.twimg.com/media"]');
    if (img && img.src) return "i:" + img.src;
    if (isVideo(r)) {
      const c = videoTweetId(r);
      if (c) return "v:" + c.status;
    }
    let u = uids.get(r);
    if (!u) {
      u = "el:" + ++uidN;
      uids.set(r, u);
    }
    return u;
  }

  // Each image/video keeps its OWN cycle counter, keyed by its media identity.
  // Because counters are independent, quickly circling over several photos in a
  // post racks up cycles on each one separately and downloads them all — while a
  // single clean pass (one leave per image) never reaches the threshold.
  const counters = new Map(); // key -> { leaves:[ts], cooldownUntil }
  const counterFor = (key) => {
    let c = counters.get(key);
    if (!c) {
      c = { leaves: [], cooldownUntil: 0 };
      counters.set(key, c);
    }
    return c;
  };

  // Enter: pointer crossed from outside the region into it.
  document.addEventListener(
    "mouseover",
    (e) => {
      const r = regionOf(e.target);
      if (!r) return;
      // Came from within the same region? -> internal move between layers.
      if (r.contains(e.relatedTarget)) return;
      inside.set(r, true);
      schedulePreview(r);
    },
    true
  );

  // Leave: pointer crossed from inside the region to somewhere outside it.
  document.addEventListener(
    "mouseout",
    (e) => {
      const r = regionOf(e.target);
      if (!r) return;
      // Still inside the same region? -> internal move between layers.
      if (r.contains(e.relatedTarget)) return;
      if (!inside.get(r)) return; // never registered an enter -> ignore
      inside.set(r, false);
      cancelPreview(r);

      if (!ENABLE_GESTURE) return;

      const now = Date.now();
      const c = counterFor(mediaKey(r));

      if (now < c.cooldownUntil) {
        c.leaves = [];
        return;
      }

      c.leaves = c.leaves.filter((ts) => now - ts < WINDOW);
      c.leaves.push(now);

      if (c.leaves.length >= NEEDED) {
        c.leaves = [];
        c.cooldownUntil = now + COOLDOWN;
        trigger(r);
      }
    },
    true
  );

  // ---- image URL extraction -------------------------------------------------

  function rawUrlFrom(container) {
    // Prefer the <img> element
    const img = container.querySelector('img[src*="pbs.twimg.com/media"]');
    if (img && img.src) return img.src;

    // Fall back to the background-image div X uses behind the <img>
    const bg = container.querySelector('[style*="background-image"]');
    if (bg) {
      const m = bg.getAttribute("style").match(/url\(["']?(.*?)["']?\)/);
      if (m && /pbs\.twimg\.com\/media/.test(m[1])) return m[1];
    }
    return null;
  }

  // Turn any pbs.twimg.com/media URL into the original-size download URL.
  // e.g. .../media/HOwTJQ8aAAAG_Bj?format=jpg&name=medium
  //   -> .../media/HOwTJQ8aAAAG_Bj?format=jpg&name=orig
  function toOriginal(rawUrl) {
    try {
      const u = new URL(rawUrl, location.href);
      let format = u.searchParams.get("format");
      // Some URLs encode the format as an extension: .../media/ID.jpg
      if (!format) {
        const dot = u.pathname.match(/\.(jpg|jpeg|png|webp|gif)$/i);
        if (dot) {
          format = dot[1].toLowerCase();
          u.pathname = u.pathname.replace(/\.(jpg|jpeg|png|webp|gif)$/i, "");
        }
      }
      format = (format || "jpg").toLowerCase();
      if (format === "jpeg") format = "jpg";
      u.searchParams.set("format", format);
      u.searchParams.set("name", "orig");
      return { url: u.toString(), ext: format };
    } catch (e) {
      return { url: rawUrl, ext: "jpg" };
    }
  }

  function mediaIdFrom(rawUrl) {
    const m = rawUrl.match(/\/media\/([A-Za-z0-9_\-]+)/);
    return m ? m[1].replace(/\.\w+$/, "") : "img";
  }

  // Keep the site's own filename: the media id from the URL, e.g.
  // pbs.twimg.com/media/HOuePYAakAEdsoF -> HOuePYAakAEdsoF.jpg
  function buildFilename(rawUrl, ext /*, region */) {
    return `${mediaIdFrom(rawUrl)}.${ext}`;
  }

  // Last path segment of a URL, e.g. .../720x1280/abcXYZ.mp4?tag=12 -> abcXYZ.mp4
  function urlBasename(u) {
    try {
      const p = new URL(u, location.href).pathname;
      const b = p.substring(p.lastIndexOf("/") + 1);
      return b || null;
    } catch (e) {
      return null;
    }
  }

  // ---- video resolution -----------------------------------------------------

  // Find the tweet id for a video region by walking up to its <article> and
  // reading the permalink (the <a> that wraps the timestamp <time>).
  function videoTweetId(region) {
    const art = region.closest("article") || document;
    const timeLink =
      art.querySelector('a[href*="/status/"] time') &&
      art.querySelector('a[href*="/status/"] time').closest("a");
    const cand = timeLink || art.querySelector('a[href*="/status/"]');
    if (cand) {
      const m = cand.getAttribute("href").match(/\/([^\/]+)\/status\/(\d+)/);
      if (m) return { user: m[1], status: m[2] };
    }
    // Single-post page fallback
    const m2 = location.pathname.match(/\/([^\/]+)\/status\/(\d+)/);
    if (m2) return { user: m2[1], status: m2[2] };
    return null;
  }

  function downloadVideo(region) {
    const ctx = videoTweetId(region);
    if (!ctx) {
      toast("Can't identify video", false);
      return;
    }

    // 1) Prefer variants intercepted from the page (works for sensitive posts).
    const cap = captured[ctx.status];
    if (cap && cap.length) {
      const best = cap[0]; // sorted largest-first in injected.js
      send(best.url, urlBasename(best.url) || `${ctx.status}.mp4`, region);
      return;
    }

    // 2) Fall back to the background syndication API.
    toast("Fetching video…", true);
    chrome.runtime.sendMessage({ type: "getVideo", id: ctx.status }, (resp) => {
      if (chrome.runtime.lastError) {
        toast("Failed", false);
        return;
      }
      if (resp && resp.ok && resp.variants && resp.variants.length) {
        const best = resp.variants[0];
        send(best.url, urlBasename(best.url) || `${ctx.status}.mp4`, region);
      } else {
        toast("No video found", false);
      }
    });
  }

  // ---- trigger + feedback ---------------------------------------------------

  function trigger(region) {
    if (isVideo(region)) {
      if (ENABLE_VIDEO) downloadVideo(region);
      return;
    }

    if (!ENABLE_IMAGE) return;

    const raw = rawUrlFrom(region);
    if (!raw) {
      toast("No image found", false);
      return;
    }
    const { url, ext } = toOriginal(raw);
    send(url, buildFilename(raw, ext, region), region);
  }

  function send(url, filename, region) {
    toast("Downloading…", true);
    const h = makeOverlay(region); // red frame shows immediately
    chrome.runtime.sendMessage({ type: "download", url, filename }, (r) => {
      if (chrome.runtime.lastError) {
        toast("Failed", false);
        endOverlay(h, false, "Failed");
        return;
      }
      if (r && r.dup) {
        toast("Already saved", true);
        endOverlay(h, true, "✔ Already saved");
        return;
      }
      const ok = !!(r && r.ok);
      toast(ok ? "✔ Saved" : "Failed", ok);
      endOverlay(h, ok, ok ? "✔ Saved" : "Failed");
    });
  }

  // A frame + badge drawn over a piece of media. It stays fixed-positioned (so
  // we never touch X's own layout) but a requestAnimationFrame loop keeps it
  // aligned to the media's live position, so it follows the page as you scroll.
  //
  // makeOverlay() shows a RED "downloading" frame immediately; endOverlay()
  // flips it to GREEN on success (or leaves it red on failure) and fades it out.
  function makeOverlay(region) {
    if (!region || !region.getBoundingClientRect) return null;

    const el = document.createElement("div");
    el.className = "xid-flash xid-flash-active"; // red while downloading
    const badge = document.createElement("div");
    badge.className = "xid-badge";
    badge.textContent = "⬇ Downloading…";
    el.appendChild(badge);
    document.documentElement.appendChild(el);

    let alive = true;
    (function sync() {
      if (!alive) return;
      const r = region.getBoundingClientRect();
      if (r.width && r.height) {
        el.style.display = "";
        el.style.left = r.left + "px";
        el.style.top = r.top + "px";
        el.style.width = r.width + "px";
        el.style.height = r.height + "px";
      } else {
        el.style.display = "none"; // media scrolled out / unmounted
      }
      requestAnimationFrame(sync);
    })();

    requestAnimationFrame(() => el.classList.add("xid-show"));
    return { el, badge, stop: () => (alive = false) };
  }

  function endOverlay(h, ok, text) {
    if (!h) return;
    h.el.classList.remove("xid-flash-active", "xid-flash-err");
    if (!ok) h.el.classList.add("xid-flash-err"); // ok -> base green
    h.badge.textContent = text;
    setTimeout(() => {
      h.el.classList.remove("xid-show");
      setTimeout(() => {
        h.stop();
        h.el.remove();
      }, 220);
    }, 1300);
  }

  // ---- fixed-box preview (Hover Zoom style) + save hotkey -------------------
  //
  // Hovering a photo shows it enlarged inside a box whose position is defined
  // as viewport percentages (left/right/top/bottom), so it always sits in the
  // same place — no cursor-following popup. While that preview is up, pressing
  // the configured key saves the image at original size.

  function ensurePreview() {
    if (pvEl) return pvEl;
    pvEl = document.createElement("div");
    pvEl.id = "xid-preview";
    pvImg = document.createElement("img");
    pvImg.id = "xid-preview-img";
    pvInfo = document.createElement("div");
    pvInfo.id = "xid-preview-info";
    pvEl.appendChild(pvImg);
    pvEl.appendChild(pvInfo);
    document.documentElement.appendChild(pvEl);
    applyPreviewBox();
    return pvEl;
  }

  // Position/appearance come straight from the settings, so the Options page
  // can move the box live.
  function applyPreviewBox() {
    if (!pvEl) return;
    pvEl.style.left = PV.left + "%";
    pvEl.style.right = PV.right + "%";
    pvEl.style.top = PV.top + "%";
    pvEl.style.bottom = PV.bottom + "%";
    pvEl.classList.toggle("xid-pv-plain", !PV.backdrop);
    if (pvInfo) pvInfo.style.display = PV.info ? "" : "none";

    // Entry/exit effect: the hidden-state transform lives in content.css, one
    // class per effect; duration and slide distance come from these vars.
    ANIMS.forEach((a) => pvEl.classList.toggle("xid-anim-" + a, a === PV.anim));
    pvEl.style.setProperty("--xid-pv-ms", PV.animMs + "ms");
    pvEl.style.setProperty("--xid-pv-shift", PV.animDist + "px");
  }

  function keyLabel() {
    const k = SAVE_KEY.key;
    return (
      (SAVE_KEY.ctrl ? "Ctrl+" : "") +
      (SAVE_KEY.alt ? "Alt+" : "") +
      (SAVE_KEY.shift ? "Shift+" : "") +
      (k.length === 1 ? k.toUpperCase() : k)
    );
  }

  function schedulePreview(region) {
    if (!PV.on) return;
    if (isVideo(region)) return; // videos: no still preview
    const raw = rawUrlFrom(region);
    if (!raw) return;
    clearTimeout(pvTimer);
    pvTimer = setTimeout(() => showPreview(region, raw), PV.delay);
  }

  function cancelPreview(region) {
    clearTimeout(pvTimer);
    if (!pvRegion) return;
    if (region === pvRegion || (region.contains && region.contains(pvRegion))) {
      hidePreview();
    }
  }

  function showPreview(region, raw) {
    if (!document.contains(region)) return;
    const { url, ext } = toOriginal(raw);
    pvRegion = region;
    pvTarget = { url, filename: buildFilename(raw, ext, region) };
    ensurePreview();
    applyPreviewBox();

    // Show the already-cached thumbnail instantly, then swap in the original.
    pvImg.src = raw;
    if (pvInfo) pvInfo.textContent = "載入原圖… · " + keyLabel() + " 存檔";

    const hi = new Image();
    hi.onload = () => {
      if (!pvTarget || pvTarget.url !== url) return; // moved on already
      pvImg.src = url;
      if (pvInfo) {
        pvInfo.textContent =
          hi.naturalWidth + "×" + hi.naturalHeight + " · " + keyLabel() + " 存檔";
      }
    };
    hi.onerror = () => {
      if (pvInfo && pvTarget && pvTarget.url === url) {
        pvInfo.textContent = keyLabel() + " 存檔";
      }
    };
    hi.src = url;

    // Flush styles first so the hidden state (opacity/transform) is committed
    // and the entry effect actually plays instead of being batched away.
    void pvEl.offsetWidth;
    pvEl.classList.add("xid-show");
  }

  function hidePreview() {
    pvRegion = null;
    pvTarget = null;
    clearTimeout(pvTimer);
    if (pvEl) pvEl.classList.remove("xid-show");
  }

  function matchesSaveKey(e) {
    const k = SAVE_KEY.key;
    if (!k) return false;
    const hit =
      k.length === 1
        ? String(e.key).toLowerCase() === k.toLowerCase()
        : e.key === k;
    return (
      hit &&
      e.ctrlKey === SAVE_KEY.ctrl &&
      e.altKey === SAVE_KEY.alt &&
      e.shiftKey === SAVE_KEY.shift &&
      !e.metaKey
    );
  }

  const isTyping = (t) =>
    !!t &&
    (t.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ""));

  document.addEventListener(
    "keydown",
    (e) => {
      if (!pvTarget || !pvEl || !pvEl.classList.contains("xid-show")) return;
      if (e.key === "Escape") {
        hidePreview();
        return;
      }
      if (isTyping(e.target)) return;
      if (!matchesSaveKey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      send(pvTarget.url, pvTarget.filename, pvRegion);
    },
    true
  );

  // Clicking (e.g. opening the photo lightbox) dismisses the preview; it comes
  // straight back on the next hover.
  document.addEventListener("mousedown", () => hidePreview(), true);

  let toastEl = null;
  let toastTimer = null;
  function toast(text, ok) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = "xid-toast";
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.className = ok ? "xid-ok" : "xid-err";
    toastEl.classList.add("xid-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("xid-show");
    }, 1600);
  }
})();
