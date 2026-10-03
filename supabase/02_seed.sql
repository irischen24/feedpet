-- =====================================================================
-- 6. 初始資料（Initial Data）— on conflict do nothing，不會覆蓋後台修改
-- =====================================================================
insert into public.game_config(key, value, description) values
  ('max_adoptions_per_player', '3',   '每位玩家同時認養上限'),
  ('first_adoption_free',      'true','第一次認養免費（AI 補充）'),
  ('starting_fish',            '100', '新玩家起始魚乾'),
  ('feed_expire_hours',        '72',  '未餵食多久結束認養（Excel）'),
  ('remind_first_hours',       '48',  '第一段提醒（Excel）'),
  ('remind_last_hours',        '66',  '剩 6 小時提醒（Excel）'),
  ('stamina_natural_per_hour', '5',   '每小時自然恢復體力'),
  ('rest_amount',              '15',  '休息一次恢復體力'),
  ('rest_cooldown_minutes',    '60',  '休息冷卻'),
  ('daily_recovery_cap',       '60',  '每日非餵食恢復上限'),
  ('battle_duration_sec',      '60',  '每局秒數（Excel）'),
  ('food_box_hp',              '200', '飼料箱生命值'),
  ('daily_battle_fish_cap',    '300', '每日戰鬥魚乾上限'),
  ('win_bonus_fish',           '10',  '勝利額外魚乾'),
  ('carrier_heal',             '15',  '外出籠每次恢復生命值'),
  ('carrier_uses_per_battle',  '3',   '外出籠每局次數'),
  ('carrier_cooldown_sec',     '8',   '外出籠冷卻'),
  ('carrier_familiar_hours',   '48',  '熟悉多久可用外出籠（Excel）'),
  ('max_level',                '20',  '等級上限'),
  ('text_low_stamina',   '"我即將要生一場很大的病"',                          '低體力提示（Excel）'),
  ('text_remind_48h',    '"喵～已經兩天沒餵我了，記得回來照顧我！"',          '48 小時提醒（Excel）'),
  ('text_remind_6h',     '"再不餵我，我就要去找新的照顧者了哦。"',            '剩 6 小時提醒（Excel）'),
  ('text_expired',       '"貓咪已離開你的房間，虛擬領養名額已釋出。"',        '到期訊息（Excel）')
on conflict (key) do nothing;

insert into public.character_types(code, name, role_label, species, max_stamina, attack, task_cost, base_battle_hp, sprite_key, sort) values
  ('orange',  '橘貓',   '耐力型',   'cat', 120, 12, 20, 120, 'cat_orange',  1),
  ('tabby',   '虎斑',   '攻擊型',   'cat',  90, 20, 25,  90, 'cat_tabby',   2),
  ('black',   '黑貓',   '均衡型',   'cat', 100, 16, 20, 100, 'cat_black',   3),
  ('calico',  '三花',   '輕量型',   'cat',  80, 14, 15,  80, 'cat_calico',  4),
  ('ragdoll', '品種貓', '超輕量型', 'cat',  75, 12, 10,  75, 'cat_ragdoll', 5)
on conflict (code) do nothing;

insert into public.skills(code, name, trust_required, character_type, cooldown_ms, effect, description) values
  ('paw_combo',    '貓掌連擊', 20, null,      12000, '{"type":"multi_hit","hits":2,"duration_ms":5000}',        '5 秒內每次攻擊打兩下'),
  ('bumpy_dodge',  '凹凸閃避', 40, null,      15000, '{"type":"dodge","chance":0.3,"duration_ms":3000}',       '3 秒內 30% 機率閃避傷害'),
  ('purr',         '呼嚕呼呼', 60, null,      18000, '{"type":"shield","reduce":0.3,"duration_ms":5000}',      '5 秒內吸收 30% 傷害'),
  ('pounce',       '飛撲突擊', 80, null,      10000, '{"type":"dash_cone","targets":3,"mult":1.5}',            '向前飛撲，攻擊前方最多 3 隻怪物'),
  ('orange_guard', '橘座坐鎮',100, 'orange',  25000, '{"type":"heal_box","amount":40}',                         '專屬：飼料箱恢復 40 生命值'),
  ('tabby_roar',   '虎嘯震波',100, 'tabby',   20000, '{"type":"aoe","radius":180,"mult":2}',                    '專屬：周圍範圍 2 倍傷害'),
  ('black_shadow', '夜影潛行',100, 'black',   22000, '{"type":"invulnerable","duration_ms":3000}',              '專屬：3 秒無敵'),
  ('calico_whirl', '三色旋風',100, 'calico',  18000, '{"type":"spin","duration_ms":2500,"tick_ms":250}',        '專屬：旋轉攻擊周圍'),
  ('ragdoll_gaze', '優雅凝視',100, 'ragdoll', 20000, '{"type":"slow_all","factor":0.5,"duration_ms":5000}',     '專屬：全場怪物減速 50%')
