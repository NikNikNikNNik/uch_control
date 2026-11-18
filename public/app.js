/* Контроль обучения персонала: интерфейс (одностраничное приложение без сборки) */
(function () {
  'use strict';
  const C = window.TCCore;
  const API = window.TCApi;
  const STATUS_ICON = { CURRENT: '✓', EXPIRING: '!', EXPIRED: '×', NOT_COMPLETED: '○' };
  const STATUS_COLOR = { CURRENT: 'var(--good)', EXPIRING: 'var(--warning)', EXPIRED: 'var(--critical)', NOT_COMPLETED: 'var(--serious)' };
  const SL = C.STATUS_LABEL;

  // ---------------- состояние ----------------
  const S = {
    boot: null,
    F: { asOf: '', siteId: '', departmentId: '', positionId: '', category: '', courseId: '' },
    status: { statuses: [], q: '', sort: 'due', page: 1, dueKey: '' },
    matrix: { onlyProblems: false, q: '' },
    employees: { q: '', state: 'active', page: 1 },
    audit: { q: '', page: 1 },
    record: null, // предзаполнение формы «Внести обучение»
    selected: new Set(),
    renderToken: 0
  };

  // ---------------- утилиты ----------------
  const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const n = (v) => (v === null || v === undefined ? '' : Number(v).toLocaleString('ru-RU'));
  const pct = (v) => (v === null || v === undefined ? 'нет данных' : (Math.round(v * 1000) / 10).toLocaleString('ru-RU') + '%');
  const d = (iso) => C.fmtDate(iso);
  const opt = (v, label, sel) => `<option value="${esc(v)}"${String(sel) === String(v) ? ' selected' : ''}>${esc(label)}</option>`;
  const stBadge = (st) => `<span class="st ${st}"><i>${STATUS_ICON[st]}</i>${SL[st]}</span>`;
  const plural = (k, one, few, many) => { const a = Math.abs(k) % 100, b = a % 10; return (a > 10 && a < 20) ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; };
  const periodText = (m) => (m ? 'каждые ' + m + ' мес.' : 'однократно');
  const call = (m, p) => API.call(m, p);
  const user = () => S.boot.user;
  const filterParams = () => Object.assign({}, S.F);

  function toast(msg, isErr) {
    let box = $('.toast-box');
    if (!box) { box = document.createElement('div'); box.className = 'toast-box'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast' + (isErr ? ' err' : '');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.remove(), isErr ? 7000 : 3500);
  }
  function showError(e) { toast(e && e.message ? e.message : String(e), true); }

  // подсказки по наведению: data-tip="..."
  const tipEl = document.createElement('div');
  tipEl.className = 'tip hidden';
  document.addEventListener('mouseover', (ev) => {
    const t = ev.target.closest && ev.target.closest('[data-tip]');
    if (!t) { tipEl.classList.add('hidden'); return; }
    if (!tipEl.parentNode) document.body.appendChild(tipEl);
    tipEl.textContent = t.getAttribute('data-tip');
    tipEl.classList.remove('hidden');
  });
  document.addEventListener('mousemove', (ev) => {
    if (tipEl.classList.contains('hidden')) return;
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
    if (y + h > window.innerHeight - 8) y = ev.clientY - h - 14;
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
  });

  // модальное окно: возвращает Promise с результатом onOk или null
  function modal({ title, body, okText = 'Сохранить', cancelText = 'Отмена', wide = false, onOk, onOpen, danger = false, noOk = false }) {
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true">
        <div class="modal-head"><h2>${esc(title)}</h2><button class="btn ghost sm" data-x aria-label="Закрыть">✕</button></div>
        <div class="modal-body">${body}</div>
        <div class="modal-foot"><div class="err-box hidden" style="margin-right:auto;padding:6px 10px"></div>
          <button class="btn" data-x>${esc(cancelText)}</button>${noOk ? '' : `<button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okText)}</button>`}</div></div>`;
      document.body.appendChild(back);
      const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') close(null); };
      document.addEventListener('keydown', onKey);
      $$('[data-x]', back).forEach((b) => b.addEventListener('click', () => close(null)));
      back.addEventListener('mousedown', (e) => { if (e.target === back) close(null); });
      const okBtn = $('[data-ok]', back);
      const err = $('.err-box', back);
      if (okBtn) okBtn.addEventListener('click', async () => {
        okBtn.disabled = true; err.classList.add('hidden');
        try { const r = onOk ? await onOk(back) : true; if (r !== false) close(r === undefined ? true : r); }
        catch (e) { err.textContent = e.message || String(e); err.classList.remove('hidden'); }
        finally { okBtn.disabled = false; }
      });
      if (onOpen) onOpen(back, close);
      const first = $('input,select,textarea', back); if (first) first.focus();
    });
  }
  const confirmBox = (title, text, okText) => modal({ title, body: `<p>${esc(text)}</p>`, okText: okText || 'Удалить', danger: true });
  const formData = (root) => {
    const o = {};
    $$('[name]', root).forEach((i) => { o[i.name] = i.type === 'checkbox' ? i.checked : i.value; });
    return o;
  };

  // ---------------- Excel ----------------
  async function exportXlsx(filename, sheets) {
    if (!window.ExcelJS) throw new Error('Библиотека Excel не загружена');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Контроль обучения';
    for (const sh of sheets) {
      const ws = wb.addWorksheet(sh.name.slice(0, 31));
      if (sh.title) { ws.addRow([sh.title]).font = { bold: true, size: 12 }; ws.addRow([]); }
      const headRow = ws.addRow(sh.columns.map((c) => c.header));
      headRow.font = { bold: true }; headRow.alignment = { vertical: 'middle', wrapText: true };
      headRow.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEA' } }; cell.border = { bottom: { style: 'thin', color: { argb: 'FFBBBBBB' } } }; });
      sh.columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width || 14; });
      sh.rows.forEach((r) => {
        const row = ws.addRow(sh.columns.map((c) => {
          const v = typeof c.value === 'function' ? c.value(r) : r[c.key];
          if (c.type === 'date') { const dt = C.parseISO(v); return dt || null; }
          return v === undefined ? null : v;
        }));
        sh.columns.forEach((c, i) => {
          const cell = row.getCell(i + 1);
          if (c.type === 'date') cell.numFmt = 'dd.mm.yyyy';
          if (c.fill) { const f = c.fill(r); if (f) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f } }; }
        });
      });
      const headIdx = sh.title ? 3 : 1;
      ws.views = [{ state: 'frozen', ySplit: headIdx, xSplit: sh.freezeCols || 0 }];
      if (sh.rows.length) ws.autoFilter = { from: { row: headIdx, column: 1 }, to: { row: headIdx, column: sh.columns.length } };
    }
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const ok = await API.saveFile(filename, blob);
    if (ok) toast('Файл ' + filename + ' сформирован');
  }
  const FILL = { CURRENT: 'FFD8F0D8', EXPIRING: 'FFFDE9B8', EXPIRED: 'FFF6C9C9', NOT_COMPLETED: 'FFF9D9CB' };

  async function readXlsx(file) {
    if (!window.ExcelJS) throw new Error('Библиотека Excel не загружена');
    const wb = new ExcelJS.Workbook();
    const buf = await file.arrayBuffer();
    if (/\.csv$/i.test(file.name)) throw new Error('Сохраните файл в формате .xlsx');
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('В файле нет листов');
    // строка заголовков: первая строка, где есть хотя бы 2 непустые ячейки
    let headRowNo = 1, headers = [];
    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
      const vals = []; ws.getRow(r).eachCell({ includeEmpty: true }, (c, col) => { vals[col] = cellText(c.value); });
      if (vals.filter((x) => x).length >= 2) { headRowNo = r; headers = vals; break; }
    }
    const rows = [];
    for (let r = headRowNo + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r); const o = { _line: r }; let any = false;
      headers.forEach((h, col) => {
        if (!h) return;
        let v = row.getCell(col).value;
        if (v && typeof v === 'object' && !(v instanceof Date)) v = v.result !== undefined ? v.result : (v.text || (v.richText ? v.richText.map((x) => x.text).join('') : ''));
        if (v !== null && v !== undefined && String(v).trim() !== '') any = true;
        o[h] = v;
      });
      if (any) rows.push(o);
    }
    return { headers: headers.filter(Boolean), rows };
  }
  function cellText(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object' && !(v instanceof Date)) return String(v.text || v.result || (v.richText ? v.richText.map((x) => x.text).join('') : '')).trim();
    return String(v).trim();
  }
  const normH = (s) => String(s).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
  const IMPORT_MAP = {
    employees: {
      tabNo: ['табельныйномер', 'табномер', 'таб', 'табельный', 'табн'], fullName: ['фио', 'работник', 'сотрудник', 'фамилияимяотчество'],
      site: ['площадка', 'филиал', 'производственнаяплощадка'], department: ['подразделение', 'цех', 'отдел', 'участок'],
      position: ['должность', 'профессия', 'должностьпрофессия'], hireDate: ['датаприема', 'принят', 'датаприемаработу'], dismissedAt: ['датаувольнения', 'уволен']
    },
    trainings: {
      tabNo: ['табельныйномер', 'табномер', 'таб', 'табельный', 'табн'], course: ['курс', 'курскодилиназвание', 'программа', 'кодкурса', 'обучение', 'названиекурса'],
      date: ['датаобучения', 'дата', 'датапроверкизнаний', 'датапрохождения'], validUntil: ['действуетдо', 'срокдействия', 'следующаяпроверка', 'датаследующейпроверки'],
      protocolNo: ['протокола', 'номерпротокола', 'протокол'], certificateNo: ['удостоверения', 'номерудостоверения', 'удостоверение'], provider: ['кемпроведено', 'организация', 'учебныйцентр', 'проводил']
    }
  };
  function mapRows(kind, parsed) {
    const map = IMPORT_MAP[kind], colFor = {};
    parsed.headers.forEach((h) => {
      const k = normH(h);
      Object.keys(map).forEach((f) => { if (!colFor[f] && map[f].indexOf(k) >= 0) colFor[f] = h; });
    });
    const rows = parsed.rows.map((r) => { const o = { _line: r._line }; Object.keys(colFor).forEach((f) => { o[f] = r[colFor[f]] instanceof Date ? r[colFor[f]] : (r[colFor[f]] === null || r[colFor[f]] === undefined ? '' : r[colFor[f]]); }); return o; });
    rows.forEach((o) => ['hireDate', 'dismissedAt', 'date', 'validUntil'].forEach((k) => { if (o[k] instanceof Date) o[k] = C.normalizeDate(o[k]); else if (typeof o[k] === 'number') o[k] = C.normalizeDate(o[k]); }));
    return { colFor, rows, missing: Object.keys(map).filter((f) => !colFor[f]) };
  }

  // ---------------- иконки ----------------
  const I = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const ICONS = {
    dashboard: I('<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>'),
    status: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    matrix: I('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>'),
    plan: I('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>'),
    record: I('<path d="M12 5v14M5 12h14"/>'),
    employees: I('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6 6 0 0 0-4-5.6"/>'),
    courses: I('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M9 8h6"/>'),
    org: I('<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-2h12v2"/>'),
    import: I('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>'),
    audit: I('<path d="M5 4h11l3 3v13H5z"/><path d="M9 10h6M9 14h6M9 18h4"/>'),
    admin: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>')
  };

  const PAGES = [
    { id: 'dashboard', title: 'Дашборд', sub: 'Состояние обязательного обучения на дату' },
    { id: 'status', title: 'Контроль сроков', sub: 'Каждое обязательное обучение каждого работника со статусом на дату' },
    { id: 'matrix', title: 'Матрица обучения', sub: 'Работники × обязательные курсы' },
    { id: 'plan', title: 'План обучения', sub: 'Кого и когда нужно обучить в ближайшие 12 месяцев' },
    { id: 'record', title: 'Внести обучение', sub: 'Запись о проведённом обучении или проверке знаний для одного или группы работников', edit: true },
    { sep: true },
    { id: 'employees', title: 'Работники', sub: 'Список работников и карточки с историей обучения' },
    { id: 'courses', title: 'Курсы и требования', sub: 'Справочник курсов и обязательные курсы по должностям' },
    { id: 'org', title: 'Оргструктура', sub: 'Площадки, подразделения, должности' },
    { id: 'import', title: 'Импорт и выгрузка', sub: 'Перенос данных из Excel и выгрузка отчётов' },
    { id: 'audit', title: 'Журнал изменений', sub: 'Кто, когда и что изменил', hideFor: ['manager'] },
    { id: 'admin', title: 'Администрирование', sub: 'Пользователи, роли и настройки', admin: true }
  ];

  // ---------------- каркас ----------------
  function shell() {
    const u = user();
    const navItems = PAGES.filter((p) => p.sep || ((!p.admin || u.isAdmin) && (!p.edit || u.canEdit) && !(p.hideFor || []).includes(u.role)))
      .map((p) => p.sep ? '<div class="sep"></div>' : `<a href="#${p.id}" data-nav="${p.id}">${ICONS[p.id]}<span>${esc(p.title)}</span></a>`).join('');
    const foot = API.mode === 'demo'
      ? `<b>${esc(u.fullName)}</b>${esc(u.roleLabel)}
         <label class="small" style="display:block;margin-top:8px">Войти как (демо):
         <select id="demo-user">${API.demoUsers.map((x) => opt(x.login, x.fullName, API.currentLogin)).join('')}</select></label>`
      : `<b>${esc(u.fullName)}</b>${esc(u.roleLabel)}<div class="btn-row" style="margin-top:8px"><button class="btn sm" id="chpw">Сменить пароль</button><button class="btn sm" id="logout">Выйти</button></div>`;
    document.body.innerHTML = `
      <div class="app">
        <aside class="side">
          <div class="brand"><b>Контроль обучения</b><span>${esc(S.boot.settings.orgName)}</span></div>
          <nav class="nav">${navItems}</nav>
          <div class="side-foot">${foot}</div>
        </aside>
        <main class="main">
          ${API.mode === 'demo' ? `<div class="demo-banner"><span><b>Демо-версия.</b> Люди и данные вымышлены. Изменения сохраняются только в этом браузере. Периодичность курсов задана для примера.</span><button class="btn sm" id="demo-reset">Сбросить демо-данные</button></div>` : ''}
          <div class="page-head"><div><h1 id="page-title"></h1><div class="sub" id="page-sub"></div></div><div id="page-actions" class="btn-row"></div></div>
          <div class="content" id="content"></div>
        </main>
      </div>`;
    if (API.mode === 'demo') {
      $('#demo-user').addEventListener('change', async (e) => { API.switchUser(e.target.value); await reboot(); });
      $('#demo-reset').addEventListener('click', async () => {
        if (await confirmBox('Сбросить демо-данные', 'Все изменения, сделанные в демо-версии, будут удалены и данные будут сгенерированы заново.', 'Сбросить')) {
          await API.resetDemo(); location.reload();
        }
      });
    } else {
      $('#logout').addEventListener('click', async () => { await API.logout(); location.reload(); });
      $('#chpw').addEventListener('click', changePassword);
    }
  }

  async function changePassword() {
    await modal({
      title: 'Смена пароля',
      body: `<div class="form-grid"><label class="field"><span>Текущий пароль</span><input type="password" name="old" autocomplete="current-password"></label>
        <label class="field"><span>Новый пароль (не короче 8 символов)</span><input type="password" name="nw" autocomplete="new-password"></label></div>`,
      onOk: async (root) => { const f = formData(root); await API.changePassword(f.old, f.nw); toast('Пароль изменён'); }
    });
  }

  function parseHash() {
    const h = (location.hash || '').replace(/^#/, '');
    const m = /^employee-(\d+)$/.exec(h);
    if (m) return { page: 'employee', id: Number(m[1]) };
    return { page: PAGES.some((p) => p.id === h) ? h : 'dashboard' };
  }
  function go(page) { if (location.hash === '#' + page) route(); else location.hash = page; }

  async function route() {
    const r = parseHash();
    const token = ++S.renderToken;
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.getAttribute('data-nav') === (r.page === 'employee' ? 'employees' : r.page)));
    const p = PAGES.find((x) => x.id === r.page) || { title: 'Карточка работника', sub: '' };
    $('#page-title').textContent = p.title; $('#page-sub').textContent = p.sub || '';
    $('#page-actions').innerHTML = '';
    const content = $('#content');
    content.innerHTML = '<div class="spinner">Загрузка…</div>';
    tipEl.classList.add('hidden');
    try {
      await (VIEWS[r.page] || VIEWS.dashboard)(content, token, r);
    } catch (e) {
      if (token !== S.renderToken) return;
      content.innerHTML = `<div class="err-box">${esc(e.message || e)}</div>`;
    }
    window.scrollTo(0, 0);
  }
  const stale = (token) => token !== S.renderToken;

  // ---------------- фильтры ----------------
  function visibleDepartments(siteId) {
    const u = user();
    return S.boot.departments.filter((x) => {
      if (siteId && x.siteId !== Number(siteId)) return false;
      if (u.role === 'manager' && u.departmentIds.length) return u.departmentIds.includes(x.id);
      if ((u.role === 'manager' || u.role === 'trainer') && u.siteIds.length) return u.siteIds.includes(x.siteId);
      return true;
    });
  }
  function visibleSites() {
    const ds = visibleDepartments(''); const ids = new Set(ds.map((x) => x.siteId));
    return S.boot.sites.filter((s) => ids.has(s.id) || (user().role === 'admin'));
  }
  function filterBar(fields, onChange, extra) {
    const F = S.F, b = S.boot;
    const parts = [];
    if (fields.includes('asOf')) parts.push(`<label>На дату<input type="date" data-f="asOf" value="${esc(F.asOf)}"></label>`);
    if (fields.includes('site')) parts.push(`<label>Площадка<select data-f="siteId">${opt('', 'Все площадки', F.siteId)}${visibleSites().map((s) => opt(s.id, s.name, F.siteId)).join('')}</select></label>`);
    if (fields.includes('department')) parts.push(`<label>Подразделение<select data-f="departmentId">${opt('', 'Все подразделения', F.departmentId)}${visibleDepartments(F.siteId).map((x) => opt(x.id, x.name, F.departmentId)).join('')}</select></label>`);
    if (fields.includes('position')) parts.push(`<label>Должность<select data-f="positionId">${opt('', 'Все должности', F.positionId)}${b.positions.map((x) => opt(x.id, x.name, F.positionId)).join('')}</select></label>`);
    if (fields.includes('category')) parts.push(`<label>Категория<select data-f="category">${opt('', 'Все категории', F.category)}${b.categories.map((x) => opt(x, x, F.category)).join('')}</select></label>`);
    if (fields.includes('course')) parts.push(`<label>Курс<select data-f="courseId">${opt('', 'Все курсы', F.courseId)}${b.courses.filter((c) => !F.category || c.category === F.category).map((x) => opt(x.id, x.name, F.courseId)).join('')}</select></label>`);
    const wrap = document.createElement('div');
    wrap.className = 'filters';
    wrap.innerHTML = parts.join('') + (extra || '') + `<button class="btn ghost sm reset" data-reset>Сбросить фильтры</button>`;
    $$('[data-f]', wrap).forEach((i) => i.addEventListener('change', () => {
      const k = i.getAttribute('data-f');
      S.F[k] = i.value;
      if (k === 'asOf' && !C.isValidISO(i.value)) S.F.asOf = S.boot.today;
      if (k === 'siteId') S.F.departmentId = '';
      if (k === 'category') S.F.courseId = '';
      S.status.page = 1; S.selected.clear();
      onChange();
    }));
    $('[data-reset]', wrap).addEventListener('click', () => {
      Object.assign(S.F, { asOf: S.boot.today, siteId: '', departmentId: '', positionId: '', category: '', courseId: '' });
      S.status.dueKey = ''; S.status.statuses = []; S.status.page = 1; S.selected.clear();
      onChange();
    });
    return wrap;
  }
  function filterSummary() {
    const b = S.boot, F = S.F, parts = [];
    if (F.siteId) parts.push((b.sites.find((x) => x.id == F.siteId) || {}).name);
    if (F.departmentId) parts.push((b.departments.find((x) => x.id == F.departmentId) || {}).name);
    if (F.positionId) parts.push((b.positions.find((x) => x.id == F.positionId) || {}).name);
    if (F.category) parts.push(F.category);
    if (F.courseId) parts.push((b.courses.find((x) => x.id == F.courseId) || {}).name);
    return parts.filter(Boolean).join(', ');
  }

  // ---------------- навигация «провалиться» ----------------
  function drill(patch) {
    if (patch.F) Object.assign(S.F, patch.F);
    S.status.statuses = patch.statuses || [];
    S.status.dueKey = patch.dueKey || '';
    S.status.page = 1; S.status.q = ''; S.selected.clear();
    go('status');
  }

  // ================= ДАШБОРД =================
  const VIEWS = {};
  VIEWS.dashboard = async (root, token) => {
    const rerender = () => VIEWS.dashboard(root, ++S.renderToken);
    const data = await call('dashboard', filterParams());
    if (stale(token)) return;
    root.innerHTML = '';
    root.appendChild(filterBar(['asOf', 'site', 'department', 'position', 'category', 'course'], rerender));
    $('#page-sub').textContent = 'Состояние обязательного обучения на ' + d(data.asOf) + (filterSummary() ? '. Фильтр: ' + filterSummary() : '');
    $('#page-actions').innerHTML = `<button class="btn" id="dash-export">Выгрузить сводку в Excel</button>`;
    $('#dash-export').addEventListener('click', () => exportDashboard(data).catch(showError));

    const T = data.totals;
    if (!T.total) {
      root.insertAdjacentHTML('beforeend', `<div class="card empty">Нет обязательных обучений для выбранных условий. Проверьте фильтры или задайте требования по должностям в разделе «Курсы и требования».</div>`);
      return;
    }
    const kpi = (o) => `<div class="kpi-tile${o.click ? ' click' : ''}" ${o.click ? `data-drill="${o.click}"` : ''} ${o.tip ? `data-tip="${esc(o.tip)}"` : ''}>
        ${o.color ? `<span class="stripe" style="background:${o.color}"></span>` : ''}
        <div class="label">${o.label}</div><div class="value">${o.value}</div><div class="note">${o.note}</div></div>`;
    const html = `
      <div class="grid kpi">
        ${kpi({ label: 'В норме', value: pct(data.okShare), note: `${n(T.CURRENT + T.EXPIRING)} из ${n(T.total)} обязательных обучений`, tip: 'Доля обязательных обучений со статусом «Действует» или «Истекает» (срок ещё не нарушен)' })}
        ${kpi({ label: stBadge('EXPIRED'), value: n(T.EXPIRED), note: 'срок действия уже истёк', click: 'EXPIRED', color: STATUS_COLOR.EXPIRED })}
        ${kpi({ label: stBadge('NOT_COMPLETED'), value: n(T.NOT_COMPLETED), note: 'требуется, но записи нет', click: 'NOT_COMPLETED', color: STATUS_COLOR.NOT_COMPLETED })}
        ${kpi({ label: stBadge('EXPIRING'), value: n(T.EXPIRING), note: `истекает в ближайшие ${data.expiringDays} дн.`, click: 'EXPIRING', color: STATUS_COLOR.EXPIRING })}
        ${kpi({ label: 'Работники с нарушениями', value: n(data.employeesCritical), note: `из ${n(data.employeesWithRequirements)} (${pct(data.employeesCriticalShare)}), хотя бы одно просрочено или не пройдено`, click: 'CRIT' })}
      </div>
      <div class="card" style="margin-top:14px">
        <div class="card-head"><h2>Распределение обязательных обучений по статусам</h2><span class="muted small">всего ${n(T.total)}</span></div>
        <div class="distbar">${C.STATUS_ORDER.filter((s) => T[s]).map((s) => `<div data-drill="${s}" style="flex:${T[s]};background:${STATUS_COLOR[s]}" data-tip="${SL[s]}: ${n(T[s])} (${pct(T[s] / T.total)})"></div>`).join('')}</div>
        <div class="legend">${C.STATUS_ORDER.map((s) => `<span data-drill="${s}"><i class="dot ${s}"></i>${SL[s]} <b>${n(T[s])}</b> <span class="muted">${pct(T[s] / T.total)}</span></span>`).join('')}</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Потребность в обучении на 12 месяцев</h2><span class="muted small">сколько обучений нужно провести: срочно и по месяцам окончания срока. Нажмите на столбец, чтобы увидеть людей</span></div>
        <div class="bars" id="need-chart"></div>
      </div>
      <div class="grid two" style="margin-top:14px">
        <div class="card"><div class="card-head"><h2>Подразделения</h2><span class="muted small">сначала с наименьшей долей «в норме»</span></div>
          <div class="table-wrap" style="max-height:440px"><table class="t"><thead><tr><th>Подразделение</th><th class="num">Работников</th><th class="num" data-tip="Работники, у которых хотя бы одно обучение просрочено или не пройдено">С нарушен.</th><th class="num">Просроч.</th><th class="num">Не пройд.</th><th class="num">В норме</th></tr></thead>
          <tbody>${data.departments.map((x) => `<tr class="click" data-dept="${x.id}" data-site="${x.siteId}" data-tip="${esc(x.name)}\nОбязательных обучений: ${n(x.counts.total)}\nИстекает: ${n(x.counts.EXPIRING)}"><td>${esc(x.name)}<div class="muted small">${esc((S.boot.sites.find((s) => s.id === x.siteId) || {}).name || '')}</div></td>
            <td class="num">${n(x.employees)}</td><td class="num">${x.criticalEmployees ? n(x.criticalEmployees) : '<span class="muted">0</span>'}</td>
            <td class="num">${x.counts.EXPIRED || '<span class="muted">0</span>'}</td><td class="num">${x.counts.NOT_COMPLETED || '<span class="muted">0</span>'}</td>
            <td class="num nowrap">${pct(x.okShare)}<span class="mini-bar"><i style="width:${Math.round((x.okShare || 0) * 100)}%"></i></span></td></tr>`).join('')}</tbody></table></div></div>
        <div class="card"><div class="card-head"><h2>Курсы с нарушениями</h2><span class="muted small">по числу просроченных и непройденных</span></div>
          ${data.courses.length ? `<div class="table-wrap" style="max-height:440px"><table class="t"><thead><tr><th>Курс</th><th class="num">Просроч.</th><th class="num">Не пройд.</th><th class="num">Истекает</th></tr></thead>
          <tbody>${data.courses.map((x) => `<tr class="click" data-course="${x.id}"><td>${esc(x.name)}</td><td class="num">${x.counts.EXPIRED || '<span class="muted">0</span>'}</td><td class="num">${x.counts.NOT_COMPLETED || '<span class="muted">0</span>'}</td><td class="num">${x.counts.EXPIRING || '<span class="muted">0</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Нарушений нет</div>'}
        </div>
      </div>
      ${data.sites.length > 1 ? `<div class="card" style="margin-top:14px"><div class="card-head"><h2>Площадки</h2></div><div class="grid kpi">${data.sites.map((s) => `<div class="kpi-tile click" data-site-only="${s.id}"><div class="label">${esc(s.name)}</div><div class="value">${pct(s.okShare)}</div><div class="note">в норме · работников ${n(s.employees)} · с нарушениями ${n(s.criticalEmployees)}</div></div>`).join('')}</div></div>` : ''}`;
    root.insertAdjacentHTML('beforeend', html);
    needChart($('#need-chart'), data);

    $$('[data-drill]', root).forEach((el) => el.addEventListener('click', () => {
      const v = el.getAttribute('data-drill');
      drill({ statuses: v === 'CRIT' ? ['EXPIRED', 'NOT_COMPLETED'] : [v] });
    }));
    $$('[data-dept]', root).forEach((el) => el.addEventListener('click', () => drill({ F: { siteId: el.getAttribute('data-site'), departmentId: el.getAttribute('data-dept') }, statuses: ['EXPIRED', 'NOT_COMPLETED'] })));
    $$('[data-course]', root).forEach((el) => el.addEventListener('click', () => drill({ F: { courseId: el.getAttribute('data-course') }, statuses: ['EXPIRED', 'NOT_COMPLETED', 'EXPIRING'] })));
    $$('[data-site-only]', root).forEach((el) => el.addEventListener('click', () => { S.F.siteId = el.getAttribute('data-site-only'); S.F.departmentId = ''; rerender(); }));
  };

  function needChart(box, data) {
    const items = [{ key: 'now', label: 'Срочно', count: data.need.now, now: true }].concat(data.need.months.map((m) => ({ key: m.key, label: m.label, count: m.count })));
    const W = 900, H = 230, padL = 40, padB = 40, padT = 18, padR = 8;
    const max = Math.max(1, ...items.map((x) => x.count));
    const step = niceStep(max / 4), top = Math.ceil(max / step) * step;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const slot = innerW / items.length, bw = Math.min(44, slot * 0.62);
    const y = (v) => padT + innerH - (v / top) * innerH;
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Потребность в обучении по месяцам">`;
    for (let v = 0; v <= top; v += step) {
      svg += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? '#bdbcb6' : '#ecebe7'}" stroke-width="1"/>`;
      svg += `<text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#7c7b76">${n(v)}</text>`;
    }
    const peak = items.slice(1).reduce((a, b) => (b.count > a.count ? b : a), items[1] || items[0]);
    items.forEach((it, i) => {
      const cx = padL + slot * i + slot / 2, x = cx - bw / 2, h = Math.max(0, (it.count / top) * innerH), yy = padT + innerH - h;
      const r = Math.min(4, h);
      const path = h > 0 ? `M${x},${padT + innerH} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${padT + innerH} Z` : '';
      const tip = it.now ? `Срочно: ${n(it.count)}\nпросрочено и не пройдено, нужно обучить сейчас` : `${C.monthLabel(it.key, true)}: ${n(it.count)}\nистекает срок действия`;
      svg += `<g data-need="${it.key}" style="cursor:pointer" data-tip="${esc(tip)}">
        <rect x="${padL + slot * i}" y="${padT}" width="${slot}" height="${innerH + padB}" fill="transparent"/>
        ${path ? `<path class="bar" d="${path}" fill="${it.now ? 'var(--critical)' : 'var(--seq)'}"/>` : ''}
        <text x="${cx}" y="${H - padB + 16}" text-anchor="middle" font-size="11.5" fill="${it.now ? '#17181a' : '#52514e'}" font-weight="${it.now ? 600 : 400}">${esc(it.now ? 'Срочно' : it.label.split(' ')[0])}</text>
        ${(!it.now && (i === 1 || it.label.startsWith('янв'))) ? `<text x="${cx}" y="${H - padB + 30}" text-anchor="middle" font-size="10.5" fill="#7c7b76">${it.key.slice(0, 4)}</text>` : ''}
        ${(it.now || it === peak) && it.count ? `<text x="${cx}" y="${yy - 5}" text-anchor="middle" font-size="11.5" fill="#17181a" font-weight="600">${n(it.count)}</text>` : ''}
      </g>`;
    });
    svg += '</svg>';
    box.innerHTML = svg + `<div class="legend" style="margin-top:4px"><span><i class="dot" style="background:var(--critical)"></i>Срочно: просрочено и не пройдено</span><span><i class="dot" style="background:var(--seq)"></i>Истекает срок в этом месяце</span></div>`;
    $$('[data-need]', box).forEach((g) => g.addEventListener('click', () => {
      const k = g.getAttribute('data-need');
      drill({ dueKey: k, statuses: [] });
    }));
  }
  function niceStep(x) {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1))));
    const f = x / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  async function exportDashboard(data) {
    const T = data.totals;
    const summary = [
      { k: 'Дата состояния', v: d(data.asOf) }, { k: 'Фильтр', v: filterSummary() || 'нет' },
      { k: 'Обязательных обучений', v: T.total }, { k: 'В норме, %', v: Math.round(data.okShare * 1000) / 10 },
      { k: 'Действует', v: T.CURRENT }, { k: 'Истекает (' + data.expiringDays + ' дн.)', v: T.EXPIRING }, { k: 'Просрочено', v: T.EXPIRED }, { k: 'Не пройдено', v: T.NOT_COMPLETED },
      { k: 'Работников с требованиями', v: data.employeesWithRequirements }, { k: 'Работников с нарушениями', v: data.employeesCritical },
      { k: 'Нужно обучить срочно', v: data.need.now }
    ].concat(data.need.months.map((m) => ({ k: 'Истекает: ' + C.monthLabel(m.key, true), v: m.count })));
    await exportXlsx('Сводка_обучение_' + data.asOf + '.xlsx', [
      { name: 'Сводка', title: S.boot.settings.orgName + ': состояние обучения на ' + d(data.asOf), columns: [{ header: 'Показатель', key: 'k', width: 40 }, { header: 'Значение', key: 'v', width: 16 }], rows: summary },
      { name: 'Подразделения', columns: [
        { header: 'Площадка', width: 26, value: (x) => (S.boot.sites.find((s) => s.id === x.siteId) || {}).name },
        { header: 'Подразделение', key: 'name', width: 34 }, { header: 'Работников', key: 'employees', width: 12 },
        { header: 'С нарушениями', key: 'criticalEmployees', width: 14 }, { header: 'Обязательных обучений', width: 14, value: (x) => x.counts.total },
        { header: 'Просрочено', width: 12, value: (x) => x.counts.EXPIRED }, { header: 'Не пройдено', width: 12, value: (x) => x.counts.NOT_COMPLETED },
        { header: 'Истекает', width: 12, value: (x) => x.counts.EXPIRING }, { header: 'В норме, %', width: 12, value: (x) => Math.round(x.okShare * 1000) / 10 }
      ], rows: data.departments },
      { name: 'Курсы', columns: [{ header: 'Курс', key: 'name', width: 60 }, { header: 'Просрочено', width: 12, value: (x) => x.counts.EXPIRED }, { header: 'Не пройдено', width: 12, value: (x) => x.counts.NOT_COMPLETED }, { header: 'Истекает', width: 12, value: (x) => x.counts.EXPIRING }], rows: data.courses }
    ]);
  }

  // ================= КОНТРОЛЬ СРОКОВ =================
  VIEWS.status = async (root, token) => {
    const st = S.status;
    const rerender = () => VIEWS.status(root, ++S.renderToken);
    const params = Object.assign(filterParams(), { statuses: st.statuses, q: st.q, sort: st.sort, page: st.page, pageSize: 50, dueKey: st.dueKey });
    const data = await call('statusList', params);
    if (stale(token)) return;
    const canEdit = user().canEdit;
    root.innerHTML = '';
    const extra = `<label class="grow">Поиск по ФИО или таб. №<input type="search" id="st-q" value="${esc(st.q)}" placeholder="Например, Иванов или 10234"></label>
      <label>Сортировка<select id="st-sort">${opt('due', 'Сначала нарушения', st.sort)}${opt('name', 'По ФИО', st.sort)}${opt('course', 'По курсу', st.sort)}</select></label>`;
    root.appendChild(filterBar(['asOf', 'site', 'department', 'position', 'category', 'course'], rerender, extra));
    const qi = $('#st-q'); let tm;
    qi.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { st.q = qi.value; st.page = 1; rerender(); }, 350); });
    $('#st-sort').addEventListener('change', (e) => { st.sort = e.target.value; rerender(); });
    $('#page-sub').textContent = 'Статусы на ' + d(data.asOf) + (filterSummary() ? '. Фильтр: ' + filterSummary() : '');
    $('#page-actions').innerHTML = `<button class="btn" id="st-export">Выгрузить в Excel (${n(data.total)})</button>`;
    $('#st-export').addEventListener('click', async () => {
      try {
        const all = await call('statusList', Object.assign({}, params, { page: 1, pageSize: 0 }));
        await exportXlsx('Контроль_сроков_' + data.asOf + '.xlsx', [{ name: 'Контроль сроков', title: 'Контроль сроков обучения на ' + d(data.asOf) + (filterSummary() ? ' (' + filterSummary() + ')' : ''), freezeCols: 2, columns: statusColumns(), rows: all.items }]);
      } catch (e) { showError(e); }
    });

    const c = data.counts;
    const chips = C.STATUS_ORDER.map((s) => `<button class="chip${st.statuses.includes(s) ? ' on' : ''}" data-chip="${s}"><i class="dot ${s}"></i>${SL[s]} <b>${n(c[s])}</b></button>`).join('');
    const dueInfo = st.dueKey ? `<div class="info-box" style="margin-bottom:10px">Показаны обучения, которые нужно провести: <b>${st.dueKey === 'now' ? 'срочно (просрочено и не пройдено)' : 'срок истекает в ' + C.monthLabel(st.dueKey, true).toLowerCase()}</b>. <button class="link-btn" id="due-clear">Показать все</button></div>` : '';
    root.insertAdjacentHTML('beforeend', `${dueInfo}<div class="chips">${chips}<button class="chip${!st.statuses.length ? ' on' : ''}" data-chip="">Все <b>${n(c.total)}</b></button></div>
      <div class="table-wrap"><table class="t"><thead><tr>${canEdit ? '<th><input type="checkbox" id="sel-all" aria-label="Выбрать все на странице"></th>' : ''}<th>Статус</th><th>Работник</th><th>Подразделение</th><th>Курс</th><th>Последнее</th><th>Действует до</th><th class="num">Осталось, дн.</th><th>Протокол</th></tr></thead>
      <tbody>${data.items.map((r) => `<tr>
        ${canEdit ? `<td><input type="checkbox" data-sel="${r.employeeId}:${r.courseId}" ${S.selected.has(r.employeeId + ':' + r.courseId) ? 'checked' : ''}></td>` : ''}
        <td>${stBadge(r.status)}</td>
        <td><a href="#employee-${r.employeeId}">${esc(r.fullName)}</a><div class="muted small">таб. № ${esc(r.tabNo)} · ${esc(r.positionName)}</div></td>
        <td>${esc(r.departmentName)}<div class="muted small">${esc(r.siteName)}</div></td>
        <td>${esc(r.courseName)}<div class="muted small">${esc(periodText(r.periodMonths))}${r.source === 'individual' ? ' · индивидуально' : ''}</div></td>
        <td class="nowrap">${d(r.lastDate) || '<span class="muted">нет</span>'}</td>
        <td class="nowrap">${r.validUntil ? d(r.validUntil) : (r.lastDate ? '<span class="muted">бессрочно</span>' : '')}</td>
        <td class="num">${r.daysLeft === null ? '' : n(r.daysLeft)}</td>
        <td>${esc(r.protocolNo)}</td></tr>`).join('') || `<tr><td colspan="9" class="empty">Ничего не найдено</td></tr>`}</tbody></table></div>
      ${pager(data, (p) => { st.page = p; rerender(); })}
      ${canEdit ? `<div class="sel-bar hidden" id="sel-bar"><span id="sel-text"></span><button class="btn sm" id="sel-record">Внести обучение для выбранных</button><button class="btn sm ghost" style="color:#fff" id="sel-clear">Снять выбор</button></div>` : ''}`);
    bindPager(root, (p) => { st.page = p; rerender(); });
    $$('[data-chip]', root).forEach((b) => b.addEventListener('click', () => {
      const s = b.getAttribute('data-chip');
      if (!s) st.statuses = [];
      else st.statuses = st.statuses.includes(s) ? st.statuses.filter((x) => x !== s) : st.statuses.concat(s);
      st.page = 1; rerender();
    }));
    if ($('#due-clear')) $('#due-clear').addEventListener('click', () => { st.dueKey = ''; st.page = 1; rerender(); });
    if (canEdit) {
      const upd = () => {
        const bar = $('#sel-bar'); const k = S.selected.size;
        bar.classList.toggle('hidden', !k);
        const courses = new Set(Array.from(S.selected).map((x) => x.split(':')[1]));
        $('#sel-text').textContent = `Выбрано: ${k}` + (courses.size > 1 ? ` (курсов: ${courses.size}, внести можно по одному курсу)` : '');
        $('#sel-record').disabled = courses.size !== 1;
      };
      $$('[data-sel]', root).forEach((cb) => cb.addEventListener('change', () => { cb.checked ? S.selected.add(cb.dataset.sel) : S.selected.delete(cb.dataset.sel); upd(); }));
      $('#sel-all').addEventListener('change', (e) => { $$('[data-sel]', root).forEach((cb) => { cb.checked = e.target.checked; cb.checked ? S.selected.add(cb.dataset.sel) : S.selected.delete(cb.dataset.sel); }); upd(); });
      $('#sel-clear').addEventListener('click', () => { S.selected.clear(); $$('[data-sel]', root).forEach((cb) => { cb.checked = false; }); upd(); });
      $('#sel-record').addEventListener('click', () => {
        const arr = Array.from(S.selected).map((x) => x.split(':').map(Number));
        S.record = { courseId: arr[0][1], employeeIds: arr.map((x) => x[0]) };
        S.selected.clear(); go('record');
      });
      upd();
    }
  };
  function statusColumns() {
    return [
      { header: 'Таб. №', key: 'tabNo', width: 10 }, { header: 'ФИО', key: 'fullName', width: 34 },
      { header: 'Площадка', key: 'siteName', width: 22 }, { header: 'Подразделение', key: 'departmentName', width: 30 }, { header: 'Должность', key: 'positionName', width: 30 },
      { header: 'Код курса', key: 'courseCode', width: 10 }, { header: 'Курс', key: 'courseName', width: 50 }, { header: 'Категория', key: 'category', width: 22 },
      { header: 'Периодичность', width: 16, value: (r) => periodText(r.periodMonths) },
      { header: 'Статус', width: 14, value: (r) => SL[r.status], fill: (r) => FILL[r.status] },
      { header: 'Последнее обучение', key: 'lastDate', type: 'date', width: 14 }, { header: 'Действует до', key: 'validUntil', type: 'date', width: 14 },
      { header: 'Осталось дней', key: 'daysLeft', width: 10 }, { header: '№ протокола', key: 'protocolNo', width: 14 },
      { header: 'Основание требования', width: 16, value: (r) => (r.source === 'individual' ? 'индивидуально' : 'по должности') }
    ];
  }
  function pager(data, _cb) {
    const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
    if (pages <= 1) return `<div class="pager"><span class="muted small">Записей: ${n(data.total)}</span></div>`;
    return `<div class="pager"><span class="muted small">Записи ${n((data.page - 1) * data.pageSize + 1)}–${n(Math.min(data.total, data.page * data.pageSize))} из ${n(data.total)}</span>
      <div class="btn-row"><button class="btn sm" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>Назад</button>
      <span class="small">стр. ${data.page} из ${pages}</span>
      <button class="btn sm" data-page="${data.page + 1}" ${data.page >= pages ? 'disabled' : ''}>Вперёд</button></div></div>`;
  }
  function bindPager(root, cb) { $$('[data-page]', root).forEach((b) => b.addEventListener('click', () => cb(Number(b.getAttribute('data-page'))))); }

  // ================= МАТРИЦА =================
  VIEWS.matrix = async (root, token) => {
    const M = S.matrix;
    const rerender = () => VIEWS.matrix(root, ++S.renderToken);
    const data = await call('matrix', Object.assign(filterParams(), { onlyProblems: M.onlyProblems, q: M.q, limit: 400 }));
    if (stale(token)) return;
    root.innerHTML = '';
    const extra = `<label class="grow">Поиск<input type="search" id="mx-q" value="${esc(M.q)}" placeholder="ФИО или таб. №"></label>
      <label class="check" style="align-self:center"><input type="checkbox" id="mx-prob" ${M.onlyProblems ? 'checked' : ''}> Только с отклонениями</label>`;
    root.appendChild(filterBar(['asOf', 'site', 'department', 'position', 'category'], rerender, extra));
    let tm; $('#mx-q').addEventListener('input', (e) => { clearTimeout(tm); tm = setTimeout(() => { M.q = e.target.value; rerender(); }, 350); });
    $('#mx-prob').addEventListener('change', (e) => { M.onlyProblems = e.target.checked; rerender(); });
    $('#page-sub').textContent = 'Работники × обязательные курсы на ' + d(data.asOf) + (filterSummary() ? '. Фильтр: ' + filterSummary() : '');
    $('#page-actions').innerHTML = `<button class="btn" id="mx-export">Выгрузить матрицу в Excel</button>`;
    $('#mx-export').addEventListener('click', async () => {
      try {
        const all = await call('matrix', Object.assign(filterParams(), { onlyProblems: M.onlyProblems, q: M.q, limit: 100000 }));
        const cols = [{ header: 'Таб. №', key: 'tabNo', width: 10 }, { header: 'ФИО', key: 'fullName', width: 34 }, { header: 'Подразделение', key: 'departmentName', width: 28 }, { header: 'Должность', key: 'positionName', width: 28 }]
          .concat(all.courses.map((c) => ({ header: (c.code ? c.code + ' ' : '') + c.name, width: 14, type: 'date',
            value: (e) => { const x = e.cells[c.id]; return x ? (x.v || (x.d ? null : null)) : null; },
            fill: (e) => { const x = e.cells[c.id]; return x ? FILL[x.s] : 'FFF2F2F2'; } })));
        await exportXlsx('Матрица_обучения_' + data.asOf + '.xlsx', [{ name: 'Матрица', title: 'Матрица обучения на ' + d(data.asOf) + '. В ячейке: «действует до». Цвет: зелёный действует, жёлтый истекает, красный просрочено, оранжевый не пройдено, серый не требуется', freezeCols: 2, columns: cols, rows: all.employees }]);
      } catch (e) { showError(e); }
    });
    if (!data.employees.length) { root.insertAdjacentHTML('beforeend', '<div class="card empty">Нет работников для выбранных условий</div>'); return; }
    const head = data.courses.map((c) => `<th class="v" data-tip="${esc(c.name)}\n${esc(c.category)}"><div>${esc(c.code || '')} ${esc(c.name)}</div></th>`).join('');
    const body = data.employees.map((e) => `<tr><td class="name"><a href="#employee-${e.id}">${esc(e.fullName)}</a><div class="muted small">${esc(e.positionName)} · ${esc(e.departmentName)}</div></td>
      ${data.courses.map((c) => {
        const x = e.cells[c.id];
        if (!x) return `<td class="c none" data-tip="Не требуется"></td>`;
        const tip = `${c.name}\n${SL[x.s]}` + (x.d ? `\nПоследнее: ${d(x.d)}` : '') + (x.v ? `\nДействует до: ${d(x.v)}` : (x.d ? '\nБессрочно' : ''));
        return `<td class="c" data-tip="${esc(tip)}"><span class="${x.s}">${STATUS_ICON[x.s]}</span></td>`;
      }).join('')}</tr>`).join('');
    root.insertAdjacentHTML('beforeend', `
      <div class="toolbar"><div class="legend">${C.STATUS_ORDER.map((s) => `<span><i class="dot ${s}"></i>${SL[s]}</span>`).join('')}<span><i class="dot" style="background:repeating-linear-gradient(135deg,#fafaf8 0 3px,#d9d8d3 3px 4px)"></i>Не требуется</span></div>
      <span class="muted small">${data.limited ? `Показаны первые 400 из ${n(data.total)} работников. Уточните фильтр или выгрузите в Excel.` : `Работников: ${n(data.total)}`}</span></div>
      <div class="matrix-wrap"><table class="mx"><thead><tr><th class="name">Работник</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
  };

  // ================= ПЛАН =================
  VIEWS.plan = async (root, token) => {
    const rerender = () => VIEWS.plan(root, ++S.renderToken);
    const data = await call('plan', filterParams());
    if (stale(token)) return;
    root.innerHTML = '';
    root.appendChild(filterBar(['asOf', 'site', 'department', 'position', 'category'], rerender));
    $('#page-sub').textContent = 'Сколько человек нужно обучить по каждому курсу, по месяцам окончания срока, начиная с ' + d(data.asOf);
    $('#page-actions').innerHTML = `<button class="btn" id="pl-export">Выгрузить план в Excel</button>`;
    $('#pl-export').addEventListener('click', async () => {
      try {
        const all = await call('statusList', Object.assign(filterParams(), { page: 1, pageSize: 0, sort: 'course' }));
        const horizon = C.addMonths(C.monthKey(data.asOf) + '-01', 12);
        const rows = all.items.map((r) => Object.assign(r, { planKey: C.planKeyOf(r, horizon) })).filter((r) => r.planKey)
          .sort((a, b) => (a.planKey === 'now' ? '0' : a.planKey).localeCompare(b.planKey === 'now' ? '0' : b.planKey) || a.courseName.localeCompare(b.courseName, 'ru') || a.fullName.localeCompare(b.fullName, 'ru'));
        await exportXlsx('План_обучения_' + data.asOf + '.xlsx', [
          { name: 'Сводно', title: 'План обучения на 12 месяцев с ' + d(data.asOf), freezeCols: 1,
            columns: [{ header: 'Курс', key: 'name', width: 50 }].concat(data.keys.map((k) => ({ header: k.label, width: 11, value: (c) => c.cells[k.key] || null }))).concat([{ header: 'Итого', key: 'total', width: 10 }]),
            rows: data.courses },
          { name: 'Поимённо', columns: [{ header: 'Когда', width: 14, value: (r) => (r.planKey === 'now' ? 'Срочно' : C.monthLabel(r.planKey, true)) }].concat(statusColumns()), rows }
        ]);
      } catch (e) { showError(e); }
    });
    if (!data.courses.length) { root.insertAdjacentHTML('beforeend', '<div class="card empty">В ближайшие 12 месяцев обучение не требуется</div>'); return; }
    const total = data.courses.reduce((a, c) => a + c.total, 0);
    root.insertAdjacentHTML('beforeend', `
      <div class="info-box" style="margin-bottom:12px">Нажмите на число, чтобы увидеть список работников и сразу внести обучение группе. «Срочно»: обучение просрочено или ни разу не пройдено.</div>
      <div class="table-wrap"><table class="t plan"><thead><tr><th>Курс</th>${data.keys.map((k) => `<th class="num${k.key === 'now' ? ' now' : ''}">${esc(k.label)}</th>`).join('')}<th class="num">Итого</th></tr></thead>
      <tbody>${data.courses.map((c) => `<tr><td>${esc(c.name)}<div class="muted small">${esc(c.category)}</div></td>
        ${data.keys.map((k) => { const v = c.cells[k.key] || 0; return `<td class="cell${v ? '' : ' zero'}${k.key === 'now' ? ' now' : ''}" ${v ? `data-cell="${c.id}|${k.key}"` : ''}>${v || '·'}</td>`; }).join('')}
        <td class="num"><b>${n(c.total)}</b></td></tr>`).join('')}
        <tr class="total"><td>Итого</td>${data.keys.map((k) => `<td class="num${k.key === 'now' ? ' now' : ''}">${n(data.colTotals[k.key] || 0)}</td>`).join('')}<td class="num">${n(total)}</td></tr></tbody></table></div>`);
    $$('[data-cell]', root).forEach((td) => td.addEventListener('click', () => {
      const [cid, key] = td.getAttribute('data-cell').split('|');
      planCell(Number(cid), key, data.keys.find((k) => k.key === key).label);
    }));
  };

  async function planCell(courseId, key, label) {
    const list = await call('statusList', Object.assign(filterParams(), { courseId, dueKey: key, page: 1, pageSize: 0, sort: 'name' }));
    const course = S.boot.courses.find((c) => c.id === courseId);
    const canEdit = user().canEdit;
    await modal({
      title: course.name + ': ' + label, wide: true, okText: 'Внести обучение для выбранных', noOk: !canEdit, cancelText: 'Закрыть',
      body: `<p class="muted">Работников: ${n(list.total)}. ${key === 'now' ? 'Обучение просрочено или не пройдено.' : 'Срок действия истекает в этом месяце.'}</p>
        <div class="table-wrap" style="max-height:52vh"><table class="t"><thead><tr>${canEdit ? '<th><input type="checkbox" checked data-all></th>' : ''}<th>Работник</th><th>Подразделение</th><th>Статус</th><th>Действует до</th></tr></thead>
        <tbody>${list.items.map((r) => `<tr>${canEdit ? `<td><input type="checkbox" checked data-emp="${r.employeeId}"></td>` : ''}<td>${esc(r.fullName)}<div class="muted small">таб. № ${esc(r.tabNo)} · ${esc(r.positionName)}</div></td><td>${esc(r.departmentName)}</td><td>${stBadge(r.status)}</td><td>${d(r.validUntil)}</td></tr>`).join('')}</tbody></table></div>`,
      onOpen: (bk) => { const a = $('[data-all]', bk); if (a) a.addEventListener('change', () => $$('[data-emp]', bk).forEach((c) => { c.checked = a.checked; })); },
      onOk: (bk) => {
        const ids = $$('[data-emp]', bk).filter((c) => c.checked).map((c) => Number(c.dataset.emp));
        if (!ids.length) throw new Error('Отметьте работников');
        S.record = { courseId, employeeIds: ids };
        setTimeout(() => go('record'), 0);
        return true;
      }
    });
  }

  // ================= ВНЕСТИ ОБУЧЕНИЕ =================
  VIEWS.record = async (root, token) => {
    if (!user().canEdit) { root.innerHTML = '<div class="warn-box">У вашей роли нет прав на внесение данных</div>'; return; }
    const pre = S.record || {};
    S.record = null;
    const st = { courseId: pre.courseId || '', selected: new Set(pre.employeeIds || []), onlyRequired: true, q: '', siteId: S.F.siteId, departmentId: S.F.departmentId, positionId: '', certs: {} };
    const courses = S.boot.courses.filter((c) => c.active !== false);
    root.innerHTML = `
      <div class="card">
        <h2>1. Что за обучение</h2>
        <div class="form-grid" id="rec-form">
          <label class="field wide"><span>Курс (программа, вид проверки знаний)</span><select name="courseId" id="rec-course">${opt('', 'Выберите курс…', st.courseId)}${S.boot.categories.map((cat) => `<optgroup label="${esc(cat)}">${courses.filter((c) => c.category === cat).map((c) => opt(c.id, (c.code ? c.code + '. ' : '') + c.name, st.courseId)).join('')}</optgroup>`).join('')}</select></label>
          <label class="field"><span>Дата обучения / проверки знаний</span><input type="date" name="date" id="rec-date" value="${esc(S.boot.today)}"></label>
          <label class="field"><span>Действует до</span><input type="date" name="validUntil" id="rec-valid"><span class="hint" id="rec-valid-hint">рассчитывается по периодичности курса, можно изменить</span></label>
          <label class="field"><span>№ протокола</span><input type="text" name="protocolNo" placeholder="например, 125/26"></label>
          <label class="field"><span>Кем проведено</span><input type="text" name="provider" list="providers" placeholder="учебный центр, комиссия"></label>
          <label class="field wide"><span>Примечание</span><input type="text" name="note"></label>
        </div>
        <datalist id="providers"><option value="Учебный центр предприятия"><option value="Комиссия предприятия"><option value="Руководитель подразделения"></datalist>
      </div>
      <div class="card">
        <div class="card-head"><h2>2. Кто прошёл</h2><span class="muted small" id="rec-count"></span></div>
        <div class="filters" style="box-shadow:none">
          <label>Площадка<select id="r-site">${opt('', 'Все', st.siteId)}${visibleSites().map((s) => opt(s.id, s.name, st.siteId)).join('')}</select></label>
          <label>Подразделение<select id="r-dept"></select></label>
          <label>Должность<select id="r-pos">${opt('', 'Все', '')}${S.boot.positions.map((p) => opt(p.id, p.name, '')).join('')}</select></label>
          <label class="grow">Поиск<input type="search" id="r-q" placeholder="ФИО или таб. №"></label>
          <label class="check" style="align-self:center"><input type="checkbox" id="r-req" checked> Только те, кому курс обязателен</label>
        </div>
        <div id="rec-list"><div class="empty">Выберите курс</div></div>
      </div>
      <div class="sel-bar"><span id="rec-sel">Выбрано: 0</span><button class="btn primary" id="rec-save" style="color:#fff">Сохранить запись</button></div>`;
    const deptSel = $('#r-dept');
    const fillDept = () => { deptSel.innerHTML = opt('', 'Все', st.departmentId) + visibleDepartments(st.siteId).map((x) => opt(x.id, x.name, st.departmentId)).join(''); };
    fillDept();
    const courseSel = $('#rec-course'), dateI = $('#rec-date'), validI = $('#rec-valid');
    let validTouched = false;
    validI.addEventListener('input', () => { validTouched = true; });
    const recalc = () => {
      const c = courses.find((x) => x.id === Number(courseSel.value));
      if (!c) { $('#rec-valid-hint').textContent = 'рассчитывается по периодичности курса'; return; }
      if (!validTouched) validI.value = c.periodMonths && C.isValidISO(dateI.value) ? C.addMonths(dateI.value, c.periodMonths) : '';
      $('#rec-valid-hint').textContent = c.periodMonths ? `периодичность курса: ${c.periodMonths} мес., можно изменить вручную` : 'курс однократный: срок не ограничен';
    };
    courseSel.addEventListener('change', () => { validTouched = false; recalc(); loadList(); });
    dateI.addEventListener('change', recalc);
    recalc();
    $('#r-site').addEventListener('change', (e) => { st.siteId = e.target.value; st.departmentId = ''; fillDept(); loadList(); });
    deptSel.addEventListener('change', (e) => { st.departmentId = e.target.value; loadList(); });
    $('#r-pos').addEventListener('change', (e) => { st.positionId = e.target.value; loadList(); });
    $('#r-req').addEventListener('change', (e) => { st.onlyRequired = e.target.checked; loadList(); });
    let tm; $('#r-q').addEventListener('input', (e) => { clearTimeout(tm); tm = setTimeout(() => { st.q = e.target.value; loadList(); }, 300); });
    const updSel = () => { $('#rec-sel').textContent = `Выбрано работников: ${st.selected.size}`; };

    async function loadList() {
      const box = $('#rec-list');
      const cid = Number(courseSel.value);
      if (!cid) { box.innerHTML = '<div class="empty">Выберите курс</div>'; return; }
      const p = { asOf: S.boot.today, siteId: st.siteId, departmentId: st.departmentId, positionId: st.positionId, q: st.q };
      let rows;
      if (st.onlyRequired) {
        const r = await call('statusList', Object.assign({}, p, { courseId: cid, page: 1, pageSize: 0, sort: 'due' }));
        rows = r.items.map((x) => ({ id: x.employeeId, fullName: x.fullName, tabNo: x.tabNo, departmentName: x.departmentName, positionName: x.positionName, status: x.status, validUntil: x.validUntil, lastDate: x.lastDate }));
      } else {
        const r = await call('employeesList', Object.assign({}, p, { state: 'active', page: 1, pageSize: 0 }));
        rows = r.items.map((x) => ({ id: x.id, fullName: x.fullName, tabNo: x.tabNo, departmentName: x.departmentName, positionName: x.positionName, status: null }));
      }
      // выбранные заранее (из плана или контроля сроков) показываем первыми
      rows.sort((a, b) => (st.selected.has(b.id) ? 1 : 0) - (st.selected.has(a.id) ? 1 : 0));
      $('#rec-count').textContent = `в списке ${n(rows.length)}`;
      const shown = rows.slice(0, 500);
      box.innerHTML = `<div class="table-wrap" style="max-height:480px"><table class="t"><thead><tr><th><input type="checkbox" id="r-all" aria-label="Выбрать всех"></th><th>Работник</th><th>Подразделение</th><th>Текущий статус</th><th>№ удостоверения (если есть)</th></tr></thead>
        <tbody>${shown.map((r) => `<tr><td><input type="checkbox" data-e="${r.id}" ${st.selected.has(r.id) ? 'checked' : ''}></td>
          <td>${esc(r.fullName)}<div class="muted small">таб. № ${esc(r.tabNo)} · ${esc(r.positionName)}</div></td><td>${esc(r.departmentName)}</td>
          <td>${r.status ? stBadge(r.status) + (r.validUntil ? `<div class="muted small">до ${d(r.validUntil)}</div>` : '') : '<span class="muted small">курс не обязателен</span>'}</td>
          <td><input type="text" data-cert="${r.id}" value="${esc(st.certs[r.id] || '')}" style="width:140px"></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Никого не найдено</td></tr>'}</tbody></table></div>
        ${rows.length > 500 ? '<div class="muted small" style="margin-top:6px">Показаны первые 500. Уточните фильтр.</div>' : ''}`;
      $$('[data-e]', box).forEach((cb) => cb.addEventListener('change', () => { const id = Number(cb.dataset.e); cb.checked ? st.selected.add(id) : st.selected.delete(id); updSel(); }));
      $$('[data-cert]', box).forEach((i) => i.addEventListener('input', () => { st.certs[i.dataset.cert] = i.value; }));
      $('#r-all').addEventListener('change', (e) => { $$('[data-e]', box).forEach((cb) => { cb.checked = e.target.checked; const id = Number(cb.dataset.e); cb.checked ? st.selected.add(id) : st.selected.delete(id); }); updSel(); });
      updSel();
    }
    await loadList();
    if (stale(token)) return;
    $('#rec-save').addEventListener('click', async () => {
      const f = formData($('#rec-form'));
      const c = courses.find((x) => x.id === Number(f.courseId));
      if (c && c.periodMonths && f.validUntil === C.addMonths(f.date, c.periodMonths)) f.validUntil = ''; // совпадает с расчётом: не храним вручную
      f.employees = Array.from(st.selected).map((id) => ({ id, certificateNo: st.certs[id] || '' }));
      try {
        const r = await call('trainingsAdd', f);
        toast(`Сохранено записей: ${r.created}` + (r.skipped ? `. Пропущено как дубли (та же дата и курс): ${r.skipped}` : ''));
        st.selected.clear(); st.certs = {};
        await loadList();
      } catch (e) { showError(e); }
    });
  };

  // ================= РАБОТНИКИ =================
  VIEWS.employees = async (root, token) => {
    const E = S.employees;
    const rerender = () => VIEWS.employees(root, ++S.renderToken);
    const data = await call('employeesList', Object.assign(filterParams(), { q: E.q, state: E.state, page: E.page, pageSize: 50, asOf: S.boot.today }));
    if (stale(token)) return;
    root.innerHTML = '';
    const extra = `<label class="grow">Поиск<input type="search" id="em-q" value="${esc(E.q)}" placeholder="ФИО или таб. №"></label>
      <label>Состояние<select id="em-state">${opt('active', 'Работают', E.state)}${opt('dismissed', 'Уволены / ещё не вышли', E.state)}${opt('all', 'Все', E.state)}</select></label>`;
    root.appendChild(filterBar(['site', 'department', 'position'], () => { E.page = 1; rerender(); }, extra));
    let tm; $('#em-q').addEventListener('input', (e) => { clearTimeout(tm); tm = setTimeout(() => { E.q = e.target.value; E.page = 1; rerender(); }, 350); });
    $('#em-state').addEventListener('change', (e) => { E.state = e.target.value; E.page = 1; rerender(); });
    if (user().canEdit) {
      $('#page-actions').innerHTML = `<button class="btn primary" id="em-add">Добавить работника</button>`;
      $('#em-add').addEventListener('click', () => editEmployee(null).then((id) => { if (id) location.hash = 'employee-' + id; }));
    }
    root.insertAdjacentHTML('beforeend', `<div class="table-wrap"><table class="t"><thead><tr><th>Работник</th><th>Таб. №</th><th>Подразделение</th><th>Должность</th><th>Принят</th><th>Обучение на сегодня</th></tr></thead>
      <tbody>${data.items.map((e) => `<tr class="click" data-emp="${e.id}"><td><a href="#employee-${e.id}">${esc(e.fullName)}</a>${!e.active ? ` <span class="pill">${e.dismissedAt ? 'уволен ' + d(e.dismissedAt) : 'выход ' + d(e.hireDate)}</span>` : ''}</td><td>${esc(e.tabNo)}</td>
        <td>${esc(e.departmentName)}<div class="muted small">${esc(e.siteName)}</div></td><td>${esc(e.positionName)}</td><td class="nowrap">${d(e.hireDate)}</td>
        <td>${e.active ? countsInline(e.counts) : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Никого не найдено</td></tr>'}</tbody></table></div>
      ${pager(data)}`);
    bindPager(root, (p) => { E.page = p; rerender(); });
    $$('[data-emp]', root).forEach((tr) => tr.addEventListener('click', (ev) => { if (ev.target.tagName !== 'A') location.hash = 'employee-' + tr.dataset.emp; }));
  };
  function countsInline(c) {
    if (!c.total) return '<span class="muted small">требований нет</span>';
    const parts = [];
    if (c.EXPIRED) parts.push(`<span class="st EXPIRED"><i>×</i>${c.EXPIRED}</span>`);
    if (c.NOT_COMPLETED) parts.push(`<span class="st NOT_COMPLETED"><i>○</i>${c.NOT_COMPLETED}</span>`);
    if (c.EXPIRING) parts.push(`<span class="st EXPIRING"><i>!</i>${c.EXPIRING}</span>`);
    if (!parts.length) parts.push(`<span class="st CURRENT"><i>✓</i>все ${c.total} в норме</span>`);
    return `<span data-tip="Действует: ${c.CURRENT}\nИстекает: ${c.EXPIRING}\nПросрочено: ${c.EXPIRED}\nНе пройдено: ${c.NOT_COMPLETED}">${parts.join(' ')}</span>`;
  }

  async function editEmployee(e) {
    const b = S.boot;
    const sites = user().isAdmin || !user().siteIds.length ? b.sites : b.sites.filter((s) => user().siteIds.includes(s.id));
    const v = e || { siteId: sites[0] && sites[0].id };
    return modal({
      title: e ? 'Изменить данные работника' : 'Новый работник',
      body: `<div class="form-grid">
        <label class="field wide"><span>ФИО</span><input type="text" name="fullName" value="${esc(v.fullName || '')}"></label>
        <label class="field"><span>Табельный номер</span><input type="text" name="tabNo" value="${esc(v.tabNo || '')}"></label>
        <label class="field"><span>Дата приёма</span><input type="date" name="hireDate" value="${esc(v.hireDate || b.today)}"></label>
        <label class="field"><span>Площадка</span><select name="siteId" id="ee-site">${sites.map((s) => opt(s.id, s.name, v.siteId)).join('')}</select></label>
        <label class="field"><span>Подразделение</span><select name="departmentId" id="ee-dept"></select></label>
        <label class="field wide"><span>Должность (профессия)</span><select name="positionId">${opt('', 'Выберите…', v.positionId)}${b.positions.map((p) => opt(p.id, p.name, v.positionId)).join('')}</select>
          <span class="hint">Обязательные курсы назначаются автоматически по должности. При переводе требования пересчитаются.</span></label>
        ${e ? `<label class="field"><span>Дата увольнения</span><input type="date" name="dismissedAt" value="${esc(v.dismissedAt || '')}"><span class="hint">Уволенные не учитываются в контроле с этой даты</span></label>` : ''}
        <label class="field wide"><span>Примечание</span><input type="text" name="note" value="${esc(v.note || '')}"></label></div>`,
      onOpen: (bk) => {
        const s = $('#ee-site', bk), dd = $('#ee-dept', bk);
        const fill = () => { dd.innerHTML = opt('', 'Выберите…', v.departmentId) + b.departments.filter((x) => x.siteId === Number(s.value)).map((x) => opt(x.id, x.name, v.departmentId)).join(''); };
        s.addEventListener('change', fill); fill();
      },
      onOk: async (bk) => {
        const f = formData(bk); if (e) f.id = e.id;
        const r = await call('employeeSave', f);
        toast('Данные работника сохранены');
        return r.id;
      }
    });
  }

  VIEWS.employee = async (root, token, r) => {
    const rerender = () => VIEWS.employee(root, ++S.renderToken, r);
    const data = await call('employeeGet', { id: r.id, asOf: S.F.asOf });
    if (stale(token)) return;
    const e = data.employee;
    $('#page-title').textContent = e.fullName;
    $('#page-sub').textContent = `таб. № ${e.tabNo} · ${e.positionName}`;
    const can = data.canEdit;
    if (can) {
      $('#page-actions').innerHTML = `<button class="btn" id="e-edit">Изменить данные</button><button class="btn primary" id="e-rec">Внести обучение</button>`;
      $('#e-edit').addEventListener('click', async () => { if (await editEmployee(e)) { S.boot = await call('bootstrap'); rerender(); } });
      $('#e-rec').addEventListener('click', () => addTrainingFor(e, null).then((ok) => ok && rerender()));
    }
    const c = C.emptyCounts(); data.requirements.forEach((x) => { c[x.status]++; c.total++; });
    const indivAvailable = S.boot.courses.filter((x) => x.active !== false && !data.requirements.some((q) => q.courseId === x.id));
    root.innerHTML = `
      <p><a href="#employees">← Все работники</a></p>
      ${!e.active ? `<div class="warn-box" style="margin-bottom:12px">${e.dismissedAt ? 'Уволен ' + d(e.dismissedAt) + '. В контроле сроков не учитывается.' : 'Выходит на работу ' + d(e.hireDate) + '.'}</div>` : ''}
      <div class="grid two">
        <div class="card"><h2>Данные</h2><dl class="kv">
          <dt>Площадка</dt><dd>${esc(e.siteName)}</dd><dt>Подразделение</dt><dd>${esc(e.departmentName)}</dd>
          <dt>Должность</dt><dd>${esc(e.positionName)}</dd><dt>Принят</dt><dd>${d(e.hireDate) || '<span class="muted">не указано</span>'}</dd>
          ${e.dismissedAt ? `<dt>Уволен</dt><dd>${d(e.dismissedAt)}</dd>` : ''}${e.note ? `<dt>Примечание</dt><dd>${esc(e.note)}</dd>` : ''}</dl></div>
        <div class="card"><h2>Обучение на ${d(S.F.asOf)}</h2>
          <div class="legend" style="gap:18px">${C.STATUS_ORDER.map((s) => `<span>${stBadge(s)} <b>${c[s]}</b></span>`).join('')}</div>
          <p class="muted small" style="margin-bottom:0">Обязательных курсов: ${c.total}. Из них по должности: ${data.requirements.filter((x) => x.source === 'position').length}, индивидуально: ${data.requirements.filter((x) => x.source === 'individual').length}.</p></div>
      </div>
      <div class="card" style="margin-top:14px"><div class="card-head"><h2>Обязательное обучение</h2>
        ${can && indivAvailable.length ? `<div class="btn-row"><select id="ind-course" style="max-width:360px">${opt('', 'Добавить индивидуальное требование…', '')}${indivAvailable.map((x) => opt(x.id, x.name, '')).join('')}</select><button class="btn sm" id="ind-add">Добавить</button></div>` : ''}</div>
        <div class="table-wrap"><table class="t"><thead><tr><th>Статус</th><th>Курс</th><th>Периодичность</th><th>Последнее</th><th>Действует до</th><th>Протокол</th><th>Основание</th>${can ? '<th></th>' : ''}</tr></thead>
        <tbody>${data.requirements.map((x) => `<tr><td>${stBadge(x.status)}</td><td>${esc(x.courseName)}</td><td class="nowrap">${periodText(x.periodMonths)}</td><td class="nowrap">${d(x.lastDate) || '<span class="muted">нет</span>'}</td>
          <td class="nowrap">${x.validUntil ? d(x.validUntil) : (x.lastDate ? '<span class="muted">бессрочно</span>' : '')}${x.daysLeft !== null && x.daysLeft >= 0 && x.status !== 'CURRENT' ? `<div class="muted small">через ${x.daysLeft} дн.</div>` : ''}</td>
          <td>${esc(x.protocolNo)}</td><td>${x.source === 'individual' ? `индивидуально${can ? ` <button class="link-btn small" data-unind="${x.courseId}">снять</button>` : ''}` : 'по должности'}</td>
          ${can ? `<td><button class="btn sm" data-rec="${x.courseId}">Внести</button></td>` : ''}</tr>`).join('') || `<tr><td colspan="8" class="empty">Для должности не заданы обязательные курсы</td></tr>`}</tbody></table></div></div>
      <div class="card"><div class="card-head"><h2>История обучения</h2><span class="muted small">все записи, включая необязательные и прошлые циклы</span></div>
        <div class="table-wrap"><table class="t"><thead><tr><th>Дата</th><th>Курс</th><th>Действует до</th><th>Протокол</th><th>Удостоверение</th><th>Кем проведено</th><th>Внёс</th>${can ? '<th></th>' : ''}</tr></thead>
        <tbody>${data.trainings.map((t) => `<tr><td class="nowrap">${d(t.date)}</td><td>${esc(t.courseName)}${t.note ? `<div class="muted small">${esc(t.note)}</div>` : ''}</td>
          <td class="nowrap">${t.validUntilCalc ? d(t.validUntilCalc) : '<span class="muted">бессрочно</span>'}${t.validUntil ? ' <span class="pill" data-tip="Срок указан вручную">вручную</span>' : ''}</td>
          <td>${esc(t.protocolNo)}</td><td>${esc(t.certificateNo)}</td><td>${esc(t.provider)}</td><td class="small muted">${esc(t.createdBy || '')}</td>
          ${can ? `<td class="nowrap"><button class="btn sm ghost" data-tedit="${t.id}">Изменить</button><button class="btn sm ghost" data-tdel="${t.id}" style="color:var(--critical)">Удалить</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="8" class="empty">Записей нет</td></tr>'}</tbody></table></div></div>`;
    if (!can) return;
    $$('[data-rec]', root).forEach((b) => b.addEventListener('click', () => addTrainingFor(e, Number(b.dataset.rec)).then((ok) => ok && rerender())));
    $$('[data-unind]', root).forEach((b) => b.addEventListener('click', async () => {
      try { await call('individualRequirementSet', { employeeId: e.id, courseId: Number(b.dataset.unind), on: false }); toast('Требование снято'); rerender(); } catch (er) { showError(er); }
    }));
    if ($('#ind-add')) $('#ind-add').addEventListener('click', async () => {
      const cid = Number($('#ind-course').value); if (!cid) return;
      try { await call('individualRequirementSet', { employeeId: e.id, courseId: cid, on: true }); toast('Индивидуальное требование добавлено'); rerender(); } catch (er) { showError(er); }
    });
    $$('[data-tdel]', root).forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmBox('Удалить запись обучения', 'Запись будет удалена, статус пересчитается. Действие попадёт в журнал изменений.'))) return;
      try { await call('trainingDelete', { id: Number(b.dataset.tdel) }); toast('Запись удалена'); rerender(); } catch (er) { showError(er); }
    }));
    $$('[data-tedit]', root).forEach((b) => b.addEventListener('click', () => {
      const t = data.trainings.find((x) => x.id === Number(b.dataset.tedit));
      trainingForm(e, t).then((ok) => ok && rerender());
    }));
  };

  function trainingFields(t, courseId) {
    const courses = S.boot.courses.filter((c) => c.active !== false || (t && c.id === t.courseId));
    return `<div class="form-grid">
      <label class="field wide"><span>Курс</span><select name="courseId" data-course>${opt('', 'Выберите…', courseId)}${courses.map((c) => opt(c.id, (c.code ? c.code + '. ' : '') + c.name, courseId)).join('')}</select></label>
      <label class="field"><span>Дата обучения / проверки</span><input type="date" name="date" value="${esc(t ? t.date : S.boot.today)}"></label>
      <label class="field"><span>Действует до (вручную)</span><input type="date" name="validUntil" value="${esc(t && t.validUntil ? t.validUntil : '')}"><span class="hint" data-hint>пусто: по периодичности курса</span></label>
      <label class="field"><span>№ протокола</span><input type="text" name="protocolNo" value="${esc(t ? t.protocolNo : '')}"></label>
      <label class="field"><span>№ удостоверения</span><input type="text" name="certificateNo" value="${esc(t ? t.certificateNo : '')}"></label>
      <label class="field wide"><span>Кем проведено</span><input type="text" name="provider" value="${esc(t ? t.provider : '')}"></label>
      <label class="field wide"><span>Примечание</span><input type="text" name="note" value="${esc(t ? t.note : '')}"></label></div>`;
  }
  function bindTrainingHint(bk) {
    const cs = $('[data-course]', bk), di = $('[name=date]', bk), h = $('[data-hint]', bk);
    const upd = () => {
      const c = S.boot.courses.find((x) => x.id === Number(cs.value));
      h.textContent = !c ? 'пусто: по периодичности курса' : c.periodMonths ? `пусто: по периодичности, до ${d(C.addMonths(di.value, c.periodMonths)) || '…'}` : 'курс однократный, срок не ограничен';
    };
    cs.addEventListener('change', upd); di.addEventListener('change', upd); upd();
  }
  function addTrainingFor(e, courseId) {
    return modal({
      title: 'Внести обучение: ' + e.fullName, body: trainingFields(null, courseId || ''), onOpen: bindTrainingHint,
      onOk: async (bk) => { const f = formData(bk); f.employees = [{ id: e.id, certificateNo: f.certificateNo }]; const r = await call('trainingsAdd', f); toast(r.created ? 'Запись добавлена' : 'Такая запись уже есть'); }
    });
  }
  function trainingForm(e, t) {
    return modal({
      title: 'Изменить запись обучения', body: trainingFields(t, t.courseId), onOpen: bindTrainingHint,
      onOk: async (bk) => { const f = formData(bk); f.id = t.id; await call('trainingUpdate', f); toast('Запись изменена'); }
    });
  }

  // ================= КУРСЫ И ТРЕБОВАНИЯ =================
  VIEWS.courses = async (root, token) => {
    let tab = S.coursesTab || 'courses';
    const rerender = () => VIEWS.courses(root, ++S.renderToken);
    const can = user().canEditCatalog;
    root.innerHTML = `<div class="tabs"><button data-tab="courses" class="${tab === 'courses' ? 'on' : ''}">Курсы</button><button data-tab="req" class="${tab === 'req' ? 'on' : ''}">Требования по должностям</button></div><div id="tab-body"><div class="spinner">Загрузка…</div></div>`;
    $$('[data-tab]', root).forEach((b) => b.addEventListener('click', () => { S.coursesTab = b.dataset.tab; rerender(); }));
    const body = $('#tab-body');
    if (tab === 'courses') {
      const list = await call('coursesList');
      if (stale(token)) return;
      if (can) { $('#page-actions').innerHTML = `<button class="btn primary" id="c-add">Добавить курс</button>`; $('#c-add').addEventListener('click', () => editCourse(null).then((ok) => ok && reloadBoot().then(rerender))); }
      body.innerHTML = `<div class="info-box" style="margin-bottom:12px">Периодичность определяет, когда истекает срок: дата обучения + N месяцев. Пустая периодичность: однократное обучение без срока. Значения в демо-данных примерные: перед запуском сверьте их с нормативными документами предприятия.</div>
        <div class="table-wrap"><table class="t"><thead><tr><th>Код</th><th>Курс</th><th>Категория</th><th>Периодичность</th><th>Основание</th><th class="num">Часов</th><th class="num">Должностей</th><th class="num">Записей</th><th>Действует</th></tr></thead>
        <tbody>${list.map((c) => `<tr class="${can ? 'click' : ''}" data-c="${c.id}"><td class="nowrap">${esc(c.code)}</td><td>${esc(c.name)}</td><td>${esc(c.category)}</td><td class="nowrap">${periodText(c.periodMonths)}</td><td>${esc(c.basis)}</td>
          <td class="num">${c.hours || ''}</td><td class="num">${c.positionsCount}</td><td class="num">${n(c.trainingsCount)}</td><td>${c.active !== false ? 'да' : '<span class="pill">нет</span>'}</td></tr>`).join('')}</tbody></table></div>`;
      if (can) $$('[data-c]', body).forEach((tr) => tr.addEventListener('click', () => editCourse(list.find((x) => x.id === Number(tr.dataset.c))).then((ok) => ok && reloadBoot().then(rerender))));
    } else {
      const R = await call('requirementsGet');
      if (stale(token)) return;
      const has = new Set(R.pairs.map((p) => p[0] + ':' + p[1]));
      body.innerHTML = `<div class="info-box" style="margin-bottom:12px">Отметьте, какие курсы обязательны для каждой должности. Изменение сразу применяется ко всем работникам этой должности.${can ? '' : ' У вашей роли режим просмотра.'}</div>
        <div class="matrix-wrap"><table class="mx"><thead><tr><th class="name">Должность</th>${R.courses.map((c) => `<th class="v" data-tip="${esc(c.name)}\n${esc(periodText(c.periodMonths))}"><div>${esc(c.code || '')} ${esc(c.name)}</div></th>`).join('')}</tr></thead>
        <tbody>${R.positions.map((p) => `<tr><td class="name">${esc(p.name)}<div class="muted small">работников: ${p.employees}</div></td>${R.courses.map((c) => `<td class="c"><input type="checkbox" data-pc="${p.id}:${c.id}" ${has.has(p.id + ':' + c.id) ? 'checked' : ''} ${can ? '' : 'disabled'} aria-label="${esc(p.name + ': ' + c.name)}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      $$('[data-pc]', body).forEach((cb) => cb.addEventListener('change', async () => {
        const [pid, cid] = cb.dataset.pc.split(':').map(Number);
        try { await call('requirementSet', { positionId: pid, courseId: cid, on: cb.checked }); toast(cb.checked ? 'Требование добавлено' : 'Требование снято'); }
        catch (e) { cb.checked = !cb.checked; showError(e); }
      }));
    }
  };
  async function reloadBoot() { S.boot = await call('bootstrap'); }

  function editCourse(c) {
    const v = c || { active: true };
    return modal({
      title: c ? 'Курс: ' + c.name : 'Новый курс',
      body: `<div class="form-grid">
        <label class="field wide"><span>Название</span><input type="text" name="name" value="${esc(v.name || '')}"></label>
        <label class="field"><span>Код (для импорта и отчётов)</span><input type="text" name="code" value="${esc(v.code || '')}"></label>
        <label class="field"><span>Категория</span><input type="text" name="category" list="cats" value="${esc(v.category || '')}"><datalist id="cats">${S.boot.categories.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></label>
        <label class="field"><span>Периодичность, месяцев</span><input type="number" min="0" max="240" name="periodMonths" value="${esc(v.periodMonths || '')}"><span class="hint">пусто или 0: однократно</span></label>
        <label class="field"><span>Объём, часов</span><input type="number" min="0" name="hours" value="${esc(v.hours || '')}"></label>
        <label class="field wide"><span>Основание (нормативный документ)</span><input type="text" name="basis" value="${esc(v.basis || '')}"></label>
        <label class="check"><input type="checkbox" name="active" ${v.active !== false ? 'checked' : ''}> Действует (учитывается в контроле)</label></div>
        ${c && c.trainingsCount === 0 && user().canEdit ? '<p style="margin-top:14px"><button class="btn danger sm" data-del>Удалить курс</button></p>' : ''}`,
      onOpen: (bk, close) => {
        const del = $('[data-del]', bk);
        if (del) del.addEventListener('click', async () => {
          try { await call('courseDelete', { id: c.id }); toast('Курс удалён'); close(true); } catch (e) { showError(e); }
        });
      },
      onOk: async (bk) => { const f = formData(bk); if (c) f.id = c.id; await call('courseSave', f); toast('Курс сохранён'); }
    });
  }

  // ================= ОРГСТРУКТУРА =================
  VIEWS.org = async (root, token) => {
    const rerender = async () => { await reloadBoot(); VIEWS.org(root, ++S.renderToken); };
    const b = S.boot, can = user().canEdit, isAdmin = user().isAdmin;
    const counts = await call('employeesList', { state: 'active', page: 1, pageSize: 0 });
    if (stale(token)) return;
    const cnt = { site: {}, department: {}, position: {} };
    counts.items.forEach((e) => { cnt.site[e.siteId] = (cnt.site[e.siteId] || 0) + 1; cnt.department[e.departmentId] = (cnt.department[e.departmentId] || 0) + 1; cnt.position[e.positionId] = (cnt.position[e.positionId] || 0) + 1; });
    const row = (kind, x, extra) => `<tr><td>${esc(x.name)}${extra || ''}</td><td class="num">${n(cnt[kind][x.id] || 0)}</td>
      ${can && (kind !== 'position' || user().canEditCatalog) && (kind !== 'department' || isAdmin || !user().siteIds.length || user().siteIds.includes(x.siteId)) ? `<td class="nowrap num"><button class="btn sm ghost" data-ren="${kind}:${x.id}">Переименовать</button><button class="btn sm ghost" data-del="${kind}:${x.id}" style="color:var(--critical)">Удалить</button></td>` : '<td></td>'}</tr>`;
    root.innerHTML = `<div class="grid two">
      <div><div class="card"><div class="card-head"><h2>Площадки и подразделения</h2>${isAdmin ? '<button class="btn sm" data-add="site">Добавить площадку</button>' : ''}</div>
        ${b.sites.map((s) => `<h3 style="margin-top:14px">${esc(s.name)} <span class="muted" style="text-transform:none;font-weight:400">· работников ${n(cnt.site[s.id] || 0)}</span>
          ${isAdmin ? `<button class="btn sm ghost" data-ren="site:${s.id}">Переименовать</button><button class="btn sm ghost" data-del="site:${s.id}" style="color:var(--critical)">Удалить</button>` : ''}</h3>
          <table class="t"><thead><tr><th>Подразделение</th><th class="num">Работников</th><th></th></tr></thead><tbody>${b.departments.filter((x) => x.siteId === s.id).map((x) => row('department', x)).join('') || '<tr><td colspan="3" class="muted">Нет подразделений</td></tr>'}</tbody></table>
          ${can ? `<button class="btn sm" style="margin-top:6px" data-add="department:${s.id}">Добавить подразделение</button>` : ''}`).join('')}</div></div>
      <div class="card"><div class="card-head"><h2>Должности (профессии)</h2>${user().canEditCatalog ? '<button class="btn sm" data-add="position">Добавить должность</button>' : ''}</div>
        <table class="t"><thead><tr><th>Должность</th><th class="num">Работников</th><th></th></tr></thead><tbody>${b.positions.map((x) => row('position', x)).join('')}</tbody></table></div></div>`;
    const ask = (title, val) => modal({ title, body: `<label class="field"><span>Название</span><input type="text" name="name" value="${esc(val || '')}"></label>`, onOk: (bk) => formData(bk).name });
    $$('[data-add]', root).forEach((btn) => btn.addEventListener('click', async () => {
      const [kind, siteId] = btn.dataset.add.split(':');
      const name = await ask('Добавить: ' + { site: 'площадка', department: 'подразделение', position: 'должность' }[kind]);
      if (!name) return;
      try { await call('refSave', { kind, name, siteId }); toast('Добавлено'); rerender(); } catch (e) { showError(e); }
    }));
    $$('[data-ren]', root).forEach((btn) => btn.addEventListener('click', async () => {
      const [kind, id] = btn.dataset.ren.split(':');
      const list = { site: b.sites, department: b.departments, position: b.positions }[kind];
      const x = list.find((y) => y.id === Number(id));
      const name = await ask('Переименовать', x.name);
      if (!name) return;
      try { await call('refSave', { kind, id: x.id, name, siteId: x.siteId }); toast('Сохранено'); rerender(); } catch (e) { showError(e); }
    }));
    $$('[data-del]', root).forEach((btn) => btn.addEventListener('click', async () => {
      const [kind, id] = btn.dataset.del.split(':');
      if (!(await confirmBox('Удалить запись', 'Удалить можно только запись без работников.'))) return;
      try { await call('refDelete', { kind, id: Number(id) }); toast('Удалено'); rerender(); } catch (e) { showError(e); }
    }));
  };

  // ================= ИМПОРТ И ВЫГРУЗКА =================
  VIEWS.import = async (root) => {
    const can = user().canEdit;
    root.innerHTML = `
      ${can ? `<div class="grid two">
        <div class="card"><h2>Импорт работников</h2>
          <p class="muted">Колонки: Таб. №, ФИО, Площадка, Подразделение, Должность, Дата приёма, Дата увольнения. Работник с существующим табельным номером обновляется. Новые подразделения и должности создаются автоматически.</p>
          <div class="btn-row"><button class="btn sm" data-tpl="employees">Скачать шаблон</button><label class="btn sm primary" style="color:#fff">Выбрать файл .xlsx<input type="file" accept=".xlsx" data-imp="employees" class="hidden"></label></div></div>
        <div class="card"><h2>Импорт записей обучения</h2>
          <p class="muted">Колонки: Таб. №, Курс (код или точное название), Дата обучения, Действует до (необязательно), № протокола, № удостоверения, Кем проведено. Повторы (тот же работник, курс и дата) пропускаются.</p>
          <div class="btn-row"><button class="btn sm" data-tpl="trainings">Скачать шаблон</button><label class="btn sm primary" style="color:#fff">Выбрать файл .xlsx<input type="file" accept=".xlsx" data-imp="trainings" class="hidden"></label></div></div>
      </div>
      <div id="imp-result"></div>
      <div class="info-box" style="margin-top:14px">Порядок переноса из текущей Excel-таблицы: 1) курсы и периодичность в разделе «Курсы и требования»; 2) обязательные курсы по должностям; 3) импорт работников; 4) импорт истории обучения (достаточно последней записи по каждому курсу).</div>` : ''}
      <div class="card" style="margin-top:14px"><h2>Выгрузка</h2>
        <p class="muted">Отчёты в Excel также доступны кнопками на страницах «Дашборд», «Контроль сроков», «Матрица» и «План». Здесь можно выгрузить полные данные.</p>
        <div class="btn-row"><button class="btn" id="x-status">Реестр всех обязательных обучений</button><button class="btn" id="x-hist">Вся история обучения</button>
        ${user().isAdmin ? '<button class="btn" id="x-backup">Резервная копия (JSON)</button>' : ''}</div></div>`;
    $$('[data-tpl]', root).forEach((b) => b.addEventListener('click', () => downloadTemplate(b.dataset.tpl).catch(showError)));
    $$('[data-imp]', root).forEach((inp) => inp.addEventListener('change', async () => {
      const file = inp.files[0]; inp.value = '';
      if (file) importFile(inp.dataset.imp, file).catch(showError);
    }));
    $('#x-status').addEventListener('click', async () => {
      try { const all = await call('statusList', { asOf: S.boot.today, page: 1, pageSize: 0, sort: 'name' }); await exportXlsx('Реестр_обучения_' + S.boot.today + '.xlsx', [{ name: 'Реестр', title: 'Реестр обязательного обучения на ' + d(S.boot.today), freezeCols: 2, columns: statusColumns(), rows: all.items }]); } catch (e) { showError(e); }
    });
    $('#x-hist').addEventListener('click', async () => {
      try {
        const rows = await call('trainingsAll');
        await exportXlsx('История_обучения_' + S.boot.today + '.xlsx', [{ name: 'История', freezeCols: 2, columns: [
          { header: 'Таб. №', key: 'tabNo', width: 10 }, { header: 'ФИО', key: 'fullName', width: 34 }, { header: 'Подразделение', key: 'departmentName', width: 30 },
          { header: 'Код курса', key: 'courseCode', width: 10 }, { header: 'Курс', key: 'courseName', width: 50 }, { header: 'Дата обучения', key: 'date', type: 'date', width: 14 },
          { header: 'Действует до', key: 'validUntilCalc', type: 'date', width: 14 }, { header: '№ протокола', key: 'protocolNo', width: 14 }, { header: '№ удостоверения', key: 'certificateNo', width: 16 },
          { header: 'Кем проведено', key: 'provider', width: 30 }, { header: 'Примечание', key: 'note', width: 20 }], rows }]);
      } catch (e) { showError(e); }
    });
    if ($('#x-backup')) $('#x-backup').addEventListener('click', async () => {
      try { const o = await call('backupExport'); await API.saveFile('training-control-backup-' + S.boot.today + '.json', new Blob([JSON.stringify(o)], { type: 'application/json' })); } catch (e) { showError(e); }
    });
  };

  async function downloadTemplate(kind) {
    if (kind === 'employees') {
      await exportXlsx('Шаблон_работники.xlsx', [{ name: 'Работники', columns: [
        { header: 'Таб. №', key: 'a', width: 10 }, { header: 'ФИО', key: 'b', width: 34 }, { header: 'Площадка', key: 'c', width: 24 }, { header: 'Подразделение', key: 'd', width: 30 },
        { header: 'Должность', key: 'e', width: 34 }, { header: 'Дата приёма', key: 'f', width: 14, type: 'date' }, { header: 'Дата увольнения', key: 'g', width: 14, type: 'date' }],
        rows: [{ a: '12345', b: 'Иванов Иван Иванович', c: S.boot.sites[0] ? S.boot.sites[0].name : 'Площадка', d: 'Ремонтно-механический цех', e: 'Слесарь-ремонтник', f: '2023-03-15' }] }]);
    } else {
      await exportXlsx('Шаблон_обучение.xlsx', [
        { name: 'Обучение', columns: [{ header: 'Таб. №', key: 'a', width: 10 }, { header: 'Курс (код или название)', key: 'b', width: 40 }, { header: 'Дата обучения', key: 'c', width: 14, type: 'date' },
          { header: 'Действует до', key: 'd', width: 14, type: 'date' }, { header: '№ протокола', key: 'e', width: 14 }, { header: '№ удостоверения', key: 'f', width: 16 }, { header: 'Кем проведено', key: 'g', width: 30 }],
          rows: [{ a: '12345', b: S.boot.courses[0] ? (S.boot.courses[0].code || S.boot.courses[0].name) : 'OT-A', c: S.boot.today, e: '125/26', g: 'Учебный центр предприятия' }] },
        { name: 'Справочник курсов', columns: [{ header: 'Код', key: 'code', width: 10 }, { header: 'Название', key: 'name', width: 60 }, { header: 'Периодичность', width: 16, value: (c) => periodText(c.periodMonths) }], rows: S.boot.courses }
      ]);
    }
  }

  async function importFile(kind, file) {
    const box = $('#imp-result');
    box.innerHTML = '<div class="card" style="margin-top:14px"><div class="spinner">Читаю файл…</div></div>';
    const parsed = await readXlsx(file);
    const m = mapRows(kind, parsed);
    const required = kind === 'employees' ? ['tabNo', 'fullName', 'site', 'department', 'position'] : ['tabNo', 'course', 'date'];
    const LABEL = { tabNo: 'Таб. №', fullName: 'ФИО', site: 'Площадка', department: 'Подразделение', position: 'Должность', hireDate: 'Дата приёма', dismissedAt: 'Дата увольнения', course: 'Курс', date: 'Дата обучения', validUntil: 'Действует до', protocolNo: '№ протокола', certificateNo: '№ удостоверения', provider: 'Кем проведено' };
    const miss = required.filter((f) => !m.colFor[f]);
    const fields = Object.keys(m.colFor);
    box.innerHTML = `<div class="card" style="margin-top:14px"><div class="card-head"><h2>Проверка файла «${esc(file.name)}»</h2><span class="muted">строк с данными: ${n(m.rows.length)}</span></div>
      ${miss.length ? `<div class="err-box">Не найдены обязательные колонки: ${miss.map((f) => LABEL[f]).join(', ')}. Проверьте заголовки или используйте шаблон.</div>` : `<p class="muted">Распознаны колонки: ${fields.map((f) => `${LABEL[f]} ← «${esc(m.colFor[f])}»`).join('; ')}</p>`}
      <div class="table-wrap" style="max-height:300px"><table class="t"><thead><tr><th>Строка</th>${fields.map((f) => `<th>${LABEL[f]}</th>`).join('')}</tr></thead>
      <tbody>${m.rows.slice(0, 10).map((r) => `<tr><td class="muted">${r._line}</td>${fields.map((f) => `<td>${esc(r[f] instanceof Date ? d(C.normalizeDate(r[f])) : (/date|At|validUntil/.test(f) && C.isValidISO(String(r[f]).slice(0, 10)) ? d(r[f]) : r[f]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${m.rows.length > 10 ? `<p class="muted small">Показаны первые 10 строк.</p>` : ''}
      <div class="btn-row" style="margin-top:10px"><button class="btn primary" id="imp-go" ${miss.length || !m.rows.length ? 'disabled' : ''}>Загрузить ${n(m.rows.length)} строк</button><button class="btn" id="imp-cancel">Отмена</button></div></div>`;
    $('#imp-cancel').addEventListener('click', () => { box.innerHTML = ''; });
    $('#imp-go').addEventListener('click', async () => {
      $('#imp-go').disabled = true; $('#imp-go').textContent = 'Загружаю…';
      try {
        const res = await call(kind === 'employees' ? 'importEmployees' : 'importTrainings', { rows: m.rows });
        if (kind === 'employees') await reloadBoot();
        box.innerHTML = `<div class="card" style="margin-top:14px"><h2>Результат импорта</h2>
          <p>${kind === 'employees' ? `Добавлено: <b>${res.created}</b>, обновлено: <b>${res.updated}</b>, без изменений: ${res.unchanged}` : `Добавлено записей: <b>${res.created}</b>, пропущено повторов: ${res.duplicates}`}. Ошибок: <b>${res.errors.length}</b>.</p>
          ${res.createdRefs && res.createdRefs.length ? `<p class="muted">Созданы в справочниках: ${esc(res.createdRefs.join(', '))}</p>` : ''}
          ${res.errors.length ? `<div class="table-wrap" style="max-height:300px"><table class="t"><thead><tr><th>Строка</th><th>Ошибка</th></tr></thead><tbody>${res.errors.map((e) => `<tr><td>${e.line}</td><td>${esc(e.message)}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>`;
      } catch (e) { showError(e); $('#imp-go').disabled = false; }
    });
  }

  // ================= ЖУРНАЛ =================
  VIEWS.audit = async (root, token) => {
    const A = S.audit;
    const rerender = () => VIEWS.audit(root, ++S.renderToken);
    const data = await call('auditList', { q: A.q, page: A.page, pageSize: 50 });
    if (stale(token)) return;
    root.innerHTML = `<div class="filters"><label class="grow">Поиск по описанию или пользователю<input type="search" id="au-q" value="${esc(A.q)}"></label></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>Когда</th><th>Пользователь</th><th>Что сделано</th></tr></thead>
      <tbody>${data.items.map((a) => `<tr><td class="nowrap">${esc(new Date(a.ts).toLocaleString('ru-RU'))}</td><td>${esc(a.userName)}<div class="muted small">${esc(a.userLogin)}</div></td><td>${esc(a.summary)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Изменений пока не было</td></tr>'}</tbody></table></div>${pager(data)}`;
    bindPager(root, (p) => { A.page = p; rerender(); });
    let tm; $('#au-q').addEventListener('input', (e) => { clearTimeout(tm); tm = setTimeout(() => { A.q = e.target.value; A.page = 1; rerender(); }, 350); });
  };

  // ================= АДМИНИСТРИРОВАНИЕ =================
  VIEWS.admin = async (root, token) => {
    if (!user().isAdmin) { root.innerHTML = '<div class="warn-box">Раздел доступен администратору</div>'; return; }
    const rerender = () => VIEWS.admin(root, ++S.renderToken);
    const users = await call('usersList');
    if (stale(token)) return;
    const s = S.boot.settings, b = S.boot;
    const scope = (u) => {
      if (u.role === 'admin' || u.role === 'viewer') return 'всё предприятие';
      if (u.departmentIds.length) return u.departmentIds.map((id) => (b.departments.find((x) => x.id === id) || {}).name).join(', ');
      if (u.siteIds.length) return u.siteIds.map((id) => (b.sites.find((x) => x.id === id) || {}).name).join(', ');
      return 'всё предприятие';
    };
    root.innerHTML = `<div class="grid two">
      <div class="card"><div class="card-head"><h2>Пользователи</h2>${API.mode === 'server' ? '<button class="btn sm primary" id="u-add">Добавить</button>' : ''}</div>
        ${API.mode === 'demo' ? '<div class="info-box" style="margin-bottom:10px">В демо-версии пользователи фиксированы, переключение в левом меню. В серверной версии здесь создаются учётные записи с паролями.</div>' : ''}
        <table class="t"><thead><tr><th>Пользователь</th><th>Роль</th><th>Зона</th></tr></thead><tbody>${users.map((u) => `<tr class="${API.mode === 'server' ? 'click' : ''}" data-u="${u.id}"><td>${esc(u.fullName)}<div class="muted small">${esc(u.login)}${u.active ? '' : ' · отключён'}</div></td><td>${esc((b.roles.find((r) => r.id === u.role) || {}).label)}</td><td class="small">${esc(scope(u))}</td></tr>`).join('')}</tbody></table>
        <h3 style="margin-top:16px">Роли</h3>
        <dl class="kv small"><dt>Администратор</dt><dd>всё, включая пользователей, настройки и площадки</dd>
          <dt>Ответственный за обучение</dt><dd>вносит и меняет данные по своим площадкам (или по всему предприятию)</dd>
          <dt>Руководитель подразделения</dt><dd>только просмотр своих подразделений или площадок</dd>
          <dt>Наблюдатель</dt><dd>просмотр всего предприятия без изменений (например, служба ОТ, аудит)</dd></dl></div>
      <div class="card"><h2>Настройки</h2><div class="form-grid" id="set-form">
        <label class="field wide"><span>Название организации</span><input type="text" name="orgName" value="${esc(s.orgName)}"></label>
        <label class="field"><span>«Истекает»: за сколько дней до окончания срока</span><input type="number" min="1" max="365" name="expiringDays" value="${esc(s.expiringDays)}"></label></div>
        <div class="btn-row" style="margin-top:12px"><button class="btn primary" id="set-save">Сохранить</button></div></div></div>`;
    $('#set-save').addEventListener('click', async () => {
      try { await call('settingsSave', formData($('#set-form'))); await reloadBoot(); toast('Настройки сохранены'); shell(); route(); } catch (e) { showError(e); }
    });
    if (API.mode === 'server') {
      $('#u-add').addEventListener('click', () => editUser(null).then((ok) => ok && rerender()));
      $$('[data-u]', root).forEach((tr) => tr.addEventListener('click', () => editUser(users.find((u) => u.id === Number(tr.dataset.u))).then((ok) => ok && rerender())));
    }
  };
  function editUser(u) {
    const b = S.boot, v = u || { role: 'trainer', siteIds: [], departmentIds: [], active: true };
    return modal({
      title: u ? 'Пользователь ' + u.login : 'Новый пользователь', wide: true,
      body: `<div class="form-grid">
        <label class="field"><span>Логин</span><input type="text" name="login" value="${esc(v.login || '')}" autocomplete="off"></label>
        <label class="field"><span>ФИО</span><input type="text" name="fullName" value="${esc(v.fullName || '')}"></label>
        <label class="field"><span>Роль</span><select name="role">${b.roles.map((r) => opt(r.id, r.label, v.role)).join('')}</select></label>
        <label class="field"><span>${u ? 'Новый пароль (пусто: не менять)' : 'Пароль (не короче 8 символов)'}</span><input type="password" name="password" autocomplete="new-password"></label>
        <label class="check"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}> Учётная запись активна</label></div>
        <h3 style="margin-top:16px">Зона ответственности</h3><p class="muted small">Для ответственного: площадки, где он вносит данные (ничего не отмечено: все). Для руководителя: подразделения или площадки, которые он видит.</p>
        <div class="grid two"><div><b class="small">Площадки</b>${b.sites.map((s) => `<div><label class="check"><input type="checkbox" data-site="${s.id}" ${v.siteIds.includes(s.id) ? 'checked' : ''}> ${esc(s.name)}</label></div>`).join('')}</div>
        <div><b class="small">Подразделения</b><div style="max-height:220px;overflow:auto">${b.departments.map((x) => `<div><label class="check"><input type="checkbox" data-dept="${x.id}" ${v.departmentIds.includes(x.id) ? 'checked' : ''}> ${esc(x.name)} <span class="muted small">${esc((b.sites.find((s) => s.id === x.siteId) || {}).name)}</span></label></div>`).join('')}</div></div></div>`,
      onOk: async (bk) => {
        const f = formData(bk);
        f.siteIds = $$('[data-site]', bk).filter((c) => c.checked).map((c) => Number(c.dataset.site));
        f.departmentIds = $$('[data-dept]', bk).filter((c) => c.checked).map((c) => Number(c.dataset.dept));
        if (u) f.id = u.id;
        await call('userSave', f); toast('Пользователь сохранён');
      }
    });
  }

  // ---------------- запуск ----------------
  function loginScreen(msg) {
    document.body.innerHTML = `<div class="login-wrap"><form class="card login-card" id="login-form"><h1 style="margin-bottom:4px">Контроль обучения</h1><p class="muted" style="margin-top:0">Вход в систему</p>
      ${msg ? `<div class="err-box" style="margin-bottom:10px">${esc(msg)}</div>` : ''}
      <label class="field"><span>Логин</span><input type="text" name="login" autocomplete="username"></label>
      <label class="field" style="margin-top:10px"><span>Пароль</span><input type="password" name="password" autocomplete="current-password"></label>
      <button class="btn primary" style="margin-top:14px;width:100%;justify-content:center">Войти</button></form></div>`;
    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      try { await API.login(f.login, f.password); await start(); } catch (er) { loginScreen(er.message); }
    });
    $('[name=login]').focus();
  }

  async function reboot() {
    S.boot = await call('bootstrap');
    if (!S.F.asOf) S.F.asOf = S.boot.today;
    Object.assign(S.F, { siteId: '', departmentId: '' });
    shell();
    if (!document.querySelector(`[data-nav="${parseHash().page}"]`) && parseHash().page !== 'employee') location.hash = 'dashboard';
    route();
  }
  async function start() {
    try {
      await reboot();
    } catch (e) {
      if (e.status === 401) return loginScreen();
      document.body.innerHTML = `<div class="login-wrap"><div class="err-box">${esc(e.message)}</div></div>`;
    }
  }
  window.addEventListener('hashchange', () => { if (S.boot) route(); });
  start();
})();
