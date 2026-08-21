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

  function post(map, byMedia) {
    const hasMap = map && Object.keys(map).length;
    const hasMedia = byMedia && Object.keys(byMedia).length;
    if (!hasMap && !hasMedia) return;
    window.postMessage(
      { __xidVideo: true, variants: map || {}, byMedia: byMedia || {} },
      "*"
    );
  }

  // The id inside an mp4 URL, e.g.
  //   .../ext_tw_video/1234567890123/pu/vid/720x1280/abc.mp4 -> 1234567890123
  //   .../amplify_video/1234567890123/vid/...                -> 1234567890123
  //   .../tweet_video/AbCdEf.mp4                             -> AbCdEf  (GIF)
  // This is the MEDIA id, and the exact same id appears in the <video poster>
  // thumbnail on the page. That makes it a far more reliable link between page
  // and intercepted data than the tweet id: it survives retweets, quoted
  // tweets and sensitive/NSFW posts, where the surrounding article permalink
  // frequently belongs to a different tweet than the video.
  function mediaIdFromUrl(url) {
    const s = String(url);
    let m = s.match(/\/(?:ext_tw_video|amplify_video)\/(\d+)\//);
    if (m) return m[1];
    m = s.match(/\/tweet_video\/([A-Za-z0-9_\-]+)\.mp4/);
    if (m) return m[1];
    return null;
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
          media: mediaIdFromUrl(v.url),
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
  // `byMedia` additionally indexes every variant list by its media id, which is
  // what the content script matches against the on-page <video poster>.
  function scan(obj, map, depth, ctxId, byMedia) {
    if (!obj || typeof obj !== "object" || depth > 24) return;

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
      if (uniq.length) {
        // Tweet-id index (may be missing on some payload shapes -> "*").
        const key = ctxId || "*";
        const prev = map[key];
        map[key] = prev && prev.length ? mergeLists(prev, uniq) : uniq;

        // Media-id index: the reliable one.
        const mid = uniq[0].media;
        if (mid) {
          const p = byMedia[mid];
          byMedia[mid] = p && p.length ? mergeLists(p, uniq) : uniq;
        }
      }
    }

    if (Array.isArray(obj)) {
      for (const it of obj) scan(it, map, depth + 1, ctxId, byMedia);
    } else {
      for (const k in obj) {
        const val = obj[k];
        if (val && typeof val === "object")
          scan(val, map, depth + 1, ctxId, byMedia);
      }
    }
  }

  // A tweet can carry more than one video; keep every variant we saw, best first.
  function mergeLists(a, b) {
    const out = a.concat(b);
    out.sort((x, y) => y.area - x.area || y.bitrate - x.bitrate);
    const seen = new Set();
    const uniq = [];
    for (const v of out) {
      if (!seen.has(v.url)) {
        seen.add(v.url);
        uniq.push(v);
      }
    }
    return uniq;
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
    const byMedia = {};
    scan(data, map, 0, null, byMedia);
    post(map, byMedia);
  }

  function interesting(url) {
    return (
      /\/graphql\//.test(url) ||
      /\/i\/api\//.test(url) ||
      /\/1\.1\//.test(url) ||
      /\/i\/videos\//.test(url)
    );
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
