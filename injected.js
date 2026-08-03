// X Image & Video Downloader - MAIN world interception script
//
// Videos on X are served as HLS, so the real progressive mp4 URLs are not in
// the DOM. But because you are logged in, X's own GraphQL / API responses
// contain video_info.variants (full mp4s, including for sensitive posts).
// This script runs in the page's MAIN world, hooks fetch/XHR, scans responses
// for video_info.variants, groups them by TWEET id, and postMessage()s them to
// the content script.

(function () {
  if (window.__xidHooked) return;
  window.__xidHooked = true;

  function post(map) {
    if (!map || !Object.keys(map).length) return;
    window.postMessage({ __xidVideo: true, variants: map }, "*");
  }

  function resFromUrl(url) {
    const m = String(url).match(/\/(\d{2,5})x(\d{2,5})\//);
    return m ? m[1] + "x" + m[2] : "";
  }
  function areaFromUrl(url) {
    const m = String(url).match(/\/(\d{2,5})x(\d{2,5})\//);
    return m ? parseInt(m[1], 10) * parseInt(m[2], 10) : 0;
  }

  function normalize(variants) {
    const out = [];
    for (const v of variants) {
      if (v && v.content_type === "video/mp4" && v.url) {
        out.push({
          url: v.url,
          bitrate: v.bitrate || 0,
          res: resFromUrl(v.url),
          area: areaFromUrl(v.url),
        });
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

  // Determine whether this level is "a tweet"; if so, return its tweet id.
  function tweetIdOf(obj) {
    if (typeof obj.rest_id === "string" && /^\d+$/.test(obj.rest_id)) {
      return obj.rest_id;
    }
    const lg = obj.legacy || obj;
    if (
      lg &&
      typeof lg.id_str === "string" &&
      /^\d+$/.test(lg.id_str) &&
      (lg.full_text !== undefined ||
        lg.entities !== undefined ||
        lg.extended_entities !== undefined)
    ) {
      return lg.id_str;
    }
    return null;
  }

  // Recursively scan the JSON; video_info is bound to the id of its tweet.
  function scan(obj, map, depth, ctxId) {
    if (!obj || typeof obj !== "object" || depth > 16) return;

    const here = tweetIdOf(obj);
    if (here) ctxId = here;

    const vi =
      (obj.video_info &&
        Array.isArray(obj.video_info.variants) &&
        obj.video_info) ||
      (obj.legacy &&
        obj.legacy.video_info &&
        Array.isArray(obj.legacy.video_info.variants) &&
        obj.legacy.video_info) ||
      null;

    if (vi) {
      const uniq = normalize(vi.variants);
      if (uniq.length && ctxId) map[ctxId] = uniq;
    }

    if (Array.isArray(obj)) {
      for (const it of obj) scan(it, map, depth + 1, ctxId);
    } else {
      for (const k in obj) {
        const val = obj[k];
        if (val && typeof val === "object") scan(val, map, depth + 1, ctxId);
      }
    }
  }

  function handleText(text) {
    if (!text || text.indexOf("video_info") === -1) return;
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return;
    }
    const map = {};
    scan(data, map, 0, null);
    post(map);
  }

  function interesting(url) {
    return /\/graphql\//.test(url) || /\/i\/api\//.test(url);
  }

  // ---- hook fetch ----
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function () {
      return origFetch.apply(this, arguments).then((resp) => {
        try {
          const url =
            (resp && resp.url) ||
            (arguments[0] && arguments[0].url) ||
            String(arguments[0] || "");
          if (interesting(url)) {
            resp.clone().text().then(handleText).catch(() => {});
          }
        } catch (e) {}
        return resp;
      });
    };
  }

  // ---- hook XHR ----
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__xidUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("load", function () {
      try {
        const url = this.__xidUrl || "";
        if (interesting(url)) {
          const t =
            this.responseType === "" || this.responseType === "text"
              ? this.responseText
              : null;
          if (t) handleText(t);
        }
      } catch (e) {}
    });
    return origSend.apply(this, arguments);
  };
})();
