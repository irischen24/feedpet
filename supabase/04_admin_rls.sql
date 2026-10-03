-- =====================================================================
-- 10. 管理員 RPC（每支都先檢查 is_admin()，並寫入 admin_actions）
-- =====================================================================
create or replace function public.admin_list_players(p_search text default null,
                                                     p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q text := lower(btrim(coalesce(p_search, '')));
        lim integer := least(greatest(coalesce(p_limit, 50), 1), 200);
        off integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform public._require_admin();
  return jsonb_build_object(
    'total', (select count(*) from public.profiles p
               where q = '' or position(q in p.username) > 0 or position(q in lower(p.display_name)) > 0),
    'rows', coalesce((select jsonb_agg(r order by r ->> 'created_at' desc) from (
      select jsonb_build_object(
        'id', p.id, 'username', p.username, 'display_name', p.display_name, 'role', p.role,
        'created_at', p.created_at, 'last_login_at', p.last_login_at, 'last_active_at', p.last_active_at,
        'fish', w.fish, 'bone', w.bone,
        'best_score', pp.best_score, 'total_battles', pp.total_battles, 'total_donated', pp.total_donated,
        'active_adoptions', (select count(*) from public.adoptions a where a.user_id = p.id and a.status = 'ACTIVE'),
        'sick', (select count(*) from public.adoptions a where a.user_id = p.id and a.status = 'ACTIVE'
                   and a.disease_code is not null)) as r
      from public.profiles p
      left join public.wallets w on w.user_id = p.id
      left join public.player_progress pp on pp.user_id = p.id
      where q = '' or position(q in p.username) > 0 or position(q in lower(p.display_name)) > 0
      order by p.created_at desc limit lim offset off) x), '[]'::jsonb));
end $$;

create or replace function public.admin_get_player(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._require_admin();
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'USER_NOT_FOUND'; end if;
  return jsonb_build_object(
    'profile', (select to_jsonb(p) from public.profiles p where p.id = p_user_id),
    'wallet', (select to_jsonb(w) from public.wallets w where w.user_id = p_user_id),
    'progress', (select to_jsonb(pp) from public.player_progress pp where pp.user_id = p_user_id),
    'adoptions', coalesce((select jsonb_agg(public._adoption_json(a.id) || jsonb_build_object(
                    'status', a.status, 'ended_at', a.ended_at, 'end_reason', a.end_reason) order by a.adopted_at desc)
                   from (select * from public.adoptions where user_id = p_user_id
                          order by adopted_at desc limit 50) a), '[]'::jsonb),
    'inventory', coalesce((select jsonb_agg(to_jsonb(i)) from public.inventory i where i.user_id = p_user_id), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(to_jsonb(s) - 'spawn_plan' order by s.started_at desc)
                   from (select * from public.game_sessions where user_id = p_user_id
                          order by started_at desc limit 20) s), '[]'::jsonb),
    'logins', coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc)
                   from (select * from public.login_logs where user_id = p_user_id
                          order by created_at desc limit 20) l), '[]'::jsonb));
end $$;

