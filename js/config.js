// =====================================================================
// 《需你認養》FeedPet — Configuration Section
// 所有連線設定集中在這裡。anon key 可公開；service_role 絕對不可放進前端。
// =====================================================================
export const CONFIG = Object.freeze({
  GAME_NAME: '需你認養',
  PROJECT: 'FeedPet',

  SUPABASE_URL: 'https://ybgyimttmsqzfttbgbpx.supabase.co',
  SUPABASE_ANON_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InliZ3lpbXR0bXNxemZ0dGJnYnB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEwNDQ5MDksImV4cCI6MjEwNjYyMDkwOX0.qsK-NYEJByvWm1QaEYZpRjwt9SstGj8cTpttTzdonU0',

  // Supabase Auth 以 email 登入；玩家只輸入 username，前端轉成 username@EMAIL_DOMAIN。
  // 若註冊時出現 "invalid email"，改成你擁有的網域（例如 feedpet.example.com）。
  EMAIL_DOMAIN: 'feedpet.local',

  GAME_WIDTH: 1280,
  GAME_HEIGHT: 720,

  REQUEST_TIMEOUT_MS: 10000,
  LOG_FLUSH_INTERVAL_MS: 10000,
  LOG_QUEUE_MAX: 200,

  DEBUG: false,
});
