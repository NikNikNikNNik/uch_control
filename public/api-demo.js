/*
 * Адаптер API для демо-версии: тот же прикладной слой (shared/service.js),
 * но данные в памяти браузера. Изменения сохраняются в IndexedDB этого браузера (если доступно).
 */
(function () {
  'use strict';
  const DB_NAME = 'training-control-demo', STORE = 'state', KEY = 'v1';
  const DEMO_USERS = [
    { id: 1, login: 'admin', fullName: 'Администратор системы', role: 'admin', siteIds: [], departmentIds: [] },
    { id: 2, login: 'ivanova', fullName: 'Иванова Е. А. (обучение, пл. «Северная»)', role: 'trainer', siteIds: [1], departmentIds: [] },
    { id: 3, login: 'petrov', fullName: 'Петров С. В. (начальник РМЦ)', role: 'manager', siteIds: [], departmentIds: [3] },
    { id: 4, login: 'auditor', fullName: 'Аудитор (только просмотр)', role: 'viewer', siteIds: [], departmentIds: [] }
  ];

  function idb() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }
  async function load() {
    const db = await idb(); if (!db) return null;
    return new Promise((resolve) => {
      try {
        const r = db.transaction(STORE).objectStore(STORE).get(KEY);
        r.onsuccess = () => resolve(r.result || null); r.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }
  async function save(state) {
    const db = await idb(); if (!db) return;
    try { db.transaction(STORE, 'readwrite').objectStore(STORE).put(state, KEY); } catch (e) { /* без сохранения */ }
  }
  async function clear() {
    const db = await idb(); if (!db) return;
    await new Promise((resolve) => {
      try { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(KEY); t.oncomplete = resolve; t.onerror = resolve; } catch (e) { resolve(); }
    });
  }

  let service = null, currentUser = DEMO_USERS[0], persisted = false;
  async function init() {
    let data = await load();
    persisted = !!data;
    if (!data) data = TCSeed.generate({});
    data.users = DEMO_USERS.map((u) => Object.assign({}, u, { active: true }));
    const repo = TCMemoryRepo(data, (snap) => { save(snap); });
    service = TCService.createService(repo, { now: () => new Date().toISOString() });
    try { const saved = sessionStorage.getItem('tc-demo-user'); if (saved) currentUser = DEMO_USERS.find((u) => u.login === saved) || currentUser; } catch (e) { /* нет */ }
  }
  const ready = init();

  // Внутри Claude скачивание идёт через возможность downloads; в обычном браузере через ссылку.
  let downloads = null;
  async function getDownloads() {
    if (downloads) return downloads;
    try { downloads = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (e) { downloads = null; }
    return downloads;
  }

  window.TCApi = {
    mode: 'demo',
    demoUsers: DEMO_USERS,
    get currentLogin() { return currentUser.login; },
    call: async (method, params) => {
      await ready;
      // имитация сериализации, как при обмене с сервером
      return JSON.parse(JSON.stringify(await service.call(currentUser, method, JSON.parse(JSON.stringify(params || {})))));
    },
    switchUser: (login) => {
      currentUser = DEMO_USERS.find((u) => u.login === login) || DEMO_USERS[0];
      try { sessionStorage.setItem('tc-demo-user', currentUser.login); } catch (e) { /* нет */ }
    },
    resetDemo: async () => { await clear(); },
    saveFile: async (filename, blob) => {
      const d = await getDownloads();
      if (d) {
        try { await d.save({ filename, data: blob }); return true; } catch (e) {
          if (e && e.code === 'declined') return false;
          throw new Error('Скачивание недоступно в этом окне');
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
      return true;
    }
  };
})();
