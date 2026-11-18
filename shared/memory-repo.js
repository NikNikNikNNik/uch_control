/*
 * Хранилище в памяти. Используется демо-версией в браузере и автотестами.
 * onChange(tables) вызывается после каждого изменения (демо сохраняет в localStorage).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TCMemoryRepo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var TABLES = ['sites', 'departments', 'positions', 'employees', 'courses', 'positionRequirements', 'individualRequirements', 'trainings', 'users', 'audit'];

  function createMemoryRepo(data, onChange) {
    var tables = {};
    TABLES.forEach(function (k) { tables[k] = (data && data[k]) ? data[k] : []; });
    var nextId = {};
    TABLES.forEach(function (k) { nextId[k] = tables[k].reduce(function (m, x) { return Math.max(m, x.id || 0); }, 0) + 1; });
    var repo = {
      tables: tables,
      settings: (data && data.settings) || {},
      insert: function (table, obj) {
        var o = Object.assign({}, obj, { id: nextId[table]++ });
        tables[table].push(o);
        changed();
        return Promise.resolve(o);
      },
      update: function (table, id, patch) {
        var o = tables[table].find(function (x) { return x.id === id; });
        if (o) Object.assign(o, patch, { id: id });
        changed();
        return Promise.resolve(o);
      },
      remove: function (table, id) {
        var i = tables[table].findIndex(function (x) { return x.id === id; });
        if (i >= 0) tables[table].splice(i, 1);
        changed();
        return Promise.resolve();
      },
      setSettings: function (s) { repo.settings = Object.assign({}, repo.settings, s); changed(); return Promise.resolve(); },
      appendAudit: function (entry) {
        var o = Object.assign({}, entry, { id: nextId.audit++ });
        tables.audit.push(o);
        if (tables.audit.length > 3000) tables.audit.splice(0, tables.audit.length - 3000);
        changed();
        return Promise.resolve(o);
      },
      snapshot: function () {
        var o = {}; TABLES.forEach(function (k) { o[k] = tables[k]; }); o.settings = repo.settings; return o;
      }
    };
    var timer = null;
    function changed() {
      if (!onChange) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { timer = null; onChange(repo.snapshot()); }, 300);
    }
    return repo;
  }
  createMemoryRepo.TABLES = TABLES;
  return createMemoryRepo;
});
