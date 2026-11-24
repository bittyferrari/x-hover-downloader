// X Image & Video Downloader - background service worker
//
// Images: URLs come straight from the DOM (content.js), so this worker just
//   downloads them.
// Videos: the content script first tries variants intercepted from the page
//   (injected.js). If none are available it asks here, and we query X's public
//   tweet API (cdn.syndication.twimg.com) for the progressive mp4 variants.
//
// Every download is de-duplicated: the same original URL is only saved once per
// browser session, so repeated gestures never create "(1) (2)" copies.

const STORE = "xid_downloaded"; // { url: true } in chrome.storage.session

// ---- image URL resolver ----------------------------------------------------
// name=orig only works with the original upload format. Try the likely
// combinations and return the first one that answers with an image.
const EXT_BY_TYPE = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

async function probe(url) {
  try {
    let r = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (r.status === 405) r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    const type = (r.headers.get("content-type") || "").split(";")[0].trim();
    const ext = EXT_BY_TYPE[type];
    return ext ? { url, ext } : null;
  } catch (e) {
    return null;
  }
}

async function resolveImage(rawUrl) {
  let base;
  try {
    base = new URL(rawUrl);
  } catch (e) {
    return null;
  }
  const first = base.searchParams.get("format") || "jpg";
  const tries = [];
  const add = (format, name) => {
    const u = new URL(base.toString());
    u.searchParams.set("format", format);
    u.searchParams.set("name", name);
    const s = u.toString();
    if (!tries.includes(s)) tries.push(s);
  };
  add(first, "orig");
  add("jpg", "orig");
  add("png", "orig");
  add("webp", "4096x4096");
  add("jpg", "4096x4096");
  add("webp", "large");
  for (const t of tries) {
    const r = await probe(t);
    if (r) return r;
  }
  return null;
}

// ---- syndication API (video fallback) -------------------------------------

function resFromUrl(url) {
  const m = url.match(/\/(\d{2,5})x(\d{2,5})\//);
  return m ? `${m[1]}x${m[2]}` : "";
}
function areaFromUrl(url) {
  const m = url.match(/\/(\d{2,5})x(\d{2,5})\//);
  return m ? parseInt(m[1], 10) * parseInt(m[2], 10) : 0;
}

function getToken(id) {
  // Same algorithm as react-tweet
  return ((Number(id) / 1e15) * Math.PI)
    .toString(6 ** 2)
    .replace(/(0+|\.)/g, "");
}

const FEATURES =
  "tfw_timeline_list:;tfw_follower_count_sunset:true;tfw_tweet_edit_backend:on;" +
  "tfw_refsrc_session:on;tfw_fosnr_soft_interventions_enabled:on;" +
  "tfw_show_birdwatch_pivots_enabled:on;tfw_show_business_verified_badge:on;" +
  "tfw_duplicate_scribes_to_settings:on;tfw_use_profile_image_shape_enabled:on;" +
  "tfw_show_blue_verified_badge:on;tfw_legacy_timeline_sunset:true;" +
  "tfw_show_gov_verified_badge:on;tfw_show_business_affiliate_badge:on;" +
  "tfw_tweet_edit_frontend:on";

function extractVariants(data) {
  const medias = [];
  if (data && Array.isArray(data.mediaDetails)) medias.push(...data.mediaDetails);
  if (data && data.video) medias.push(data.video);

  const out = [];
  for (const m of medias) {
    const vi = m && (m.video_info || (m.video && m.video.info));
    if (vi && Array.isArray(vi.variants)) {
      for (const v of vi.variants) {
        if (v && v.content_type === "video/mp4" && v.url) {
          out.push({
            url: v.url,
            bitrate: v.bitrate || 0,
            res: resFromUrl(v.url),
            area: areaFromUrl(v.url),
          });
        }
      }
    }
  }
  out.sort((a, b) => b.area - a.area || b.bitrate - a.bitrate);
  const seen = new Set();
  const uniq = [];
  for (const v of out) {
    const key = v.res || v.url;
    if (!seen.has(key)) {
      seen.add(key);
      uniq.push(v);
    }
  }
  return uniq;
}

async function fetchVariants(id) {
  const token = getToken(id);
  const url =
    `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en` +
    `&features=${encodeURIComponent(FEATURES)}&token=${token}`;
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  const data = await resp.json();
  return extractVariants(data);
}

// ---- download de-duplication ----------------------------------------------

async function getStore() {
  try {
    return (await chrome.storage.session.get([STORE]))[STORE] || {};
  } catch (e) {
    return {}; // storage must never block the actual download
  }
}

async function markStored(url) {
  try {
    const store = await getStore();
    store[url] = true;
    await chrome.storage.session.set({ [STORE]: store });
  } catch (e) {
    /* ignore */
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === "getVideo") {
    (async () => {
      let variants = [];
      try {
        variants = await fetchVariants(msg.id);
      } catch (e) {
        variants = [];
      }
      sendResponse({ ok: true, variants });
    })();
    return true;
  }

  if (msg.type !== "download") return;

  (async () => {
    // Already saved this session -> don't download again.
    const store = await getStore();
    if (store[msg.url]) {
      sendResponse({ ok: true, dup: true });
      return;
    }

    // pbs.twimg.com images: make sure the URL really returns an image, and
    // name the file after what the server actually sends.
    let dlUrl = msg.url;
    let dlName = msg.filename;
    if (/pbs\.twimg\.com\/media\//.test(msg.url)) {
      const r = await resolveImage(msg.url);
      if (!r) {
        sendResponse({ ok: false, error: "image not found (404)" });
        return;
      }
      dlUrl = r.url;
      dlName = msg.filename.replace(/\.[A-Za-z0-9]+$/, "") + "." + r.ext;
    }

    chrome.downloads.download(
      {
        url: dlUrl,
        filename: dlName,
        saveAs: false,
        conflictAction: "overwrite", // never spawn " (1)" duplicates
      },
      (downloadId) => {
        const ok = !chrome.runtime.lastError && downloadId !== undefined;
        if (ok) markStored(msg.url);
        sendResponse({
          ok,
          error: chrome.runtime.lastError && chrome.runtime.lastError.message,
        });
      }
    );
  })();

  return true; // keep the message channel open for the async response
});