on conflict (code) do nothing;

insert into public.monsters(code, name, hp, attack, speed, range, ai, target, reward_fish, score) values
  ('dust',     '灰塵怪', 30, 5,  70, 24, 'patrol_chase', 'player',   1, 10),
  ('hunger',   '飢餓怪', 45, 8,  55, 28, 'seek_box',     'food_box', 2, 20),
  ('mischief', '搗蛋怪', 25, 6, 120, 24, 'zigzag_dash',  'player',   2, 20)
on conflict (code) do nothing;

insert into public.rooms(code, name, type, background, config) values
  ('home', '我的房間', 'home', 'room_home',
   '{"floor":{"x":0,"y":430,"w":1280,"h":290},"door":{"x":40,"y":430,"w":90,"h":160}}'),
  ('arena_yard', '收容所後院', 'arena', 'arena_yard',
   '{"food_box":{"x":608,"y":330,"w":64,"h":56},
     "spawn_points":[[40,120],[640,40],[1240,120],[40,640],[640,700],[1240,640]],
     "walls":[[0,0,1280,24],[0,696,1280,24],[0,0,24,720],[1256,0,24,720]],
     "player_spawn":[640,470]}'),
  ('arena_storage', '飼料倉庫', 'arena', 'arena_storage',
   '{"food_box":{"x":608,"y":330,"w":64,"h":56},
     "spawn_points":[[40,120],[640,40],[1240,120],[40,640],[640,700],[1240,640]],
     "walls":[[0,0,1280,24],[0,696,1280,24],[0,0,24,720],[1256,0,24,720],[300,200,120,60],[860,460,120,60]],
     "player_spawn":[640,470]}')
on conflict (code) do nothing;

insert into public.items(code, name, type, species, price_fish, effect, description, sort) values
  ('food_basic',      '基本乾糧',     'food',      'any',   5, '{"stamina":15,"exp":10}', '恢復 15 體力', 1),
  ('food_can',        '營養罐頭',     'food',      'any',  15, '{"stamina":30,"exp":20}', '恢復 30 體力', 2),
  ('food_treat',      '肉泥點心',     'food',      'cat',  10, '{"stamina":10,"exp":15}', '恢復 10 體力，經驗較多', 3),
  ('med_spot',        '外用驅蟲滴劑', 'medicine',  'any',  60, '{"cures":["tick","flea"]}', '治療壁蝨、跳蚤', 10),
  ('med_ear',         '耳道殺蟎滴劑', 'medicine',  'any',  60, '{"cures":["ear_mite"]}',   '治療耳疥蟲', 11),
  ('med_heartworm',   '心絲蟲照護藥', 'medicine',  'any',  80, '{"cures":["heartworm"]}',  '心絲蟲照護', 12),
  ('card_keep_growth','保留成長卡',   'card',      'any', 200, '{}', '再次認養同一隻貓時保留等級與經驗', 20),
  ('carrier',         '外出籠',       'special',   'any', null,'{}', '熟悉 48 小時後自動解鎖，不可購買', 21),
  ('cat_tree',        '貓跳台',       'furniture', 'cat', 120, '{"w":96,"h":160}', '', 30),
  ('scratcher',       '抓板',         'furniture', 'cat',  40, '{"w":72,"h":40}',  '', 31),
  ('cat_bed',         '貓窩',         'furniture', 'cat',  80, '{"w":96,"h":56}',  '', 32),
  ('tunnel',          '隧道',         'furniture', 'cat',  60, '{"w":120,"h":48}', '', 33),
  ('bowl',            '食碗',         'furniture', 'any',  20, '{"w":40,"h":24}',  '', 34),
  ('fountain',        '飲水機',       'furniture', 'any',  90, '{"w":48,"h":48}',  '', 35),
  ('litter_box',      '貓砂盆',       'furniture', 'cat',  50, '{"w":88,"h":48}',  '', 36),
  ('toy_mouse',       '玩具老鼠',     'furniture', 'cat',  15, '{"w":24,"h":16}',  '', 37),
  ('rug_round',       '圓形地毯',     'furniture', 'any',  45, '{"w":200,"h":64}', '', 38),
  ('floor_dark_wood', '深色木地板',   'decor',     'any',  60, '{"slot":"floor"}',     '', 40),
  ('wallpaper_stripe','條紋壁紙',     'decor',     'any',  60, '{"slot":"wallpaper"}', '', 41)
on conflict (code) do nothing;

