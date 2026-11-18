#!/usr/bin/env node
/*
 * Сборка демо-версии в один HTML-файл (dist/demo.html):
 * интерфейс + общий код + демо-данные + библиотека Excel. Работает без сервера, данные в браузере.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const js = (code) => '<script>\n' + code.replace(/<\/script/gi, '<\\/script') + '\n</script>';

const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Контроль обучения персонала (демо)</title>
<style>
${read('public/styles.css')}
</style>
</head>
<body>
<div class="spinner">Загрузка демо-данных…</div>
${js(read('shared/core.js'))}
${js(read('shared/service.js'))}
${js(read('shared/seed.js'))}
${js(read('shared/memory-repo.js'))}
${js(fs.readFileSync(require.resolve('exceljs/dist/exceljs.min.js'), 'utf8'))}
${js(read('public/api-demo.js'))}
${js(read('public/app.js'))}
</body>
</html>
`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'demo.html'), html);
console.log('dist/demo.html', (html.length / 1024 / 1024).toFixed(2) + ' МБ');
