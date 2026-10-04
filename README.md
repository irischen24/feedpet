# 《需你認養》FeedPet

像素貓咪養成、60 秒守護戰、流浪動物公益助養的 Web Game。
前端：Vanilla JS + Canvas（GitHub Pages）。後端：Supabase（Auth + Postgres + RLS + RPC）。

## 目前進度：Phase 12 完成（全部完成）

- **Phase 11 響應式**：9 種尺寸 × 11 個畫面自動檢查，修正後 0 個問題；戰鬥中直橫切換正常。
- **Phase 12 整合測試**：在 PostgreSQL + PostgREST 上以實際 schema 與 RLS 測試 41 項，全部通過。
- 詳細結果見 [`TEST_REPORT.md`](TEST_REPORT.md)；測試腳本在 [`tests/`](tests/README.md)。

> 本次修正了 `start_battle` 的並發處理，**請在 Supabase SQL Editor 重新執行一次 `supabase/supabase_schema.sql`**（可重複執行，不影響現有資料）。

## Phase 10：ADMIN PANEL

管理員登入後，首頁會出現「管理後台」。按鈕只是介面；真正的權限由後端 `is_admin()` 與 RLS 判斷，
一般玩家就算從瀏覽器直接呼叫管理功能也會被拒絕（已用實際 PostgreSQL + PostgREST 測試）。

| 分頁 | 功能 |
|---|---|
| 總覽 | 玩家數、有效認養、24 小時戰鬥／勝場／登入／登入失敗 |
| 玩家 | 搜尋、分頁；點開可看資料、錢包、背包、認養、最近戰鬥與登入 |
| 玩家操作 | 發放或扣除魚乾／骨頭、發放道具、修改認養（體力、信任、等級、經驗、疾病、重設 72 小時、解除認養）、修改名稱與身分 |
| 遊戲紀錄 | game_sessions，依帳號、狀態篩選 |
| 登入日誌 | login_logs，依帳號、事件篩選（可快速找 LOGIN_FAILED） |
| 操作日誌 | operation_logs，依帳號、動作、來源（server／client）篩選 |
| Audit Log | admin_actions：所有管理員操作與設定修改，不可修改、不可刪除 |
| 遊戲設定 | game_config：認養上限、體力恢復、每日上限、外出籠、提示文字等 |
| 認養動物 | 上架／下架、認養上限、認養費、新增動物 |
| 收容所 | 名稱、聯絡、地址、介紹、示範資料標記 |

每個玩家操作都必須填寫原因，並與修改前的資料一起寫入 Audit Log。

## Phase 9：道具、照護、房間佈置、助養

在房間右側（手機在畫面下方）有四個按鈕：

| 按鈕 | 內容 | 後端 RPC |
|---|---|---|
| 照護 | 餵食、每日照護小遊戲（鏟貓砂、刷牙、逗貓棒、指甲）、休息、生病用藥 | `feed_pet`、`complete_care_task`、`rest_pet`、`use_medicine` |
| 商店 | 食物、藥物、家具、裝飾、道具、背包 | `buy_item` |
| 裝飾 | 拖曳擺放家具、翻轉、收回、地板與壁紙主題 | `save_room_layout` |
| 助養 | 把魚乾投入助養任務（示範資料） | `get_charity_progress`、`donate_fish` |

首頁也新增了「助養任務」按鈕。Phase 9 沒有修改 SQL。

### Phase 9 檔案

| 檔案 | 用途 |
|---|---|
| `js/ui/panels.js` | 照護、商店／背包、助養面板與 4 個照護小遊戲 |
| `js/game/homeFurniture.js` | 家具素材、擺放資料、主題背景、裝飾模式 |
| `js/game/furnitureArt.js` | 內建家具、地板／壁紙、商店圖示（依美術規格尺寸） |

## Phase 8：60 秒守護戰

從家裡的門出門 → 選戰場與技能 → 後端 `start_battle` 扣體力並產生出怪表 → 3 秒倒數 → 守護飼料箱 60 秒 → 後端 `end_battle` 驗證並發放魚乾。

### Phase 8 檔案

| 檔案 | 用途 |
|---|---|
| `js/game/battleScene.js` | 戰鬥流程、自動攻擊、技能、外出籠、戰鬥 HUD |
| `js/game/monster.js` | 怪物 AI（灰塵怪巡邏追擊、飢餓怪衝飼料箱、搗蛋怪之字形） |
| `js/game/monsterArt.js` | 內建怪物 Sprite Sheet（依美術規格的格子尺寸） |
| `js/engine/sprites.js` | Sprite Sheet 規格、繪製、動畫播放器 |

### 自行上傳美術

依《美術素材規格》把 PNG 放到 `assets/` 對應路徑即可，遊戲會優先使用；檔案不存在時用內建版本。
尺寸不符規格的圖會被略過，並在瀏覽器 Console（`?debug=1` 時也會跳提示）列出原因。

### 戰鬥平衡參數（前端，可直接調整）

| 參數 | 位置 | 目前值 |
|---|---|---|
| 自動攻擊間隔 | `battleScene.js` `AUTO_PERIOD` | 0.75 秒 |
| 一次揮爪最多命中 | `battleScene.js` `CLEAVE` | 3 隻 |
| 受傷後無敵時間 | `battleScene.js` `IFRAMES` | 0.8 秒 |
| 自動攻擊範圍 | `battleScene.js` `AUTO_RANGE` | 115 px |
| 飢餓怪啃飼料箱間隔 | `monster.js` `TUNING.boxCooldown` | 2.0 秒 |

怪物 HP／攻擊／速度在 Supabase `monsters` 表；飼料箱生命、每局秒數、外出籠在 `game_config` 表。

## Phase 7

