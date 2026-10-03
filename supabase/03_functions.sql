-- =====================================================================
-- 7. 共用函式（內部用，底線開頭，不開放給前端）
-- =====================================================================
create or replace function public._cfg_int(p_key text) returns integer
language sql stable security definer set search_path = '' as $$
  select (value #>> '{}')::integer from public.game_config where key = p_key
$$;

create or replace function public._cfg_bool(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((value #>> '{}')::boolean, false) from public.game_config where key = p_key
$$;

create or replace function public._game_date() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Taipei')::date
$$;

-- 安全地從 jsonb 取整數，非整數一律回傳預設值
create or replace function public._jint(p jsonb, k text, d integer default 0) returns integer
language sql immutable set search_path = '' as $$
  select case
    when p is not null and jsonb_typeof(p) = 'object' and jsonb_typeof(p -> k) = 'number'
         and (p ->> k) ~ '^-?[0-9]{1,9}$'
    then (p ->> k)::integer else d end
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  )
$$;

create or replace function public._require_user() returns uuid
language plpgsql stable set search_path = '' as $$
declare v uuid := (select auth.uid());
begin
  if v is null then raise exception 'AUTH_REQUIRED'; end if;
  return v;
end $$;

create or replace function public._require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := public._require_user();
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return v;
end $$;

create or replace function public._server_log(
  p_user uuid, p_session uuid, p_action text, p_target_type text, p_target_id text, p_meta jsonb
) returns void
language sql security definer set search_path = '' as $$
  insert into public.operation_logs(user_id, session_id, action, target_type, target_id, metadata, source)
  values (p_user, p_session, p_action, p_target_type, p_target_id, coalesce(p_meta, '{}'::jsonb), 'server')
$$;

create or replace function public._admin_log(
  p_action text, p_target_user uuid, p_target_table text, p_target_id text, p_payload jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := (select auth.uid());
begin
  insert into public.admin_actions(admin_id, action, target_user_id, target_table, target_id, payload)
  values (v_admin, p_action, p_target_user, p_target_table, p_target_id, coalesce(p_payload, '{}'::jsonb));
  perform public._server_log(v_admin, null, p_action, p_target_table, p_target_id,
          jsonb_build_object('target_user_id', p_target_user) || coalesce(p_payload, '{}'::jsonb));
end $$;

-- 錢包異動：鎖定該列、檢查餘額、寫入帳本
create or replace function public._wallet_change(
  p_user uuid, p_fish integer, p_bone integer, p_reason text, p_ref_type text, p_ref_id text
) returns public.wallets
language plpgsql security definer set search_path = '' as $$
declare w public.wallets;
begin
  select * into w from public.wallets where user_id = p_user for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;
  if w.fish + p_fish < 0 or w.bone + p_bone < 0 then raise exception 'NOT_ENOUGH_FISH'; end if;
  update public.wallets
     set fish = fish + p_fish, bone = bone + p_bone, updated_at = now()
   where user_id = p_user
  returning * into w;
  insert into public.wallet_ledger(user_id, delta_fish, delta_bone, fish_after, bone_after, reason, ref_type, ref_id)
  values (p_user, p_fish, p_bone, w.fish, w.bone, p_reason, p_ref_type, p_ref_id);
  return w;
end $$;

create or replace function public._add_item(p_user uuid, p_code text, p_qty integer) returns void
language sql security definer set search_path = '' as $$
  insert into public.inventory(user_id, item_code, qty) values (p_user, p_code, p_qty)
  on conflict (user_id, item_code)
  do update set qty = public.inventory.qty + excluded.qty, updated_at = now()
$$;

create or replace function public._consume_item(p_user uuid, p_code text, p_qty integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.inventory set qty = qty - p_qty, updated_at = now()
   where user_id = p_user and item_code = p_code and qty >= p_qty;
  if not found then raise exception 'ITEM_NOT_ENOUGH'; end if;
end $$;

-- 72 小時未餵食 → 結束認養（cron 與各 RPC 都會呼叫）
create or replace function public.expire_adoptions() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_hours integer := public._cfg_int('feed_expire_hours'); n integer;
begin
  with ex as (
    update public.adoptions
       set status = 'EXPIRED', ended_at = now(), end_reason = 'NOT_FED'
     where status = 'ACTIVE'
       and last_fed_at < now() - make_interval(hours => v_hours)
    returning id, user_id, animal_id
  ), lg as (
    insert into public.operation_logs(user_id, action, target_type, target_id, metadata, source)
    select user_id, 'ADOPTION_EXPIRED', 'adoption', id::text,
           jsonb_build_object('animal_id', animal_id), 'server'
      from ex
    returning 1
  )
  select count(*) into n from lg;
  return n;
end $$;

-- 鎖定並取得玩家自己的有效認養
create or replace function public._lock_adoption(p_user uuid, p_adoption uuid) returns public.adoptions
language plpgsql security definer set search_path = '' as $$
declare a public.adoptions;
begin
  select * into a from public.adoptions
   where id = p_adoption and user_id = p_user for update;
  if not found or a.status <> 'ACTIVE' then raise exception 'ADOPTION_NOT_FOUND'; end if;
  return a;
end $$;

create or replace function public._adoption_type(p_adoption uuid) returns public.character_types
language sql stable security definer set search_path = '' as $$
  select ct.* from public.adoptions a
    join public.animals an on an.id = a.animal_id
    join public.character_types ct on ct.code = an.character_type
   where a.id = p_adoption
$$;

-- 自然恢復體力（生病時暫停），每日恢復上限
create or replace function public._apply_recovery(p_adoption uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.adoptions; ct public.character_types;
  per_hour integer := public._cfg_int('stamina_natural_per_hour');
  cap integer := public._cfg_int('daily_recovery_cap');
  today date := public._game_date();
  rec integer; raw integer; gain integer; new_ts timestamptz;
begin
  select * into a from public.adoptions where id = p_adoption for update;
  if not found or a.status <> 'ACTIVE' then return; end if;
  if a.disease_code is not null or per_hour <= 0 then
    update public.adoptions set stamina_updated_at = now() where id = a.id;
    return;
  end if;
  ct := public._adoption_type(a.id);
  rec := case when a.recovery_date = today then a.recovery_today else 0 end;
  raw := floor(extract(epoch from now() - a.stamina_updated_at) / 3600.0 * per_hour)::integer;
  if raw <= 0 then return; end if;
  gain := greatest(0, least(raw, ct.max_stamina - a.stamina, cap - rec));
  if a.stamina + gain >= ct.max_stamina or gain < raw then
    new_ts := now();
  else
    new_ts := a.stamina_updated_at + make_interval(secs => raw * 3600.0 / per_hour);
  end if;
  update public.adoptions
     set stamina = stamina + gain, recovery_today = rec + gain,
         recovery_date = today, stamina_updated_at = new_ts
   where id = a.id;
end $$;

-- 經驗與升級：門檻 = 50 × 等級
create or replace function public._add_exp(p_adoption uuid, p_exp integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare a public.adoptions; lvl integer; ex integer; gained integer := 0;
        max_lvl integer := public._cfg_int('max_level');
begin
  select * into a from public.adoptions where id = p_adoption for update;
  lvl := a.level; ex := a.exp + greatest(p_exp, 0);
  while lvl < max_lvl and ex >= 50 * lvl loop
    ex := ex - 50 * lvl; lvl := lvl + 1; gained := gained + 1;
  end loop;
  if lvl >= max_lvl then ex := least(ex, 50 * max_lvl); end if;
  update public.adoptions set level = lvl, exp = ex where id = p_adoption;
  return gained;
end $$;

-- 每日任務第一次完成才給完整獎勵；回傳是否有獎勵
create or replace function public._record_task(p_user uuid, p_adoption uuid, p_task text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare full_r boolean; t public.care_tasks;
begin
  select * into t from public.care_tasks where code = p_task;
  full_r := not exists (
    select 1 from public.task_completions
     where adoption_id = p_adoption and task_code = p_task
       and game_date = public._game_date() and full_reward);
  insert into public.task_completions(user_id, adoption_id, task_code, game_date, full_reward)
  values (p_user, p_adoption, p_task, public._game_date(), full_r);
  if full_r then
    update public.adoptions set trust = least(100, trust + t.trust_reward) where id = p_adoption;
    if t.fish_reward > 0 then
      perform public._wallet_change(p_user, t.fish_reward, 0, 'CARE_TASK', 'care_task', p_task);
    end if;
  end if;
  return full_r;
end $$;

-- 伺服器產生出怪表（結算時用來限制擊殺數）
create or replace function public._gen_spawn_plan() returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  dur integer := public._cfg_int('battle_duration_sec');
  t numeric := 1.5; step numeric; r double precision; m text; i integer := 0;
  arr jsonb := '[]'::jsonb;
begin
  while t < dur - 2 loop
    r := random();
    if t < 20 then
      m := case when r < 0.75 then 'dust' when r < 0.95 then 'hunger' else 'mischief' end; step := 1.6;
    elsif t < 40 then
      m := case when r < 0.40 then 'dust' when r < 0.75 then 'hunger' else 'mischief' end; step := 1.25;
    else
      m := case when r < 0.30 then 'dust' when r < 0.60 then 'hunger' else 'mischief' end; step := 1.0;
    end if;
    arr := arr || jsonb_build_object('i', i, 't', round(t, 2), 'm', m, 'p', floor(random() * 6)::integer);
    i := i + 1; t := t + step;
  end loop;
  return arr;
end $$;

-- 單隻認養的完整狀態（給前端顯示）
create or replace function public._adoption_json(p_adoption uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', a.id, 'animal_id', a.animal_id, 'animal_name', an.name,
    'character_type', ct.code, 'character_name', ct.name, 'role_label', ct.role_label,
    'sprite_key', ct.sprite_key, 'species', an.species,
    'adopted_at', a.adopted_at, 'last_fed_at', a.last_fed_at,
    'hours_since_fed', round(extract(epoch from now() - a.last_fed_at) / 3600.0, 2),
    'expires_at', a.last_fed_at + make_interval(hours => public._cfg_int('feed_expire_hours')),
    'reminder', case
        when now() - a.last_fed_at >= make_interval(hours => public._cfg_int('remind_last_hours')) then '6H'
        when now() - a.last_fed_at >= make_interval(hours => public._cfg_int('remind_first_hours')) then '48H'
        else 'NONE' end,
    'stamina', a.stamina, 'max_stamina', ct.max_stamina, 'task_cost', ct.task_cost,
    'low_stamina', a.stamina > 0 and a.stamina * 3 < ct.max_stamina,
    'trust', a.trust, 'level', a.level, 'exp', a.exp, 'exp_to_next', 50 * a.level,
    'battle_hp', ct.base_battle_hp + 3 * (a.level - 1),
    'attack', ct.attack + (a.level - 1),
    'disease', case when a.disease_code is null then null else
        (select jsonb_build_object('code', d.code, 'name', d.name, 'cure_item_code', d.cure_item_code,
                                   'cause_text', d.cause_text, 'care_text', d.care_text,
                                   'edu_reference', d.edu_reference)
           from public.diseases d where d.code = a.disease_code) end,
    'can_battle', a.disease_code is null and a.stamina > 0,
    'carrier_ready', now() >= a.adopted_at + make_interval(hours => public._cfg_int('carrier_familiar_hours')),
    'carrier_ready_at', a.adopted_at + make_interval(hours => public._cfg_int('carrier_familiar_hours')),
    'rest_ready_at', coalesce(a.last_rest_at + make_interval(mins => public._cfg_int('rest_cooldown_minutes')), now()),
    'skills', coalesce((select jsonb_agg(jsonb_build_object(
                 'code', s.code, 'name', s.name, 'trust_required', s.trust_required,
                 'unlocked', a.trust >= s.trust_required, 'cooldown_ms', s.cooldown_ms,
                 'effect', s.effect, 'description', s.description) order by s.trust_required)
               from public.skills s
              where s.character_type is null or s.character_type = ct.code), '[]'::jsonb),
    'tasks_today', coalesce((select jsonb_agg(distinct tc.task_code)
               from public.task_completions tc
              where tc.adoption_id = a.id and tc.game_date = public._game_date() and tc.full_reward), '[]'::jsonb)
  )
  from public.adoptions a
  join public.animals an on an.id = a.animal_id
  join public.character_types ct on ct.code = an.character_type
  where a.id = p_adoption
$$;

-- =====================================================================
-- 8. Triggers
-- =====================================================================
-- 新使用者註冊 → 建立 profile、錢包、進度（role 一律為 user）
create or replace function public._handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare uname text; dname text;
begin
  uname := lower(coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), split_part(new.email, '@', 1)));
  if uname !~ '^[a-z0-9_]{3,20}$' then raise exception 'INVALID_USERNAME'; end if;
  dname := left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), uname), 20);
  if dname ~ '[<>[:cntrl:]]' then dname := uname; end if;
  insert into public.profiles(id, username, display_name, role) values (new.id, uname, dname, 'user');
  insert into public.wallets(user_id, fish) values (new.id, coalesce(public._cfg_int('starting_fish'), 0));
  insert into public.player_progress(user_id) values (new.id);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public._handle_new_user();

-- 防提權：一般玩家不能改 role / username
create or replace function public._guard_profile_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.role is distinct from old.role
      or new.username is distinct from old.username
      or new.id is distinct from old.id
      or new.created_at is distinct from old.created_at)
     and (select auth.uid()) is not null
     and not public.is_admin() then
    raise exception 'FORBIDDEN_PROFILE_FIELD';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update before update on public.profiles
  for each row execute function public._guard_profile_update();

-- 管理員透過 REST 修改遊戲定義表時自動寫 Audit Log
create or replace function public._audit_catalog() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then  -- SQL Editor / migration 不記錄
    return coalesce(new, old);
  end if;
  insert into public.admin_actions(admin_id, action, target_table, target_id, payload)
  values ((select auth.uid()), 'CATALOG_' || tg_op, tg_table_name,
          coalesce(to_jsonb(new), to_jsonb(old)) ->> (case when tg_table_name in
            ('shelters','animals','charity_tasks','sponsors','sponsor_campaigns') then 'id'
            when tg_table_name = 'game_config' then 'key' else 'code' end),
          jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new)));
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['game_config','character_types','skills','monsters','rooms','items',
                           'diseases','care_tasks','shelters','animals','charity_tasks',
                           'sponsors','sponsor_campaigns'] loop
    execute format('drop trigger if exists audit_catalog on public.%I', t);
    execute format('create trigger audit_catalog after insert or update or delete on public.%I
                    for each row execute function public._audit_catalog()', t);
  end loop;
end $$;

-- =====================================================================
-- 9. 玩家 RPC（前端透過 /rest/v1/rpc/<name> 呼叫）
-- =====================================================================

-- 登入後一次取得所有狀態
create or replace function public.get_my_state() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_user(); r record;
begin
  perform public.expire_adoptions();
  for r in select id from public.adoptions where user_id = uid and status = 'ACTIVE' loop
    perform public._apply_recovery(r.id);
  end loop;
  update public.profiles set last_active_at = now() where id = uid;

  return jsonb_build_object(
    'server_time', now(),
    'profile', (select jsonb_build_object('id', p.id, 'username', p.username,
                 'display_name', p.display_name, 'role', p.role, 'created_at', p.created_at)
                  from public.profiles p where p.id = uid),
    'wallet', (select jsonb_build_object('fish', w.fish, 'bone', w.bone)
                 from public.wallets w where w.user_id = uid),
    'progress', (select to_jsonb(pp) - 'user_id' from public.player_progress pp where pp.user_id = uid),
    'adoptions', coalesce((select jsonb_agg(public._adoption_json(a.id) order by a.adopted_at)
                   from public.adoptions a where a.user_id = uid and a.status = 'ACTIVE'), '[]'::jsonb),
    'recently_ended', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'animal_name', an.name,
                   'ended_at', a.ended_at, 'end_reason', a.end_reason, 'level', a.level))
                   from public.adoptions a join public.animals an on an.id = a.animal_id
                  where a.user_id = uid and a.status <> 'ACTIVE'
                    and a.ended_at > now() - interval '7 days'), '[]'::jsonb),
    'inventory', coalesce((select jsonb_agg(jsonb_build_object('item_code', i.item_code, 'qty', i.qty))
                   from public.inventory i where i.user_id = uid and i.qty > 0), '[]'::jsonb),
    'furniture', coalesce((select jsonb_agg(jsonb_build_object('item_code', f.item_code,
                   'x', f.x, 'y', f.y, 'flipped', f.flipped, 'z', f.z) order by f.z)
                   from public.placed_furniture f where f.user_id = uid), '[]'::jsonb)
  );
