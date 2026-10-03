// =====================================================================
// Room — 每個 Room 都有：ID、Type、Background、Collision Map、
//        Spawn Points、Props（家具 / 飼料箱 / 木箱）、Doors、Events
// 座標全部是 1280×720 邏輯座標；props 的 (x, y) 是「腳底中心」。
// =====================================================================
import { CollisionManager, pointInRect } from '../engine/collision.js';
import { PX } from './roomArt.js';

export const ROOM_DEFS = {
  home: {
    id: 'home', type: 'home', name: '我的房間', bg: 'bg_home',
    // 地板透視梯形：後牆底線 y≈430，兩側斜牆在畫面邊緣 y≈505
    walkable: [[128, 446], [1152, 446], [1280, 516], [1280, 714], [0, 714], [0, 516]],
    props: [],
    doors: [{ id: 'go_out', zone: { x: 930, y: 440, w: 160, h: 70 }, action: 'arena_select', prompt: '出門守護飼料箱' }],
    spawns: { default: { x: 640, y: 610 }, from_arena: { x: 1010, y: 520 } },
  },
  arena_yard: {
    id: 'arena_yard', type: 'arena', name: '收容所後院', bg: 'bg_yard',
    walkable: [[24, 206], [1256, 206], [1256, 714], [24, 714]],
    props: [{ id: 'food_box', img: 'food_box', x: 640, y: 470, solid: { x: 598, y: 446, w: 84, h: 26 } }],
    doors: [{ id: 'go_home', zone: { x: 560, y: 206, w: 160, h: 50 }, action: 'home', prompt: '回家' }],
    spawns: { default: { x: 640, y: 640 } },
    monsterSpawns: [[40, 230], [640, 210], [1240, 230], [40, 700], [640, 712], [1240, 700]],
  },
  arena_storage: {
    id: 'arena_storage', type: 'arena', name: '飼料倉庫', bg: 'bg_storage',
    walkable: [[0, 238], [1280, 238], [1280, 714], [0, 714]],
    props: [
      { id: 'food_box', img: 'food_box', x: 640, y: 480, solid: { x: 598, y: 456, w: 84, h: 26 } },
      { id: 'crate_a', img: 'crate', x: 300, y: 400, solid: { x: 258, y: 376, w: 84, h: 26 } },
      { id: 'crate_b', img: 'crate', x: 980, y: 640, solid: { x: 938, y: 616, w: 84, h: 26 } },
    ],
    doors: [{ id: 'go_home', zone: { x: 560, y: 238, w: 160, h: 50 }, action: 'home', prompt: '回家' }],
    spawns: { default: { x: 640, y: 650 } },
    monsterSpawns: [[20, 260], [640, 240], [1260, 260], [20, 700], [640, 712], [1260, 700]],
  },
};

export class Room {
  constructor(def, assets) {
    this.def = def;
    this.id = def.id;
    this.type = def.type;
    this.name = def.name;
    this.bg = assets.get(def.bg);
    this.props = def.props.map((p) => {
      const img = assets.get(p.img);
      return { ...p, image: img, w: img.width * PX, h: img.height * PX };
    });
    this.collision = new CollisionManager({
      walkable: def.walkable,
      solids: this.props.filter((p) => p.solid).map((p) => p.solid),
    });
  }

  spawn(name = 'default') { return this.def.spawns[name] || this.def.spawns.default; }

  doorAt(px, py) { return this.def.doors.find((d) => pointInRect(px, py, d.zone)) || null; }

  render(ctx, entities) {
    ctx.drawImage(this.bg, 0, 0, this.bg.width * PX, this.bg.height * PX);
    // 依腳底 y 排序（越下面越靠前）
    const drawables = [...this.props.map((p) => ({ y: p.y, draw: () => this._drawProp(ctx, p) })),
                       ...entities.map((e) => ({ y: e.y, draw: () => e.render(ctx) }))];
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) d.draw();
  }

  _drawProp(ctx, p) {
    ctx.fillStyle = 'rgba(107, 62, 38, 0.22)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y - 2, p.w * 0.46, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(p.image, Math.round(p.x - p.w / 2), Math.round(p.y - p.h), p.w, p.h);
  }

  renderDebug(ctx) {
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#00d084';
    ctx.beginPath();
    this.def.walkable.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath(); ctx.stroke();
    ctx.strokeStyle = '#ff3b30';
    for (const s of this.collision.solids) ctx.strokeRect(s.x, s.y, s.w, s.h);
    ctx.strokeStyle = '#2f7cff';
    for (const d of this.def.doors) ctx.strokeRect(d.zone.x, d.zone.y, d.zone.w, d.zone.h);
    ctx.fillStyle = '#ff9f0a';
    for (const [x, y] of this.def.monsterSpawns || []) ctx.fillRect(x - 5, y - 5, 10, 10);
    ctx.restore();
  }
}
