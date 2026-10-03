import { supabase, NetworkError } from '../js/net/supabaseClient.js';
import { auth } from '../js/core/authManager.js';
import { LogManager } from '../js/core/logManager.js';
import { messageFor } from '../js/core/errors.js';

const $ = (id) => document.getElementById(id);
const out = $('out');
const logs = new LogManager(auth);
let state = null;
let currentSession = null;

// 所有輸出一律 textContent，避免 XSS
function print(label, data, cls) {
  const line = document.createElement('div');
  if (cls) line.className = cls;
  const time = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  line.textContent = `[${time}] ${label}${data === undefined ? '' : '\n' + JSON.stringify(data, null, 2)}`;
  out.prepend(line);
}

let lastAction = null;
async function run(label, fn) {
  lastAction = () => run(label, fn);
  try {
    const r = await fn();
    $('banner').classList.remove('show');
    if (r !== undefined) print(label, r);
    return r;
  } catch (e) {
    if (e instanceof NetworkError) $('banner').classList.add('show');
    print(`${label} ✗ ${e.code || ''} ${messageFor(e)}`, undefined, 'fail');
  }
}
$('retry').onclick = () => lastAction && lastAction();

function render() {
  const logged = auth.isLoggedIn && auth.profile;
  $('authBox').classList.toggle('hidden', !!logged);
  $('playerBox').classList.toggle('hidden', !logged);
  $('adminBox').classList.toggle('hidden', !auth.isAdmin);
  if (logged) $('who').textContent = `${auth.profile.display_name}（${auth.profile.username}／${auth.profile.role}）`;
}
auth.onChange((type) => {
  if (type === 'expired') print('登入已過期，請重新登入。', undefined, 'fail');
  render();
});

const firstAdoption = () => state?.adoptions?.[0]?.id;
async function reloadState() { state = await auth.loadState(); return state; }

// ---------- Auth ----------
$('btnLogin').onclick = () => run('登入', async () => {
  await auth.login($('u').value, $('p').value); $('p').value = '';
  return reloadState();
});
$('btnRegister').onclick = () => run('註冊', async () => {
  await auth.register($('u').value, $('p').value, $('d').value); $('p').value = '';
  return reloadState();
});
$('btnLogout').onclick = () => run('登出', async () => { await logs.flush(); await auth.logout(); return 'OK'; });

// ---------- Player ----------
$('btnState').onclick = () => run('get_my_state', reloadState);
$('btnAnimals').onclick = () => run('get_animals', async () => {
  const list = await supabase.rpc('get_animals');
  const ul = $('animalList'); ul.replaceChildren();
  for (const a of list) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = `${a.name}（${a.character_name}・${a.role_label}）${a.adopters}/${a.max_adopters}${a.is_demo ? '・示範' : ''}`;
    li.append(span);
    if (!a.adopted_by_me) {
      const b = document.createElement('button');
      b.textContent = `認養（${a.adopt_cost} 魚乾）`;
      b.onclick = () => run(`adopt ${a.name}`, async () => {
        const r = await supabase.rpc('adopt_animal', { p_animal_id: a.id, p_use_growth_card: false });
        await reloadState(); return r;
      });
      li.append(b);
    }
    ul.append(li);
  }
  return list;
});
$('btnBuy').onclick = () => run('buy_item', () => supabase.rpc('buy_item', { p_item_code: 'food_basic', p_qty: 1 }));
$('btnFeed').onclick = () => run('feed_pet', () => supabase.rpc('feed_pet', { p_adoption_id: firstAdoption(), p_item_code: 'food_basic' }));
$('btnBrush').onclick = () => run('complete_care_task', () => supabase.rpc('complete_care_task', { p_adoption_id: firstAdoption(), p_task_code: 'brush' }));