end $$;

-- 認養區：滿額隱藏；自己已認養的仍顯示
create or replace function public.get_animals() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_user();
begin
  perform public.expire_adoptions();
  return coalesce((
    select jsonb_agg(x order by x ->> 'name') from (
      select jsonb_build_object(
        'id', an.id, 'name', an.name, 'species', an.species,
        'character_type', an.character_type, 'character_name', ct.name, 'role_label', ct.role_label,
        'sprite_key', ct.sprite_key, 'shelter_name', s.name, 'is_demo', an.is_demo,
        'real_profile', an.real_profile, 'adopt_cost', an.adopt_cost,
        'adopters', cnt.n, 'max_adopters', an.max_adopters,
        'is_full', cnt.n >= an.max_adopters, 'adopted_by_me', mine.yes,
        'can_keep_growth', exists (select 1 from public.adoptions pa
                                    where pa.user_id = uid and pa.animal_id = an.id and pa.status <> 'ACTIVE')
      ) as x
      from public.animals an
      join public.character_types ct on ct.code = an.character_type
      left join public.shelters s on s.id = an.shelter_id
      cross join lateral (select count(*)::integer as n from public.adoptions a
                           where a.animal_id = an.id and a.status = 'ACTIVE') cnt
      cross join lateral (select exists (select 1 from public.adoptions a
                           where a.animal_id = an.id and a.user_id = uid and a.status = 'ACTIVE') as yes) mine
      where an.is_listed and (cnt.n < an.max_adopters or mine.yes)
    ) q), '[]'::jsonb);
