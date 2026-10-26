/*
 * 問題の写真の保存（IndexedDB）
 * localStorage は容量が小さい（5MB 前後）ため、写真だけはこちらに保存し、問題には写真の ID を持たせる。
 */
(function () {
  'use strict';

  const DB_NAME = 'math-review';
  const STORE = 'images';
  const MAX_EDGE = 1600;
  const JPEG_QUALITY = 0.85;

  let dbPromise = null;
  const urlCache = new Map();

  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      dbPromise.catch(() => {
        dbPromise = null;
      });
    }
    return dbPromise;
  }

  // fn にはオブジェクトストアを渡す。戻り値が IDBRequest ならその結果を返す
  async function withStore(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('保存が中断されました'));
    });
  }

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return `img-${window.crypto.randomUUID()}`;
    return `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  let persistRequested = false;
  function requestPersist() {
    // ブラウザが容量不足のときに勝手に消さないよう頼む（断られても動作には影響しない）
    if (persistRequested || !navigator.storage || !navigator.storage.persist) return;
    persistRequested = true;
    navigator.storage.persist().catch(() => {});
  }

  // 写真を読み込み、長辺 MAX_EDGE 以下の JPEG に縮小する
  function fromFile(file) {
    return new Promise((resolve, reject) => {
      const src = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(src);
        const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error(`${file.name || '写真'} を変換できませんでした`));
            return;
          }
          resolve({ blob, url: URL.createObjectURL(blob) });
        }, 'image/jpeg', JPEG_QUALITY);
      };
      img.onerror = () => {
        URL.revokeObjectURL(src);
        reject(new Error(`${file.name || '写真'} を読み込めませんでした`));
      };
      img.src = src;
    });
  }

  // まだ保存していない写真（{ blob, url }）を保存して ID を返す
  async function save(blob) {
    const id = newId();
    await withStore('readwrite', (store) => {
      store.put(blob, id);
    });
    requestPersist();
    return id;
  }

  async function get(id) {
    return withStore('readonly', (store) => store.get(id));
  }

  async function url(id) {
    if (urlCache.has(id)) return urlCache.get(id);
    const blob = await get(id);
    if (!blob) return null;
    const u = URL.createObjectURL(blob);
    urlCache.set(id, u);
    return u;
  }

  function forget(id) {
    const u = urlCache.get(id);
    if (u) URL.revokeObjectURL(u);
    urlCache.delete(id);
  }

  async function remove(ids) {
    if (!ids.length) return;
    ids.forEach(forget);
    await withStore('readwrite', (store) => {
      ids.forEach((id) => store.delete(id));
    });
  }

  async function keys() {
    return withStore('readonly', (store) => store.getAllKeys());
  }

  // すべての写真を entries（[id, blob] の配列）で置き換える
  async function replaceAll(entries) {
    [...urlCache.keys()].forEach(forget);
    await withStore('readwrite', (store) => {
      store.clear();
      entries.forEach(([id, blob]) => store.put(blob, id));
    });
    if (entries.length) requestPersist();
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function dataUrlToBlob(dataUrl) {
    const res = await fetch(dataUrl);
    return res.blob();
  }

  window.MathReviewImages = {
    fromFile,
    save,
    get,
    url,
    remove,
    keys,
    replaceAll,
    blobToDataUrl,
    dataUrlToBlob,
  };
})();