create or replace function public.admin_grant_currency(p_user_id uuid, p_fish integer, p_bone integer, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w public.wallets;
begin
  perform public._require_admin();
  if coalesce(p_fish, 0) not between -100000 and 100000 or coalesce(p_bone, 0) not between -100000 and 100000
     or (coalesce(p_fish, 0) = 0 and coalesce(p_bone, 0) = 0) then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 200 then raise exception 'REASON_REQUIRED'; end if;
  w := public._wallet_change(p_user_id, coalesce(p_fish, 0), coalesce(p_bone, 0), 'ADMIN_REWARD', 'admin', (select auth.uid())::text);
  perform public._admin_log('ADMIN_REWARD', p_user_id, 'wallets', p_user_id::text,
          jsonb_build_object('fish', p_fish, 'bone', p_bone, 'reason', p_reason));
  return to_jsonb(w);
end $$;

create or replace function public.admin_grant_item(p_user_id uuid, p_item_code text, p_qty integer, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_admin();
  if p_qty is null or p_qty = 0 or p_qty not between -999 and 999 then raise exception 'INVALID_QTY'; end if;
  if not exists (select 1 from public.items where code = p_item_code) then raise exception 'ITEM_NOT_FOUND'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'USER_NOT_FOUND'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 200 then raise exception 'REASON_REQUIRED'; end if;
  if p_qty > 0 then perform public._add_item(p_user_id, p_item_code, p_qty);
  else perform public._consume_item(p_user_id, p_item_code, -p_qty); end if;
  perform public._admin_log('ADMIN_ITEM_GRANT', p_user_id, 'inventory', p_item_code,
          jsonb_build_object('qty', p_qty, 'reason', p_reason));
  return jsonb_build_object('item_code', p_item_code,
    'qty', (select qty from public.inventory where user_id = p_user_id and item_code = p_item_code));
end $$;

-- 可修改：stamina / trust / level / exp / disease_code（null=治癒）/ status=RELEASED / reset_feed_timer
create or replace function public.admin_update_adoption(p_adoption_id uuid, p_patch jsonb, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.adoptions; ct public.character_types; before jsonb;
begin
  perform public._require_admin();
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 200 then raise exception 'REASON_REQUIRED'; end if;
  select * into a from public.adoptions where id = p_adoption_id for update;
  if not found then raise exception 'ADOPTION_NOT_FOUND'; end if;
  if jsonb_typeof(p_patch) <> 'object' then raise exception 'INVALID_PATCH'; end if;
  ct := public._adoption_type(a.id);
  before := to_jsonb(a);

  if p_patch ? 'stamina' then
    a.stamina := least(greatest(public._jint(p_patch, 'stamina', a.stamina), 0), ct.max_stamina);
  end if;
  if p_patch ? 'trust' then a.trust := least(greatest(public._jint(p_patch, 'trust', a.trust), 0), 100); end if;
  if p_patch ? 'level' then a.level := least(greatest(public._jint(p_patch, 'level', a.level), 1), 20); end if;
  if p_patch ? 'exp'   then a.exp   := greatest(public._jint(p_patch, 'exp', a.exp), 0); end if;
  if p_patch ? 'disease_code' then
    if jsonb_typeof(p_patch -> 'disease_code') = 'null' then
      a.disease_code := null; a.sick_since := null;
    elsif exists (select 1 from public.diseases where code = p_patch ->> 'disease_code') then
      a.disease_code := p_patch ->> 'disease_code'; a.sick_since := now();
    else raise exception 'INVALID_DISEASE'; end if;
  end if;
  if coalesce((p_patch ->> 'reset_feed_timer')::boolean, false) then a.last_fed_at := now(); end if;
  if p_patch ->> 'status' = 'RELEASED' and a.status = 'ACTIVE' then
    a.status := 'RELEASED'; a.ended_at := now(); a.end_reason := 'ADMIN';
  end if;

  update public.adoptions set stamina = a.stamina, trust = a.trust, level = a.level, exp = a.exp,
         disease_code = a.disease_code, sick_since = a.sick_since, last_fed_at = a.last_fed_at,
         status = a.status, ended_at = a.ended_at, end_reason = a.end_reason, stamina_updated_at = now()
   where id = a.id;
  perform public._admin_log('ADMIN_PLAYER_UPDATE', a.user_id, 'adoptions', a.id::text,
          jsonb_build_object('reason', p_reason, 'patch', p_patch, 'before', before));
  return public._adoption_json(a.id) || jsonb_build_object('status', a.status);
end $$;

create or replace function public.admin_update_profile(p_user_id uuid, p_display_name text, p_role text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.profiles; before jsonb;
begin
  perform public._require_admin();
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 200 then raise exception 'REASON_REQUIRED'; end if;
  select * into p from public.profiles where id = p_user_id for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  before := to_jsonb(p);
  if p_role is not null and p_role not in ('user','admin') then raise exception 'INVALID_ROLE'; end if;
  if p_role = 'user' and p.role = 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'LAST_ADMIN';
  end if;
  update public.profiles
     set display_name = coalesce(nullif(btrim(p_display_name), ''), display_name),
         role = coalesce(p_role, role)
   where id = p_user_id
  returning * into p;
  perform public._admin_log('ADMIN_PLAYER_UPDATE', p_user_id, 'profiles', p_user_id::text,
          jsonb_build_object('reason', p_reason, 'before', before,
                             'after', jsonb_build_object('display_name', p.display_name, 'role', p.role)));
  return to_jsonb(p);
end $$;

-- 初始化第一位管理員：只能在 SQL Editor（postgres）執行，且系統中尚無 admin 時才有效
create or replace function public.bootstrap_admin(p_username text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'ADMIN_ALREADY_EXISTS';
  end if;
  update public.profiles set role = 'admin' where username = lower(p_username);
  if not found then
    raise exception 'USER_NOT_FOUND: 請先在 Authentication > Users 建立 %@<EMAIL_DOMAIN>', p_username;
  end if;
  insert into public.admin_actions(action, target_table, target_id, payload)
  values ('ADMIN_BOOTSTRAP', 'profiles', lower(p_username), '{}'::jsonb);
  return 'OK: ' || lower(p_username) || ' is now admin';
end $$;

-- =====================================================================
-- 11. Row Level Security
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'game_config','profiles','wallets','wallet_ledger','character_types','skills','monsters','rooms',
    'items','diseases','care_tasks','shelters','animals','adoptions','task_completions','inventory',
    'placed_furniture','player_progress','game_sessions','charity_tasks','donations','sponsors',
    'sponsor_campaigns','login_logs','operation_logs','admin_actions'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- 遊戲定義表：所有人可讀，只有 admin 可寫
do $$
declare t text;
begin
  foreach t in array array['game_config','character_types','skills','monsters','rooms','items',
                           'diseases','care_tasks','shelters','animals','charity_tasks',
                           'sponsors','sponsor_campaigns'] loop
    execute format('drop policy if exists catalog_read on public.%I', t);
    execute format('create policy catalog_read on public.%I for select to anon, authenticated using (true)', t);
    execute format('drop policy if exists catalog_admin_write on public.%I', t);
    execute format('create policy catalog_admin_write on public.%I for all to authenticated
                    using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- 玩家資料：只能讀自己的；admin 可讀全部；沒有任何寫入 policy（只能經 RPC）
do $$
declare t text;
begin
  foreach t in array array['wallets','wallet_ledger','adoptions','task_completions','inventory',
                           'placed_furniture','player_progress','game_sessions','donations',
                           'operation_logs','login_logs'] loop
    execute format('drop policy if exists own_read on public.%I', t);
    execute format('create policy own_read on public.%I for select to authenticated
                    using (user_id = (select auth.uid()) or public.is_admin())', t);
  end loop;
end $$;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists admin_actions_read on public.admin_actions;
create policy admin_actions_read on public.admin_actions for select to authenticated
  using (public.is_admin());

-- =====================================================================
-- 12. 權限（Grants）— 欄位級別防提權
-- =====================================================================
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.game_config, public.character_types, public.skills, public.monsters, public.rooms,
  public.items, public.diseases, public.care_tasks, public.shelters, public.animals,
  public.charity_tasks, public.sponsors, public.sponsor_campaigns to anon, authenticated;
grant insert, update, delete on public.game_config, public.character_types, public.skills, public.monsters,
  public.rooms, public.items, public.diseases, public.care_tasks, public.shelters, public.animals,
  public.charity_tasks, public.sponsors, public.sponsor_campaigns to authenticated;   -- RLS 限 admin

grant select on public.profiles, public.wallets, public.wallet_ledger, public.adoptions,
  public.task_completions, public.inventory, public.placed_furniture, public.player_progress,
  public.game_sessions, public.donations, public.login_logs, public.operation_logs,
  public.admin_actions to authenticated;
grant update (display_name) on public.profiles to authenticated;   -- 只能改顯示名稱

-- 函式：先全部收回，再逐一開放
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.log_auth_event_anon(text, text, text) to anon, authenticated;

grant execute on function
  public.get_my_state(), public.get_animals(), public.adopt_animal(uuid, boolean),
  public.feed_pet(uuid, text), public.complete_care_task(uuid, text), public.rest_pet(uuid),
  public.buy_item(text, integer), public.use_medicine(uuid, text), public.save_room_layout(jsonb, jsonb),
  public.start_battle(uuid, text, text, text), public.end_battle(uuid, jsonb), public.abandon_battle(uuid),
  public.donate_fish(uuid, integer), public.get_charity_progress(), public.get_leaderboard(text, integer),
  public.log_events(jsonb), public.log_login(text, text),
  public.admin_list_players(text, integer, integer), public.admin_get_player(uuid),
  public.admin_grant_currency(uuid, integer, integer, text), public.admin_grant_item(uuid, text, integer, text),
  public.admin_update_adoption(uuid, jsonb, text), public.admin_update_profile(uuid, text, text, text)
to authenticated;
-- 內部函式（_ 開頭）、expire_adoptions、bootstrap_admin 不開放給前端

-- =====================================================================
-- 13. 排程：每 10 分鐘結束逾期認養（pg_cron 未啟用時略過，RPC 仍會 lazy 檢查）
-- =====================================================================
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('feedpet-expire-adoptions', '*/10 * * * *', 'select public.expire_adoptions()');
exception when others then
  raise notice 'pg_cron 未啟用（%），請至 Database > Extensions 開啟後重新執行本段。', sqlerrm;
end $$;

-- =====================================================================
-- 完成。接著：
--   1. Authentication > Users > Add user：feedpet@feedpet.local / feedpet2026（勾 Auto Confirm）
--   2. 執行：select public.bootstrap_admin('feedpet');
-- =====================================================================