insert into public.diseases(code, name, cause_text, care_text, edu_reference, cure_item_code) values
  ('tick', '壁蝨',
   '接觸有壁蝨的草叢、灌木或受污染環境，壁蝨爬上身體附著吸血；部分種類能在室內繁殖並傳播病原。',
   '使用犬貓專用的外用驅蟲產品，已附著的壁蝨需正確移除。防治壁蝨不等於治療其傳播的疾病。',
   '常見產品如 Frontline Plus（需選犬／貓專用版）、貓用 Revolution Plus。以上為衛教資訊，實際用藥請諮詢獸醫。',
   'med_spot'),
  ('flea', '跳蚤',
   '接觸帶蚤動物，或環境中的跳蚤羽化後跳上身；蚤卵、幼蟲與蛹藏在寢具、地毯和縫隙。',
   '除了身體驅蟲，同住動物也要一起防治，並吸塵、清洗寢具。',
   '常見產品如 Frontline Plus、貓用 Revolution Plus。以上為衛教資訊，實際用藥請諮詢獸醫。',
   'med_spot'),
  ('ear_mite', '耳疥蟲',
   '常由耳蟎寄生造成，主要經密切接觸傳染；可能出現搔癢、甩頭與深褐色耳垢，但耳垢多不一定是耳蟎。',
   '需檢查確認；一般清耳液不能取代殺蟎藥物，同住動物也需評估。',
   '貓用 Revolution Plus 具耳蟎治療適應症。以上為衛教資訊，實際用藥請諮詢獸醫。',
   'med_ear'),
  ('heartworm', '心絲蟲',
   '由帶有感染期幼蟲的蚊子叮咬傳播，寄生蟲逐步發育並損害心肺；室內犬貓也有風險，與疲累無關。',
   '重點在定期預防；已感染需由獸醫規劃治療，貓目前沒有核准的成蟲治療藥物。',
   '預防：犬用 Heartgard Plus、貓用 Revolution Plus。以上為衛教資訊，實際用藥請諮詢獸醫。',
   'med_heartworm')
on conflict (code) do nothing;

insert into public.care_tasks(code, name, species, trust_reward, fish_reward, description, sort) values
  ('litter', '鏟貓砂',   'cat', 5, 10, '點選髒污、拖進垃圾桶', 1),
  ('feed',   '餵食',     'any', 5,  0, '選擇食物、放入碗中；重設未餵食計時', 2),
  ('brush',  '刷牙',     'any', 5, 10, '沿提示滑動清潔牙齒', 3),
  ('wand',   '逗貓棒',   'cat', 8, 10, '引導貓咪追逐玩具', 4),
  ('nail',   '指甲照護', 'cat', 5,  0, '查看指甲，必要時完成修剪', 5)
on conflict (code) do nothing;

-- 示範收容所與動物（固定 UUID，方便重複執行不重複新增）
insert into public.shelters(id, name, description, contact, address, is_demo) values
  ('00000000-0000-4000-a000-000000000001', '臺北市動物之家（範例）',
   '示範資料：正式上線前請於後台改為實際合作機構。', '（範例）', '（範例）', true)
on conflict (id) do nothing;

insert into public.animals(id, name, character_type, shelter_id, species, adopt_cost, real_profile, is_demo) values
  ('00000000-0000-4000-b000-000000000001', '小橘', 'orange',  '00000000-0000-4000-a000-000000000001', 'cat', 100, '{"note":"示範資料"}', true),
  ('00000000-0000-4000-b000-000000000002', '阿虎', 'tabby',   '00000000-0000-4000-a000-000000000001', 'cat', 100, '{"note":"示範資料"}', true),
  ('00000000-0000-4000-b000-000000000003', '小黑', 'black',   '00000000-0000-4000-a000-000000000001', 'cat', 100, '{"note":"示範資料"}', true),
  ('00000000-0000-4000-b000-000000000004', '花花', 'calico',  '00000000-0000-4000-a000-000000000001', 'cat', 100, '{"note":"示範資料"}', true),
  ('00000000-0000-4000-b000-000000000005', '雪球', 'ragdoll', '00000000-0000-4000-a000-000000000001', 'cat', 100, '{"note":"示範資料"}', true)
on conflict (id) do nothing;

insert into public.charity_tasks(id, shelter_id, title, description, goal_fish, is_demo) values
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-a000-000000000001',
   '冬季飼料補給（示範）', '示範資料：遊戲魚乾為虛擬點數，不代表實際捐款。', 50000, true),
  ('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-a000-000000000001',
   '醫療基金（示範）', '示範資料：遊戲魚乾為虛擬點數，不代表實際捐款。', 80000, true)
on conflict (id) do nothing;

insert into public.sponsors(id, name, intro, is_demo) values
  ('00000000-0000-4000-d000-000000000001', '示範企業', '示範資料：尚無正式合作。', true)
on conflict (id) do nothing;

insert into public.sponsor_campaigns(id, sponsor_id, shelter_id, charity_task_id, title, rule_text,
                                     twd_per_valid_battle, cap_twd, pledged_twd, is_demo) values
  ('00000000-0000-4000-e000-000000000001', '00000000-0000-4000-d000-000000000001',
   '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000001',
   '守護飼料箱活動（示範）', '示範：每完成 1 場有效守護戰，企業提供 1 元飼料經費，上限 10,000 元。',
   1, 10000, 10000, true)
on conflict (id) do nothing;
