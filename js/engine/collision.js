// =====================================================================
// CollisionManager — Bounding Box + Collision Map（不使用圖片透明區域）
//   walkable：可行走多邊形（房間地板的透視梯形）
//   solids：不可穿越的矩形（家具、飼料箱、木箱）
//   移動採用「分軸解算」：先 X 後 Y，撞到就退回該軸，可貼牆滑行
// =====================================================================
export function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function pointInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export class CollisionManager {
  constructor({ walkable, solids = [] }) {
    this.walkable = walkable;
    this.solids = solids;
  }

  boxIsFree(box) {
    const corners = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]];
    for (const [cx, cy] of corners) if (!pointInPolygon(cx, cy, this.walkable)) return false;
    for (const s of this.solids) if (rectsOverlap(box, s)) return false;
    return true;
  }

  // entity 需提供 x, y 與 feetBoxAt(x, y)
  move(entity, dx, dy) {
    let hitX = false, hitY = false;
    if (dx) {
      if (this.boxIsFree(entity.feetBoxAt(entity.x + dx, entity.y))) entity.x += dx; else hitX = true;
    }
    if (dy) {
      if (this.boxIsFree(entity.feetBoxAt(entity.x, entity.y + dy))) entity.y += dy; else hitY = true;
    }
    return { hitX, hitY };
  }
}
