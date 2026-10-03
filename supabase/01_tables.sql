-- =====================================================================
-- 《需你認養》FeedPet — supabase_schema.sql
-- 直接貼到 Supabase SQL Editor 執行（可重複執行）。
--
-- 安全模型摘要
--   * 所有資料表啟用 RLS。
--   * 玩家「只能讀」自己的資料；所有寫入都經過 SECURITY DEFINER RPC，
--     由後端驗證後才改變分數、魚乾、背包、認養狀態。
--   * 管理員身分只看 public.profiles.role，前端無法自行變更。
--   * 前端只使用 anon key；本檔不需要也不使用 service_role。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. 參數表（後台可調）
-- ---------------------------------------------------------------------
create table if not exists public.game_config (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 1. 帳號
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  username       text not null unique
                   check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name   text not null
                   check (char_length(display_name) between 1 and 20
                          and display_name !~ '[<>[:cntrl:]]'),
  role           text not null default 'user' check (role in ('user','admin')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  last_login_at  timestamptz,
  last_active_at timestamptz
);

create table if not exists public.wallets (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  fish       integer not null default 0 check (fish >= 0),
  bone       integer not null default 0 check (bone >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_ledger (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  delta_fish  integer not null default 0,
  delta_bone  integer not null default 0,
  fish_after  integer not null,
  bone_after  integer not null,
  reason      text not null,
  ref_type    text,
  ref_id      text,
  created_at  timestamptz not null default now()
);
create index if not exists wallet_ledger_user_idx on public.wallet_ledger(user_id, created_at desc);

-- ---------------------------------------------------------------------
-- 2. 遊戲定義（Catalog）
-- ---------------------------------------------------------------------
create table if not exists public.character_types (
  code            text primary key,
  name            text not null,
  role_label      text not null,
  species         text not null default 'cat' check (species in ('cat','dog')),
  max_stamina     integer not null check (max_stamina > 0),
  attack          integer not null check (attack > 0),
  task_cost       integer not null check (task_cost > 0),
  base_battle_hp  integer not null check (base_battle_hp > 0),
  sprite_key      text not null,
  sort            integer not null default 0
);

create table if not exists public.skills (
  code            text primary key,
  name            text not null,
  trust_required  integer not null check (trust_required between 0 and 100),
  character_type  text references public.character_types(code),  -- null = 共用
  cooldown_ms     integer not null check (cooldown_ms > 0),
  effect          jsonb not null default '{}'::jsonb,
  description     text not null
);

create table if not exists public.monsters (
  code        text primary key,
  name        text not null,
  hp          integer not null,
  attack      integer not null,
  speed       integer not null,       -- 邏輯座標 px/s（1280×720）
  range       integer not null,
  ai          text not null,
  target      text not null check (target in ('player','food_box')),
  reward_fish integer not null,
  score       integer not null
);

create table if not exists public.rooms (
  code        text primary key,
  name        text not null,
  type        text not null check (type in ('home','arena')),
  background  text not null,
  config      jsonb not null default '{}'::jsonb   -- collision、spawn points、food box…
);

create table if not exists public.items (
  code         text primary key,
  name         text not null,
  type         text not null check (type in ('food','medicine','furniture','decor','card','special')),
  species      text not null default 'any' check (species in ('any','cat','dog')),
  price_fish   integer check (price_fish is null or price_fish >= 0),
  effect       jsonb not null default '{}'::jsonb,
  description  text not null default '',
  brand_info   jsonb,                 -- 合作品牌資訊（無合作時為 null）
  is_active    boolean not null default true,
  sort         integer not null default 0
);

create table if not exists public.diseases (
  code            text primary key,
  name            text not null,
  cause_text      text not null,
  care_text       text not null,
  edu_reference   text not null,
  cure_item_code  text not null references public.items(code)
);

create table if not exists public.care_tasks (
  code          text primary key,
  name          text not null,
  species       text not null default 'any' check (species in ('any','cat','dog')),
  trust_reward  integer not null default 0,
  fish_reward   integer not null default 0,
  description   text not null,
  sort          integer not null default 0
);

create table if not exists public.shelters (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text not null default '',
  contact     text not null default '',
  address     text not null default '',
  is_demo     boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.animals (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  character_type  text not null references public.character_types(code),
  shelter_id      uuid references public.shelters(id) on delete set null,
  species         text not null default 'cat' check (species in ('cat','dog')),
  max_adopters    integer not null default 100 check (max_adopters > 0),
  adopt_cost      integer not null default 100 check (adopt_cost >= 0),
  real_profile    jsonb not null default '{}'::jsonb,
  is_listed       boolean not null default true,
  is_demo         boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. 玩家狀態
-- ---------------------------------------------------------------------
create table if not exists public.adoptions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  animal_id           uuid not null references public.animals(id) on delete cascade,
  status              text not null default 'ACTIVE' check (status in ('ACTIVE','EXPIRED','RELEASED')),
  adopted_at          timestamptz not null default now(),
  last_fed_at         timestamptz not null default now(),   -- 72h 計時起點
  ended_at            timestamptz,
  end_reason          text,
  stamina             integer not null check (stamina >= 0),
  stamina_updated_at  timestamptz not null default now(),
  recovery_today      integer not null default 0,
  recovery_date       date,
  last_rest_at        timestamptz,
  trust               integer not null default 0 check (trust between 0 and 100),
  level               integer not null default 1 check (level between 1 and 20),
  exp                 integer not null default 0 check (exp >= 0),
  disease_code        text references public.diseases(code),
  sick_since          timestamptz,
  created_at          timestamptz not null default now()
);
create unique index if not exists adoptions_one_active_idx
  on public.adoptions(user_id, animal_id) where status = 'ACTIVE';
create index if not exists adoptions_animal_active_idx
  on public.adoptions(animal_id) where status = 'ACTIVE';
create index if not exists adoptions_fed_active_idx
  on public.adoptions(last_fed_at) where status = 'ACTIVE';
create index if not exists adoptions_user_idx on public.adoptions(user_id, status);

create table if not exists public.task_completions (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  adoption_id  uuid not null references public.adoptions(id) on delete cascade,
  task_code    text not null references public.care_tasks(code),
  game_date    date not null,
  full_reward  boolean not null,
  created_at   timestamptz not null default now()
);
-- 每項任務每天只有一次完整獎勵
create unique index if not exists task_completions_daily_reward_idx
  on public.task_completions(adoption_id, task_code, game_date) where full_reward;

create table if not exists public.inventory (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  item_code  text not null references public.items(code),
  qty        integer not null check (qty >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, item_code)
);

create table if not exists public.placed_furniture (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  item_code  text not null references public.items(code),
  x          integer not null check (x between 0 and 1280),
  y          integer not null check (y between 0 and 720),
  flipped    boolean not null default false,
  z          integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists placed_furniture_user_idx on public.placed_furniture(user_id);

create table if not exists public.player_progress (
  user_id               uuid primary key references public.profiles(id) on delete cascade,
  selected_adoption_id  uuid references public.adoptions(id) on delete set null,
  tutorial_step         integer not null default 0,
  room_theme            jsonb not null default '{}'::jsonb,
  best_score            integer not null default 0,
  total_battles         integer not null default 0,
  total_wins            integer not null default 0,
  total_donated         integer not null default 0,
  updated_at            timestamptz not null default now()
);

create table if not exists public.game_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  adoption_id      uuid not null references public.adoptions(id) on delete cascade,
  room_code        text not null references public.rooms(code),
  skill_code       text references public.skills(code),
  idempotency_key  text not null,
  spawn_plan       jsonb not null,
  status           text not null default 'PLAYING'
                     check (status in ('PLAYING','COMPLETED','FAILED','ABANDONED')),
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  score            integer not null default 0,
  fish_reward      integer not null default 0,
  result           jsonb,
  client_report    jsonb,
  unique (user_id, idempotency_key)
);
create index if not exists game_sessions_user_idx on public.game_sessions(user_id, started_at desc);
create index if not exists game_sessions_status_idx on public.game_sessions(status, started_at desc);

-- ---------------------------------------------------------------------
-- 4. 公益 / 企業（第一版以示範資料呈現）
-- ---------------------------------------------------------------------
create table if not exists public.charity_tasks (
  id          uuid primary key default gen_random_uuid(),
  shelter_id  uuid references public.shelters(id) on delete set null,
  title       text not null,
  description text not null default '',
  goal_fish   integer not null check (goal_fish > 0),
  is_active   boolean not null default true,
  is_demo     boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.donations (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  task_id    uuid not null references public.charity_tasks(id) on delete cascade,
  fish       integer not null check (fish > 0),
  created_at timestamptz not null default now()
);
create index if not exists donations_task_idx on public.donations(task_id);
create index if not exists donations_user_idx on public.donations(user_id);

create table if not exists public.sponsors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  logo_url    text,
  website     text,
  intro       text not null default '',
  is_demo     boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.sponsor_campaigns (
  id                   uuid primary key default gen_random_uuid(),
  sponsor_id           uuid not null references public.sponsors(id) on delete cascade,
  shelter_id           uuid references public.shelters(id) on delete set null,
  charity_task_id      uuid references public.charity_tasks(id) on delete set null,
  title                text not null,
  rule_text            text not null,
  twd_per_valid_battle integer not null default 0,
  cap_twd              integer not null default 0,
  pledged_twd          integer not null default 0,
  delivered_text       text not null default '',
  starts_at            timestamptz,
  ends_at              timestamptz,
  is_demo              boolean not null default true
);

-- ---------------------------------------------------------------------
-- 5. 日誌
-- ---------------------------------------------------------------------
create table if not exists public.login_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.profiles(id) on delete set null,
  username    text not null,
  success     boolean not null,
  event_type  text not null check (event_type in ('LOGIN_SUCCESS','LOGIN_FAILED','LOGOUT','SESSION_EXPIRED')),
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists login_logs_created_idx on public.login_logs(created_at desc);
create index if not exists login_logs_username_idx on public.login_logs(username, created_at desc);
create index if not exists login_logs_user_idx on public.login_logs(user_id, created_at desc);

create table if not exists public.operation_logs (
  id           bigint generated always as identity primary key,
  user_id      uuid references public.profiles(id) on delete set null,
  session_id   uuid references public.game_sessions(id) on delete set null,
  action       text not null,
  target_type  text,
  target_id    text,
  metadata     jsonb not null default '{}'::jsonb,
  source       text not null default 'server' check (source in ('server','client')),
  created_at   timestamptz not null default now()
);
create index if not exists operation_logs_user_idx on public.operation_logs(user_id, created_at desc);
create index if not exists operation_logs_action_idx on public.operation_logs(action, created_at desc);

create table if not exists public.admin_actions (
  id              bigint generated always as identity primary key,
  admin_id        uuid references public.profiles(id) on delete set null,
  action          text not null,
  target_user_id  uuid references public.profiles(id) on delete set null,
  target_table    text,
  target_id       text,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists admin_actions_created_idx on public.admin_actions(created_at desc);
