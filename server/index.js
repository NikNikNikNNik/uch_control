'use strict';
/*
 * Сервер «Контроль обучения персонала».
 * Запуск: npm start  (переменные окружения см. в .env.example и README.md)
 */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { connect, createDbRepo } = require('./db');
const { createService } = require('../shared/service.js');
const Seed = require('../shared/seed.js');

const PORT = Number(process.env.PORT || 3000);
const COOKIE = 'tc_session';
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);
let JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET;
if (!JWT_SECRET) {
  JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[!] JWT_SECRET не задан: сгенерирован временный ключ, после перезапуска всем придётся войти заново.');
}

async function main() {
  const knex = connect();
  const repo = await createDbRepo(knex);

  // Первичное наполнение
  if (!repo.tables.sites.length && /^(1|true|yes)$/i.test(process.env.SEED_DEMO || '')) {
    console.log('База пустая, загружаю демонстрационные данные...');
    const data = Seed.generate({});
    await repo.bulkLoad(data);
    console.log(`Загружено: работников ${data.employees.length}, записей обучения ${data.trainings.length}`);
  }
  if (!repo.tables.users.length) {
    const login = (process.env.ADMIN_LOGIN || 'admin').toLowerCase();
    let password = process.env.ADMIN_PASSWORD;
    if (!password) {
      throw new Error('Добавьте ADMIN_PASSWORD в Secrets для создания администратора.');
    }
    await repo.insert('users', { login, fullName: 'Администратор', role: 'admin', passwordHash: await bcrypt.hash(password, 10), siteIds: [], departmentIds: [], active: true });
  }

  const service = createService(repo, {
    hashPassword: (pw) => bcrypt.hash(pw, 10),
    now: () => new Date().toISOString()
  });

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (req.url === '/training-api' || req.url.startsWith('/training-api/')) {
      req.url = '/api' + req.url.slice('/training-api'.length);
    }
    next();
  });
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
  app.use(express.json({ limit: '25mb' }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    // Replit Preview is embedded in an iframe on a different origin.
    res.set('Referrer-Policy', 'same-origin');
    next();
  });

  function currentUser(req) {
    const token = req.cookies[COOKIE];
    if (!token) return null;
    try {
      const p = jwt.verify(token, JWT_SECRET);
      const u = repo.tables.users.find((x) => x.id === p.uid);
      if (!u || u.active === false) return null;
      return u;
    } catch (e) { return null; }
  }

  // Ограничение попыток входа: 10 неудачных попыток за 15 минут с одного адреса
  const attempts = new Map();
  function tooMany(ip) {
    const now = Date.now();
    const a = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
    attempts.set(ip, a);
    return a.length >= 10;
  }

  app.post('/api/login', async (req, res) => {
    const ip = req.ip;
    if (tooMany(ip)) return res.status(429).json({ error: 'Слишком много попыток входа. Повторите через 15 минут.' });
    const login = String((req.body || {}).login || '').trim().toLowerCase();
    const password = String((req.body || {}).password || '');
    const u = repo.tables.users.find((x) => x.login === login && x.active !== false);
    const ok = u && u.passwordHash && (await bcrypt.compare(password, u.passwordHash));
    if (!ok) { attempts.get(ip).push(Date.now()); return res.status(401).json({ error: 'Неверный логин или пароль' }); }
    const token = jwt.sign({ uid: u.id }, JWT_SECRET, { expiresIn: SESSION_HOURS + 'h' });
    res.cookie(COOKIE, token, {
      httpOnly: true, sameSite: 'lax', secure: /^(1|true|yes)$/i.test(process.env.COOKIE_SECURE || ''),
      maxAge: SESSION_HOURS * 3600 * 1000
    });
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => { res.clearCookie(COOKIE); res.json({ ok: true }); });

  app.post('/api/password', async (req, res) => {
    const u = currentUser(req);
    if (!u) return res.status(401).json({ error: 'Требуется вход' });
    const { oldPassword, newPassword } = req.body || {};
    if (!(await bcrypt.compare(String(oldPassword || ''), u.passwordHash || ''))) return res.status(400).json({ error: 'Текущий пароль указан неверно' });
    if (String(newPassword || '').length < 8) return res.status(400).json({ error: 'Новый пароль не короче 8 символов' });
    await repo.update('users', u.id, { passwordHash: await bcrypt.hash(String(newPassword), 10) });
    res.json({ ok: true });
  });

  // Все прикладные методы: POST /api/call/<метод> с JSON-параметрами
  app.post('/api/call/:method', async (req, res) => {
    if (req.get('X-Requested-With') !== 'tc') return res.status(400).json({ error: 'Некорректный запрос' });
    const u = currentUser(req);
    if (!u) return res.status(401).json({ error: 'Требуется вход' });
    try {
      const result = await service.call(u, req.params.method, req.body || {});
      res.json({ result });
    } catch (e) {
      if (e && e.name === 'ServiceError') return res.status(e.status || 400).json({ error: e.message });
      console.error(e);
      res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
  });

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // Статика: интерфейс, общий код, библиотека Excel (локально, без интернета)
  app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));
  app.get('/vendor/exceljs.min.js', (req, res) => res.sendFile(require.resolve('exceljs/dist/exceljs.min.js'), { dotfiles: 'allow' }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));

  app.listen(PORT, '0.0.0.0', () => console.log(`Контроль обучения: порт ${PORT}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
