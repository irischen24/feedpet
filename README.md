# 《需你認養》FeedPet

像素貓咪養成、60 秒守護戰、流浪動物公益助養的 Web Game。
前端：Vanilla JS + Canvas（GitHub Pages）。後端：Supabase（Auth + Postgres + RLS + RPC）。

## 目前進度：Phase 4–5 完成

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
