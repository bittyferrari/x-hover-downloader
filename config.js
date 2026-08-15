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
  GESTURE_CYCLES: 3,          // over→out 要做幾次才觸發下載 (次數)
  GESTURE_WINDOW_SECONDS: 1.5,  // 上面那幾次要在幾秒內完成 (秒數)

  // --- 多圖貼文顯示 ---
  GRID_MEDIA: true,   // true = 把左右滑的 carousel 攤平成一次看得到全部的網格
  GRID_COLUMNS: 2,    // 網格欄數 (2 = 每張約 50% 寬)

  // --- 其他 ---
  COOLDOWN_SECONDS: 3,  // 同一張圖/影片觸發後,幾秒內不再重複觸發
};