開啟 `index.html` 就是遊戲本體：登入 → 首頁 → 認養區 → 我的房間 → 出門到戰場（練習模式）。
網址加上 `?debug=1` 可在「設定」開啟除錯資訊（FPS、碰撞框、房間、座標、API 錯誤）。

### Phase 6–7 檔案

| 檔案 | 用途 |
|---|---|
| `index.html`、`css/game.css` | 遊戲外殼、像素風 UI、直向／橫向響應式排版 |
| `js/main.js` | App 狀態機：LOADING → LOGIN → MENU → ADOPT / HOME ⇄ ARENA |
| `js/engine/game.js` | requestAnimationFrame + 固定步長 Game Loop、DEBUG 覆蓋層 |
| `js/engine/scaler.js` | 固定 1280×720 邏輯座標，畫布等比縮放 |
| `js/engine/inputManager.js` | 鍵盤、虛擬搖桿、觸控按鈕、點地板移動（Pointer Events） |
| `js/engine/collision.js` | 可行走多邊形 + 矩形碰撞，分軸解算 |
| `js/engine/assetManager.js` | 圖片載入與進度 |
| `js/engine/audioManager.js` | 合成音效 Placeholder、音樂／音效開關 |
| `js/game/room.js`、`roomScene.js` | Room 定義（碰撞、門、出生點、怪物出生點）與場景 |
| `js/game/player.js` | 貓咪角色：移動、方向、Idle／Walk 動畫、對話泡泡 |
| `js/game/roomArt.js` | 延伸場景與物件（後院、倉庫、門、飼料箱、木箱） |
| `js/game/dataStore.js` | 伺服器狀態快取、提醒文字 |
| `js/ui/uiManager.js` | 畫面、HUD、對話框、Toast、網路錯誤 RETRY |
| `assets/sprites/*.png` | 由原圖降採樣的原生像素 sprite（約 44×48） |
| `assets/rooms/room_home.png` | 房間原圖重新對齊為 427×240（×3 繪製） |

## Phase 4–5

| 檔案 | 用途 |
|---|---|
| `supabase/supabase_schema.sql` | 一次貼進 SQL Editor 執行（Tables、RLS、RPC、Triggers、Initial Data、pg_cron） |
| `supabase/01~04_*.sql` | 同內容拆檔，方便閱讀與版控 |
| `js/config.js` | Supabase URL 與 anon key（唯一存放處） |
| `js/net/supabaseClient.js` | REST / Auth 呼叫（不依賴 SDK） |
| `js/core/authManager.js` | 登入、註冊、Session 自動續期、登入日誌 |
| `js/core/logManager.js` | 有意義事件的批次日誌、離線佇列 |
| `js/core/errors.js` | 後端錯誤碼 → 中文訊息 |
| `tools/phase5-test.html` | 後端實機驗證台（非遊戲畫面） |

## Supabase 設定（依序）

1. **SQL Editor** → 貼上 `supabase/supabase_schema.sql` → Run。
   可以重複執行；Initial Data 使用 `on conflict do nothing`，不會覆蓋後台修改。
2. **Database → Extensions** → 開啟 `pg_cron`，再執行一次 schema 的第 13 段（排程每 10 分鐘結束逾期認養）。
   沒開也能運作：每個 RPC 都會先檢查逾期。
3. **Authentication → Sign In / Providers → Email** → 關閉 **Confirm email**。
   玩家用 username 登入，前端轉成 `username@feedpet.local`，這不是真的信箱。
4. **Authentication → Users → Add user**
   Email `feedpet@feedpet.local`、Password `feedpet2026`、勾選 Auto Confirm User。
5. **SQL Editor** → `select public.bootstrap_admin('feedpet');`
   只有 SQL Editor（postgres）能執行，且只在系統還沒有 admin 時有效。
6. 課堂 Demo 結束後，請到 Users 修改 feedpet 的密碼。

> 若註冊時出現 invalid email：把 `js/config.js` 的 `EMAIL_DOMAIN` 改成你擁有的網域，
> 第 4 步的管理員信箱也要用同一個網域。

## 部署到 GitHub Pages

1. 把整個資料夾推到 GitHub repo（例如 `feedpet`）。
2. Settings → Pages → Source：`Deploy from a branch`，Branch：`main` / `(root)`。
3. 開啟 `https://<你的帳號>.github.io/feedpet/tools/phase5-test.html` 驗證後端。
4. 本機測試請用 HTTP 伺服器（ES Modules 不能用 `file://` 開）：
   `npx serve .` 或 VS Code Live Server。

## 安全設計

- 前端只有 anon key；**永遠不要**把 service_role key 放進這個 repo。
- 所有表啟用 RLS。玩家只能 **讀** 自己的資料；任何寫入（魚乾、背包、認養、分數）都必須走後端 RPC。
- `profiles.role` 只有欄位層級的 `display_name` 可被玩家更新，並有 trigger 雙重防護。
- 戰鬥結算：後端產生出怪表，擊殺數不得超過實際生成數量，勝利需要伺服器計時滿 57 秒以上，每日魚乾有上限，重送不會重複發獎或重複扣體力。
- 登入日誌不記錄密碼、token、Authorization header。失敗登入有速率限制。
- 所有管理員操作寫入 `admin_actions`；管理員透過 REST 修改遊戲定義表也會由 trigger 自動記錄。

## 已知限制

- 這是前端運算的動作遊戲，後端只能做「合理性驗證」，無法 100% 防止修改瀏覽器記憶體的作弊。
- 登入成功事件由前端在拿到 token 後回報；需要伺服器端真實紀錄時，可對照 Supabase 內建的 Auth Logs。
- 照護小遊戲（刷牙、鏟砂）是否「真的完成」由前端判定；獎勵受每日一次限制，影響有限。
