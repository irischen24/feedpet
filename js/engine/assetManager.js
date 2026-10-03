// =====================================================================
// AssetManager — 全部圖片載入完成前不啟動 Game Loop
// =====================================================================
export const MANIFEST = {
  room_home: 'assets/rooms/room_home.png',
  cat_orange: 'assets/sprites/cat_orange.png',
  cat_tabby: 'assets/sprites/cat_tabby.png',
  cat_black: 'assets/sprites/cat_black.png',
  cat_calico: 'assets/sprites/cat_calico.png',
  cat_ragdoll: 'assets/sprites/cat_ragdoll.png',
  cat_tabby_feed1: 'assets/sprites/cat_tabby_feed1.png',
  cat_tabby_feed2: 'assets/sprites/cat_tabby_feed2.png',
  cat_tabby_feed3: 'assets/sprites/cat_tabby_feed3.png',
};

export class AssetManager {
  constructor() { this.images = new Map(); }

  async loadAll(manifest = MANIFEST, onProgress = () => {}) {
    const entries = Object.entries(manifest);
    let done = 0;
    onProgress(0, entries.length);
    await Promise.all(entries.map(([key, url]) => this._loadImage(url).then((img) => {
      this.images.set(key, img);
      done += 1;
      onProgress(done, entries.length);
    })));
  }

  // 可選素材：載入失敗（檔案不存在）就略過，回傳實際找到的 key
  async loadOptional(manifest, onProgress = () => {}) {
    const entries = Object.entries(manifest);
    const found = [];
    let done = 0;
    await Promise.all(entries.map(([key, url]) => this._loadImage(url)
      .then((img) => { this.images.set(key, img); found.push(key); })
      .catch(() => {})
      .finally(() => { done += 1; onProgress(done, entries.length); })));
    return found;
  }

  _loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(Object.assign(new Error(`ASSET_LOAD_FAILED: ${url}`), { code: 'ASSET' }));
      img.src = url;
    });
  }

  get(key) {
    const img = this.images.get(key);
    if (!img) throw new Error(`Asset not loaded: ${key}`);
    return img;
  }

  // 程式產生的圖（例如延伸場景）也放進同一個倉庫
  set(key, canvas) { this.images.set(key, canvas); }
  has(key) { return this.images.has(key); }
}