end $$;

create or replace function public.adopt_animal(p_animal_id uuid, p_use_growth_card boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public._require_user();
  an public.animals; ct public.character_types;
  cnt integer; mine integer; cost integer; lvl integer := 1; ex integer := 0;
  prev record; new_id uuid;
begin
  perform public.expire_adoptions();
  perform 1 from public.wallets where user_id = uid for update;          -- 序列化同一玩家
  select * into an from public.animals where id = p_animal_id for update; -- 序列化同一隻動物
  if not found or not an.is_listed then raise exception 'ANIMAL_NOT_AVAILABLE'; end if;

  if exists (select 1 from public.adoptions where user_id = uid and animal_id = an.id and status = 'ACTIVE') then
    raise exception 'ALREADY_ADOPTED';
  end if;
  select count(*) into cnt from public.adoptions where animal_id = an.id and status = 'ACTIVE';
  if cnt >= an.max_adopters then raise exception 'ANIMAL_FULL'; end if;
  select count(*) into mine from public.adoptions where user_id = uid and status = 'ACTIVE';
  if mine >= public._cfg_int('max_adoptions_per_player') then raise exception 'ADOPTION_LIMIT'; end if;

  cost := an.adopt_cost;
  if public._cfg_bool('first_adoption_free')
     and not exists (select 1 from public.adoptions where user_id = uid) then
    cost := 0;
  end if;
  if cost > 0 then
    perform public._wallet_change(uid, -cost, 0, 'ADOPT', 'animal', an.id::text);
  end if;

  if p_use_growth_card then
    select level, exp into prev from public.adoptions
     where user_id = uid and animal_id = an.id and status <> 'ACTIVE'
     order by ended_at desc nulls last limit 1;
    if not found then raise exception 'NO_PREVIOUS_ADOPTION'; end if;
    perform public._consume_item(uid, 'card_keep_growth', 1);
    lvl := prev.level; ex := prev.exp;
  end if;

  select * into ct from public.character_types where code = an.character_type;
  insert into public.adoptions(user_id, animal_id, stamina, level, exp)
  values (uid, an.id, ct.max_stamina, lvl, ex)
  returning id into new_id;

  update public.player_progress
     set selected_adoption_id = coalesce(selected_adoption_id, new_id), updated_at = now()
   where user_id = uid;

  perform public._server_log(uid, null, 'ADOPT', 'animal', an.id::text,
          jsonb_build_object('adoption_id', new_id, 'cost', cost, 'kept_growth', p_use_growth_card));
  return jsonb_build_object('adoption', public._adoption_json(new_id), 'cost', cost);
end $$;

create or replace function public.feed_pet(p_adoption_id uuid, p_item_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public._require_user();
  a public.adoptions; ct public.character_types; it public.items;
  gain integer; rewarded boolean; lv integer;
begin
  perform public.expire_adoptions();
  perform public._apply_recovery(p_adoption_id);
  a := public._lock_adoption(uid, p_adoption_id);
  select * into it from public.items where code = p_item_code and type = 'food' and is_active;
  if not found then raise exception 'INVALID_FOOD'; end if;
  perform public._consume_item(uid, it.code, 1);

  ct := public._adoption_type(a.id);
  -- 生病時仍可餵食（重設計時），但體力不會恢復，需先用藥（AI 補充）
  gain := case when a.disease_code is null
               then least(public._jint(it.effect, 'stamina'), ct.max_stamina - a.stamina) else 0 end;
  update public.adoptions
     set stamina = stamina + greatest(gain, 0), last_fed_at = now()
   where id = a.id;
  rewarded := public._record_task(uid, a.id, 'feed');
  lv := public._add_exp(a.id, public._jint(it.effect, 'exp'));

  perform public._server_log(uid, null, 'FEED', 'adoption', a.id::text,
          jsonb_build_object('item', it.code, 'stamina_gain', gain, 'trust_reward', rewarded, 'level_up', lv));
  return jsonb_build_object('adoption', public._adoption_json(a.id),
                            'stamina_gain', gain, 'rewarded', rewarded, 'level_up', lv);
end $$;

create or replace function public.complete_care_task(p_adoption_id uuid, p_task_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public._require_user();
  a public.adoptions; t public.care_tasks; sp text; rewarded boolean;
begin
  perform public.expire_adoptions();
  a := public._lock_adoption(uid, p_adoption_id);
  select * into t from public.care_tasks where code = p_task_code and code <> 'feed';
  if not found then raise exception 'INVALID_TASK'; end if;
  select species into sp from public.animals where id = a.animal_id;
  if t.species <> 'any' and t.species <> sp then raise exception 'INVALID_TASK'; end if;
  rewarded := public._record_task(uid, a.id, t.code);
  perform public._server_log(uid, null, 'CARE_TASK', 'adoption', a.id::text,
          jsonb_build_object('task', t.code, 'rewarded', rewarded));
  return jsonb_build_object('adoption', public._adoption_json(a.id), 'rewarded', rewarded,
                            'trust_gain', case when rewarded then t.trust_reward else 0 end,
                            'fish_gain', case when rewarded then t.fish_reward else 0 end);
end $$;

create or replace function public.rest_pet(p_adoption_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public._require_user();
  a public.adoptions; ct public.character_types; today date := public._game_date();
  rec integer; gain integer;
begin
  perform public.expire_adoptions();
  perform public._apply_recovery(p_adoption_id);
  a := public._lock_adoption(uid, p_adoption_id);
  if a.disease_code is not null then raise exception 'PET_SICK'; end if;
  if a.last_rest_at is not null
     and a.last_rest_at > now() - make_interval(mins => public._cfg_int('rest_cooldown_minutes')) then
    raise exception 'REST_COOLDOWN';
  end if;
  ct := public._adoption_type(a.id);
  rec := case when a.recovery_date = today then a.recovery_today else 0 end;
  gain := greatest(0, least(public._cfg_int('rest_amount'), ct.max_stamina - a.stamina,
                            public._cfg_int('daily_recovery_cap') - rec));
  update public.adoptions
     set stamina = stamina + gain, recovery_today = rec + gain, recovery_date = today, last_rest_at = now()
   where id = a.id;
  perform public._server_log(uid, null, 'REST', 'adoption', a.id::text, jsonb_build_object('gain', gain));
  return jsonb_build_object('adoption', public._adoption_json(a.id), 'stamina_gain', gain);
end $$;

create or replace function public.buy_item(p_item_code text, p_qty integer default 1) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_user(); it public.items; w public.wallets; total integer;
begin
  if p_qty is null or p_qty < 1 or p_qty > 99 then raise exception 'INVALID_QTY'; end if;
  select * into it from public.items where code = p_item_code and is_active and price_fish is not null;
  if not found then raise exception 'ITEM_NOT_FOR_SALE'; end if;
  total := it.price_fish * p_qty;
  w := public._wallet_change(uid, -total, 0, 'BUY', 'item', it.code);
  perform public._add_item(uid, it.code, p_qty);
  perform public._server_log(uid, null, 'ITEM_BUY', 'item', it.code,
          jsonb_build_object('qty', p_qty, 'cost', total));
  return jsonb_build_object('item_code', it.code, 'qty', p_qty, 'cost', total, 'fish', w.fish);
end $$;

create or replace function public.use_medicine(p_adoption_id uuid, p_item_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_user(); a public.adoptions; ct public.character_types; d public.diseases;
begin
  perform public.expire_adoptions();
  a := public._lock_adoption(uid, p_adoption_id);
  if a.disease_code is null then raise exception 'PET_NOT_SICK'; end if;
  select * into d from public.diseases where code = a.disease_code;
  if d.cure_item_code <> p_item_code then raise exception 'WRONG_MEDICINE'; end if;
  perform public._consume_item(uid, p_item_code, 1);
  ct := public._adoption_type(a.id);
  -- 治癒後體力回到最大體力 1/3（AI 補充）
  update public.adoptions
     set disease_code = null, sick_since = null,
         stamina = greatest(stamina, ceil(ct.max_stamina / 3.0)::integer),
         stamina_updated_at = now()
   where id = a.id;
  perform public._server_log(uid, null, 'CURED', 'adoption', a.id::text,
          jsonb_build_object('disease', d.code, 'item', p_item_code));
  return jsonb_build_object('adoption', public._adoption_json(a.id));
end $$;

create or replace function public.save_room_layout(p_items jsonb, p_theme jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_user(); e jsonb; it public.items; owned integer; used integer;
        theme jsonb := '{}'::jsonb; slot text; z integer := 0;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 60 then
    raise exception 'INVALID_LAYOUT';
  end if;
  -- 每個品項擺放數量不得超過持有數量
  for e in select value from jsonb_array_elements(p_items) loop
    select * into it from public.items where code = e ->> 'item_code' and type = 'furniture';
    if not found then raise exception 'INVALID_LAYOUT_ITEM'; end if;
    if public._jint(e, 'x', -1) not between 0 and 1280 or public._jint(e, 'y', -1) not between 0 and 720 then
      raise exception 'INVALID_LAYOUT_POSITION';
    end if;
  end loop;
  for it in select i.* from public.items i
             where i.code in (select value ->> 'item_code' from jsonb_array_elements(p_items)) loop
    select count(*) into used from jsonb_array_elements(p_items) where value ->> 'item_code' = it.code;
    select coalesce(qty, 0) into owned from public.inventory where user_id = uid and item_code = it.code;
    if coalesce(owned, 0) < used then raise exception 'ITEM_NOT_ENOUGH'; end if;
  end loop;
  -- 地板 / 壁紙主題
  if p_theme is not null and jsonb_typeof(p_theme) = 'object' then
    foreach slot in array array['floor','wallpaper'] loop
      if p_theme ? slot and jsonb_typeof(p_theme -> slot) = 'string' then
        if not exists (select 1 from public.items i join public.inventory inv
                         on inv.item_code = i.code and inv.user_id = uid and inv.qty > 0
                        where i.code = p_theme ->> slot and i.type = 'decor' and i.effect ->> 'slot' = slot) then
          raise exception 'INVALID_THEME';
        end if;
        theme := theme || jsonb_build_object(slot, p_theme ->> slot);
      end if;
    end loop;
  end if;

  delete from public.placed_furniture where user_id = uid;
  for e in select value from jsonb_array_elements(p_items) loop
    insert into public.placed_furniture(user_id, item_code, x, y, flipped, z)
    values (uid, e ->> 'item_code', public._jint(e, 'x'), public._jint(e, 'y'),
            coalesce((e ->> 'flipped')::boolean, false), z);
    z := z + 1;
  end loop;
  update public.player_progress set room_theme = theme, updated_at = now() where user_id = uid;
  perform public._server_log(uid, null, 'ROOM_SAVE', 'room', 'home',
          jsonb_build_object('count', jsonb_array_length(p_items)));
  return jsonb_build_object('saved', jsonb_array_length(p_items), 'theme', theme);
end $$;

-- 開始戰鬥：後端扣體力（冪等），產生出怪表
create or replace function public.start_battle(
  p_adoption_id uuid, p_skill_code text, p_room_code text, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public._require_user();
  s public.game_sessions; a public.adoptions; ct public.character_types; sk public.skills;
  new_stamina integer; dis text := null; plan jsonb;
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;
  select * into s from public.game_sessions where user_id = uid and idempotency_key = p_idempotency_key;
  if found then  -- 重新整理 / 重複送出：回傳同一局，不再扣體力
    return jsonb_build_object('session_id', s.id, 'spawn_plan', s.spawn_plan, 'status', s.status,
                              'replayed', true, 'adoption', public._adoption_json(s.adoption_id));
  end if;

  perform public.expire_adoptions();
  perform public._apply_recovery(p_adoption_id);
  a := public._lock_adoption(uid, p_adoption_id);
  if a.disease_code is not null then raise exception 'PET_SICK'; end if;
  if a.stamina <= 0 then raise exception 'NO_STAMINA'; end if;
  if not exists (select 1 from public.rooms where code = p_room_code and type = 'arena') then
    raise exception 'INVALID_ROOM';
  end if;
  ct := public._adoption_type(a.id);
  if p_skill_code is not null then
    select * into sk from public.skills where code = p_skill_code;
    if not found or a.trust < sk.trust_required
       or (sk.character_type is not null and sk.character_type <> ct.code) then
      raise exception 'SKILL_LOCKED';
    end if;
  end if;

  -- 同一時間只允許一局進行中
  update public.game_sessions set status = 'ABANDONED', ended_at = now()
   where user_id = uid and status = 'PLAYING';

  new_stamina := greatest(0, a.stamina - ct.task_cost);
  if new_stamina = 0 then
    select code into dis from public.diseases order by random() limit 1;
  end if;
  update public.adoptions
     set stamina = new_stamina, stamina_updated_at = now(),
         disease_code = coalesce(dis, disease_code),
         sick_since = case when dis is not null then now() else sick_since end
   where id = a.id;

  plan := public._gen_spawn_plan();
  insert into public.game_sessions(user_id, adoption_id, room_code, skill_code, idempotency_key, spawn_plan)
  values (uid, a.id, p_room_code, p_skill_code, p_idempotency_key, plan)
  returning * into s;

  perform public._server_log(uid, s.id, 'GAME_START', 'room', p_room_code,
          jsonb_build_object('adoption_id', a.id, 'stamina_cost', a.stamina - new_stamina, 'skill', p_skill_code));
  if dis is not null then
    perform public._server_log(uid, s.id, 'SICK', 'adoption', a.id::text, jsonb_build_object('disease', dis));
  end if;

  return jsonb_build_object(
    'session_id', s.id, 'spawn_plan', plan, 'status', s.status, 'replayed', false,
    'duration_sec', public._cfg_int('battle_duration_sec'),
    'food_box_hp', public._cfg_int('food_box_hp'),
    'carrier', jsonb_build_object(
        'ready', now() >= a.adopted_at + make_interval(hours => public._cfg_int('carrier_familiar_hours')),
        'heal', public._cfg_int('carrier_heal'),
        'uses', public._cfg_int('carrier_uses_per_battle'),
        'cooldown_sec', public._cfg_int('carrier_cooldown_sec')),
    'became_sick', dis is not null,
    'adoption', public._adoption_json(a.id));
end $$;

-- 結束戰鬥：後端驗證並發放獎勵（冪等）
create or replace function public.end_battle(p_session_id uuid, p_report jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public._require_user();
  s public.game_sessions; m public.monsters;
  dur integer := public._cfg_int('battle_duration_sec');
  box_max integer := public._cfg_int('food_box_hp');
  elapsed numeric; win boolean; box_hp integer; spawned integer; claimed integer;
  kill_score integer := 0; fish integer := 0; today_fish integer; cap integer;
  kills jsonb := '{}'::jsonb; res jsonb; capped boolean := false;
begin
  select * into s from public.game_sessions where id = p_session_id and user_id = uid for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if s.status <> 'PLAYING' then
    return jsonb_build_object('already_settled', true, 'status', s.status, 'score', s.score,
                              'fish_reward', s.fish_reward, 'result', s.result);
  end if;

  elapsed := extract(epoch from now() - s.started_at);
  if elapsed > dur + 600 then
    update public.game_sessions set status = 'ABANDONED', ended_at = now() where id = s.id;
    perform public._server_log(uid, s.id, 'GAME_END', 'session', s.id::text, jsonb_build_object('status', 'ABANDONED'));
    return jsonb_build_object('status', 'ABANDONED', 'score', 0, 'fish_reward', 0);
  end if;

  box_hp := least(greatest(public._jint(p_report, 'box_hp'), 0), box_max);
  win := upper(coalesce(p_report ->> 'result', '')) = 'WIN' and box_hp > 0 and elapsed >= dur - 3;

  -- 擊殺數不得超過「到目前為止實際生成」的數量
  for m in select * from public.monsters loop
    select count(*) into spawned from jsonb_array_elements(s.spawn_plan) e
     where e.value ->> 'm' = m.code and (e.value ->> 't')::numeric <= least(elapsed, dur);
    claimed := least(greatest(public._jint(p_report -> 'kills', m.code), 0), spawned);
    kills := kills || jsonb_build_object(m.code, claimed);
    kill_score := kill_score + claimed * m.score;
    fish := fish + claimed * m.reward_fish;
  end loop;

  if win then fish := fish + public._cfg_int('win_bonus_fish'); end if;
  cap := public._cfg_int('daily_battle_fish_cap');
  select coalesce(sum(fish_reward), 0) into today_fish from public.game_sessions
   where user_id = uid and ended_at is not null
     and (ended_at at time zone 'Asia/Taipei')::date = public._game_date();
  if fish > greatest(cap - today_fish, 0) then
    fish := greatest(cap - today_fish, 0); capped := true;
  end if;

  res := jsonb_build_object('win', win, 'kills', kills, 'box_hp', box_hp,
                            'elapsed_sec', round(elapsed, 1), 'daily_cap_reached', capped);
  update public.game_sessions
     set status = case when win then 'COMPLETED' else 'FAILED' end,
         ended_at = now(),
         score = kill_score + case when win then 100 + (box_hp * 100 / box_max) else 0 end,
         fish_reward = fish, result = res,
         client_report = case when pg_column_size(p_report) <= 4096 then p_report else null end
   where id = s.id
  returning * into s;

  if fish > 0 then
    perform public._wallet_change(uid, fish, 0, 'BATTLE', 'session', s.id::text);
  end if;
  update public.player_progress
     set best_score = greatest(best_score, s.score), total_battles = total_battles + 1,
         total_wins = total_wins + case when win then 1 else 0 end, updated_at = now()
   where user_id = uid;

  perform public._server_log(uid, s.id, 'GAME_END', 'session', s.id::text,
          jsonb_build_object('status', s.status, 'score', s.score) || res);
  if fish > 0 then
    perform public._server_log(uid, s.id, 'REWARD_RECEIVED', 'wallet', uid::text, jsonb_build_object('fish', fish));
  end if;
  return jsonb_build_object('status', s.status, 'score', s.score, 'fish_reward', fish, 'result', res);
end $$;

create or replace function public.abandon_battle(p_session_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_user();
begin
  update public.game_sessions set status = 'ABANDONED', ended_at = now()
   where id = p_session_id and user_id = uid and status = 'PLAYING';
  if found then
    perform public._server_log(uid, p_session_id, 'GAME_END', 'session', p_session_id::text,
            jsonb_build_object('status', 'ABANDONED'));
  end if;
  return jsonb_build_object('abandoned', found);
end $$;

create or replace function public.donate_fish(p_task_id uuid, p_fish integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_user(); w public.wallets;
begin
  if p_fish is null or p_fish < 1 or p_fish > 10000 then raise exception 'INVALID_AMOUNT'; end if;
  if not exists (select 1 from public.charity_tasks where id = p_task_id and is_active) then
    raise exception 'TASK_NOT_FOUND';
  end if;
  w := public._wallet_change(uid, -p_fish, 0, 'DONATE', 'charity_task', p_task_id::text);
  insert into public.donations(user_id, task_id, fish) values (uid, p_task_id, p_fish);
  update public.player_progress set total_donated = total_donated + p_fish, updated_at = now()
   where user_id = uid;
  perform public._server_log(uid, null, 'DONATE', 'charity_task', p_task_id::text, jsonb_build_object('fish', p_fish));
  return jsonb_build_object('fish', w.fish, 'donated', p_fish);
end $$;

create or replace function public.get_charity_progress() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'title', t.title, 'description', t.description, 'goal_fish', t.goal_fish,
    'is_demo', t.is_demo, 'shelter_name', s.name,
    'donated_fish', (select coalesce(sum(d.fish), 0) from public.donations d where d.task_id = t.id))
    order by t.created_at), '[]'::jsonb)
  from public.charity_tasks t left join public.shelters s on s.id = t.shelter_id
  where t.is_active
$$;

-- 排行榜：只回傳顯示名稱與數值，不暴露 user id
create or replace function public.get_leaderboard(p_metric text, p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := public._require_user(); lim integer := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  if p_metric not in ('best_score','total_donated','total_trust') then raise exception 'INVALID_METRIC'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('rank', rnk, 'display_name', display_name,
                                        'value', val, 'is_me', is_me) order by rnk)
    from (
      select rank() over (order by val desc) as rnk, display_name, val, is_me from (
        select p.display_name, p.id = uid as is_me,
               case p_metric
                 when 'best_score'    then pp.best_score::bigint
                 when 'total_donated' then pp.total_donated::bigint
                 else (select coalesce(sum(a.trust), 0) from public.adoptions a
                        where a.user_id = p.id and a.status = 'ACTIVE')::bigint
               end as val
          from public.profiles p join public.player_progress pp on pp.user_id = p.id
         where p.role = 'user'
      ) base where val > 0
      order by val desc limit lim
    ) ranked), '[]'::jsonb);
end $$;

-- 前端批次送出的操作日誌（只接受白名單事件）
create or replace function public.log_events(p_events jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public._require_user(); e jsonb; act text; sid uuid; md jsonb;
  accepted integer := 0; rejected integer := 0; recent integer;
  allowed text[] := array['ROOM_ENTER','ROOM_EXIT','ITEM_PICKUP','ITEM_USE','SKILL_USE',
                          'MONSTER_ATTACK','MONSTER_DEFEATED','PLAYER_DAMAGE','PLAYER_DEATH',
                          'LEVEL_COMPLETE','BATTLE_PAUSE','BATTLE_RESUME','UI_OPEN',
                          'SETTINGS_CHANGE','CLIENT_ERROR'];
begin
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 50 then
    raise exception 'INVALID_EVENTS';
  end if;
  select count(*) into recent from public.operation_logs
   where user_id = uid and source = 'client' and created_at > now() - interval '1 hour';

  for e in select value from jsonb_array_elements(p_events) loop
    act := e ->> 'action';
    if act is null or not (act = any(allowed)) or recent + accepted >= 600 then
      rejected := rejected + 1; continue;
    end if;
    sid := null;
    if (e ->> 'session_id') ~ '^[0-9a-f-]{36}$' then
      select id into sid from public.game_sessions
       where id = (e ->> 'session_id')::uuid and user_id = uid;   -- 防 IDOR
    end if;
    md := case when jsonb_typeof(e -> 'metadata') = 'object' then e -> 'metadata' else '{}'::jsonb end;
    if length(md::text) > 2048 then md := jsonb_build_object('truncated', true); end if;
    insert into public.operation_logs(user_id, session_id, action, target_type, target_id, metadata, source)
    values (uid, sid, act, left(e ->> 'target_type', 40), left(e ->> 'target_id', 80), md, 'client');
    accepted := accepted + 1;
  end loop;
  return jsonb_build_object('accepted', accepted, 'rejected', rejected);
end $$;

-- 登入成功 / 登出（需已登入）
create or replace function public.log_login(p_event text, p_user_agent text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_user(); uname text; recent integer;
begin
  if p_event not in ('LOGIN_SUCCESS','LOGOUT') then raise exception 'INVALID_EVENT'; end if;
  select count(*) into recent from public.login_logs where user_id = uid and created_at > now() - interval '1 hour';
  if recent >= 30 then return; end if;
  select username into uname from public.profiles where id = uid;
  insert into public.login_logs(user_id, username, success, event_type, user_agent)
  values (uid, uname, true, p_event, left(p_user_agent, 200));
  if p_event = 'LOGIN_SUCCESS' then
    update public.profiles set last_login_at = now(), last_active_at = now() where id = uid;
    if public.is_admin() then
      perform public._server_log(uid, null, 'ADMIN_LOGIN', 'profile', uid::text, '{}'::jsonb);
    end if;
  end if;
end $$;

-- 登入失敗 / Session 過期（未登入也能呼叫，含速率限制）
create or replace function public.log_auth_event_anon(p_username text, p_event text, p_user_agent text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare uname text := lower(left(coalesce(p_username, ''), 40)); uid uuid; n_user integer; n_all integer;
begin
  if p_event not in ('LOGIN_FAILED','SESSION_EXPIRED') then return; end if;
  if uname !~ '^[a-z0-9_]{1,40}$' then uname := '(invalid)'; end if;
  select count(*) into n_user from public.login_logs where username = uname and created_at > now() - interval '1 minute';
  select count(*) into n_all  from public.login_logs where created_at > now() - interval '1 minute';
  if n_user >= 10 or n_all >= 300 then return; end if;
  select id into uid from public.profiles where username = uname;
  insert into public.login_logs(user_id, username, success, event_type, user_agent)
  values (uid, uname, false, p_event, left(p_user_agent, 200));
end $$;
