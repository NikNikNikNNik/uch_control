/*
 * Контроль обучения персонала: расчётное ядро.
 * Один и тот же файл работает в браузере (демо) и на сервере (Node.js).
 * Только чистые функции: на вход справочники и записи, на выход статусы и агрегаты.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TCCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STATUS = {
    CURRENT: 'CURRENT',          // действует
    EXPIRING: 'EXPIRING',        // срок истекает (в пределах порога)
    EXPIRED: 'EXPIRED',          // просрочено
    NOT_COMPLETED: 'NOT_COMPLETED' // требуется, но не пройдено ни разу
  };
  var STATUS_ORDER = ['EXPIRED', 'NOT_COMPLETED', 'EXPIRING', 'CURRENT'];
  var STATUS_LABEL = {
    CURRENT: 'Действует',
    EXPIRING: 'Истекает',
    EXPIRED: 'Просрочено',
    NOT_COMPLETED: 'Не пройдено'
  };

  // ---------- даты (ISO yyyy-mm-dd, без часовых поясов) ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toISO(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function parseISO(s) {
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  }
  function isValidISO(s) {
    var d = parseISO(s);
    return !!d && toISO(d) === String(s).slice(0, 10);
  }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  // Прибавить месяцы. 31.01 + 1 мес = 28/29.02 (последний день месяца).
  function addMonths(iso, n) {
    var d = parseISO(iso);
    if (!d) return null;
    var y = d.getUTCFullYear(), m = d.getUTCMonth() + n, day = d.getUTCDate();
    var target = new Date(Date.UTC(y, m, 1));
    var last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(day, last));
    return toISO(target);
  }
  function addDays(iso, n) {
    var d = parseISO(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return toISO(d);
  }
  function diffDays(a, b) { // b - a в днях
    return Math.round((parseISO(b) - parseISO(a)) / 86400000);
  }
  function monthKey(iso) { return String(iso).slice(0, 7); }
  var MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  var MONTHS_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  function monthLabel(key, full) {
    var y = key.slice(0, 4), m = +key.slice(5, 7) - 1;
    return (full ? MONTHS_FULL[m] : MONTHS[m]) + ' ' + y;
  }
  function fmtDate(iso) {
    if (!iso) return '';
    return iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4);
  }
  // 'дд.мм.гггг', 'гггг-мм-дд', Date, число Excel -> ISO или null
  function normalizeDate(v) {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date && !isNaN(v)) {
      return v.getUTCFullYear() + '-' + pad(v.getUTCMonth() + 1) + '-' + pad(v.getUTCDate());
    }
    if (typeof v === 'number' && isFinite(v)) { // серийный номер Excel
      var d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
      return toISO(d);
    }
    var s = String(v).trim();
    var m = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/.exec(s);
    if (m) s = m[3] + '-' + pad(+m[2]) + '-' + pad(+m[1]);
    return isValidISO(s) ? s.slice(0, 10) : null;
  }

  // ---------- срок действия ----------
  // Если в записи указан срок вручную, он главнее периодичности курса.
  // periodMonths пусто или 0: обучение бессрочное (однократное).
  function validUntilOf(training, course) {
    if (training.validUntil) return training.validUntil;
    if (course && course.periodMonths) return addMonths(training.date, course.periodMonths);
    return null;
  }

  function statusOf(validUntil, hasTraining, asOf, expiringDays) {
    if (!hasTraining) return STATUS.NOT_COMPLETED;
    if (!validUntil) return STATUS.CURRENT;
    if (validUntil < asOf) return STATUS.EXPIRED;
    if (diffDays(asOf, validUntil) <= expiringDays) return STATUS.EXPIRING;
    return STATUS.CURRENT;
  }

  /*
   * Главная функция: строки «работник × обязательный курс» со статусом на дату asOf.
   * data: { employees, courses, positionRequirements:[{positionId,courseId}],
   *         individualRequirements:[{employeeId,courseId}], trainings }
   * Учитываются только работающие на дату asOf (принят ≤ asOf, не уволен до asOf)
   * и только записи обучения с датой ≤ asOf.
   */
  function buildRows(data, asOf, expiringDays) {
    var courseById = indexBy(data.courses, 'id');
    var reqByPos = {};
    data.positionRequirements.forEach(function (r) {
      (reqByPos[r.positionId] = reqByPos[r.positionId] || []).push(r.courseId);
    });
    var reqByEmp = {};
    data.individualRequirements.forEach(function (r) {
      (reqByEmp[r.employeeId] = reqByEmp[r.employeeId] || []).push(r.courseId);
    });
    // последняя запись обучения на дату asOf
    var last = {};
    data.trainings.forEach(function (t) {
      if (t.date > asOf) return;
      var k = t.employeeId + ':' + t.courseId;
      var p = last[k];
      if (!p || t.date > p.date || (t.date === p.date && t.id > p.id)) last[k] = t;
    });
    var rows = [];
    data.employees.forEach(function (e) {
      if (!isActiveOn(e, asOf)) return;
      var ids = {};
      (reqByPos[e.positionId] || []).forEach(function (c) { ids[c] = 'position'; });
      (reqByEmp[e.id] || []).forEach(function (c) { if (!ids[c]) ids[c] = 'individual'; });
      Object.keys(ids).forEach(function (cid) {
        var course = courseById[cid];
        if (!course || course.active === false) return;
        var t = last[e.id + ':' + course.id];
        var vu = t ? validUntilOf(t, course) : null;
        var st = statusOf(vu, !!t, asOf, expiringDays);
        rows.push({
          employeeId: e.id,
          courseId: course.id,
          source: ids[cid],
          lastDate: t ? t.date : null,
          lastTrainingId: t ? t.id : null,
          protocolNo: t ? (t.protocolNo || '') : '',
          validUntil: vu,
          status: st,
          daysLeft: vu ? diffDays(asOf, vu) : null,
          // дата, к которой нужно пройти: для просрочки и непройденного «сейчас»
          dueDate: (st === STATUS.EXPIRED || st === STATUS.NOT_COMPLETED) ? asOf : vu
        });
      });
    });
    return rows;
  }

  function isActiveOn(e, asOf) {
    if (e.hireDate && e.hireDate > asOf) return false;
    if (e.dismissedAt && e.dismissedAt <= asOf) return false;
    return true;
  }

  function indexBy(arr, key) {
    var o = {};
    for (var i = 0; i < arr.length; i++) o[arr[i][key]] = arr[i];
    return o;
  }

  function emptyCounts() { return { CURRENT: 0, EXPIRING: 0, EXPIRED: 0, NOT_COMPLETED: 0, total: 0 }; }
  function addCount(c, st) { c[st]++; c.total++; }
  // «В норме» = действует + истекает (ещё не нарушение)
  function okShare(c) { return c.total ? (c.CURRENT + c.EXPIRING) / c.total : null; }

  /*
   * Агрегаты для дашборда.
   * groupBy: 'site' | 'department': разрез таблицы подразделений.
   */
  function dashboard(rows, employeesById, coursesById, refs, asOf, opts) {
    opts = opts || {};
    var months = opts.months || 12;
    var totals = emptyCounts();
    var empCritical = {}, empWith = {};
    var bySite = {}, byDept = {}, byCourse = {};
    var startKey = monthKey(asOf);
    var monthKeys = [];
    for (var i = 0; i < months; i++) monthKeys.push(monthKey(addMonths(startKey + '-01', i)));
    var need = {}; monthKeys.forEach(function (k) { need[k] = 0; });
    var needNow = 0;

    rows.forEach(function (r) {
      var e = employeesById[r.employeeId];
      addCount(totals, r.status);
      empWith[r.employeeId] = true;
      var critical = r.status === 'EXPIRED' || r.status === 'NOT_COMPLETED';
      if (critical) empCritical[r.employeeId] = true;

      var s = bySite[e.siteId] = bySite[e.siteId] || { id: e.siteId, counts: emptyCounts(), emps: {}, crit: {} };
      addCount(s.counts, r.status); s.emps[e.id] = 1; if (critical) s.crit[e.id] = 1;
      var d = byDept[e.departmentId] = byDept[e.departmentId] || { id: e.departmentId, siteId: e.siteId, counts: emptyCounts(), emps: {}, crit: {} };
      addCount(d.counts, r.status); d.emps[e.id] = 1; if (critical) d.crit[e.id] = 1;
      var c = byCourse[r.courseId] = byCourse[r.courseId] || { id: r.courseId, counts: emptyCounts() };
      addCount(c.counts, r.status);

      if (critical) needNow++;
      else if (r.validUntil) {
        var k = monthKey(r.validUntil);
        if (need[k] !== undefined) need[k]++;
      }
    });

    function finish(g, nameOf) {
      return Object.keys(g).map(function (k) {
        var x = g[k];
        return {
          id: x.id, siteId: x.siteId, name: nameOf(x),
          counts: x.counts, okShare: okShare(x.counts),
          employees: x.emps ? Object.keys(x.emps).length : undefined,
          criticalEmployees: x.crit ? Object.keys(x.crit).length : undefined
        };
      });
    }
    var siteName = function (x) { return (refs.sitesById[x.id] || {}).name || ''; };
    var deptName = function (x) { return (refs.departmentsById[x.id] || {}).name || ''; };
    var courseName = function (x) { return (coursesById[x.id] || {}).name || ''; };

    var depts = finish(byDept, deptName).sort(function (a, b) {
      return (a.okShare - b.okShare) || (b.counts.total - a.counts.total);
    });
    var courses = finish(byCourse, courseName).filter(function (c) {
      return c.counts.EXPIRED + c.counts.NOT_COMPLETED + c.counts.EXPIRING > 0;
    }).sort(function (a, b) {
      return (b.counts.EXPIRED + b.counts.NOT_COMPLETED) - (a.counts.EXPIRED + a.counts.NOT_COMPLETED) || b.counts.EXPIRING - a.counts.EXPIRING;
    });

    var empTotal = Object.keys(empWith).length;
    var critCount = Object.keys(empCritical).length;
    return {
      asOf: asOf,
      totals: totals,
      okShare: okShare(totals),
      employeesWithRequirements: empTotal,
      employeesCritical: critCount,
      employeesCriticalShare: empTotal ? critCount / empTotal : null,
      need: { now: needNow, months: monthKeys.map(function (k) { return { key: k, label: monthLabel(k), count: need[k] }; }) },
      sites: finish(bySite, siteName).sort(function (a, b) { return a.okShare - b.okShare; }),
      departments: depts,
      courses: courses
    };
  }

  /* План: месяц × курс. 'now': просроченные и непройденные (нужно сейчас). */
  function plan(rows, asOf, months) {
    var keys = ['now'];
    for (var i = 0; i < months; i++) keys.push(monthKey(addMonths(monthKey(asOf) + '-01', i)));
    var horizonEnd = addMonths(monthKey(asOf) + '-01', months); // первый день за горизонтом
    var cells = {}; // courseId -> key -> count
    var colTotals = {}; keys.forEach(function (k) { colTotals[k] = 0; });
    rows.forEach(function (r) {
      var k = planKeyOf(r, horizonEnd);
      if (!k) return;
      var c = cells[r.courseId] = cells[r.courseId] || {};
      c[k] = (c[k] || 0) + 1;
      colTotals[k]++;
    });
    return { keys: keys, cells: cells, colTotals: colTotals };
  }
  function planKeyOf(r, horizonEnd) {
    if (r.status === 'EXPIRED' || r.status === 'NOT_COMPLETED') return 'now';
    if (!r.validUntil) return null;
    if (horizonEnd && r.validUntil >= horizonEnd) return null;
    return monthKey(r.validUntil);
  }

  return {
    STATUS: STATUS, STATUS_ORDER: STATUS_ORDER, STATUS_LABEL: STATUS_LABEL,
    toISO: toISO, parseISO: parseISO, isValidISO: isValidISO, todayISO: todayISO,
    addMonths: addMonths, addDays: addDays, diffDays: diffDays, monthKey: monthKey,
    monthLabel: monthLabel, fmtDate: fmtDate, normalizeDate: normalizeDate,
    validUntilOf: validUntilOf, statusOf: statusOf, buildRows: buildRows, isActiveOn: isActiveOn,
    dashboard: dashboard, plan: plan, planKeyOf: planKeyOf, indexBy: indexBy,
    emptyCounts: emptyCounts, okShare: okShare
  };
});
