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
  // Videos get no still preview, so the save hotkey works off the plain hover.
  let VIDEO_KEY, VIDEO_HINT;

  // Pointer-trace gesture settings (circle / zig-zag drawn on the media).
  const TR = {
    on: true,
    circle: true,
    zx: true,
    zy: true,
    window: 1200, // ms the whole gesture must fit into
    turns: 1, // full turns needed for a circle
    radius: 25, // px — a circle must be at least this big
    swings: 4, // direction reversals needed for a zig-zag
    seg: 30, // px — how far each swing must travel to count
  };

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
    anim: "random",
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
  // "random" 不是真的 CSS class,而是每次顯示前隨機抽一種效果 (不含「無動畫」)。
  const ANIM_CHOICES = ANIMS.concat("random");
  const RANDOM_POOL = ANIMS.filter((a) => a !== "none");
  let pvAnimNow = "slide-right"; // 這次實際套用的效果

  const SAVE_KEY = { key: "s", ctrl: false, alt: false, shift: false };

  // Video-hover / hotkey-hint state. Declared up here for the same reason as the
  // preview state below: applySettings() runs immediately and calls
  // hideVideoHint() / resetTrace(), so these must already be initialised.
  let hoverVideo = null;
  let vhEl = null;
  let vhAlive = false;

  // Pointer-trace state (see the trace gesture section further down).
  let trRegion = null;
  let trPts = []; // [{x, y, t}] within the time window
  const zzX = { dir: 0, ext: 0, count: 0, since: 0 };
  const zzY = { dir: 0, ext: 0, count: 0, since: 0 };

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
    VIDEO_KEY = c.ENABLE_VIDEO_KEY !== false;
    VIDEO_HINT = c.VIDEO_KEY_HINT !== false;
    if (!VIDEO_KEY || !VIDEO_HINT) hideVideoHint();

    TR.on = c.ENABLE_TRACE !== false;
    TR.circle = c.TRACE_CIRCLE !== false;
    TR.zx = c.TRACE_ZIGZAG_X !== false;
    TR.zy = c.TRACE_ZIGZAG_Y !== false;
    TR.window = pos(c.TRACE_WINDOW_SECONDS, 1.2) * 1000;
    TR.turns = Math.max(0.5, num(c.TRACE_CIRCLE_TURNS, 1));
    TR.radius = Math.max(5, num(c.TRACE_CIRCLE_RADIUS, 25));
    TR.swings = Math.max(2, Math.round(pos(c.TRACE_ZIGZAG_SWINGS, 4)));
    TR.seg = Math.max(5, num(c.TRACE_ZIGZAG_MIN_PX, 30));
    resetTrace();

    PV.on = c.ENABLE_PREVIEW !== false;
    PV.delay = Math.max(0, num(c.PREVIEW_DELAY_MS, 0));
    PV.left = num(c.PREVIEW_LEFT, 65);
    PV.right = num(c.PREVIEW_RIGHT, 1);
    PV.top = num(c.PREVIEW_TOP, 1);
    PV.bottom = num(c.PREVIEW_BOTTOM, 1);
    PV.backdrop = c.PREVIEW_BACKDROP !== false;
    PV.info = c.PREVIEW_INFO !== false;
    PV.anim = ANIM_CHOICES.includes(c.PREVIEW_ANIM) ? c.PREVIEW_ANIM : "random";
    if (PV.anim !== "random") pvAnimNow = PV.anim;
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
  // A throw in here would kill the whole content script (and every feature with
  // it), so keep it contained and fall back to whatever is already applied.
  function applySettingsSafe(cfg) {
    try {
      applySettings(cfg);
    } catch (err) {
      console.error("[x-hover-downloader] settings failed:", err);
    }
  }

  applySettingsSafe(); // start from config.js defaults immediately

  try {
    chrome.storage.sync.get(null, (stored) => {
      if (!chrome.runtime.lastError && stored) applySettingsSafe(stored);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      chrome.storage.sync.get(null, (stored) => applySettingsSafe(stored || {}));
    });
  } catch (e) {
    /* storage unavailable -> keep config.js defaults */
  }

  // Stable regions: the photo link for images, the video component for videos.
  const REGION_SEL =
    'a[href*="/photo/"], [data-testid="tweetPhoto"], ' +
    '[data-testid="videoComponent"], [data-testid="videoPlayer"]';

  function regionOf(el) {
    if (!el || !el.closest) return null;
    const r = el.closest(REGION_SEL);
    if (r) return r;
    if (looseCache.has(el)) return looseCache.get(el);
    const loose = looseVideoRegion(el);
    looseCache.set(el, loose);
    return loose;
  }

  // mouseover fires constantly, so remember the fallback result per element.
  const looseCache = new WeakMap();

  // Sensitive / NSFW posts (and some embedded players) are rendered WITHOUT the
  // usual data-testid wrappers, so closest(REGION_SEL) finds nothing and the
  // hover gesture never even starts. Fall back to the nearest ancestor that
  // actually contains a <video> and is mostly filled by it, so hovering a text
  // block that merely shares an ancestor with a video never counts as a region.
  function looseVideoRegion(el) {
    let node = el.nodeType === 1 ? el : el.parentElement;
    for (let i = 0; i < 8 && node && node !== document.body; i++) {
      if (node.tagName === "ARTICLE") break;
      const v = node.querySelector && node.querySelector("video");
      if (v) {
        const rb = node.getBoundingClientRect();
        const vb = v.getBoundingClientRect();
        const ra = rb.width * rb.height;
        const va = vb.width * vb.height;
        if (ra > 0 && va >= ra * 0.5) return node;
        break;
      }
      node = node.parentElement;
    }
    return null;
  }

  const isVideo = (r) =>
    r.tagName === "VIDEO" ||
    (r.matches &&
      r.matches(
        '[data-testid="videoComponent"], [data-testid="videoPlayer"]'
      )) ||
    !!(r.querySelector && r.querySelector("video"));

  // ---- captured video variants (from injected.js) ---------------------------
  //
  // Two indexes: by TWEET id (what the article permalink gives us) and by MEDIA
  // id (the number shared by the mp4 URL and the <video poster> thumbnail).
  // The media index is the one that works for sensitive/NSFW posts, retweets
  // and quoted tweets, where the article's permalink is often a different tweet.

  const captured = Object.create(null);
  const capturedMedia = Object.create(null);
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d.__xidVideo !== true) return;
    if (d.variants) {
      for (const id in d.variants) {
        const list = d.variants[id];
        if (list && list.length) captured[id] = list;
      }
    }
    if (d.byMedia) {
      for (const mid in d.byMedia) {
        const list = d.byMedia[mid];
        if (list && list.length) capturedMedia[mid] = list;
      }
    }
  });

  // Media ids visible on the page for this region: the poster/thumbnail URLs
  // carry the same id as the mp4.
  //   ext_tw_video_thumb/1234/pu/img/x.jpg  <-> ext_tw_video/1234/pu/vid/...
  //   amplify_video_thumb/1234/img/x.jpg    <-> amplify_video/1234/vid/...
  //   tweet_video_thumb/AbCd.jpg            <-> tweet_video/AbCd.mp4  (GIF)
  const THUMB_RE =
    /(?:ext_tw_video_thumb|amplify_video_thumb)\/(\d+)|tweet_video_thumb\/([A-Za-z0-9_\-]+)/g;

  function regionMediaIds(region) {
    const ids = [];
    const add = (s) => {
      if (!s) return;
      THUMB_RE.lastIndex = 0;
      let m;
      while ((m = THUMB_RE.exec(s))) {
        const id = m[1] || m[2];
        if (id && ids.indexOf(id) === -1) ids.push(id);
      }
    };

    const vids =
      region.tagName === "VIDEO" ? [region] : region.querySelectorAll("video");
    for (const v of vids) add(v.getAttribute("poster") || "");

    if (!ids.length) {
      // Not playing yet: X shows the thumbnail as an <img> or a background div.
      const imgs = region.querySelectorAll("img[src]");
      for (const im of imgs) add(im.getAttribute("src"));
      const bgs = region.querySelectorAll('[style*="background-image"]');
      for (const b of bgs) add(b.getAttribute("style"));
    }
    return ids;
  }

  // A progressive mp4 sitting directly on the <video> (GIFs, some short clips).
  // Needs no API at all, so it works on sensitive posts too.
  function directVideoUrl(region) {
    const v =
      region.tagName === "VIDEO" ? region : region.querySelector("video");
    if (!v) return null;
    const src = v.currentSrc || v.src || "";
    if (/^https?:/i.test(src) && /\.mp4(\?|$)/i.test(src)) return src;
    const s = v.querySelector && v.querySelector("source[src]");
    if (s) {
      const u = s.getAttribute("src") || "";
      if (/^https?:/i.test(u) && /\.mp4(\?|$)/i.test(u)) return u;
    }
    return null;
  }

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
      const mids = regionMediaIds(r);
      if (mids.length) return "m:" + mids[0];
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
      if (isVideo(r)) enterVideo(r);
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
      if (r === hoverVideo) leaveVideo();
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

  // ---- pointer-trace gestures (circle / zig-zag) ----------------------------
  //
  // Instead of counting hover in/out, this watches the actual pointer PATH while
  // it stays over one piece of media:
  //
  //   circle  — sum the signed turn angle between consecutive steps. A real loop
  //             keeps turning the same way, so the sum reaches ±360°; ordinary
  //             wobble cancels itself out because the signs alternate.
  //   zig-zag — track the extreme reached along one axis; every time the pointer
  //             comes back the other way by at least TR.seg px, that's a swing.
  //
  // Both run on the SAME sample buffer and reset whenever the pointer leaves the
  // region or goes quiet for longer than the time window, so a gesture always has
  // to be one continuous, deliberate motion.

  const MIN_STEP = 4; // px — ignore sub-pixel jitter between samples

  function resetZig(z, v, now) {
    z.dir = 0;
    z.ext = v;
    z.count = 0;
    z.since = now;
  }

  function resetTrace(region, x, y, now) {
    trRegion = region || null;
    trPts = [];
    const t = now || Date.now();
    resetZig(zzX, x || 0, t);
    resetZig(zzY, y || 0, t);
  }

  // One axis of the zig-zag detector. Returns the swing count so far.
  function feedZig(z, v, now) {
    if (now - z.since > TR.window) resetZig(z, v, now); // too slow -> start over
    if (z.dir === 0) {
      if (v - z.ext >= TR.seg) {
        z.dir = 1;
        z.ext = v;
        z.count = 1;
        z.since = now;
      } else if (z.ext - v >= TR.seg) {
        z.dir = -1;
        z.ext = v;
        z.count = 1;
        z.since = now;
      }
      return z.count;
    }
    if (z.dir === 1) {
      if (v > z.ext) z.ext = v;
      else if (z.ext - v >= TR.seg) {
        z.dir = -1;
        z.ext = v;
        z.count++;
      }
    } else {
      if (v < z.ext) z.ext = v;
      else if (v - z.ext >= TR.seg) {
        z.dir = 1;
        z.ext = v;
        z.count++;
      }
    }
    return z.count;
  }

  // Signed turn accumulated over the WHOLE buffered path. Recomputed from the
  // buffer each time (it only holds one time window of samples) so that old
  // samples rolling out of the window take their contribution with them —
  // otherwise a long slow drift would eventually fake a loop.
  function circleHit() {
    if (trPts.length < 6) return false;

    let sum = 0;
    let prev = null;
    let anchor = trPts[0];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;

    for (const p of trPts) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;

      const vx = p.x - anchor.x;
      const vy = p.y - anchor.y;
      if (Math.hypot(vx, vy) < MIN_STEP) continue; // jitter -> not a real step
      if (prev) {
        let d = Math.atan2(vy, vx) - Math.atan2(prev.y, prev.x);
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        // A near-180° flip is a reversal, not a turn — never a loop.
        if (Math.abs(d) < Math.PI * 0.9) sum += d;
      }
      prev = { x: vx, y: vy };
      anchor = p;
    }

    // One traversal of a closed loop turns exactly 360°, but we can only measure
    // the turn BETWEEN steps, so a perfect single lap lands a step short. Allow
    // ~17° of slack; far too little for wobble to sneak past.
    if (Math.abs(sum) < TR.turns * 2 * Math.PI - 0.3) return false;
    // Big enough to be a deliberate circle rather than a wrist twitch?
    return Math.min(x1 - x0, y1 - y0) >= TR.radius * 2;
  }

  // Fire once, then arm the same per-media cooldown the hover gesture uses.
  // Either way the buffer starts over, so one gesture can only fire once and a
  // cooled-down gesture doesn't fire the moment the cooldown expires.
  function traceHit(region, x, y) {
    const now = Date.now();
    const c = counterFor(mediaKey(region));
    resetTrace(region, x, y, now);
    if (now < c.cooldownUntil) return;
    c.cooldownUntil = now + COOLDOWN;
    c.leaves = [];
    trigger(region);
  }

  document.addEventListener(
    "mousemove",
    (e) => {
      if (!TR.on) return;
      if (e.buttons) return; // dragging / selecting is not a gesture

      const r = regionOf(e.target);
      if (!r) {
        if (trRegion) resetTrace(null);
        return;
      }

      const now = Date.now();
      const x = e.clientX;
      const y = e.clientY;

      if (r !== trRegion) {
        resetTrace(r, x, y, now);
        trPts.push({ x, y, t: now });
        return;
      }

      const last = trPts[trPts.length - 1];
      if (last) {
        if (now - last.t > TR.window) {
          // Paused too long — treat what follows as a fresh gesture.
          resetTrace(r, x, y, now);
          trPts.push({ x, y, t: now });
          return;
        }
        if (Math.abs(x - last.x) + Math.abs(y - last.y) < 2) return;
      }

      trPts.push({ x, y, t: now });
      while (trPts.length && now - trPts[0].t > TR.window) trPts.shift();

      if (TR.circle && circleHit()) {
        traceHit(r, x, y);
        return;
      }
      if (TR.zx && feedZig(zzX, x, now) >= TR.swings) {
        traceHit(r, x, y);
        return;
      }
      if (TR.zy && feedZig(zzY, y, now) >= TR.swings) {
        traceHit(r, x, y);
      }
    },
    true
  );

  // Leaving the window clears any half-finished gesture. No capture here: with
  // capture we would also catch every descendant's mouseleave and reset the
  // buffer while the pointer is still happily inside the media.
  document.documentElement.addEventListener("mouseleave", () =>
    resetTrace(null)
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
      // X now serves timeline images as format=webp, but name=orig only
      // exists for the original upload format (jpg/png) -> webp+orig is 404
      // and Chrome saves the error page as .txt. Ask for jpg instead; the
      // background worker probes png/webp as fallbacks.
      if (format !== "jpg" && format !== "png" && format !== "gif") format = "jpg";
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

  // Look for variants we already intercepted, best source first.
  //   1. media id from the on-page poster  (works for NSFW / RT / quoted)
  //   2. tweet id from the article permalink
  //   3. the "*" bucket (payload shapes where no tweet id was found)
  function lookupVariants(region, ctx) {
    for (const mid of regionMediaIds(region)) {
      const l = capturedMedia[mid];
      if (l && l.length) return l;
    }
    if (ctx && captured[ctx.status] && captured[ctx.status].length) {
      return captured[ctx.status];
    }
    if (captured["*"] && captured["*"].length) return captured["*"];
    return null;
  }

  function downloadVideo(region) {
    const ctx = videoTweetId(region); // may be null / may be the wrong tweet
    const name = (u) =>
      urlBasename(u) || `${(ctx && ctx.status) || Date.now()}.mp4`;

    // 1) Variants intercepted from X's own responses.
    const cap = lookupVariants(region, ctx);
    if (cap && cap.length) {
      send(cap[0].url, name(cap[0].url), region); // sorted largest-first
      return;
    }

    // 2) A plain mp4 already on the <video> (GIFs, short clips) — no API needed,
    //    so this also covers sensitive posts.
    const direct = directVideoUrl(region);
    if (direct) {
      send(direct, name(direct), region);
      return;
    }

    toast("Fetching video…", true);

    // 3) The public syndication API. It returns nothing for sensitive/NSFW or
    //    protected posts, so treat a miss here as "keep waiting", not "fail".
    const askApi = (cb) => {
      if (!ctx) {
        cb(null);
        return;
      }
      chrome.runtime.sendMessage({ type: "getVideo", id: ctx.status }, (resp) => {
        if (chrome.runtime.lastError) {
          cb(null);
          return;
        }
        cb(resp && resp.ok && resp.variants && resp.variants.length
          ? resp.variants
          : null);
      });
    };

    askApi((vars) => {
      if (vars) {
        send(vars[0].url, name(vars[0].url), region);
        return;
      }
      // 4) X may still be loading the post's data (very common on a sensitive
      //    post you just revealed). Re-check the intercepted cache for a while
      //    before giving up.
      let tries = 0;
      const tick = () => {
        const late = lookupVariants(region, ctx) || null;
        if (late && late.length) {
          send(late[0].url, name(late[0].url), region);
          return;
        }
        const d2 = directVideoUrl(region);
        if (d2) {
          send(d2, name(d2), region);
          return;
        }
        if (++tries >= 6) {
          toast("No video found (試著先播放一次影片)", false);
          return;
        }
        setTimeout(tick, 500);
      };
      setTimeout(tick, 400);
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

  // ---- 修正 X 偶爾算錯的 aspect-ratio ---------------------------------------
  //
  // 少數貼文的圖片外框會拿到像 `aspect-ratio: 0.0145833 / 1` 的值。
  // 0.0145833 = 1 / 68.5714,而 68.5714 正是 X 舊版用 `padding-bottom: 68.5714%`
  // 撐長寬比時的那個「百分比數值」—— 也就是少除了 100。結果高度變成寬度的
  // 68 倍,整張圖被拉成超級長條 (真實比例其實是 1.4583,一張正常的橫圖)。
  //
  // 對策:用圖片真正的 naturalWidth/naturalHeight 覆寫外框的 aspect-ratio。
  // `name=large` 只是縮邊長、比例不變,所以量到的比例可以直接信。圖還沒載入
  // 時,退而用「× 100 / ÷ 100」把百分比數值還原回比例。
  //
  // 只有在比例明顯離譜 (超出 1:10 ~ 10:1) 時才動手 —— 多圖貼文的外框本來就
  // 會故意用跟原圖不同的比例去裁切,那是正常的,不能碰。
  // content.css 另外有一道 max-height 保險絲,擋掉任何漏網的情況。

  const AR_MIN = 0.1; // 比這更窄 (太長) 就當作算錯
  const AR_MAX = 10; // 比這更寬 (太扁) 也一樣
  const AR_TOL = 0.02; // 差 2% 以內視為已經正確,不重寫

  // 往上找第一個自己帶 inline aspect-ratio 的祖先 (X 就是寫在那裡)。
  function arBoxOf(img) {
    let n = img.parentElement;
    for (let i = 0; i < 8 && n && n !== document.body; i++) {
      if (n.style && n.style.aspectRatio) return n;
      n = n.parentElement;
    }
    return null;
  }

  // "0.0145833 / 1" -> 0.0145833 ; "1.5" -> 1.5
  function parseAR(v) {
    const p = String(v).split("/");
    const a = parseFloat(p[0]);
    const b = p.length > 1 ? parseFloat(p[1]) : 1;
    if (!isFinite(a) || !isFinite(b) || !b) return NaN;
    return a / b;
  }

  function fixAspect(img) {
    const box = arBoxOf(img);
    if (!box) return;
    const cur = parseAR(box.style.aspectRatio);
    if (!isFinite(cur) || cur <= 0) return;
    if (cur >= AR_MIN && cur <= AR_MAX) return; // 正常範圍 -> 完全不碰

    const want =
      img.naturalWidth && img.naturalHeight
        ? img.naturalWidth / img.naturalHeight // 有實際尺寸就用實際尺寸
        : cur < AR_MIN
        ? cur * 100 // 還沒載入:還原百分比 -> 比例
        : cur / 100;

    if (!isFinite(want) || want <= 0) return;
    if (Math.abs(want - cur) <= cur * AR_TOL) return; // 本來就是這樣 (真的超長圖)

    box.style.setProperty("aspect-ratio", want + " / 1", "important");
    box.setAttribute("data-xid-ar", "fixed");
  }

  function scanAspect() {
    const imgs = document.querySelectorAll('img[src*="pbs.twimg.com/media"]');
    for (const im of imgs) {
      fixAspect(im);
      if (!im.complete && !im.__xidArBound) {
        im.__xidArBound = true;
        im.addEventListener("load", () => fixAspect(im), { once: true });
      }
    }
  }

  // X 會不斷 re-render 並蓋掉 inline style,所以要持續盯著。
  // 我們自己寫回去的值也會觸發這個 observer,但下一輪 cur 已經在正常範圍內,
  // fixAspect() 會直接 return,不會無限迴圈。
  let arTimer = null;
  function scheduleAspectScan() {
    if (arTimer) return;
    arTimer = setTimeout(() => {
      arTimer = null;
      scanAspect();
    }, 120);
  }

  new MutationObserver(scheduleAspectScan).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["style", "src"],
  });
  scanAspect();

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
    ANIMS.forEach((a) => pvEl.classList.toggle("xid-anim-" + a, a === pvAnimNow));
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
    // 「隨機」:每次要顯示前重抽一種效果。
    if (PV.anim === "random") {
      pvAnimNow = RANDOM_POOL[Math.floor(Math.random() * RANDOM_POOL.length)];
    }
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

  // ---- video hover + save hotkey --------------------------------------------
  //
  // Videos deliberately get no still preview (X keeps playing underneath), so
  // there is no preview box to hang the hotkey off. Instead we remember the
  // video region the pointer is currently over and let the same save key
  // download it. A small badge in the corner reminds you the key is live.

  function enterVideo(region) {
    hoverVideo = region;
    if (VIDEO_KEY && VIDEO_HINT && ENABLE_VIDEO) showVideoHint(region);
  }

  function leaveVideo() {
    hoverVideo = null;
    hideVideoHint();
  }

  // Fixed-positioned badge kept aligned to the video by a rAF loop, so it
  // follows the page as you scroll and never touches X's own layout.
  function showVideoHint(region) {
    if (!region.getBoundingClientRect) return;
    if (!vhEl) {
      vhEl = document.createElement("div");
      vhEl.className = "xid-vhint";
      document.documentElement.appendChild(vhEl);
    }
    vhEl.textContent = keyLabel() + " 存影片";
    if (vhAlive) return; // loop already running, just retargeted below
    vhAlive = true;
    (function sync() {
      if (!vhAlive || !vhEl) return;
      const r = hoverVideo && hoverVideo.getBoundingClientRect();
      if (r && r.width && r.height) {
        vhEl.style.display = "";
        vhEl.style.left = r.left + r.width - 8 + "px"; // CSS pulls it back in
        vhEl.style.top = r.top + 8 + "px";
      } else {
        vhEl.style.display = "none";
      }
      requestAnimationFrame(sync);
    })();
    requestAnimationFrame(() => vhEl && vhEl.classList.add("xid-show"));
  }

  function hideVideoHint() {
    vhAlive = false;
    if (vhEl) vhEl.classList.remove("xid-show");
  }

  // Save the hovered video, honouring the same per-media cooldown the gesture
  // uses so a held key can't fire a dozen downloads.
  function saveHoveredVideo() {
    const r = hoverVideo;
    if (!r || !document.contains(r)) return false;
    const now = Date.now();
    const c = counterFor(mediaKey(r));
    if (now < c.cooldownUntil) return true; // still cooling down: swallow the key
    c.cooldownUntil = now + COOLDOWN;
    c.leaves = [];
    downloadVideo(r);
    return true;
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
      const previewUp = !!(
        pvTarget &&
        pvEl &&
        pvEl.classList.contains("xid-show")
      );
      if (e.key === "Escape") {
        if (previewUp) hidePreview();
        return;
      }
      if (e.repeat) return; // holding the key must not queue downloads
      if (isTyping(e.target)) return;
      if (!matchesSaveKey(e)) return;

      // Image: the preview box is up -> save the original.
      if (previewUp) {
        e.preventDefault();
        e.stopPropagation();
        send(pvTarget.url, pvTarget.filename, pvRegion);
        return;
      }

      // Video: no preview, so use whichever video the pointer is over.
      if (VIDEO_KEY && ENABLE_VIDEO && hoverVideo) {
        if (saveHoveredVideo()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
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
