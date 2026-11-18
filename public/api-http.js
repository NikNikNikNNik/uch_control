/* Адаптер API для серверного режима: запросы к /api */
(function () {
  'use strict';
  async function post(url, body, extraHeaders) {
    const r = await fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {}),
      body: JSON.stringify(body || {})
    });
    let data = {};
    try { data = await r.json(); } catch (e) { /* пустой ответ */ }
    if (!r.ok) {
      const err = new Error(data.error || ('Ошибка ' + r.status));
      err.status = r.status;
      throw err;
    }
    return data;
  }
  window.TCApi = {
    mode: 'server',
    call: async (method, params) => (await post('/training-api/call/' + encodeURIComponent(method), params, { 'X-Requested-With': 'tc' })).result,
    login: (login, password) => post('/training-api/login', { login, password }),
    logout: () => post('/training-api/logout', {}),
    changePassword: (oldPassword, newPassword) => post('/training-api/password', { oldPassword, newPassword }),
    saveFile: async (filename, blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
      return true;
    }
  };
})();
