'use strict';
/*
 * База данных: SQLite (по умолчанию, файл data/training.db) или PostgreSQL (DATABASE_URL=postgres://...).
 * Схема создаётся автоматически при первом запуске.
 * Хранилище держит копию всех таблиц в памяти (расчёт статусов идёт в памяти),
 * а каждое изменение сразу записывает в БД. Поэтому сервер запускается в ОДНОМ экземпляре.
 */
const path = require('path');
const fs = require('fs');
const knexLib = require('knex');

const TABLES = ['sites', 'departments', 'positions', 'employees', 'courses', 'positionRequirements', 'individualRequirements', 'trainings', 'users', 'audit'];
const JSON_FIELDS = { users: ['siteIds', 'departmentIds'] };
const BOOL_FIELDS = { courses: ['active'], users: ['active'] };

function connect() {
  // Keep the archive's SQLite default; opt in explicitly to an external PostgreSQL database.
  const url = process.env.TRAINING_DATABASE_URL;
  if (url && /^postgres/.test(url)) {
    return knexLib({ client: 'pg', connection: url, pool: { min: 1, max: 5 } });
  }
  const file = process.env.SQLITE_FILE || path.join(__dirname, '..', 'data', 'training.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return knexLib({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true });
}

async function createSchema(knex) {
  const has = (t) => knex.schema.hasTable(t);
  if (!(await has('sites'))) await knex.schema.createTable('sites', (t) => { t.increments('id'); t.string('name', 200).notNullable(); });
  if (!(await has('departments'))) await knex.schema.createTable('departments', (t) => {
    t.increments('id'); t.integer('siteId').notNullable().references('id').inTable('sites'); t.string('name', 200).notNullable();
  });
  if (!(await has('positions'))) await knex.schema.createTable('positions', (t) => { t.increments('id'); t.string('name', 200).notNullable(); });
  if (!(await has('employees'))) await knex.schema.createTable('employees', (t) => {
    t.increments('id'); t.string('tabNo', 50).notNullable().unique(); t.string('fullName', 300).notNullable();
    t.integer('siteId').notNullable().references('id').inTable('sites');
    t.integer('departmentId').notNullable().references('id').inTable('departments');
    t.integer('positionId').notNullable().references('id').inTable('positions');
    t.string('hireDate', 10); t.string('dismissedAt', 10); t.text('note');
  });
  if (!(await has('courses'))) await knex.schema.createTable('courses', (t) => {
    t.increments('id'); t.string('code', 50); t.string('name', 400).notNullable(); t.string('category', 200);
    t.integer('periodMonths'); t.string('basis', 400); t.integer('hours'); t.boolean('active').defaultTo(true);
  });
  if (!(await has('positionRequirements'))) await knex.schema.createTable('positionRequirements', (t) => {
    t.increments('id'); t.integer('positionId').notNullable().references('id').inTable('positions');
    t.integer('courseId').notNullable().references('id').inTable('courses'); t.unique(['positionId', 'courseId']);
  });
  if (!(await has('individualRequirements'))) await knex.schema.createTable('individualRequirements', (t) => {
    t.increments('id'); t.integer('employeeId').notNullable().references('id').inTable('employees');
    t.integer('courseId').notNullable().references('id').inTable('courses'); t.unique(['employeeId', 'courseId']);
  });
  if (!(await has('trainings'))) await knex.schema.createTable('trainings', (t) => {
    t.increments('id'); t.integer('employeeId').notNullable().references('id').inTable('employees');
    t.integer('courseId').notNullable().references('id').inTable('courses');
    t.string('date', 10).notNullable(); t.string('validUntil', 10);
    t.string('protocolNo', 100); t.string('certificateNo', 100); t.string('provider', 300); t.text('note');
    t.string('createdBy', 100); t.string('createdAt', 30);
    t.index(['employeeId', 'courseId']);
  });
  if (!(await has('users'))) await knex.schema.createTable('users', (t) => {
    t.increments('id'); t.string('login', 50).notNullable().unique(); t.string('fullName', 300);
    t.string('passwordHash', 200); t.string('role', 20).notNullable();
    t.text('siteIds'); t.text('departmentIds'); t.boolean('active').defaultTo(true);
  });
  if (!(await has('audit'))) await knex.schema.createTable('audit', (t) => {
    t.increments('id'); t.string('ts', 30); t.string('userLogin', 50); t.string('userName', 300);
    t.string('action', 20); t.string('entity', 30); t.integer('entityId'); t.text('summary');
  });
  if (!(await has('settings'))) await knex.schema.createTable('settings', (t) => { t.string('key', 100).primary(); t.text('value'); });
}

function toDb(table, o) {
  const r = Object.assign({}, o);
  (JSON_FIELDS[table] || []).forEach((k) => { if (k in r) r[k] = JSON.stringify(r[k] || []); });
  return r;
}
function fromDb(table, o) {
  (JSON_FIELDS[table] || []).forEach((k) => { try { o[k] = JSON.parse(o[k] || '[]'); } catch (e) { o[k] = []; } });
  (BOOL_FIELDS[table] || []).forEach((k) => { o[k] = o[k] === null || o[k] === undefined ? true : !!o[k]; });
  return o;
}

async function createDbRepo(knex) {
  await createSchema(knex);
  const tables = {};
  for (const t of TABLES) tables[t] = (await knex(t).select('*').orderBy('id')).map((o) => fromDb(t, o));
  const settings = {};
  (await knex('settings').select('*')).forEach((r) => { try { settings[r.key] = JSON.parse(r.value); } catch (e) { settings[r.key] = r.value; } });

  // Простая очередь: записи в БД выполняются последовательно, кеш меняется только после успешной записи.
  let chain = Promise.resolve();
  function serial(fn) { const p = chain.then(fn); chain = p.catch(() => {}); return p; }
  const cols = {};
  async function columns(table) {
    if (!cols[table]) cols[table] = Object.keys(await knex(table).columnInfo());
    return cols[table];
  }
  function pick(o, keys) { const r = {}; keys.forEach((k) => { if (k in o && k !== 'id') r[k] = o[k]; }); return r; }

  const repo = {
    tables,
    settings,
    knex,
    insert: (table, obj) => serial(async () => {
      const row = pick(toDb(table, obj), await columns(table));
      const res = await knex(table).insert(row).returning('id');
      const id = typeof res[0] === 'object' ? res[0].id : res[0];
      const o = Object.assign({}, obj, { id: Number(id) });
      tables[table].push(o);
      return o;
    }),
    update: (table, id, patch) => serial(async () => {
      await knex(table).where({ id }).update(pick(toDb(table, patch), await columns(table)));
      const o = tables[table].find((x) => x.id === id);
      if (o) Object.assign(o, patch, { id });
      return o;
    }),
    remove: (table, id) => serial(async () => {
      await knex(table).where({ id }).del();
      const i = tables[table].findIndex((x) => x.id === id);
      if (i >= 0) tables[table].splice(i, 1);
    }),
    setSettings: (s) => serial(async () => {
      for (const k of Object.keys(s)) {
        const v = JSON.stringify(s[k]);
        const ex = await knex('settings').where({ key: k }).first();
        if (ex) await knex('settings').where({ key: k }).update({ value: v });
        else await knex('settings').insert({ key: k, value: v });
        settings[k] = s[k];
      }
    }),
    appendAudit: (entry) => repo.insert('audit', entry).then((o) => {
      // в памяти держим последние 5000 записей журнала, в БД хранится всё
      if (tables.audit.length > 5000) tables.audit.splice(0, tables.audit.length - 5000);
      return o;
    }),
    // Массовая загрузка (первичное наполнение демо-данными) в одной транзакции
    bulkLoad: async (data) => {
      await knex.transaction(async (trx) => {
        for (const t of ['sites', 'departments', 'positions', 'employees', 'courses', 'positionRequirements', 'individualRequirements', 'trainings']) {
          const rows = (data[t] || []).map((o) => toDb(t, o));
          for (let i = 0; i < rows.length; i += 500) await trx(t).insert(rows.slice(i, i + 500));
          tables[t] = (data[t] || []).map((o) => Object.assign({}, o));
        }
      });
      if (knex.client.config.client === 'pg') {
        for (const t of ['sites', 'departments', 'positions', 'employees', 'courses', 'positionRequirements', 'individualRequirements', 'trainings']) {
          await knex.raw(`SELECT setval(pg_get_serial_sequence('"${t}"', 'id'), COALESCE((SELECT MAX(id) FROM "${t}"), 1))`);
        }
      }
      if (data.settings) await repo.setSettings(data.settings);
    }
  };
  return repo;
}

module.exports = { connect, createDbRepo, TABLES };
