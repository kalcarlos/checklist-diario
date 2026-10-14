// Funções puras (sem DOM, sem estado do app) do Checklist Diário.
// Carregadas antes do app.js; também rodam em Node para os testes unitários.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CDPure = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function dayKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Acha links úteis num texto: sites, e-mails e telefones (formatos brasileiros
  // com DDD entre parênteses, +55 ou 8/9 dígitos com hífen; números soltos não).
  function findLinks(text) {
    var out = [], seen = {};
    var t = String(text || '');
    function add(type, href, label) { if (!seen[href]) { seen[href] = 1; out.push({ type: type, href: href, label: label }); } }
    t.replace(/(?:https?:\/\/|www\.)[^\s<>"']+/gi, function (m) {
      var clean = m.replace(/[.,;:!?)\]]+$/, '');
      var href = /^https?:/i.test(clean) ? clean : 'https://' + clean;
      var host = clean.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[\/?#]/)[0];
      add('url', href, host);
      return m;
    });
    t.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, function (m) { add('mail', 'mailto:' + m, m); return m; });
    t.replace(/(?:\+55\s?)?\(\d{2}\)\s?9?\d{4}[-\s]?\d{4}|\+55\s?\d{2}\s?9?\d{4}[-\s]?\d{4}|\b9?\d{4}-\d{4}\b/g, function (m) {
      add('tel', 'tel:' + m.replace(/[^\d+]/g, ''), m.trim());
      return m;
    });
    return out;
  }

  var WEEKDAYS_PT = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };

  function plain(t) { return String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

  // Só sugere quando há uma HORA clara (10h, 10h30, 14:30, "as 9"). Número solto não conta.
  function parseWhen(text, now) {
    now = now || new Date();
    var t = ' ' + plain(text) + ' ';
    var m = t.match(/[\s(](\d{1,2})h(\d{2})?(?=[\s.,;!?)]|$)/) || t.match(/[\s(](\d{1,2}):(\d{2})(?=[\s.,;!?)]|$)/) || t.match(/[\s(]as\s+(\d{1,2})()(?=[\s.,;!?)]|$)/);
    if (!m) return null;
    var h = parseInt(m[1], 10), min = m[2] ? parseInt(m[2], 10) : 0;
    if (h > 23 || min > 59) return null;
    if (/\b(da tarde|da noite)\b/.test(t) && h < 12) h += 12;
    var offset = null;
    if (/\bdepois de amanha\b/.test(t)) offset = 2;
    else if (/\bamanha\b/.test(t)) offset = 1;
    else if (/\bhoje\b/.test(t)) offset = 0;
    else {
      var wd = t.match(/\b(domingo|segunda|terca|quarta|quinta|sexta|sabado)(-feira)?\b/);
      if (wd) { offset = (WEEKDAYS_PT[wd[1]] - now.getDay() + 7) % 7 || 7; }
    }
    var base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var when = function (off) { var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + off, h, min); return d; };
    var d = offset === null ? (when(0) > now ? when(0) : when(1)) : when(offset);
    if (d <= now) return null;
    return { date: dayKey(d), time: String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0') };
  }

  function mergeProgressInto(game, r) {
    if (!r || typeof r !== 'object') return false;
    var before = JSON.stringify([game.days, game.doneLists, game.badges, game.total, game.listsDone, Object.keys(game.reviews)]);
    ['days', 'doneLists'].forEach(function (f) {
      var m = r[f] || {};
      Object.keys(m).forEach(function (k) { if (m[k] > (game[f][k] || 0)) game[f][k] = m[k]; });
    });
    var b = r.badges || {};
    Object.keys(b).forEach(function (id) { if (!game.badges[id] || b[id] < game.badges[id]) game.badges[id] = b[id]; });
    game.total = Math.max(game.total, r.total || 0);
    game.listsDone = Math.max(game.listsDone, r.listsDone || 0);
    var rv = r.reviews || {};
    Object.keys(rv).forEach(function (k) {
      if (!game.reviews[k]) game.reviews[k] = { helped: '', next: '', at: (rv[k] && rv[k].at) || k, seen: true };
    });
    return before !== JSON.stringify([game.days, game.doneLists, game.badges, game.total, game.listsDone, Object.keys(game.reviews)]);
  }

  return { dayKey: dayKey, plain: plain, parseWhen: parseWhen, findLinks: findLinks, mergeProgressInto: mergeProgressInto };
});
