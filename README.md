# X Image & Video Downloader (Chrome Extension)

Download images **and videos** on X (Twitter) with a quick mouse gesture — no
buttons, no menus.

## How It Works

Move your mouse **onto a photo/video and off it, then onto it and off again** —
two fast hover-in / hover-out cycles within **2 seconds**. That gesture
downloads the media automatically: images at their **original (largest) size**,
videos at the **highest available quality**.

**Images.** Each photo is wrapped in its own element
(`[data-testid="tweetPhoto"]`), so the gesture works on a single-image post and
on any individual image inside a multi-image post. The extension reads the image
URL straight from the page and rewrites it to `...?format=<jpg|png>&name=orig`
for the full-size original rather than the on-screen thumbnail.

**Videos.** Videos are HLS-streamed, so the real mp4 URL isn't in the DOM.
`injected.js` runs in the page and intercepts X's own GraphQL/API responses to
collect the progressive mp4 variants for each tweet (this also covers sensitive
posts, since you're logged in). The gesture then picks the largest resolution
and downloads it. If interception hasn't caught the tweet yet, it falls back to
X's public tweet API (`cdn.syndication.twimg.com`).

## Fixed-box hover preview + save hotkey

Hovering a photo shows it **enlarged inside a box at a fixed place on screen**
(Hover Zoom+ style, but the box never follows the cursor). While the preview is
up, pressing your chosen key saves that image at original size.

The box position is given as **viewport percentages** — `left`, `right`, `top`,
`bottom` — the default `left 65% / right 1% / top 1% / bottom 1%` fills the
right-hand third of the window. The image is scaled to
fit inside that box (aspect ratio kept). The on-screen thumbnail appears
instantly and is swapped for the original-size image as soon as it loads (with
no hover delay by default); the
info strip under it shows the original dimensions and the current hotkey.

The preview box is `pointer-events: none`, so it never blocks clicks or the
hover gesture underneath it.

- **Hotkey** — default `S`. Set it on the Options page: click the key field and
  press the key you want (modifiers you hold are picked up, and there are
  Ctrl / Alt / Shift toggles too). The key is ignored while you're typing in an
  input, a textarea, or X's own composer.
- **Esc** closes the preview; clicking anywhere also dismisses it.
- Videos have no still preview — the gesture still downloads them.

## Installation

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** (top-left).
4. Select this folder, `x-image-downloader`.
5. Done.

## Important: turn off the "ask where to save" prompt

For the gesture to save instantly (and silently), Chrome must **not** pop up a
"Save As" dialog for every download. Go to `chrome://settings/downloads` and
turn **off**:

> **Ask where to save each file before downloading**

Otherwise every gesture opens a save dialog, which defeats the one-motion
workflow — especially when circling over a multi-image post.

## Usage

1. Open any X page with media (timeline, post, or media tab).
2. On a photo or video, quickly hover on → off → on → off within the time
   window. Each image counts its cycles independently, so on a multi-image post
   you can **quickly circle the mouse over all the photos** to download them all
   at once. A single clean pass (each image once) won't trigger anything.
3. A frame is drawn over the media itself: **red "⬇ Downloading…"** while it
   saves, then it flips to **green "✔ Saved"** when done (staying red on
   failure). The frame follows the media as you scroll, and a matching toast
   appears at the bottom. The file is saved to your Downloads folder.

Filenames keep the site's own name:

- Images: the media id from the URL, e.g. `HOuePYAakAEdsoF.jpg` — the same name
  you'd get downloading the image normally.
- Videos: the mp4's own filename from the URL, e.g. `abcXYZ.mp4`.

> For videos, the variant list is usually captured as the timeline loads, so you
> don't need to play the video first. If a fresh video doesn't download, let it
> load/play for a second and try the gesture again.

## Settings

**Easiest: the Options page.** At `chrome://extensions`, open this extension's
**Details → Extension options** (or right-click the toolbar icon → Options). You
get toggles and number fields for everything below, and changes **apply
instantly — no reload needed**. Saved values are stored in `chrome.storage.sync`
and override the defaults in `config.js`. "還原預設值 / Reset" clears them and
falls back to `config.js`.

**Defaults: `config.js`.** This file holds the default values (used when the
Options page hasn't set something, or after a reset). If you edit it directly,
reload the extension at `chrome://extensions` and refresh the X tab.

Available settings:

- `ENABLE_IMAGE` — turn image download on/off.
- `ENABLE_VIDEO` — turn video download on/off.
- `ENABLE_PREVIEW` — fixed-box hover preview on/off.
- `PREVIEW_DELAY_MS` — how long the pointer must rest before the preview shows.
- `PREVIEW_LEFT` / `PREVIEW_RIGHT` / `PREVIEW_TOP` / `PREVIEW_BOTTOM` — the
  preview box position, as a percentage inset from each edge of the window.
- `PREVIEW_ANIM` — how the preview appears/disappears: `none`, `fade`,
  `slide-right`, `slide-left`, `slide-up`, `slide-down`, `zoom`, `zoom-out`,
  or `random` (picks a different effect each time the preview shows, never
  `none`) — default `random`.
- `PREVIEW_ANIM_MS` — animation duration in ms (default `100`).
- `PREVIEW_ANIM_DISTANCE` — how far the slide effects travel, in px (default `40`).
- `PREVIEW_BACKDROP` — dark panel + border behind the image (off = image only).
- `PREVIEW_INFO` — the dimensions / hotkey strip under the image.
- `SAVE_KEY`, `SAVE_KEY_CTRL`, `SAVE_KEY_ALT`, `SAVE_KEY_SHIFT` — the save
  hotkey used while the preview is showing.
- `ENABLE_GESTURE` — the hover gesture on/off (turn it off if you only want the
  hotkey).
- `GESTURE_CYCLES` — how many over→out cycles are required (default `2`).
- `GESTURE_WINDOW_SECONDS` — the time window for the whole gesture (default `2`).
- `COOLDOWN_SECONDS` — after a trigger, how long before the same media can
  trigger again (default `3`).

Raise `GESTURE_CYCLES` to `3` or lower `GESTURE_WINDOW_SECONDS` if you get
accidental downloads while browsing.

## Files

- `manifest.json` — extension settings and permissions (`downloads`, `storage`)
- `config.js` — default settings (feature on/off, gesture cycles, seconds window)
- `options.html` / `options.js` — the Options page UI (saves to `chrome.storage.sync`)
- `content.js` — detects the hover gesture; resolves the image URL or the video's tweet id
- `injected.js` — MAIN-world hook that intercepts GraphQL/API responses for video variants
- `content.css` — toast, download frame, media grid and preview-box styles
- `background.js` — performs the download; video-variant fallback via the tweet API

## Notes

- Works on `x.com` / `twitter.com`.
- Images: only those served from `pbs.twimg.com/media` (post photos), not avatars or emoji.
- Videos: highest resolution is chosen automatically.
- **You may occasionally download an unintended image.** Because triggering is
  gesture-based, quickly moving the mouse across a post can catch a neighbouring
  photo you didn't mean to grab. Raise `GESTURE_CYCLES` or lower
  `GESTURE_WINDOW_SECONDS` in `config.js` to make it less sensitive.
- **Video downloads may sometimes fail.** The mp4 URL has to be captured from
  X's own API responses; if it hasn't been captured yet, let the video load or
  play for a second and try the gesture again.
- **This extension may break if X (Twitter) changes its site.** It relies on X's
  current page structure and API responses, so a site update or change on X's
  side can stop it from working until the code is updated.
- After changing code, reload the extension at `chrome://extensions` and refresh
  the X tab.

## Disclaimer

For educational and personal use only. Not affiliated with or endorsed by X
(Twitter). You are responsible for complying with local copyright laws and X's
Terms of Service.