$('btnStart').onclick = () => run('start_battle', async () => {
  const key = crypto.randomUUID();
  const r = await supabase.rpc('start_battle', {
    p_adoption_id: firstAdoption(), p_skill_code: null, p_room_code: 'arena_yard', p_idempotency_key: key,
  });
  currentSession = r.session_id;
  // 重送同一把 key：應回傳 replayed=true 且不再扣體力
  const again = await supabase.rpc('start_battle', {
    p_adoption_id: firstAdoption(), p_skill_code: null, p_room_code: 'arena_yard', p_idempotency_key: key,
  });
  print(again.replayed ? 'PASS 重送 start_battle 未重複扣體力' : 'FAIL 重送 start_battle',
        undefined, again.replayed ? 'pass' : 'fail');
  return { session_id: r.session_id, monsters: r.spawn_plan.length, stamina: r.adoption.stamina, became_sick: r.became_sick };
});
$('btnEnd').onclick = () => run('end_battle', () => supabase.rpc('end_battle', {
  p_session_id: currentSession,
  p_report: { result: 'WIN', box_hp: 120, kills: { dust: 8, hunger: 4, mischief: 3 } },
}));
$('btnRank').onclick = () => run('get_leaderboard', () => supabase.rpc('get_leaderboard', { p_metric: 'best_score', p_limit: 10 }));
$('btnLog').onclick = () => run('LogManager', async () => {
  logs.log('ROOM_ENTER', { targetType: 'room', targetId: 'home' });
  logs.log('UI_OPEN', { targetType: 'panel', targetId: 'phase5-test' });
  await logs.flush();
  return { queued_after_flush: logs.queue.length };
});

// ---------- 安全測試：每項都「應該失敗」----------
async function expectFail(label, fn) {
  try { await fn(); print(`FAIL ${label}（竟然成功）`, undefined, 'fail'); }
  catch (e) { print(`PASS ${label} → ${e.code || e.status}`, undefined, 'pass'); }
}
$('btnSecurity').onclick = () => run('安全測試', async () => {
  const me = auth.profile.id;
  await expectFail('把自己改成 admin', () => supabase.update('profiles', { id: `eq.${me}` }, { role: 'admin' }));
  await expectFail('直接修改錢包', () => supabase.update('wallets', { user_id: `eq.${me}` }, { fish: 999999 }));
  await expectFail('呼叫內部函式 _wallet_change', () => supabase.rpc('_wallet_change',
    { p_user: me, p_fish: 999, p_bone: 0, p_reason: 'x', p_ref_type: null, p_ref_id: null }));
  await expectFail('呼叫 bootstrap_admin', () => supabase.rpc('bootstrap_admin', { p_username: auth.profile.username }));
  if (!auth.isAdmin) await expectFail('一般玩家呼叫 admin_list_players', () => supabase.rpc('admin_list_players', {}));
  const wallets = await supabase.select('wallets', { select: 'user_id' });
  const onlyMine = auth.isAdmin || wallets.every((w) => w.user_id === me);
  print(onlyMine ? `PASS RLS：只看得到自己的錢包（${wallets.length} 筆）` : 'FAIL RLS 洩漏其他玩家錢包',
        undefined, onlyMine ? 'pass' : 'fail');
  const fake = await supabase.rpc('log_events', { p_events: [{ action: 'REWARD_RECEIVED' }, { action: 'GAME_END' }] });
  print(fake.accepted === 0 ? 'PASS 偽造伺服器事件被拒絕' : 'FAIL 偽造事件被接受', fake, fake.accepted === 0 ? 'pass' : 'fail');
});

// ---------- Admin ----------
$('btnPlayers').onclick = () => run('admin_list_players', () => supabase.rpc('admin_list_players', { p_search: '', p_limit: 50, p_offset: 0 }));
$('btnLoginLogs').onclick = () => run('login_logs', () => supabase.select('login_logs', { order: 'created_at.desc', limit: 30 }));
$('btnAudit').onclick = () => run('admin_actions', () => supabase.select('admin_actions', { order: 'created_at.desc', limit: 30 }));
$('btnGrant').onclick = () => run('admin_grant_currency', () => supabase.rpc('admin_grant_currency', {
  p_user_id: $('gUser').value.trim(), p_fish: Number($('gFish').value) || 0, p_bone: 0, p_reason: $('gReason').value,
}));

// ---------- Boot ----------
run('還原登入狀態', async () => {
  const ok = await auth.restore();
  if (ok) state = await reloadState();
  render();
  return ok ? '已還原' : '尚未登入';
});
