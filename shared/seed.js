/*
 * Демонстрационные данные: условное промышленное предприятие с тремя площадками.
 * Все названия и люди вымышлены. Периодичность курсов: ПРИМЕРНАЯ, для демонстрации:
 * перед реальной эксплуатацией её нужно задать по нормативным документам заказчика.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.TCSeed = factory(root.TCCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  function rng(seed) {
    var s = seed >>> 0;
    return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  var COURSES = [
    ['OT-A', 'Охрана труда: общие вопросы (программа А)', 'Охрана труда', 36, 'ПП РФ № 2464', 16],
    ['OT-B', 'Охрана труда: безопасные методы при воздействии вредных факторов (программа Б)', 'Охрана труда', 36, 'ПП РФ № 2464', 16],
    ['OT-V', 'Охрана труда: работы повышенной опасности (программа В)', 'Охрана труда', 36, 'ПП РФ № 2464', 16],
    ['PP', 'Оказание первой помощи пострадавшим', 'Охрана труда', 36, 'ПП РФ № 2464', 8],
    ['SIZ', 'Использование (применение) СИЗ', 'Охрана труда', 36, 'ПП РФ № 2464', 4],
    ['VYS', 'Безопасные методы и приёмы выполнения работ на высоте', 'Охрана труда', 36, 'Правила по ОТ при работе на высоте', 24],
    ['INS-P', 'Повторный инструктаж на рабочем месте', 'Инструктажи', 6, 'ПП РФ № 2464', 1],
    ['INS-V', 'Вводный инструктаж по охране труда', 'Инструктажи', null, 'ПП РФ № 2464', 1],
    ['EB-2', 'Электробезопасность, II группа (неэлектротехнический персонал)', 'Электробезопасность', 12, 'ПТЭЭП', 4],
    ['EB-4', 'Электробезопасность, IV группа до и выше 1000 В', 'Электробезопасность', 12, 'ПТЭЭП', 72],
    ['PB-M', 'Пожарно-технический минимум', 'Пожарная безопасность', 12, 'Приказ МЧС России № 806', 16],
    ['PB-A', 'Промышленная безопасность: общие требования (А.1)', 'Промышленная безопасность', 60, 'ПП РФ № 1365', 40],
    ['PB-B7', 'Промышленная безопасность: сосуды под давлением (Б.8)', 'Промышленная безопасность', 60, 'ПП РФ № 1365', 24],
    ['STR', 'Стропальщик: периодическая проверка знаний', 'Профессиональное обучение', 12, 'ФНП ПС', 8],
    ['GOR', 'Газоопасные работы', 'Промышленная безопасность', 12, 'Правила ГОР', 16],
    ['SVR', 'Аттестация сварщика (НАКС)', 'Профессиональное обучение', 24, 'Правила аттестации сварщиков', 40],
    ['POG', 'Водитель погрузчика: проверка знаний', 'Профессиональное обучение', 12, 'Правила по ОТ', 8]
  ];
  var BASE = ['OT-A', 'PP', 'SIZ', 'INS-V', 'PB-M'];
  var WORKER = BASE.concat(['OT-B', 'INS-P', 'EB-2']);
  var POSITIONS = [
    ['Слесарь-ремонтник', WORKER.concat(['OT-V', 'VYS', 'STR'])],
    ['Электромонтёр по ремонту электрооборудования', WORKER.filter(function (x) { return x !== 'EB-2'; }).concat(['OT-V', 'EB-4', 'VYS'])],
    ['Слесарь КИПиА', WORKER.concat(['OT-V', 'VYS'])],
    ['Оператор технологических установок', WORKER.concat(['OT-V', 'GOR', 'PB-B7'])],
    ['Машинист компрессорных установок', WORKER.concat(['PB-B7', 'GOR'])],
    ['Электрогазосварщик', WORKER.concat(['OT-V', 'SVR', 'VYS'])],
    ['Водитель погрузчика', WORKER.concat(['POG', 'STR'])],
    ['Кладовщик', BASE.concat(['INS-P', 'EB-2'])],
    ['Лаборант химического анализа', WORKER.concat(['GOR'])],
    ['Мастер участка', BASE.concat(['OT-B', 'OT-V', 'PB-A', 'EB-2', 'INS-P'])],
    ['Начальник цеха', BASE.concat(['OT-B', 'OT-V', 'PB-A', 'EB-2'])],
    ['Инженер-механик', BASE.concat(['OT-B', 'PB-A', 'PB-B7', 'EB-2'])],
    ['Инженер-энергетик', BASE.concat(['OT-B', 'PB-A', 'EB-4'])],
    ['Специалист по охране труда', BASE.concat(['OT-B', 'OT-V', 'PB-A', 'EB-2'])],
    ['Бухгалтер', BASE],
    ['Специалист по кадрам', BASE]
  ];
  var SITES = [
    ['Площадка «Северная»', [['Цех № 1 (переработка)', [3, 4, 9, 0, 10, 11, 2]], ['Цех № 2 (компрессорный)', [4, 3, 0, 9, 10]], ['Ремонтно-механический цех', [0, 5, 6, 9, 11]], ['Энергоцех', [1, 1, 9, 12]], ['Цех КИПиА', [2, 2, 9]], ['Склад и логистика', [7, 6, 9]]]],
    ['Площадка «Южная»', [['Цех № 3 (подготовка сырья)', [3, 0, 9, 10, 11]], ['Ремонтный участок', [0, 5, 1, 9]], ['Лаборатория', [8, 8, 9]], ['Энергоучасток', [1, 9, 12]]]],
    ['Управление', [['Служба охраны труда и ПБ', [13, 13]], ['Бухгалтерия', [14, 14]], ['Отдел кадров', [15, 15]], ['Технический отдел', [11, 12, 11]]]]
  ];
  var LAST = ['Иванов', 'Петров', 'Сидоров', 'Смирнов', 'Кузнецов', 'Попов', 'Васильев', 'Соколов', 'Михайлов', 'Новиков', 'Фёдоров', 'Морозов', 'Волков', 'Алексеев', 'Лебедев', 'Семёнов', 'Егоров', 'Павлов', 'Козлов', 'Степанов', 'Николаев', 'Орлов', 'Андреев', 'Макаров', 'Никитин', 'Захаров', 'Зайцев', 'Соловьёв', 'Борисов', 'Яковлев', 'Григорьев', 'Романов', 'Воробьёв', 'Сергеев', 'Кузьмин', 'Фролов', 'Александров', 'Дмитриев', 'Королёв', 'Гусев', 'Киселёв', 'Ильин', 'Максимов', 'Поляков', 'Сорокин', 'Виноградов', 'Ковалёв', 'Белов', 'Медведев', 'Антонов', 'Тарасов', 'Жуков', 'Баранов', 'Филиппов', 'Комаров', 'Давыдов', 'Беляев', 'Герасимов', 'Богданов', 'Осипов'];
  var FIRST_M = ['Александр', 'Сергей', 'Дмитрий', 'Андрей', 'Алексей', 'Максим', 'Евгений', 'Иван', 'Михаил', 'Николай', 'Владимир', 'Олег', 'Павел', 'Роман', 'Артём', 'Игорь', 'Денис', 'Виктор', 'Юрий', 'Константин'];
  var FIRST_F = ['Елена', 'Ольга', 'Наталья', 'Татьяна', 'Ирина', 'Светлана', 'Анна', 'Марина', 'Юлия', 'Екатерина'];
  var MID_M = ['Александрович', 'Сергеевич', 'Дмитриевич', 'Андреевич', 'Алексеевич', 'Викторович', 'Иванович', 'Михайлович', 'Николаевич', 'Владимирович', 'Юрьевич', 'Олегович'];
  var MID_F = ['Александровна', 'Сергеевна', 'Дмитриевна', 'Андреевна', 'Викторовна', 'Ивановна', 'Михайловна', 'Николаевна', 'Владимировна'];
  var PROVIDERS = ['Учебный центр предприятия', 'АНО ДПО «Промышленный учебный центр»', 'ЧОУ ДПО «Центр охраны труда»', 'Комиссия предприятия'];

  function generate(opts) {
    opts = opts || {};
    var asOf = opts.asOf || C.todayISO();
    var perSlot = opts.scale || 24; // людей на одну «позицию» в подразделении
    var R = rng(opts.seed || 20261114);
    function pick(a) { return a[Math.floor(R() * a.length)]; }
    var t = { sites: [], departments: [], positions: [], employees: [], courses: [], positionRequirements: [], individualRequirements: [], trainings: [], users: [], audit: [] };
    var id = { sites: 0, departments: 0, positions: 0, employees: 0, courses: 0, positionRequirements: 0, individualRequirements: 0, trainings: 0, users: 0, audit: 0 };
    function add(tb, o) { o.id = ++id[tb]; t[tb].push(o); return o; }

    var courseByCode = {};
    COURSES.forEach(function (c) {
      courseByCode[c[0]] = add('courses', { code: c[0], name: c[1], category: c[2], periodMonths: c[3], basis: c[4], hours: c[5], active: true });
    });
    var posIds = POSITIONS.map(function (p) {
      var pos = add('positions', { name: p[0] });
      p[1].forEach(function (code) { add('positionRequirements', { positionId: pos.id, courseId: courseByCode[code].id }); });
      return pos.id;
    });
    var tab = 10000;
    SITES.forEach(function (s, si) {
      var site = add('sites', { name: s[0] });
      s[1].forEach(function (d) {
        var dep = add('departments', { siteId: site.id, name: d[0] });
        d[1].forEach(function (pi) {
          var n = Math.max(1, Math.round(perSlot * (pi >= 9 ? 0.35 : 1) * (0.6 + R() * 0.8)));
          for (var k = 0; k < n; k++) {
            var female = (pi === 7 || pi >= 13 || pi === 8) ? R() < 0.75 : R() < 0.06;
            var last = pick(LAST);
            if (female) last = last.replace(/ий$/, 'ая').replace(/(ов|ев|ёв|ин)$/, '$1а');
            var fio = last + ' ' + (female ? pick(FIRST_F) : pick(FIRST_M)) + ' ' + (female ? pick(MID_F) : pick(MID_M));
            var years = R() < 0.12 ? R() * 0.7 : 0.7 + R() * 14;
            var hire = C.addDays(asOf, -Math.round(years * 365));
            var e = add('employees', { tabNo: String(tab += 1 + Math.floor(R() * 3)), fullName: fio, siteId: site.id, departmentId: dep.id, positionId: posIds[pi], hireDate: hire, dismissedAt: null, note: '' });
            if (R() < 0.02) e.dismissedAt = C.addDays(asOf, -Math.round(R() * 200));
            if (R() < 0.015) e.hireDate = C.addDays(asOf, Math.round(5 + R() * 25)); // выйдет на работу позже
          }
        });
      });
    });

    // история обучения
    var reqByPos = {};
    t.positionRequirements.forEach(function (r) { (reqByPos[r.positionId] = reqByPos[r.positionId] || []).push(r.courseId); });
    // небольшая доля индивидуальных требований
    t.employees.forEach(function (e) {
      if (R() < 0.03) {
        var extra = courseByCode[pick(['VYS', 'STR', 'GOR', 'POG'])];
        if ((reqByPos[e.positionId] || []).indexOf(extra.id) < 0) add('individualRequirements', { employeeId: e.id, courseId: extra.id });
      }
    });
    var protoNo = 100;
    var groupCache = {}; // courseId|date -> протокол, чтобы у группы был общий протокол
    function protoFor(cid, date) {
      var k = cid + '|' + date.slice(0, 7);
      if (!groupCache[k]) groupCache[k] = { no: (++protoNo) + '/' + date.slice(2, 4), provider: pick(PROVIDERS), day: date.slice(0, 8) + String(5 + Math.floor(R() * 20)).padStart(2, '0') };
      return groupCache[k];
    }
    t.employees.forEach(function (e) {
      var dn = t.departments[e.departmentId - 1].name;
      var deptBad = (dn === 'Ремонтный участок' || dn === 'Цех № 2 (компрессорный)') ? 0.09 : (dn === 'Склад и логистика' ? 0.04 : 0); // «проблемные» подразделения
      var reqs = (reqByPos[e.positionId] || []).concat(t.individualRequirements.filter(function (r) { return r.employeeId === e.id; }).map(function (r) { return r.courseId; }));
      reqs.forEach(function (cid) {
        var c = t.courses[cid - 1];
        var x = R();
        if (x < 0.007 + deptBad / 2) return; // не пройдено
        var period = c.periodMonths;
        var lastDate;
        if (!period) { lastDate = e.hireDate; }
        else {
          var days = period * 30.4;
          var y = R();
          var ageDays;
          if (y < 0.013 + deptBad) ageDays = days + 5 + R() * 120; // просрочено
          else if (y < 0.075 + deptBad) ageDays = days - R() * 28; // истекает
          else ageDays = R() * (days - 30);
          lastDate = C.addDays(asOf, -Math.round(ageDays));
          if (lastDate < e.hireDate) lastDate = e.hireDate;
        }
        if (lastDate > asOf) return;
        var g = protoFor(cid, lastDate);
        var day = g.day <= asOf && g.day >= e.hireDate && period ? g.day : lastDate;
        add('trainings', { employeeId: e.id, courseId: cid, date: day, validUntil: null, protocolNo: c.code.indexOf('INS') === 0 ? '' : g.no,
          certificateNo: c.code === 'EB-4' || c.code === 'SVR' ? 'У-' + Math.floor(1000 + R() * 9000) : '', provider: c.code.indexOf('INS') === 0 ? 'Руководитель подразделения' : g.provider, note: '', createdBy: 'import', createdAt: asOf + 'T08:00:00Z' });
        // предыдущий цикл для части записей (видна история)
        if (period && R() < 0.5) {
          var prev = C.addMonths(day, -period);
          if (prev >= e.hireDate) add('trainings', { employeeId: e.id, courseId: cid, date: prev, validUntil: null, protocolNo: c.code.indexOf('INS') === 0 ? '' : (protoFor(cid, prev).no), certificateNo: '', provider: c.code.indexOf('INS') === 0 ? 'Руководитель подразделения' : protoFor(cid, prev).provider, note: '', createdBy: 'import', createdAt: asOf + 'T08:00:00Z' });
        }
      });
    });
    t.settings = { orgName: 'АО «Демо-Завод»', expiringDays: 30 };
    return t;
  }

  return { generate: generate };
});
