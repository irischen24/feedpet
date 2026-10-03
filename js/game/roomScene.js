// =====================================================================
// RoomScene — 家（養成）與戰場（Phase 7 為練習模式，Phase 8 加入怪物）
//   State：ROOM_ENTER → EXPLORE →（門）→ ROOM_EXIT
// =====================================================================
import { Room, ROOM_DEFS } from './room.js';
import { Cat } from './player.js';

export class RoomScene {
  constructor({ roomId, spawn = 'default', assets, input, adoption, hooks }) {
    this.room = new Room(ROOM_DEFS[roomId], assets);
    this.input = input;
    this.hooks = hooks;               // { onDoor(action), onPause(), onEnter(room), onExit(room), ambientLine() }
    this.cat = new Cat(assets, adoption, this.room.spawn(spawn));
    this.nearDoor = null;
    this.ambientTimer = 2;
    this.decor = null;                // 裝飾模式時為 DecorateController
  }

  enter() { this.hooks.onEnter?.(this.room); }
  exit() { this.hooks.onExit?.(this.room); }
  onPause() { this.hooks.onPause?.(); }

  setAdoption(adoption) { this.cat.setAdoption(adoption); this.ambientTimer = 0.5; }

  update(dt) {
    if (this.decor) { this.cat.update(dt, this.input, this.room, { canMove: false }); return; }
    this.cat.update(dt, this.input, this.room);

    const door = this.room.doorAt(this.cat.x, this.cat.y);
    if (door !== this.nearDoor) { this.nearDoor = door; this.hooks.onPrompt?.(door ? door.prompt : null); }
    if (this.input.consume('interact') && door) this.hooks.onDoor?.(door.action);

    // 照護提醒：低體力 / 生病 / 48 小時未餵食，定期說出 Excel 指定的提示文字
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = 18;
      const line = this.hooks.ambientLine?.();
      if (line) this.cat.say(line, 5);
    }
  }

  render(ctx) {
    this.room.render(ctx, [this.cat]);
    if (this.decor) this.decor.renderOverlay(ctx);
  }

  renderDebug(ctx) {
    this.room.renderDebug(ctx);
    const f = this.cat.feetBox, b = this.cat.bodyBox;
    ctx.save(); ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffd60a'; ctx.strokeRect(f.x, f.y, f.w, f.h);
    ctx.strokeStyle = '#bf5af2'; ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.restore();
  }

  debugInfo() {
    return {
      Room: this.room.id, Player: `${this.cat.x.toFixed(0)}, ${this.cat.y.toFixed(0)}`,
      State: this.cat.state, Door: this.nearDoor ? this.nearDoor.id : '-',
    };
  }
}
