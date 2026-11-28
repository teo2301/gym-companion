/* Gym Companion training calendar: a month grid of the days you trained, for your own profile and friends'.
 *
 * GymCal.render(box, workouts, opts)
 *   workouts: [{date: 'YYYY-MM-DD', title, minutes, volume, sets, id?, editable?}] (any order, whole history)
 *   opts: {key: 'own' | friend id (remembers the month shown), editable: bool (own only: add / edit),
 *          onAdd(date), onOpen(id), now: ms (tests)}
 * Month navigation back through history, per-month count + sessions per week, current / best weekly streak,
 * intensity (1 vs 2+ workouts a day, shown with colour AND dots), a legend and a Table view.
 * Tapping a day lists that day's workouts; on your own calendar it also offers "Add workout on <date>".
 * Everything is built with DOM nodes + textContent (titles can come from friends).
 */
(function () {
'use strict';
var MONTH = {}, TABLE = {}, PICK = {};       // per calendar key: month shown, table view on, day picked

function pad(n) { return ('0' + n).slice(-2); }
function dkey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function mkey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
function parse(ds) { return new Date(ds + 'T12:00:00'); }
function monday(d) { var x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; }
function weekNo(ds) { return Math.round(monday(parse(ds)).getTime() / 6048e5); }
function el(tag, cls, text, parent) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}
function longDate(ds) { return parse(ds).toLocaleDateString('en-GB', {weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'}); }
function shortDate(ds) { return parse(ds).toLocaleDateString('en-GB', {day: 'numeric', month: 'short'}); }
function monthName(mk) { return parse(mk + '-01').toLocaleDateString('en-GB', {month: 'long', year: 'numeric'}); }
function addMonths(mk, n) { var d = parse(mk + '-01'); d.setMonth(d.getMonth() + n); return mkey(d); }
function r1(v) { return Math.round(v * 10) / 10; }

/* ---------- numbers (exported for tests) */
function byDay(list) {
  var m = {};
  (list || []).forEach(function (w) {
    if (!w || !/^\d{4}-\d{2}-\d{2}$/.test(String(w.date))) return;
    (m[w.date] = m[w.date] || []).push(w);
  });
  return m;
}
/* Weeks in a row (Mon-Sun) with at least one workout. Current = ending this week, or last week if this
 * week has none yet (the streak isn't broken until a whole week passes). */
function streaks(list, now) {
  var weeks = {};
  (list || []).forEach(function (w) { if (w && w.date) weeks[weekNo(w.date)] = 1; });
  var ks = Object.keys(weeks).map(Number).sort(function (a, b) { return a - b; });
  var best = 0, run = 0, prev = null;
  ks.forEach(function (k) { run = prev !== null && k === prev + 1 ? run + 1 : 1; best = Math.max(best, run); prev = k; });
  var cur = weekNo(dkey(new Date(now || Date.now()))), k = weeks[cur] ? cur : cur - 1, current = 0;
  while (weeks[k]) { current++; k--; }
  return {current: current, best: best};
}
/* One month: workouts, training days, sessions per week (over the days of the month so far). */
function monthStats(days, mk, now) {
  var first = parse(mk + '-01'), last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12);
  var today = new Date(now || Date.now()); today.setHours(12, 0, 0, 0);
  var end = last > today ? today : last, n = 0, d = 0;
  Object.keys(days).forEach(function (k) { if (k.slice(0, 7) === mk) { d++; n += days[k].length; } });
  var span = end < first ? 0 : Math.round((end - first) / 864e5) + 1;
  return {workouts: n, days: d, perWeek: span ? r1(n / (span / 7)) : 0, span: span};
}

/* ---------- styles */
function styles() {
  if (document.getElementById('calCss')) return;
  var s = document.createElement('style'); s.id = 'calCss';
  s.textContent = [
    '.gcal{margin-top:2px}',
    '.gcnav{display:flex;align-items:center;gap:8px;margin:2px 0 8px}.gcnav b{flex:1;text-align:center;font-size:16px}',
    '.gcnav button{width:40px;height:40px;border-radius:12px;background:var(--card2);color:var(--text);font-size:20px;font-weight:700}',
    '.gcnav button:disabled{opacity:.3}',
    '.gcsum{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-bottom:10px}',
    '.gcsum div{background:var(--card2);border-radius:12px;padding:8px 4px;text-align:center;min-width:0}',
    '.gcsum b{display:block;font-size:18px;font-weight:800}.gcsum small{display:block;color:var(--dim);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.gcgrid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}',
    '.gcdow{text-align:center;color:var(--dim);font-size:11.5px;font-weight:700;padding-bottom:2px}',
    '.gcd{position:relative;aspect-ratio:1;border-radius:10px;background:var(--card2);color:var(--dim);font-size:13.5px;font-weight:700;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;min-width:0;padding:0}',
    '.gcd.pad{background:none;pointer-events:none}',
    '.gcd.l1{background:rgba(215,255,62,.32);color:var(--text)}',
    '.gcd.l2{background:#d7ff3e;color:#0c0e12}',
    '.gcd.fut{opacity:.38}',
    '.gcd.today{box-shadow:inset 0 0 0 2px var(--text)}',
    '.gcd.sel{outline:2px solid #d7ff3e;outline-offset:2px}',
    '.gcd i{display:block;height:6px;font-style:normal;font-size:9px;line-height:6px;letter-spacing:1px}',
    '.gcleg{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;color:var(--dim);font-size:12px;margin:10px 2px 2px}',
    '.gcleg span{display:flex;align-items:center;gap:6px}.gcleg i{width:14px;height:14px;border-radius:4px;background:var(--card2);display:inline-block}',
    '.gcleg i.l1{background:rgba(215,255,62,.32)}.gcleg i.l2{background:#d7ff3e}.gcleg i.td{box-shadow:inset 0 0 0 2px var(--text)}',
    '.gcday{margin-top:12px;background:var(--card2);border-radius:14px;padding:12px}',
    '.gcday h4{margin:0 0 6px;font-size:15px}.gcday p{margin:4px 0;color:var(--dim);font-size:13.5px}',
    '.gcw{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--line);width:100%;text-align:left;color:var(--text);background:none;font:inherit}',
    '.gcw:first-of-type{border-top:0}.gcw div{flex:1;min-width:0}.gcw b{display:block;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.gcw small{color:var(--dim);font-size:12.5px}.gcw span{flex:none;color:#d7ff3e;font-weight:700;font-size:13.5px}',
    '.gcadd{width:100%;height:44px;border-radius:12px;background:#d7ff3e;color:#0c0e12;font-weight:800;font-size:15px;margin-top:8px}',
    '.gcnote{color:var(--dim);font-size:13px;margin-top:8px}.gcnote b{color:var(--text)}',
    '.gctab{display:block;margin:10px 0 0 auto;height:34px;padding:0 12px;border-radius:10px;background:var(--card2);color:var(--dim);font-weight:700;font-size:13px}',
    '.gcal .ctbl{max-height:320px;overflow:auto;margin-top:4px}.gcal .ctbl table{width:100%;border-collapse:collapse;font-size:13.5px}',
    '.gcal .ctbl th{color:var(--dim);font-weight:700;text-align:left;padding:6px 4px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--card)}',
    '.gcal .ctbl td{padding:6px 4px;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums}'
  ].join('\n');
  document.head.appendChild(s);
}

/* ---------- render */
function render(box, list, opts) {
  opts = opts || {};
  styles();
  var key = opts.key || 'own', now = opts.now || Date.now();
  var todayD = new Date(now), today = dkey(todayD), thisMonth = mkey(todayD);
  var days = byDay(list), dates = Object.keys(days).sort();
  var firstMonth = dates.length ? dates[0].slice(0, 7) : thisMonth;
  if (firstMonth > thisMonth) firstMonth = thisMonth;
  var mk = MONTH[key] || thisMonth;
  if (mk > thisMonth) mk = thisMonth;
  if (mk < firstMonth) mk = firstMonth;
  MONTH[key] = mk;
  var st = streaks(list, now);
  box.textContent = '';
  var root = el('div', 'gcal', null, box);
  root.setAttribute('data-cal', key);

  var tab = el('button', 'gctab', TABLE[key] ? 'Calendar view' : 'Table view', root);
  tab.setAttribute('data-caltab', '1'); tab.setAttribute('aria-pressed', TABLE[key] ? 'true' : 'false');
  tab.onclick = function () { if (window.buzz) buzz(); TABLE[key] = !TABLE[key]; render(box, list, opts); };
  if (TABLE[key]) { table(root); return api(); }

  var nav = el('div', 'gcnav', null, root);
  var prev = el('button', null, '‹', nav); prev.setAttribute('aria-label', 'Previous month'); prev.setAttribute('data-nav', '-1');
  var title = el('b', null, monthName(mk), nav); title.setAttribute('aria-live', 'polite');
  var next = el('button', null, '›', nav); next.setAttribute('aria-label', 'Next month'); next.setAttribute('data-nav', '1');
  prev.disabled = mk <= firstMonth; next.disabled = mk >= thisMonth;
  prev.onclick = function () { go(-1); }; next.onclick = function () { go(1); };

  var ms = monthStats(days, mk, now), sum = el('div', 'gcsum', null, root);
  [[ms.workouts, ms.workouts === 1 ? 'workout' : 'workouts'], [ms.days, ms.days === 1 ? 'gym day' : 'gym days'], [ms.perWeek, 'per week'],
   [st.current + (st.best > st.current ? '/' + st.best : ''), 'streak / best']].forEach(function (c, i) {
    var d = el('div', null, null, sum); var b = el('b', 'num', String(c[0]), d); el('small', null, c[1], d);
    if (i === 3) { b.title = 'Weeks in a row with a workout: now ' + st.current + ', best ' + st.best; b.setAttribute('data-streak', st.current + ',' + st.best); }
  });
  sum.setAttribute('data-month', ms.workouts + ',' + ms.days + ',' + ms.perWeek);

  var grid = el('div', 'gcgrid', null, root);
  grid.setAttribute('role', 'grid'); grid.setAttribute('aria-label', 'Training days in ' + monthName(mk));
  ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach(function (d) { el('div', 'gcdow', d, grid).setAttribute('aria-hidden', 'true'); });
  var first = parse(mk + '-01'), lead = (first.getDay() + 6) % 7, nDays = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  for (var i = 0; i < lead; i++) el('span', 'gcd pad', null, grid);
  for (var dd = 1; dd <= nDays; dd++) {
    var ds = mk + '-' + pad(dd), n = (days[ds] || []).length;
    var b = el('button', 'gcd' + (n >= 2 ? ' l2' : n ? ' l1' : '') + (ds > today ? ' fut' : '') + (ds === today ? ' today' : '') + (PICK[key] === ds ? ' sel' : ''), null, grid);
    b.setAttribute('data-d', ds); b.setAttribute('data-n', String(n));
    b.setAttribute('aria-label', longDate(ds) + ': ' + (n ? n + (n === 1 ? ' workout' : ' workouts') : 'rest day') + (ds === today ? ' (today)' : ''));
    el('span', null, String(dd), b);
    el('i', null, n >= 2 ? '••' : n ? '•' : '', b).setAttribute('aria-hidden', 'true');
    b.onclick = (function (x) { return function () { if (window.buzz) buzz(); pick(x); }; })(ds);
  }
  var leg = el('div', 'gcleg', null, root);
  [['', 'Rest'], ['l1', '1 workout •'], ['l2', '2+ workouts ••'], ['td', 'Today']].forEach(function (x) {
    var s = el('span', null, null, leg); el('i', x[0], null, s); s.appendChild(document.createTextNode(x[1]));
  });
  var dayBox = el('div', null, null, root);
  dayBox.setAttribute('data-daybox', '1');
  if (PICK[key] && PICK[key].slice(0, 7) === mk) showDay(dayBox, PICK[key]);
  else if (opts.editable && mk === thisMonth) hint(dayBox);
  note(root);
  return api();

  function api() { return {month: function () { return MONTH[key]; }, pick: pick, go: go}; }
  function go(step) {
    var m = addMonths(MONTH[key], step);
    if (m < firstMonth || m > thisMonth) return;
    MONTH[key] = m; render(box, list, opts);
  }
  function pick(ds) {
    PICK[key] = ds; MONTH[key] = ds.slice(0, 7); render(box, list, opts);
  }
  function hint(boxEl) {
    var p = el('p', 'gcnote', 'Tap a day to see it' + (opts.editable ? ', or to log a workout you did on that day.' : '.'), boxEl);
    p.style.marginTop = '10px';
  }
  function showDay(boxEl, ds) {
    var card = el('div', 'gcday', null, boxEl), ws = (days[ds] || []).slice().sort(function (a, b) { return (a.start || 0) - (b.start || 0); });
    card.setAttribute('data-day', ds);
    el('h4', null, longDate(ds), card);
    if (!ws.length) el('p', null, ds > today ? 'A day still to come.' : 'Rest day.', card);
    ws.forEach(function (w) {
      var row = el(opts.editable && w.id ? 'button' : 'div', 'gcw', null, card), t = el('div', null, null, row);
      el('b', null, w.title || 'Workout', t);
      var bits = [];
      if (w.minutes) bits.push(w.minutes + ' min');
      if (w.sets) bits.push(w.sets + (w.sets === 1 ? ' set' : ' sets'));
      if (w.volume) bits.push(Math.round(w.volume).toLocaleString() + ' kg');
      el('small', null, bits.join(' · ') || 'logged', t);
      if (opts.editable && w.id) {
        el('span', null, w.editable === false ? 'View ›' : '✎ Edit', row);
        row.onclick = function () { if (window.buzz) buzz(); if (opts.onOpen) opts.onOpen(w.id, ds); };
      }
    });
    if (opts.editable) {
      if (ds <= today) {
        var add = el('button', 'gcadd', '＋ Add workout on ' + shortDate(ds), card);
        add.setAttribute('data-add', ds);
        add.onclick = function () { if (window.buzz) buzz(); if (opts.onAdd) opts.onAdd(ds); };
      } else el('p', null, 'You can log a workout once the day has come.', card);
    }
  }
  function note(rootEl) {
    var total = list ? list.length : 0, p = el('div', 'gcnote', null, rootEl);
    if (!total) { p.textContent = opts.editable ? 'No workouts yet. Tap any past day to log one.' : 'No workouts yet.'; return; }
    p.appendChild(document.createTextNode('Streak = weeks in a row with a workout. '));
    p.appendChild(document.createTextNode(total + (total === 1 ? ' workout' : ' workouts') + ' on ' + dates.length + (dates.length === 1 ? ' day' : ' days') + ' since ' + shortDate(dates[0]) + ' ' + dates[0].slice(0, 4) + '.'));
  }
  function table(rootEl) {
    var months = [], m = thisMonth;
    for (var g = 0; m >= firstMonth && g < 600; g++) { months.push(m); m = addMonths(m, -1); }
    var t = el('div', 'ctbl', null, rootEl), tb = el('table', null, null, t), hr = el('tr', null, null, el('thead', null, null, tb));
    ['Month', 'Workouts', 'Gym days', 'Per week'].forEach(function (h) { el('th', null, h, hr); });
    var body = el('tbody', null, null, tb);
    months.forEach(function (mm) {
      var s = monthStats(days, mm, now), tr = el('tr', null, null, body);
      [monthName(mm), s.workouts, s.days, s.perWeek].forEach(function (v) { el('td', null, String(v), tr); });
      tr.style.cursor = 'pointer';
      tr.onclick = function () { TABLE[key] = false; MONTH[key] = mm; render(box, list, opts); };
    });
    var p = el('p', 'gcnote', 'Streak: ' + st.current + (st.current === 1 ? ' week' : ' weeks') + ' now, best ' + st.best + '. Tap a month to open it.', rootEl);
    var dl = el('div', 'ctbl', null, rootEl); dl.style.marginTop = '10px';
    var tb2 = el('table', null, null, dl), hr2 = el('tr', null, null, el('thead', null, null, tb2));
    ['Date', 'Workout', 'Time', 'Volume'].forEach(function (h) { el('th', null, h, hr2); });
    var b2 = el('tbody', null, null, tb2);
    dates.slice().reverse().forEach(function (ds) {
      days[ds].forEach(function (w) {
        var tr = el('tr', null, null, b2);
        [ds, w.title || 'Workout', w.minutes ? w.minutes + ' min' : '–', w.volume ? Math.round(w.volume).toLocaleString() + ' kg' : '–'].forEach(function (v) { el('td', null, String(v), tr); });
      });
    });
    void p;
  }
}

window.GymCal = {render: render, streaks: streaks, monthStats: monthStats, byDay: byDay,
  table: function (key, on) { TABLE[key || 'own'] = !!on; }, isTable: function (key) { return !!TABLE[key || 'own']; },
  reset: function (key) { delete MONTH[key]; delete PICK[key]; }};
})();
