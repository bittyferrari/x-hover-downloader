// ===========================================================================
//  X Image & Video Downloader — SETTINGS (預設值 / defaults)
//
//  這裡是「預設值」。日常調整建議直接用擴充功能的「選項 / Options」頁面
//  (在 chrome://extensions 點本擴充功能的「詳細資料 → 擴充功能選項」),
//  那邊改完會即時生效、不用重新載入。
//
//  這個檔案的值會在「選項頁沒有設定 / 按下還原預設值」時使用。改這裡的話,
//  一樣到 chrome://extensions 按「Reload」再重新整理 X 分頁即可生效。
// ===========================================================================

window.XID_CONFIG = {
  // --- 功能開關 (true = 開啟, false = 關閉) ---
  ENABLE_IMAGE: true,   // 圖片下載
  ENABLE_VIDEO: true,   // 影片下載  ← 想關掉影片下載就改成 false

  // --- 手勢設定 ---
  ENABLE_GESTURE: true,       // 「快速來回 hover 自動下載」手勢總開關
  GESTURE_CYCLES: 3,          // over→out 要做幾次才觸發下載 (次數)
  GESTURE_WINDOW_SECONDS: 1.5,  // 上面那幾次要在幾秒內完成 (秒數)

  // --- 固定框大圖預覽 (Hover Zoom 風格) ---
  ENABLE_PREVIEW: true,     // 滑鼠移到圖片上時,在固定框裡顯示大圖
  PREVIEW_DELAY_MS: 0,      // 停留多久才顯示 (毫秒,0 = 立刻)
  // 預覽框位置:相對「瀏覽器視窗」的百分比邊距。
  // 例:LEFT 65 / RIGHT 1 / TOP 1 / BOTTOM 1
  //   = 從視窗左邊 65% 處開始,右、上、下各留 1%。
  PREVIEW_LEFT: 65,
  PREVIEW_RIGHT: 1,
  PREVIEW_TOP: 1,
  PREVIEW_BOTTOM: 1,
  PREVIEW_BACKDROP: true,   // 預覽框要不要底色 + 外框
  PREVIEW_INFO: true,       // 顯示圖片尺寸 / 快捷鍵提示

  // --- 預覽出現效果 ---
  // PREVIEW_ANIM 可用值:
  //   "none"        直接出現 (無動畫)
  //   "fade"        淡入淡出
  //   "slide-right" 從右邊滑進來
  //   "slide-left"  從左邊滑進來
  //   "slide-up"    從下往上滑進來
  //   "slide-down"  從上往下滑進來
  //   "zoom"        由小放大 (帶淡入)
  //   "zoom-out"    由大縮到定位 (帶淡入)
  //   "random"      隨機:每次顯示前從上面的效果隨機抽一種 (不含 "none")
  PREVIEW_ANIM: "random",
  PREVIEW_ANIM_MS: 100,     // 動畫時間 (毫秒)
  PREVIEW_ANIM_DISTANCE: 40, // 滑動類效果的位移距離 (px)

  // --- 存圖快捷鍵 (預覽顯示中按下即存檔) ---
  SAVE_KEY: "s",            // 單一按鍵,例如 "s" / "d" / "ArrowDown"
  SAVE_KEY_CTRL: false,     // 是否要同時按 Ctrl
  SAVE_KEY_ALT: false,      // 是否要同時按 Alt
  SAVE_KEY_SHIFT: false,    // 是否要同時按 Shift

  // --- 影片快捷鍵 ---
  // 影片不會跳出大圖預覽,所以改成「滑鼠停在影片上時按同一顆鍵」就下載。
  ENABLE_VIDEO_KEY: true,   // 影片也能用快捷鍵存檔
  VIDEO_KEY_HINT: true,     // 在影片右上角顯示「S 存影片」提示

  // --- 軌跡手勢 (在圖片/影片上「畫」出來的手勢) ---
  // 判斷的是滑鼠在同一張圖/影片上的移動軌跡,不需要移出元素。
  ENABLE_TRACE: true,          // 軌跡手勢總開關
  TRACE_CIRCLE: true,          // 畫圈 = 存檔
  TRACE_ZIGZAG_X: true,        // 左右來回抖動 = 存檔
  TRACE_ZIGZAG_Y: true,        // 上下來回抖動 = 存檔
  TRACE_WINDOW_SECONDS: 1.2,   // 整個手勢要在幾秒內完成
  TRACE_CIRCLE_TURNS: 1,       // 要畫幾圈 (可用 0.5 的倍數,例如 1.5)
  TRACE_CIRCLE_RADIUS: 25,     // 圈至少要多大 (半徑 px);太小的手抖不算
  TRACE_ZIGZAG_SWINGS: 4,      // 要來回反向幾次
  TRACE_ZIGZAG_MIN_PX: 30,     // 每一次來回至少要移動多少 px 才算一次

  // --- 多圖貼文顯示 ---
  GRID_MEDIA: true,   // true = 把左右滑的 carousel 攤平成一次看得到全部的網格
  GRID_COLUMNS: 2,    // 網格欄數 (2 = 每張約 50% 寬)

  // --- 其他 ---
  COOLDOWN_SECONDS: 3,  // 同一張圖/影片觸發後,幾秒內不再重複觸發
};
