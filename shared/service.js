/*
 * Контроль обучения персонала: прикладной слой (методы API).
 * Работает поверх «хранилища» (repo) с одинаковым интерфейсом:
 *   в браузере (демо): массивы в памяти + localStorage,
 *   на сервере: SQLite/PostgreSQL через knex с кешем в памяти.
 * Права доступа, проверки и журнал изменений: здесь, общие для обоих режимов.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.TCService = factory(root.TCCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  var ROLES = {
    admin: { label: 'Администратор', edit: true, admin: true },
    trainer: { label: 'Ответственный за обучение', edit: true },
    manager: { label: 'Руководитель подразделения', edit: false },
    viewer: { label: 'Наблюдатель (только просмотр)', edit: false }
  };

  function ServiceError(message, status) {
    this.message = message; this.status = status || 400; this.name = 'ServiceError';
  }
  ServiceError.prototype = Object.create(Error.prototype);
  function fail(msg, status) { throw new ServiceError(msg, status); }

  function str(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : null; }
  function norm(s) { return str(s).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' '); }

  function createService(repo, hooks) {
    hooks = hooks || {};
    var T = repo.tables;

    // ---------- права ----------
    function role(user) { return ROLES[user.role] || ROLES.viewer; }
    function requireEdit(user) { if (!role(user).edit) fail('Недостаточно прав для изменения данных', 403); }
    function requireAdmin(user) { if (!role(user).admin) fail('Действие доступно только администратору', 403); }
    // Справочник курсов и требования по должностям общие для всего предприятия:
    // менять их может администратор или ответственный без ограничения по площадкам.
    function requireCatalog(user) {
      requireEdit(user);
      if (user.role !== 'admin' && siteIdsOf(user).length) fail('Курсы и требования по должностям общие для предприятия: их меняет администратор или ответственный за всё предприятие', 403);
    }
    function siteIdsOf(user) { return (user.siteIds || []).map(Number); }
    function deptIdsOf(user) { return (user.departmentIds || []).map(Number); }
    function inScope(user, e) {
      if (user.role === 'admin' || user.role === 'viewer') return true;
      var d = deptIdsOf(user), s = siteIdsOf(user);
      if (user.role === 'manager' && d.length) return d.indexOf(e.departmentId) >= 0;
      if (s.length) return s.indexOf(e.siteId) >= 0;
      return true;
    }
    function canEditSite(user, siteId) {
      if (user.role === 'admin') return true;
      if (user.role !== 'trainer') return false;
      var s = siteIdsOf(user);
      return !s.length || s.indexOf(Number(siteId)) >= 0;
    }
    function requireEditEmployee(user, e) {
      requireEdit(user);
      if (!canEditSite(user, e.siteId)) fail('Работник относится к площадке вне вашей зоны ответственности', 403);
    }

    // ---------- справочники ----------
    function refs() {
      return {
        sitesById: C.indexBy(T.sites, 'id'),
        departmentsById: C.indexBy(T.departments, 'id'),
        positionsById: C.indexBy(T.positions, 'id'),
        coursesById: C.indexBy(T.courses, 'id'),
        employeesById: C.indexBy(T.employees, 'id')
      };
    }
    function settings() {
      var s = repo.settings || {};
      return {
        orgName: s.orgName || 'Предприятие',
        expiringDays: num(s.expiringDays) || 30
      };
    }
    function asOfOf(p) { return p && C.isValidISO(p.asOf) ? p.asOf : C.todayISO(); }

    function audit(user, action, entity, entityId, summary) {
      return repo.appendAudit({
        ts: hooks.now ? hooks.now() : new Date().toISOString(),
        userLogin: user.login, userName: user.fullName || user.login,
        action: action, entity: entity, entityId: entityId == null ? null : entityId, summary: summary
      });
    }

    // ---------- выборка работников по фильтрам ----------
    function filterEmployees(user, p, includeInactive) {
      p = p || {};
      var q = norm(p.q);
      var asOf = asOfOf(p);
      return T.employees.filter(function (e) {
        if (!inScope(user, e)) return false;
        if (!includeInactive && !C.isActiveOn(e, asOf)) return false;
        if (p.siteId && e.siteId !== Number(p.siteId)) return false;
        if (p.departmentId && e.departmentId !== Number(p.departmentId)) return false;
        if (p.positionId && e.positionId !== Number(p.positionId)) return false;
        if (q && norm(e.fullName).indexOf(q) < 0 && norm(e.tabNo).indexOf(q) < 0) return false;
        return true;
      });
    }

    function rowsFor(user, p) {
      var asOf = asOfOf(p);
      var emps = filterEmployees(user, p, false);
      var rows = C.buildRows({
        employees: emps, courses: T.courses,
        positionRequirements: T.positionRequirements,
        individualRequirements: T.individualRequirements,
        trainings: T.trainings
      }, asOf, settings().expiringDays);
      if (p.courseId) rows = rows.filter(function (r) { return r.courseId === Number(p.courseId); });
      if (p.category) {
        var cb = C.indexBy(T.courses, 'id');
        rows = rows.filter(function (r) { return (cb[r.courseId] || {}).category === p.category; });
      }
      return { asOf: asOf, rows: rows };
    }

    function enrich(rows) {
      var R = refs();
      return rows.map(function (r) {
        var e = R.employeesById[r.employeeId], c = R.coursesById[r.courseId];
        return Object.assign({}, r, {
          tabNo: e.tabNo, fullName: e.fullName,
          siteName: (R.sitesById[e.siteId] || {}).name || '',
          departmentName: (R.departmentsById[e.departmentId] || {}).name || '',
          positionName: (R.positionsById[e.positionId] || {}).name || '',
          courseName: c.name, courseCode: c.code, category: c.category, periodMonths: c.periodMonths
        });
      });
    }

    function sortRows(rows, sort) {
      var rank = { EXPIRED: 0, NOT_COMPLETED: 1, EXPIRING: 2, CURRENT: 3 };
      if (sort === 'name') return rows.sort(function (a, b) { return a.fullName.localeCompare(b.fullName, 'ru') || a.courseName.localeCompare(b.courseName, 'ru'); });
      if (sort === 'course') return rows.sort(function (a, b) { return a.courseName.localeCompare(b.courseName, 'ru') || a.fullName.localeCompare(b.fullName, 'ru'); });
      return rows.sort(function (a, b) {
        return (rank[a.status] - rank[b.status]) || ((a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : (a.dueDate || '9999') > (b.dueDate || '9999') ? 1 : 0) || a.fullName.localeCompare(b.fullName, 'ru');
      });
    }

    function page(arr, p) {
      var size = p.pageSize === 0 ? arr.length || 1 : (num(p.pageSize) || 50);
      var pg = Math.max(1, num(p.page) || 1);
      return { items: arr.slice((pg - 1) * size, pg * size), total: arr.length, page: pg, pageSize: size };
    }

    // ---------- проверка и нормализация входных данных ----------
    function cleanEmployee(o) {
      var e = {
        tabNo: str(o.tabNo), fullName: str(o.fullName),
        siteId: num(o.siteId), departmentId: num(o.departmentId), positionId: num(o.positionId),
        hireDate: C.normalizeDate(o.hireDate), dismissedAt: C.normalizeDate(o.dismissedAt),
        note: str(o.note)
      };
      if (!e.tabNo) fail('Укажите табельный номер');
      if (!e.fullName) fail('Укажите ФИО');
      var R = refs();
      if (!R.sitesById[e.siteId]) fail('Выберите площадку');
      var d = R.departmentsById[e.departmentId];
      if (!d) fail('Выберите подразделение');
      if (d.siteId !== e.siteId) fail('Подразделение не относится к выбранной площадке');
      if (!R.positionsById[e.positionId]) fail('Выберите должность');
      return e;
    }
    function cleanCourse(o) {
      var c = {
        code: str(o.code), name: str(o.name), category: str(o.category) || 'Прочее',
        periodMonths: o.periodMonths === '' || o.periodMonths == null ? null : num(o.periodMonths),
        basis: str(o.basis), hours: o.hours === '' || o.hours == null ? null : num(o.hours),
        active: o.active !== false
      };
      if (!c.name) fail('Укажите название курса');
      if (c.periodMonths !== null && (c.periodMonths < 0 || c.periodMonths > 240)) fail('Периодичность: от 0 до 240 месяцев');
      if (c.periodMonths === 0) c.periodMonths = null;
      return c;
    }
    function cleanTraining(o) {
      var t = {
        courseId: num(o.courseId),
        date: C.normalizeDate(o.date),
        validUntil: C.normalizeDate(o.validUntil),
        protocolNo: str(o.protocolNo), certificateNo: str(o.certificateNo),
        provider: str(o.provider), note: str(o.note)
      };
      if (!refs().coursesById[t.courseId]) fail('Выберите курс');
      if (!t.date) fail('Укажите дату обучения (проверки знаний)');
      if (t.validUntil && t.validUntil < t.date) fail('«Действует до» не может быть раньше даты обучения');
      return t;
    }

    function siteName(id) { return (refs().sitesById[id] || {}).name || ''; }

    // ---------- методы API ----------
    var M = {};

    M.bootstrap = function (user) {
      return {
        user: { id: user.id, login: user.login, fullName: user.fullName, role: user.role, roleLabel: role(user).label,
          canEdit: role(user).edit, canEditCatalog: role(user).edit && (user.role === 'admin' || !siteIdsOf(user).length), isAdmin: !!role(user).admin, siteIds: siteIdsOf(user), departmentIds: deptIdsOf(user) },
        roles: Object.keys(ROLES).map(function (k) { return { id: k, label: ROLES[k].label }; }),
        settings: settings(),
        today: C.todayISO(),
        sites: T.sites.slice().sort(byName),
        departments: T.departments.slice().sort(byName),
        positions: T.positions.slice().sort(byName),
        courses: T.courses.slice().sort(function (a, b) { return a.category.localeCompare(b.category, 'ru') || a.name.localeCompare(b.name, 'ru'); }),
        categories: uniq(T.courses.map(function (c) { return c.category; })).sort()
      };
    };
    function byName(a, b) { return String(a.name).localeCompare(String(b.name), 'ru'); }
    function uniq(a) { var o = {}; a.forEach(function (x) { o[x] = 1; }); return Object.keys(o); }

    M.dashboard = function (user, p) {
      var x = rowsFor(user, p || {});
      var R = refs();
      var d = C.dashboard(x.rows, R.employeesById, R.coursesById, R, x.asOf, { months: 12 });
      d.expiringDays = settings().expiringDays;
      return d;
    };

    M.statusList = function (user, p) {
      p = p || {};
      var x = rowsFor(user, p);
      var rows = x.rows;
      var counts = C.emptyCounts();
      if (p.dueKey) {
        var horizon = C.addMonths(C.monthKey(x.asOf) + '-01', 12);
        rows = rows.filter(function (r) { return C.planKeyOf(r, horizon) === p.dueKey; });
      }
      rows.forEach(function (r) { counts[r.status]++; counts.total++; });
      if (p.statuses && p.statuses.length) rows = rows.filter(function (r) { return p.statuses.indexOf(r.status) >= 0; });
      var full = sortRows(enrich(rows), p.sort);
      var pg = page(full, p);
      pg.counts = counts; pg.asOf = x.asOf;
      return pg;
    };

    M.matrix = function (user, p) {
      p = p || {};
      var x = rowsFor(user, p);
      var R = refs();
      var byEmp = {}, usedCourses = {};
      x.rows.forEach(function (r) {
        (byEmp[r.employeeId] = byEmp[r.employeeId] || {})[r.courseId] = { s: r.status, v: r.validUntil, d: r.lastDate };
        usedCourses[r.courseId] = 1;
      });
      var emps = filterEmployees(user, p, false).filter(function (e) {
        if (p.onlyProblems) {
          var cells = byEmp[e.id] || {};
          return Object.keys(cells).some(function (k) { return cells[k].s !== 'CURRENT'; });
        }
        return true;
      }).sort(function (a, b) { return a.fullName.localeCompare(b.fullName, 'ru'); });
      var limit = num(p.limit) || 300;
      var courses = T.courses.filter(function (c) { return usedCourses[c.id]; })
        .sort(function (a, b) { return a.category.localeCompare(b.category, 'ru') || a.name.localeCompare(b.name, 'ru'); });
      return {
        asOf: x.asOf, total: emps.length, limited: emps.length > limit,
        courses: courses.map(function (c) { return { id: c.id, code: c.code, name: c.name, category: c.category }; }),
        employees: emps.slice(0, limit).map(function (e) {
          return { id: e.id, tabNo: e.tabNo, fullName: e.fullName,
            departmentName: (R.departmentsById[e.departmentId] || {}).name || '',
            positionName: (R.positionsById[e.positionId] || {}).name || '',
            cells: byEmp[e.id] || {} };
        })
      };
    };

    M.plan = function (user, p) {
      p = p || {};
      var x = rowsFor(user, p);
      var pl = C.plan(x.rows, x.asOf, 12);
      var R = refs();
      var courses = Object.keys(pl.cells).map(Number).map(function (id) { return R.coursesById[id]; })
        .sort(function (a, b) { return a.category.localeCompare(b.category, 'ru') || a.name.localeCompare(b.name, 'ru'); });
      return {
        asOf: x.asOf,
        keys: pl.keys.map(function (k) { return { key: k, label: k === 'now' ? 'Срочно' : C.monthLabel(k) }; }),
        courses: courses.map(function (c) {
          var row = pl.cells[c.id], total = 0;
          Object.keys(row).forEach(function (k) { total += row[k]; });
          return { id: c.id, name: c.name, code: c.code, category: c.category, cells: row, total: total };
        }),
        colTotals: pl.colTotals
      };
    };

    // ----- работники -----
    M.employeesList = function (user, p) {
      p = p || {};
      var list = filterEmployees(user, p, true).filter(function (e) {
        if (p.state === 'active') return C.isActiveOn(e, C.todayISO());
        if (p.state === 'dismissed') return !C.isActiveOn(e, C.todayISO());
        return true;
      }).sort(function (a, b) { return a.fullName.localeCompare(b.fullName, 'ru'); });
      var R = refs();
      var pg = page(list, p);
      var asOf = asOfOf(p);
      var rows = C.buildRows({ employees: pg.items, courses: T.courses, positionRequirements: T.positionRequirements,
        individualRequirements: T.individualRequirements, trainings: T.trainings }, asOf, settings().expiringDays);
      var cnt = {};
      rows.forEach(function (r) { var c = cnt[r.employeeId] = cnt[r.employeeId] || C.emptyCounts(); c[r.status]++; c.total++; });
      pg.items = pg.items.map(function (e) {
        return Object.assign({}, e, {
          siteName: (R.sitesById[e.siteId] || {}).name || '',
          departmentName: (R.departmentsById[e.departmentId] || {}).name || '',
          positionName: (R.positionsById[e.positionId] || {}).name || '',
          active: C.isActiveOn(e, C.todayISO()),
          counts: cnt[e.id] || C.emptyCounts()
        });
      });
      return pg;
    };

    M.employeeGet = function (user, p) {
      var R = refs();
      var e = R.employeesById[num(p.id)];
      if (!e || !inScope(user, e)) fail('Работник не найден', 404);
      var asOf = asOfOf(p);
      var rows = C.buildRows({ employees: [Object.assign({}, e, { dismissedAt: null, hireDate: null })], courses: T.courses,
        positionRequirements: T.positionRequirements, individualRequirements: T.individualRequirements,
        trainings: T.trainings }, asOf, settings().expiringDays);
      var hist = T.trainings.filter(function (t) { return t.employeeId === e.id; })
        .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id; })
        .map(function (t) {
          var c = R.coursesById[t.courseId] || {};
          return Object.assign({}, t, { courseName: c.name, courseCode: c.code, validUntilCalc: C.validUntilOf(t, c) });
        });
      return {
        employee: Object.assign({}, e, {
          siteName: (R.sitesById[e.siteId] || {}).name || '',
          departmentName: (R.departmentsById[e.departmentId] || {}).name || '',
          positionName: (R.positionsById[e.positionId] || {}).name || '',
          active: C.isActiveOn(e, C.todayISO())
        }),
        canEdit: role(user).edit && canEditSite(user, e.siteId),
        requirements: sortRows(enrich(rows), 'course'),
        trainings: hist,
        individual: T.individualRequirements.filter(function (r) { return r.employeeId === e.id; }).map(function (r) { return r.courseId; })
      };
    };

    M.employeeSave = async function (user, p) {
      requireEdit(user);
      var data = cleanEmployee(p);
      if (!canEditSite(user, data.siteId)) fail('Площадка вне вашей зоны ответственности', 403);
      var dup = T.employees.find(function (e) { return e.tabNo === data.tabNo && e.id !== num(p.id); });
      if (dup) fail('Табельный номер ' + data.tabNo + ' уже занят: ' + dup.fullName);
      if (p.id) {
        var e = refs().employeesById[num(p.id)];
        if (!e) fail('Работник не найден', 404);
        requireEditEmployee(user, e);
        var changes = describeChanges(e, data, {
          fullName: 'ФИО', tabNo: 'таб. №', positionId: 'должность', departmentId: 'подразделение', siteId: 'площадка', hireDate: 'дата приёма', dismissedAt: 'дата увольнения'
        });
        await repo.update('employees', e.id, data);
        await audit(user, 'update', 'employee', e.id, 'Изменён работник ' + data.fullName + (changes ? ': ' + changes : ''));
        return { id: e.id };
      }
      var created = await repo.insert('employees', data);
      await audit(user, 'create', 'employee', created.id, 'Добавлен работник ' + data.fullName + ' (таб. № ' + data.tabNo + ')');
      return { id: created.id };
    };
    function describeChanges(oldO, newO, labels) {
      var R = refs();
      var names = { positionId: R.positionsById, departmentId: R.departmentsById, siteId: R.sitesById };
      return Object.keys(labels).filter(function (k) { return (oldO[k] || null) !== (newO[k] || null); }).map(function (k) {
        var f = function (v) { return names[k] ? ((names[k][v] || {}).name || '') : (v || 'пусто'); };
        return labels[k] + ' «' + f(oldO[k]) + '» → «' + f(newO[k]) + '»';
      }).join('; ');
    }

    M.individualRequirementSet = async function (user, p) {
      var e = refs().employeesById[num(p.employeeId)];
      if (!e) fail('Работник не найден', 404);
      requireEditEmployee(user, e);
      var c = refs().coursesById[num(p.courseId)];
      if (!c) fail('Курс не найден', 404);
      var ex = T.individualRequirements.find(function (r) { return r.employeeId === e.id && r.courseId === c.id; });
      if (p.on && !ex) {
        await repo.insert('individualRequirements', { employeeId: e.id, courseId: c.id });
        await audit(user, 'create', 'requirement', e.id, 'Индивидуальное требование «' + c.name + '» для ' + e.fullName);
      } else if (!p.on && ex) {
        await repo.remove('individualRequirements', ex.id);
        await audit(user, 'delete', 'requirement', e.id, 'Снято индивидуальное требование «' + c.name + '» для ' + e.fullName);
      }
      return { ok: true };
    };

    // ----- обучение -----
    M.trainingsAdd = async function (user, p) {
      requireEdit(user);
      var base = cleanTraining(p);
      var ids = (p.employees || []).map(function (x) { return num(x.id); }).filter(Boolean);
      if (!ids.length) fail('Выберите хотя бы одного работника');
      var certs = {}; (p.employees || []).forEach(function (x) { certs[num(x.id)] = str(x.certificateNo); });
      var R = refs();
      var course = R.coursesById[base.courseId];
      var skipped = 0, created = 0;
      for (var i = 0; i < ids.length; i++) {
        var e = R.employeesById[ids[i]];
        if (!e) fail('Работник не найден', 404);
        requireEditEmployee(user, e);
        var dup = T.trainings.find(function (t) { return t.employeeId === e.id && t.courseId === base.courseId && t.date === base.date; });
        if (dup) { skipped++; continue; }
        await repo.insert('trainings', Object.assign({}, base, {
          employeeId: e.id, certificateNo: certs[e.id] || base.certificateNo,
          createdBy: user.login, createdAt: hooks.now ? hooks.now() : new Date().toISOString()
        }));
        created++;
      }
      if (created) {
        await audit(user, 'create', 'training', null, 'Внесено обучение «' + course.name + '» от ' + C.fmtDate(base.date) +
          (base.protocolNo ? ', протокол № ' + base.protocolNo : '') + ': ' + created + ' чел.');
      }
      return { created: created, skipped: skipped };
    };

    M.trainingUpdate = async function (user, p) {
      var t = T.trainings.find(function (x) { return x.id === num(p.id); });
      if (!t) fail('Запись не найдена', 404);
      var e = refs().employeesById[t.employeeId];
      requireEditEmployee(user, e);
      var data = cleanTraining(Object.assign({}, t, p));
      await repo.update('trainings', t.id, data);
      await audit(user, 'update', 'training', t.id, 'Изменена запись обучения «' + refs().coursesById[data.courseId].name + '» для ' + e.fullName);
      return { ok: true };
    };

    M.trainingDelete = async function (user, p) {
      var t = T.trainings.find(function (x) { return x.id === num(p.id); });
      if (!t) fail('Запись не найдена', 404);
      var e = refs().employeesById[t.employeeId];
      requireEditEmployee(user, e);
      await repo.remove('trainings', t.id);
      await audit(user, 'delete', 'training', t.id, 'Удалена запись обучения «' + (refs().coursesById[t.courseId] || {}).name + '» от ' + C.fmtDate(t.date) + ' для ' + e.fullName);
      return { ok: true };
    };

    // ----- курсы и требования -----
    M.coursesList = function (user) {
      var used = {}, req = {};
      T.trainings.forEach(function (t) { used[t.courseId] = (used[t.courseId] || 0) + 1; });
      T.positionRequirements.forEach(function (r) { req[r.courseId] = (req[r.courseId] || 0) + 1; });
      return T.courses.map(function (c) { return Object.assign({}, c, { trainingsCount: used[c.id] || 0, positionsCount: req[c.id] || 0 }); })
        .sort(function (a, b) { return a.category.localeCompare(b.category, 'ru') || a.name.localeCompare(b.name, 'ru'); });
    };

    M.courseSave = async function (user, p) {
      requireCatalog(user);
      var c = cleanCourse(p);
      if (c.code && T.courses.some(function (x) { return x.code === c.code && x.id !== num(p.id); })) fail('Код курса ' + c.code + ' уже используется');
      if (p.id) {
        var old = refs().coursesById[num(p.id)];
        if (!old) fail('Курс не найден', 404);
        var ch = describeChanges(old, c, { name: 'название', periodMonths: 'периодичность, мес', category: 'категория', basis: 'основание' });
        await repo.update('courses', old.id, c);
        await audit(user, 'update', 'course', old.id, 'Изменён курс «' + c.name + '»' + (ch ? ': ' + ch : ''));
        return { id: old.id };
      }
      var cr = await repo.insert('courses', c);
      await audit(user, 'create', 'course', cr.id, 'Добавлен курс «' + c.name + '»');
      return { id: cr.id };
    };

    M.courseDelete = async function (user, p) {
      requireCatalog(user);
      var c = refs().coursesById[num(p.id)];
      if (!c) fail('Курс не найден', 404);
      if (T.trainings.some(function (t) { return t.courseId === c.id; })) {
        fail('По курсу есть записи обучения. Удалить нельзя: снимите отметку «Действует», чтобы курс перестал учитываться.');
      }
      var pr = T.positionRequirements.filter(function (r) { return r.courseId === c.id; });
      for (var i = 0; i < pr.length; i++) await repo.remove('positionRequirements', pr[i].id);
      var ir = T.individualRequirements.filter(function (r) { return r.courseId === c.id; });
      for (var j = 0; j < ir.length; j++) await repo.remove('individualRequirements', ir[j].id);
      await repo.remove('courses', c.id);
      await audit(user, 'delete', 'course', c.id, 'Удалён курс «' + c.name + '»');
      return { ok: true };
    };

    M.requirementsGet = function (user) {
      var cnt = {};
      T.employees.forEach(function (e) { if (C.isActiveOn(e, C.todayISO())) cnt[e.positionId] = (cnt[e.positionId] || 0) + 1; });
      return {
        positions: T.positions.slice().sort(byName).map(function (p) { return Object.assign({}, p, { employees: cnt[p.id] || 0 }); }),
        courses: M.coursesList(user).filter(function (c) { return c.active !== false; }),
        pairs: T.positionRequirements.map(function (r) { return [r.positionId, r.courseId]; })
      };
    };

    M.requirementSet = async function (user, p) {
      requireCatalog(user);
      var pos = refs().positionsById[num(p.positionId)], c = refs().coursesById[num(p.courseId)];
      if (!pos || !c) fail('Должность или курс не найдены', 404);
      var ex = T.positionRequirements.find(function (r) { return r.positionId === pos.id && r.courseId === c.id; });
      if (p.on && !ex) {
        await repo.insert('positionRequirements', { positionId: pos.id, courseId: c.id });
        await audit(user, 'create', 'requirement', pos.id, 'Для должности «' + pos.name + '» добавлено обязательное обучение «' + c.name + '»');
      } else if (!p.on && ex) {
        await repo.remove('positionRequirements', ex.id);
        await audit(user, 'delete', 'requirement', pos.id, 'Для должности «' + pos.name + '» снято требование «' + c.name + '»');
      }
      return { ok: true };
    };

    // ----- оргструктура -----
    var REF_TABLE = { site: 'sites', department: 'departments', position: 'positions' };
    var REF_LABEL = { site: 'площадка', department: 'подразделение', position: 'должность' };
    M.refSave = async function (user, p) {
      requireEdit(user);
      var table = REF_TABLE[p.kind];
      if (!table) fail('Неизвестный справочник');
      if (p.kind === 'site') requireAdmin(user);
      if (p.kind === 'position') requireCatalog(user);
      var o = { name: str(p.name) };
      if (!o.name) fail('Укажите название');
      if (p.kind === 'department') {
        o.siteId = num(p.siteId);
        if (!refs().sitesById[o.siteId]) fail('Выберите площадку');
        if (!canEditSite(user, o.siteId)) fail('Площадка вне вашей зоны ответственности', 403);
      }
      var dup = T[table].find(function (x) { return norm(x.name) === norm(o.name) && x.id !== num(p.id) && (p.kind !== 'department' || x.siteId === o.siteId); });
      if (dup) fail('Такая запись уже есть');
      if (p.id) {
        await repo.update(table, num(p.id), o);
        await audit(user, 'update', p.kind, num(p.id), 'Изменено: ' + REF_LABEL[p.kind] + ' «' + o.name + '»');
        return { id: num(p.id) };
      }
      var cr = await repo.insert(table, o);
      await audit(user, 'create', p.kind, cr.id, 'Добавлено: ' + REF_LABEL[p.kind] + ' «' + o.name + '»');
      return { id: cr.id };
    };
    M.refDelete = async function (user, p) {
      requireEdit(user);
      var table = REF_TABLE[p.kind];
      if (!table) fail('Неизвестный справочник');
      var id = num(p.id);
      var key = { site: 'siteId', department: 'departmentId', position: 'positionId' }[p.kind];
      if (T.employees.some(function (e) { return e[key] === id; })) fail('Есть работники с этой привязкой. Сначала переведите их.');
      if (p.kind === 'site' && T.departments.some(function (d) { return d.siteId === id; })) fail('На площадке есть подразделения');
      var item = T[table].find(function (x) { return x.id === id; });
      if (!item) fail('Запись не найдена', 404);
      if (p.kind === 'site') requireAdmin(user);
      if (p.kind === 'position') requireCatalog(user);
      if (p.kind === 'department' && !canEditSite(user, item.siteId)) fail('Площадка вне вашей зоны ответственности', 403);
      if (p.kind === 'position') {
        var pr = T.positionRequirements.filter(function (r) { return r.positionId === id; });
        for (var i = 0; i < pr.length; i++) await repo.remove('positionRequirements', pr[i].id);
      }
      await repo.remove(table, id);
      await audit(user, 'delete', p.kind, id, 'Удалено: ' + REF_LABEL[p.kind] + ' «' + item.name + '»');
      return { ok: true };
    };

    // ----- импорт из Excel (строки уже разобраны на клиенте) -----
    M.importEmployees = async function (user, p) {
      requireEdit(user);
      var rows = p.rows || [];
      var res = { created: 0, updated: 0, unchanged: 0, errors: [], createdRefs: [] };
      async function ref(kind, name, siteId) {
        var table = REF_TABLE[kind];
        var f = T[table].find(function (x) { return norm(x.name) === norm(name) && (kind !== 'department' || x.siteId === siteId); });
        if (f) return f.id;
        if (kind === 'site' && !role(user).admin) throw new ServiceError('Площадки «' + name + '» нет в справочнике (создать может только администратор)');
        var o = { name: str(name) }; if (kind === 'department') o.siteId = siteId;
        var cr = await repo.insert(table, o);
        res.createdRefs.push(REF_LABEL[kind] + ' «' + o.name + '»');
        return cr.id;
      }
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i], line = r._line || (i + 2);
        try {
          if (!str(r.tabNo) || !str(r.fullName)) throw new ServiceError('нет табельного номера или ФИО');
          if (!str(r.site) || !str(r.department) || !str(r.position)) throw new ServiceError('не заполнены площадка, подразделение или должность');
          var siteId = await ref('site', r.site);
          if (!canEditSite(user, siteId)) throw new ServiceError('площадка вне вашей зоны ответственности');
          var data = {
            tabNo: str(r.tabNo), fullName: str(r.fullName), siteId: siteId,
            departmentId: await ref('department', r.department, siteId),
            positionId: await ref('position', r.position),
            hireDate: C.normalizeDate(r.hireDate), dismissedAt: C.normalizeDate(r.dismissedAt)
          };
          if (str(r.hireDate) && !data.hireDate) throw new ServiceError('не распознана дата приёма «' + r.hireDate + '»');
          var ex = T.employees.find(function (e) { return e.tabNo === data.tabNo; });
          if (ex) {
            if (!canEditSite(user, ex.siteId)) throw new ServiceError('работник числится на площадке вне вашей зоны ответственности');
            var same = ['fullName', 'siteId', 'departmentId', 'positionId', 'hireDate', 'dismissedAt'].every(function (k) { return (ex[k] || null) === (data[k] || null); });
            if (same) { res.unchanged++; continue; }
            await repo.update('employees', ex.id, data); res.updated++;
          } else {
            await repo.insert('employees', Object.assign({ note: '' }, data)); res.created++;
          }
        } catch (err) {
          res.errors.push({ line: line, message: err.message });
        }
      }
      await audit(user, 'import', 'employee', null, 'Импорт работников: добавлено ' + res.created + ', обновлено ' + res.updated + ', ошибок ' + res.errors.length);
      return res;
    };

    M.importTrainings = async function (user, p) {
      requireEdit(user);
      var rows = p.rows || [];
      var res = { created: 0, duplicates: 0, errors: [] };
      var byTab = {}; T.employees.forEach(function (e) { byTab[e.tabNo] = e; });
      function findCourse(v) {
        var s = norm(v);
        return T.courses.find(function (c) { return norm(c.code) === s && s; }) || T.courses.find(function (c) { return norm(c.name) === s; });
      }
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i], line = r._line || (i + 2);
        try {
          var e = byTab[str(r.tabNo)];
          if (!e) throw new ServiceError('работник с таб. № «' + str(r.tabNo) + '» не найден');
          if (!canEditSite(user, e.siteId)) throw new ServiceError('работник на площадке вне вашей зоны ответственности');
          var c = findCourse(r.course);
          if (!c) throw new ServiceError('курс «' + str(r.course) + '» не найден (укажите код или точное название)');
          var date = C.normalizeDate(r.date);
          if (!date) throw new ServiceError('не распознана дата обучения «' + str(r.date) + '»');
          var vu = C.normalizeDate(r.validUntil);
          if (str(r.validUntil) && !vu) throw new ServiceError('не распознана дата «Действует до»');
          if (T.trainings.some(function (t) { return t.employeeId === e.id && t.courseId === c.id && t.date === date; })) { res.duplicates++; continue; }
          await repo.insert('trainings', {
            employeeId: e.id, courseId: c.id, date: date, validUntil: vu,
            protocolNo: str(r.protocolNo), certificateNo: str(r.certificateNo), provider: str(r.provider), note: '',
            createdBy: user.login, createdAt: hooks.now ? hooks.now() : new Date().toISOString()
          });
          res.created++;
        } catch (err) {
          res.errors.push({ line: line, message: err.message });
        }
      }
      await audit(user, 'import', 'training', null, 'Импорт записей обучения: добавлено ' + res.created + ', дублей ' + res.duplicates + ', ошибок ' + res.errors.length);
      return res;
    };

    // ----- журнал, пользователи, настройки -----
    M.auditList = function (user, p) {
      p = p || {};
      if (user.role === 'manager') fail('Журнал изменений недоступен для этой роли', 403);
      var q = norm(p.q);
      var list = T.audit.filter(function (a) { return !q || norm(a.summary + ' ' + a.userName).indexOf(q) >= 0; })
        .slice().sort(function (a, b) { return b.id - a.id; });
      return page(list, p);
    };

    M.usersList = function (user) {
      requireAdmin(user);
      return T.users.map(function (u) {
        return { id: u.id, login: u.login, fullName: u.fullName, role: u.role, siteIds: u.siteIds || [], departmentIds: u.departmentIds || [], active: u.active !== false };
      }).sort(function (a, b) { return a.login.localeCompare(b.login); });
    };

    M.userSave = async function (user, p) {
      requireAdmin(user);
      var u = {
        login: str(p.login).toLowerCase(), fullName: str(p.fullName), role: ROLES[p.role] ? p.role : 'viewer',
        siteIds: (p.siteIds || []).map(Number).filter(Boolean), departmentIds: (p.departmentIds || []).map(Number).filter(Boolean),
        active: p.active !== false
      };
      if (!/^[a-z0-9._-]{3,40}$/.test(u.login)) fail('Логин: 3–40 символов, латиница, цифры, точка, дефис');
      if (!u.fullName) fail('Укажите ФИО пользователя');
      if (T.users.some(function (x) { return x.login === u.login && x.id !== num(p.id); })) fail('Логин занят');
      if (p.password) {
        if (String(p.password).length < 8) fail('Пароль не короче 8 символов');
        if (hooks.hashPassword) u.passwordHash = await hooks.hashPassword(String(p.password));
      }
      if (p.id) {
        if (num(p.id) === user.id && (u.role !== 'admin' || !u.active)) fail('Нельзя снять права администратора с самого себя');
        await repo.update('users', num(p.id), u);
        await audit(user, 'update', 'user', num(p.id), 'Изменён пользователь ' + u.login + ' (' + ROLES[u.role].label + ')');
        return { id: num(p.id) };
      }
      if (!p.password && hooks.hashPassword) fail('Задайте пароль для нового пользователя');
      var cr = await repo.insert('users', u);
      await audit(user, 'create', 'user', cr.id, 'Добавлен пользователь ' + u.login + ' (' + ROLES[u.role].label + ')');
      return { id: cr.id };
    };

    M.settingsSave = async function (user, p) {
      requireAdmin(user);
      var s = { orgName: str(p.orgName) || 'Предприятие', expiringDays: Math.min(365, Math.max(1, num(p.expiringDays) || 30)) };
      await repo.setSettings(s);
      await audit(user, 'update', 'settings', null, 'Настройки: «Истекает» за ' + s.expiringDays + ' дн., организация «' + s.orgName + '»');
      return s;
    };

    // Вся история обучения в зоне доступа (для выгрузки)
    M.trainingsAll = function (user) {
      var R = refs();
      return T.trainings.filter(function (t) { var e = R.employeesById[t.employeeId]; return e && inScope(user, e); })
        .map(function (t) {
          var e = R.employeesById[t.employeeId], c = R.coursesById[t.courseId] || {};
          return Object.assign({}, t, { tabNo: e.tabNo, fullName: e.fullName, departmentName: (R.departmentsById[e.departmentId] || {}).name || '',
            courseName: c.name, courseCode: c.code, validUntilCalc: C.validUntilOf(t, c) });
        })
        .sort(function (a, b) { return a.fullName.localeCompare(b.fullName, 'ru') || (a.date < b.date ? 1 : -1); });
    };

    // Полная выгрузка для резервной копии (только администратор)
    M.backupExport = function (user) {
      requireAdmin(user);
      var o = {};
      ['sites', 'departments', 'positions', 'employees', 'courses', 'positionRequirements', 'individualRequirements', 'trainings'].forEach(function (k) { o[k] = T[k]; });
      o.settings = repo.settings; o.exportedAt = new Date().toISOString(); o.format = 'training-control/1';
      return o;
    };

    async function call(user, method, params) {
      if (!Object.prototype.hasOwnProperty.call(M, method)) fail('Неизвестный метод: ' + method, 404);
      return await M[method](user, params || {});
    }

    return { call: call, methods: M, ROLES: ROLES, ServiceError: ServiceError };
  }

  return { createService: createService, ROLES: ROLES, ServiceError: ServiceError };
});
