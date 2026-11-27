/* Gym Companion "Progress": charts and records for everything you've logged.
 * Data: Store.stats() (workouts, per-exercise records, PR events, bodyweight) + Store.progress() (level and
 * per-muscle sets per week, strength per muscle) + Store.history(name) for one exercise.
 * One period filter (top row) scopes every card. Charts come from charts.js; each card can show a table.
 * Uses page helpers: $, esc, show, openSheet, closeSheet, toast, toastOk, buzz, Store, MN, tierColour, fmtW.
 */
(function () {
'use strict';
var RANGES = [['1m', '1M', 31], ['3m', '3M', 92], ['6m', '6M', 183], ['1y', '1Y', 366], ['all', 'All', 0]];
var range = lsGet('gymProgRange') || '3m', metric = lsGet('gymProgMetric') || 'volume';
var D = null, tables = {};

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function q(id) { return document.getElementById(id); }
function e(t) { return window.esc(String(t == null ? '' : t)); }
function kg(w) { return (Math.round(w * 10) / 10).toString(); }
function big(n) { return n >= 1e6 ? (Math.round(n / 1e5) / 10) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : Math.round(n).toLocaleString(); }
function dstr(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function monday(ds) { var d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return dstr(d); }
function niceDate(ds) { return new Date(ds + 'T12:00:00').toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'}); }
function cutoff() {
  var r = RANGES.filter(function (x) { return x[0] === range; })[0];
  if (!r || !r[2]) return '0000-00-00';
  var d = new Date(); d.setDate(d.getDate() - r[2]); return dstr(d);
}
/* The previous period of the same length, [prevCut, cut). null for All (there is nothing before it). */
function prevCutoff() {
  var r = RANGES.filter(function (x) { return x[0] === range; })[0];
  if (!r || !r[2]) return null;
  var d = new Date(); d.setDate(d.getDate() - 2 * r[2]); return dstr(d);
}
/* "▲ 12%" / "▼ 5%" / "= same" vs the previous period: arrows + words, never colour alone. */
function delta(now, before) {
  if (!before) return now ? '▲ new' : '= same';
  var p = Math.round(100 * (now - before) / before);
  return p > 0 ? '▲ ' + p + '%' : p < 0 ? '▼ ' + (-p) + '%' : '= same';
}

/* ---------- styles */
function styles() {
  if (q('progCss')) return;
  var s = document.createElement('style'); s.id = 'progCss';
  s.textContent = [
    '.pghead{display:flex;align-items:center;gap:10px;margin:6px 0 14px}.pghead h1{margin:0;flex:1}',
    '.pgback{width:44px;height:44px;border-radius:22px;background:var(--card2);font-size:22px;color:var(--text);flex:none}',
    '.pgrange{display:flex;gap:6px;margin-bottom:14px;background:var(--card);border-radius:14px;padding:4px}',
    '.pgrange button{flex:1;height:36px;border-radius:10px;color:var(--dim);font-weight:700;font-size:14px}.pgrange button.on{background:var(--volt);color:#0c0e12}',
    '.pgtiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}',
    '.pgtiles div{background:var(--card);border-radius:16px;padding:11px 12px;min-width:0}',
    '.pgtiles small{display:block;color:var(--dim);font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.pgtiles b{display:block;font-size:22px;font-weight:800;margin-top:2px;white-space:nowrap}.pgtiles em{display:block;font-style:normal;color:var(--dim);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.pgtiles i{display:block;font-style:normal;font-weight:700;color:var(--text);font-size:12px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#pgCmpNote{margin:-4px 0 12px;font-size:12px}',
    '.pgcard{background:var(--card);border-radius:20px;padding:14px 14px 12px;margin-bottom:12px}',
    '.pgch{display:flex;align-items:center;gap:8px;margin-bottom:4px}.pgch h3{margin:0;font-size:17px;flex:1}',
    '.pgtab{height:30px;padding:0 10px;border-radius:9px;background:var(--card2);color:var(--dim);font-size:12.5px;font-weight:700}.pgtab.on{color:var(--volt)}',
    '.pgsub{color:var(--dim);font-size:13px;margin:0 0 8px}',
    '.pgseg{display:flex;gap:4px;margin:6px 0 8px;flex-wrap:wrap}.pgseg button{height:30px;padding:0 11px;border-radius:9px;background:var(--card2);color:var(--dim);font-size:13px;font-weight:700}',
    '.pgseg button.on{background:var(--line);color:var(--text)}',
    '.pgnote{color:var(--dim);font-size:13px;margin-top:6px}.pgnote b{color:var(--text)}',
    '.pgrow{display:flex;align-items:center;gap:10px;padding:10px 2px;border-top:1px solid var(--line);cursor:pointer}.pgrow:first-child{border-top:0}',
    '.pgrow div{flex:1;min-width:0}.pgrow b{display:block;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pgrow small{color:var(--dim);font-size:12.5px}',
    '.pgrow .v{flex:none;text-align:right;font-weight:800;font-size:15px}.pgrow .v small{display:block;font-weight:600}',
    '.pgtro{flex:none;width:30px;height:30px;border-radius:9px;background:rgba(255,176,32,.14);display:flex;align-items:center;justify-content:center}',
    '.pgmore{width:100%;height:40px;border-radius:12px;background:var(--card2);color:var(--text);font-weight:700;margin-top:8px}',
    '.pgbw{display:flex;gap:8px;margin-top:10px}.pgbw input{flex:1;margin:0;height:42px}.pgbw button{flex:none;height:42px;padding:0 16px;border-radius:12px;background:var(--volt);color:#0c0e12;font-weight:700}',
    '.pgopen{width:100%;height:48px;border-radius:16px;background:var(--card2);color:var(--text);font-weight:700;font-size:15px;margin-top:10px}',
    '.pgopen span{color:var(--volt)}',
    /* photo evolution */
    '.evo{position:relative;aspect-ratio:3/4;max-width:280px;margin:6px auto 8px;border-radius:16px;overflow:hidden;background:#0b0d11;box-shadow:inset 0 0 0 1px var(--line)}',
    '.evo img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}',
    '.evo input[type=range]{position:absolute;left:10px;right:10px;bottom:8px;width:calc(100% - 20px);margin:0;accent-color:var(--volt)}',
    '.evl{position:absolute;top:8px;font-size:11px;font-weight:800;background:rgba(8,10,12,.82);padding:3px 7px;border-radius:8px}.evl.l{left:8px}.evl.r{right:8px}',
    '.evosel{display:flex;gap:8px;margin:4px 0}.evosel select{flex:1;min-width:0;background:var(--card2);color:var(--text);border:1px solid var(--line);border-radius:10px;padding:8px;font-size:13px}',
    /* charts */
    '.cwrap{position:relative}.cwrap svg{display:block;overflow:visible;user-select:none;-webkit-user-select:none}',
    '.cax{fill:#8d94a0;font:11px system-ui,-apple-system,sans-serif}.clab{fill:#eef0f3;font:700 12px system-ui,-apple-system,sans-serif}',
    '.ctip{position:absolute;z-index:5;pointer-events:none;background:#20252e;border:1px solid #2a303a;border-radius:10px;padding:6px 10px;box-shadow:0 6px 18px rgba(0,0,0,.45);white-space:nowrap}',
    '.ctip .ctv{font-weight:800;font-size:15px;color:#eef0f3}.ctip .ctl{font-size:12px;color:#8d94a0;display:flex;align-items:center;gap:6px}',
    '.ctip i{display:inline-block;width:10px;height:2px;border-radius:1px}',
    '.cempty{color:var(--dim);font-size:14px;margin:10px 2px}',
    '.chb{display:flex;flex-direction:column;gap:7px;margin-top:4px}.chbr{display:grid;grid-template-columns:92px 1fr auto;align-items:center;gap:8px}',
    '.chbr.tap{cursor:pointer}.chbl{font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.chbt{position:relative;height:12px;border-radius:6px;background:var(--card2);overflow:hidden}',
    '.chbband{position:absolute;top:0;bottom:0;background:rgba(238,240,243,.10);border-left:1px solid rgba(238,240,243,.25);border-right:1px solid rgba(238,240,243,.25)}',
    '.chbf{position:absolute;left:0;top:2px;bottom:2px;border-radius:0 4px 4px 0;background:#d7ff3e}',
    '.chbv{font-size:12.5px;color:var(--dim);white-space:nowrap;text-align:right;min-width:44px}',
    '.chbkey{display:flex;align-items:center;gap:6px;color:var(--dim);font-size:12px}.chbkey i{width:16px;height:10px;border-radius:3px;background:rgba(238,240,243,.10);border:1px solid rgba(238,240,243,.25)}',
    '.ctbl{max-height:320px;overflow:auto;margin-top:4px}.ctbl table{width:100%;border-collapse:collapse;font-size:13.5px}',
    '.ctbl th{color:var(--dim);font-weight:700;text-align:left;padding:6px 4px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--card)}',
    '.ctbl td{padding:6px 4px;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums}'
  ].join('\n');
  document.head.appendChild(s);
}

/* ---------- screen */
function ensureScreen() {
  if (q('prog')) return;
  var sec = document.createElement('section'); sec.className = 'screen'; sec.id = 'prog';
  sec.innerHTML = '<div class="wrap"><div class="pghead"><button class="pgback" id="pgBack" aria-label="Back">‹</button><h1>Progress</h1></div>' +
    '<div class="pgrange" id="pgRange" role="tablist" aria-label="Period"></div><div id="pgBody"><div class="skel" style="height:120px"></div></div></div>';
  var home = q('home'); home.parentNode.insertBefore(sec, home.nextSibling);
  q('pgBack').onclick = function () { buzz(); leave(); };
  q('pgRange').innerHTML = RANGES.map(function (r) { return '<button data-r="' + r[0] + '" class="' + (r[0] === range ? 'on' : '') + '">' + r[1] + '</button>'; }).join('');
  q('pgRange').onclick = function (ev) {
    var r = ev.target.getAttribute && ev.target.getAttribute('data-r'); if (!r) return;
    range = r; lsSet('gymProgRange', r); buzz();
    Array.prototype.forEach.call(this.children, function (b) { b.classList.toggle('on', b.getAttribute('data-r') === r); });
    render();
  };
}
/* back to home, then let the page put you wherever the live state says (e.g. a running workout) */
function leave() { window.show('home'); if (typeof window.render === 'function') window.render(); }
function open() {
  styles(); ensureScreen();
  window.show('prog');
  q('pgBody').style.opacity = D ? 0.5 : 1;          // refetch keeps the frame
  Promise.all([Store.stats(), Store.progress()]).then(function (v) {
    D = {stats: v[0], prog: v[1]}; q('pgBody').style.opacity = 1; render();
  }).catch(function (err) { q('pgBody').innerHTML = '<p class="pgsub">Could not load your progress (' + e(err.message) + ').</p>'; });
}

function card(id, title, sub, extra) {
  return '<div class="pgcard"><div class="pgch"><h3>' + title + '</h3><button class="pgtab" data-tab="' + id + '">Table</button></div>' +
    (sub ? '<p class="pgsub">' + sub + '</p>' : '') + (extra || '') + '<div id="pg_' + id + '"></div><div class="pgnote" id="pgn_' + id + '"></div></div>';
}

/* Photos are optional and private: the slider compares any two saved photos. */
function drawEvolution() {
  var box = q('pg_evo');
  if (!box || !window.GymPhoto) return;
  window.GymPhoto.data().then(function (d) {
    var ps = (d && d.photos) || [];
    if (ps.length < 2) { box.innerHTML = '<p class="cempty">Add two photos in Settings → Character to see your evolution.</p>'; return; }
    var opts = ps.map(function (p, i) { return '<option value="' + i + '">LV ' + p.lv + ' · ' + e(p.date) + '</option>'; }).join('');
    box.innerHTML = '<div class="evosel"><select id="evoA">' + opts + '</select><select id="evoB">' + opts + '</select></div>' +
      '<div class="evo"><img id="evoBase" alt="Earlier character"><img id="evoTop" alt="Later character">' +
      '<span class="evl l" id="evoLA"></span><span class="evl r" id="evoRB"></span>' +
      '<input type="range" id="evoRange" min="0" max="100" value="50" aria-label="Before and after"></div>';
    q('evoB').selectedIndex = ps.length - 1;
    function update() {
      var a = ps[+q('evoA').value], b = ps[+q('evoB').value];
      q('evoBase').src = a.img; q('evoTop').src = b.img;
      q('evoTop').style.clipPath = 'inset(0 ' + (100 - (+q('evoRange').value)) + '% 0 0)';
      q('evoLA').textContent = 'LV ' + a.lv + ' · ' + a.date;
      q('evoRB').textContent = 'LV ' + b.lv + ' · ' + b.date;
    }
    ['evoA', 'evoB', 'evoRange'].forEach(function (id) { q(id).addEventListener('input', update); });
    update();
  }).catch(function () { box.innerHTML = '<p class="cempty">Photos unavailable.</p>'; });
}

function render() {
  if (!D) return;
  var st = D.stats, pr = D.prog, cut = cutoff();
  var W = st.workouts.filter(function (w) { return w.date >= cut; });
  var P = st.prs.filter(function (p) { return p.date >= cut; });
  var weeksAll = (pr && pr.weeks) || [];
  var LW = weeksAll.filter(function (w) { return w.week >= monday(cut === '0000-00-00' ? '1970-01-05' : cut); });
  var spanWeeks = Math.max(1, cut === '0000-00-00'
    ? (W.length ? Math.ceil((Date.now() - new Date(W[0].date + 'T00:00:00')) / 6048e5) : 1)
    : Math.round(RANGES.filter(function (r) { return r[0] === range; })[0][2] / 7));
  var vol = W.reduce(function (a, w) { return a + w.volume; }, 0), sets = W.reduce(function (a, w) { return a + w.sets; }, 0);
  var mins = W.reduce(function (a, w) { return a + (w.minutes || 0); }, 0);
  var lvNow = pr && pr.overall ? pr.overall.lv : 0, lvThen = LW.length ? LW[0].lv : lvNow, dlv = lvNow - lvThen;
  var pcut = prevCutoff(), rlab = RANGES.filter(function (r) { return r[0] === range; })[0][1];
  var PW = pcut ? st.workouts.filter(function (w) { return w.date >= pcut && w.date < cut; }) : [];
  var PP = pcut ? st.prs.filter(function (p) { return p.date >= pcut && p.date < cut; }).length : 0;
  var hasPrev = pcut && st.workouts.some(function (w) { return w.date < cut; });
  function sum(L, k) { return L.reduce(function (a, w) { return a + (w[k] || 0); }, 0); }
  /* Level: how much the level moved during the previous period (levels, not %). */
  function lvCmp() {
    if (!pcut) return '';
    if (!hasPrev) return '<i title="No workouts before this period">first ' + rlab + '</i>';
    var PL = weeksAll.filter(function (w) { return w.week >= monday(pcut) && w.week < monday(cut); });
    var d = PL.length ? lvThen - PL[0].lv : 0;
    return '<i title="Level change in the previous ' + rlab + '">' + (d > 0 ? '▲ ' + d + ' prev ' + rlab : d < 0 ? '▼ ' + (-d) + ' prev ' + rlab : '± 0 prev ' + rlab) + '</i>';
  }
  function cmp(now, before, fmt) {
    if (!pcut) return '';
    if (!hasPrev) return '<i title="No workouts before this period">first ' + rlab + '</i>';
    return '<i title="Previous ' + rlab + ': ' + e(fmt ? fmt(before) : before) + '">' + delta(now, before) + '</i>';
  }

  var html = '<div class="pgtiles">' +
    tile('Workouts', W.length, (Math.round(10 * W.length / spanWeeks) / 10) + ' a week', cmp(W.length, PW.length)) +
    tile('Volume', big(vol) + '<span style="font-size:13px;color:var(--dim)"> kg</span>', W.length ? big(vol / W.length) + ' kg each' : '–',
      cmp(vol, sum(PW, 'volume'), function (v) { return big(v) + ' kg'; })) +
    tile('Sets', big(sets), W.length ? Math.round(sets / W.length) + ' each' : '–', cmp(sets, sum(PW, 'sets'))) +
    tile('Time', mins >= 600 ? Math.round(mins / 60) + ' h' : mins + ' min', W.length && mins ? Math.round(mins / W.length) + ' min each' : '–',
      cmp(mins, sum(PW, 'minutes'), function (v) { return v + ' min'; })) +
    tile('PRs', P.length, P.length ? 'latest ' + niceDate(P[P.length - 1].date).replace(/ \d{4}$/, '') : 'keep pushing', cmp(P.length, PP)) +
    tile('Level', 'LV ' + lvNow, dlv > 0 ? '▲ ' + dlv + ' this period' : dlv < 0 ? '▼ ' + (-dlv) + ' this period' : 'no change',
      lvCmp()) + '</div>';
  if (pcut) html += '<p class="pgsub" id="pgCmpNote">▲▼ = change vs the previous ' + rlab + '.</p>';

  html += card('train', 'Training per week', null, '<div class="pgseg" id="pgMetric">' +
    [['volume', 'Volume'], ['sets', 'Sets'], ['workouts', 'Workouts'], ['minutes', 'Time']].map(function (m) {
      return '<button data-m="' + m[0] + '" class="' + (m[0] === metric ? 'on' : '') + '">' + m[1] + '</button>'; }).join('') + '</div>');
  html += card('cal', 'Consistency', 'Each square is a day; brighter = more sets.');
  html += card('lvl', 'Lifter level', 'Your overall strength level (1–50), week by week.');
  html += card('evo', 'Your evolution', 'Before / after photos — stored only on this device.');
  html += card('mus', 'Muscles trained', 'Average sets per week. Most people grow best with about 10–20 per muscle.');
  html += card('str', 'Strength by muscle', 'Your best lift for each muscle against bodyweight standards. Tap one for its chart.');
  html += card('bw', 'Bodyweight', null, '');
  html += '<div class="pgcard"><div class="pgch"><h3>Personal records</h3><span class="pgsub" style="margin:0">' + P.length + ' in this period</span></div><div id="pg_prs"></div></div>';
  html += '<div class="pgcard"><div class="pgch"><h3>Exercises</h3></div><input class="search" id="pgSearch" placeholder="Search your exercises…" autocomplete="off" style="margin:6px 0 4px"><div id="pg_ex"></div></div>';
  q('pgBody').innerHTML = html;
  drawEvolution();

  /* training per week */
  var buckets = bucketize(W, cut);
  function drawTrain() {
    var lab = {volume: ' kg', sets: ' sets', workouts: '', minutes: ' min'}[metric];
    var items = buckets.list.map(function (b, i) {
      return {x: new Date(b.key + 'T12:00:00').getTime(), y: b[metric], now: i === buckets.list.length - 1,
        label: buckets.monthly ? new Date(b.key + 'T12:00:00').toLocaleDateString('en-GB', {month: 'short'}) : null,
        tip: (buckets.monthly ? new Date(b.key + 'T12:00:00').toLocaleDateString('en-GB', {month: 'long', year: 'numeric'}) : 'Week of ' + niceDate(b.key)) +
          (metric === 'workouts' ? '' : ' · ' + b.workouts + ' workouts')};
    });
    tables.train = function (box) { Charts.table(box, [buckets.monthly ? 'Month' : 'Week of', 'Workouts', 'Sets', 'Volume (kg)', 'Time (min)'],
      buckets.list.slice().reverse().map(function (b) { return [buckets.monthly ? b.key.slice(0, 7) : b.key, b.workouts, b.sets, b.volume.toLocaleString(), b.minutes]; })); };
    if (isTable('train')) tables.train(q('pg_train'));
    else Charts.bars(q('pg_train'), {items: items, unit: lab, yFmt: metric === 'workouts' ? function (v) { return String(Math.round(v)); } : null,
      emptyText: 'No workouts in this period yet.'});
    var avg = buckets.list.length ? buckets.list.reduce(function (a, b) { return a + b[metric]; }, 0) / buckets.list.length : 0;
    q('pgn_train').innerHTML = 'Average <b>' + (metric === 'workouts' ? Math.round(avg * 10) / 10 : big(avg)) + lab + '</b> a ' + (buckets.monthly ? 'month' : 'week') + ' in this period.';
  }
  drawTrain();
  q('pgMetric').onclick = function (ev) {
    var m = ev.target.getAttribute && ev.target.getAttribute('data-m'); if (!m) return;
    metric = m; lsSet('gymProgMetric', m); buzz();
    Array.prototype.forEach.call(this.children, function (b) { b.classList.toggle('on', b.getAttribute('data-m') === m); });
    drawTrain();
  };

  /* consistency calendar (always the last 26 weeks, or the range if shorter) */
  var days = {}; st.workouts.forEach(function (w) { days[w.date] = (days[w.date] || 0) + w.sets; });
  var calWeeks = range === '1m' ? 5 : range === '3m' ? 13 : 26;
  tables.cal = function (box) { Charts.table(box, ['Date', 'Workout', 'Sets'], st.workouts.filter(function (w) { return w.date >= cut; }).slice().reverse().map(function (w) { return [w.date, w.title, w.sets]; })); };
  if (isTable('cal')) tables.cal(q('pg_cal'));
  else Charts.calendar(q('pg_cal'), {days: days, weeks: calWeeks, fmt: function (v) { return v + ' sets'; }});
  var trained = Object.keys(days).filter(function (d) { return d >= cut; }).length;
  q('pgn_cal').innerHTML = '<b>' + trained + '</b> training days in this period' + (D.prog && plan && plan.week ? ' · streak <b>' + plan.week.streak_weeks + '</b> ' + (plan.week.streak_weeks === 1 ? 'week' : 'weeks') : '') + '.';

  /* level */
  tables.lvl = function (box) { Charts.table(box, ['Week of', 'Level', 'Score'], LW.slice().reverse().map(function (w) { return [w.week, 'LV ' + w.lv, w.score]; })); };
  if (isTable('lvl')) tables.lvl(q('pg_lvl'));
  else Charts.line(q('pg_lvl'), {points: LW.map(function (w) { return {x: new Date(w.week + 'T12:00:00').getTime(), y: w.lv, label: 'Week of ' + niceDate(w.week)}; }),
    yFmt: function (v) { return 'LV ' + Math.round(v); }, emptyText: 'Your level history appears after a couple of weeks of training.'});
  q('pgn_lvl').innerHTML = pr && pr.overall ? 'Now <b>LV ' + pr.overall.lv + ' · ' + e(pr.overall.tier) + '</b>' + (dlv ? ' (' + (dlv > 0 ? '+' : '') + dlv + ' this period)' : '') + '.' : '';

  /* muscles trained: average weekly sets per muscle over the period */
  var mSum = {}, nW = Math.max(1, LW.length);
  LW.forEach(function (w) { Object.keys(w.sets || {}).forEach(function (m) { mSum[m] = (mSum[m] || 0) + w.sets[m]; }); });
  var names = window.MN || {};
  var mItems = Object.keys(names).map(function (m) { return {id: m, label: names[m], value: Math.round(10 * (mSum[m] || 0) / nW) / 10}; })
    .sort(function (a, b) { return b.value - a.value; });
  mItems.forEach(function (it) { it.text = it.value + ' / wk'; });
  tables.mus = function (box) { Charts.table(box, ['Muscle', 'Sets per week'], mItems.map(function (i) { return [i.label, i.value]; })); };
  if (isTable('mus')) tables.mus(q('pg_mus'));
  else Charts.hbars(q('pg_mus'), {items: mItems, max: Math.max(22, mItems.length ? mItems[0].value : 0), band: [10, 20], bandLabel: '10–20 sets a week',
    emptyText: 'Train for a week to see which muscles you hit.'});
  var low = mItems.filter(function (i) { return i.value < 10 && i.value > 0; }).slice(-3).map(function (i) { return i.label; });
  var zero = mItems.filter(function (i) { return !i.value; }).map(function (i) { return i.label; });
  q('pgn_mus').innerHTML = LW.length ? (low.length ? 'Could use more: <b>' + e(low.join(', ')) + '</b>. ' : '') + (zero.length ? 'Not trained: ' + e(zero.slice(0, 4).join(', ')) + (zero.length > 4 ? '…' : '') + '.' : '') : '';

  /* strength by muscle */
  var mus = (pr && pr.muscles) || {};
  var sItems = Object.keys(mus).map(function (m) {
    var x = mus[m];
    return {label: names[m] || m, value: Math.max(0, x.score), color: window.tierColour ? tierColour(x) : null,
      text: x.level + (x.e1rm ? ' · ' + kg(x.e1rm) + ' kg' : ''), lift: x.lift, raw: x,
      onclick: function () { exerciseSheet(x.lift); }};
  }).sort(function (a, b) { return b.value - a.value; });
  tables.str = function (box) { Charts.table(box, ['Muscle', 'Level', 'Best lift', 'Est. 1RM (kg)'], sItems.map(function (i) { return [i.label, i.raw.level, i.lift, kg(i.raw.e1rm)]; })); };
  if (isTable('str')) tables.str(q('pg_str'));
  else Charts.hbars(q('pg_str'), {items: sItems, max: 5, emptyText: 'Log a few lifts (or set your starting level) to see this.'});
  q('pgn_str').innerHTML = pr && pr.strongest ? 'Strongest: <b>' + e(names[pr.strongest] || pr.strongest) + '</b> · weakest: <b>' + e(names[pr.weakest] || pr.weakest) + '</b>.' : '';

  /* bodyweight */
  var BW = (st.bodyweight || []).filter(function (b) { return b.date >= cut; });
  tables.bw = function (box) { Charts.table(box, ['Date', 'kg'], BW.slice().reverse().map(function (b) { return [b.date, kg(b.kg)]; })); };
  if (isTable('bw')) tables.bw(q('pg_bw'));
  else Charts.line(q('pg_bw'), {points: BW.map(function (b) { return {x: new Date(b.date + 'T12:00:00').getTime(), y: b.kg, label: niceDate(b.date)}; }),
    unit: ' kg', yFmt: function (v) { return kg(v); }, emptyText: Store.canLogBodyweight ? 'Log your weight below; the chart appears after two weigh-ins.' : 'No weigh-ins in this period.'});
  var bwNote = '';
  if (BW.length >= 2) { var dd = Math.round(10 * (BW[BW.length - 1].kg - BW[0].kg)) / 10; bwNote = 'Latest <b>' + kg(BW[BW.length - 1].kg) + ' kg</b> (' + (dd > 0 ? '+' : '') + dd + ' kg this period).'; }
  else if (BW.length) bwNote = 'Latest <b>' + kg(BW[BW.length - 1].kg) + ' kg</b>.';
  if (Store.canLogBodyweight) bwNote += '<div class="pgbw"><input class="txt num" id="pgBwIn" type="number" inputmode="decimal" step="0.1" placeholder="Today’s weight (kg)"><button id="pgBwGo">Log</button></div>';
  else bwNote += ' <span style="color:var(--dim2)">From your smart scale.</span>';
  q('pgn_bw').innerHTML = bwNote;
  if (q('pgBwGo')) q('pgBwGo').onclick = function () {
    Store.logBodyweight(q('pgBwIn').value).then(function () { buzz([10, 40, 10]); toastOk('Weight logged'); open(); }).catch(function (err) { toast(err.message); });
  };

  /* personal records */
  var prList = P.slice().reverse(), shown = 8;
  function drawPrs() {
    q('pg_prs').innerHTML = prList.length ? prList.slice(0, shown).map(function (p, i) {
      return '<div class="pgrow" data-ex="' + e(p.ex) + '"><span class="pgtro">🏆</span><div><b>' + e(p.ex) + '</b><small>' + e(niceDate(p.date)) + ' · ' +
        (p.kind === 'weight' ? 'heaviest weight' : 'best estimated 1RM') + '</small></div><span class="v">' + kg(p.w) + ' × ' + p.r +
        '<small>' + (p.kind === 'weight' ? 'kg' : kg(p.e1rm) + ' kg 1RM') + '</small></span></div>';
    }).join('') + (prList.length > shown ? '<button class="pgmore" id="pgPrMore">Show all ' + prList.length + '</button>' : '')
      : '<p class="cempty">No records in this period yet. They show up here the moment you beat a previous best.</p>';
    if (q('pgPrMore')) q('pgPrMore').onclick = function () { shown = prList.length; drawPrs(); };
  }
  drawPrs();
  q('pg_prs').onclick = rowClick;

  /* exercises */
  function drawEx(f) {
    f = (f || '').toLowerCase();
    var list = st.exercises.filter(function (x) { return !f || x.name.toLowerCase().indexOf(f) >= 0; });
    q('pg_ex').innerHTML = list.length ? list.slice(0, f ? 50 : 12).map(function (x) {
      return '<div class="pgrow" data-ex="' + e(x.name) + '"><div><b>' + e(x.name) + '</b><small>' + x.sessions + (x.sessions === 1 ? ' session' : ' sessions') + ' · last ' + e(niceDate(x.last_date).replace(/ \d{4}$/, '')) +
        '</small></div><span class="v">' + kg(x.best_e1rm) + ' kg<small>best 1RM</small></span></div>';
    }).join('') + (!f && list.length > 12 ? '<p class="pgsub" style="margin:8px 2px 0">Search to find the other ' + (list.length - 12) + '.</p>' : '')
      : '<p class="cempty">' + (f ? 'No exercise matches.' : 'Your exercises appear here after your first workout.') + '</p>';
  }
  drawEx('');
  q('pgSearch').oninput = function () { drawEx(this.value); };
  q('pg_ex').onclick = rowClick;

  /* table toggles */
  Array.prototype.forEach.call(q('pgBody').querySelectorAll('.pgtab'), function (b) {
    var id = b.getAttribute('data-tab'); b.classList.toggle('on', isTable(id)); b.textContent = isTable(id) ? 'Chart' : 'Table';
    b.onclick = function () { tableOn[id] = !tableOn[id]; buzz(); render(); };
  });
}
var tableOn = {};
function isTable(id) { return !!tableOn[id]; }
function tile(k, v, sub, cmp) { return '<div><small>' + k + '</small><b class="num">' + v + '</b><em>' + sub + '</em>' + (cmp || '') + '</div>'; }
function rowClick(ev) { var r = ev.target.closest && ev.target.closest('[data-ex]'); if (r) { buzz(); exerciseSheet(r.getAttribute('data-ex')); } }

/* weekly buckets across the period (monthly when the period is long), zero-filled */
function bucketize(W, cut) {
  var first = cut !== '0000-00-00' ? cut : (W.length ? W[0].date : dstr(new Date()));
  var monthly = (Date.now() - new Date(first + 'T00:00:00')) / 864e5 > 400, list = [], map = {};
  var d = new Date(first + 'T12:00:00');
  if (monthly) d.setDate(1); else d.setDate(d.getDate() - (d.getDay() + 6) % 7);
  var end = new Date();
  for (var guard = 0; d <= end && guard < 600; guard++) {
    var k = dstr(d), b = {key: k, workouts: 0, sets: 0, volume: 0, minutes: 0};
    list.push(b); map[k] = b;
    if (monthly) d.setMonth(d.getMonth() + 1); else d.setDate(d.getDate() + 7);
  }
  W.forEach(function (w) {
    var k = monthly ? w.date.slice(0, 8) + '01' : monday(w.date), b = map[k];
    if (b) { b.workouts++; b.sets += w.sets; b.volume += w.volume; b.minutes += w.minutes || 0; }
  });
  return {list: list, monthly: monthly};
}

/* ---------- one exercise */
var exMetric = 'e1rm';
function exerciseSheet(name) {
  if (!name) return;
  var rec = D && D.stats.exercises.filter(function (x) { return x.name === name; })[0];
  Store.history(name).then(function (h) {
    var S = (h.sessions || []).map(function (s) {
      var heavy = 0, reps = 0; (s.sets || []).forEach(function (x) { heavy = Math.max(heavy, x.w); reps += x.r; });
      return {date: s.date, x: new Date(s.date + 'T12:00:00').getTime(), e1rm: s.e1rm, heavy: heavy, volume: s.volume, reps: reps, pr: s.pr, sets: s.sets || []};
    });
    var repBest = {};                                   // best weight lifted for at least N reps
    S.forEach(function (s) { s.sets.forEach(function (x) {
      for (var n = 1; n <= Math.min(x.r, 20); n++) if (!repBest[n] || x.w > repBest[n].w) repBest[n] = {w: x.w, date: s.date, r: x.r};
    }); });
    openSheet('<h2 style="margin:0 0 2px;font-size:22px">' + e(name) + '</h2><p class="pgsub">' + S.length + (S.length === 1 ? ' session' : ' sessions') +
      (rec ? ' · since ' + e(niceDate(rec.first_date)) : '') + '</p>' +
      (rec ? '<div class="pgtiles">' + tile('Best 1RM', kg(rec.best_e1rm) + '<span style="font-size:13px;color:var(--dim)"> kg</span>', niceDate(rec.best_e1rm_date).replace(/ \d{4}$/, '')) +
        tile('Heaviest', kg(rec.heaviest) + '<span style="font-size:13px;color:var(--dim)"> kg</span>', niceDate(rec.heaviest_date).replace(/ \d{4}$/, '')) +
        tile('Best session', big(rec.best_volume) + '<span style="font-size:13px;color:var(--dim)"> kg</span>', 'volume') +
        tile('Total reps', big(rec.total_reps), rec.sessions + (rec.sessions === 1 ? ' session' : ' sessions')) + tile('Total volume', big(rec.total_volume), 'kg lifted') +
        tile('PRs', S.filter(function (s) { return s.pr; }).length, '1RM records') + '</div>' : '') +
      '<div class="pgcard" style="background:var(--card)"><div class="pgseg" id="exMetric">' +
      [['e1rm', 'Est. 1RM'], ['heavy', 'Heaviest'], ['volume', 'Volume'], ['reps', 'Reps']].map(function (m) {
        return '<button data-m="' + m[0] + '" class="' + (m[0] === exMetric ? 'on' : '') + '">' + m[1] + '</button>'; }).join('') +
      '</div><div id="exChart"></div><div class="pgnote" id="exNote"></div></div>' +
      '<div class="pgcard"><div class="pgch"><h3>Rep maxes</h3></div><p class="pgsub">Heaviest weight you’ve lifted for at least that many reps.</p><div id="exReps"></div></div>' +
      '<div class="pgcard"><div class="pgch"><h3>Recent sessions</h3></div><div id="exSess"></div></div>');
    function draw() {
      var lab = {e1rm: 'Estimated 1-rep max', heavy: 'Heaviest set', volume: 'Session volume', reps: 'Total reps'}[exMetric];
      var pts = S.map(function (s) { return {x: s.x, y: s[exMetric], pr: exMetric === 'e1rm' && s.pr, label: niceDate(s.date)}; });
      if (exMetric === 'volume' || exMetric === 'reps')
        Charts.bars(q('exChart'), {items: pts.map(function (p, i) { return {x: p.x, y: p.y, tip: p.label, now: i === pts.length - 1}; }), unit: exMetric === 'volume' ? ' kg' : ' reps'});
      else Charts.line(q('exChart'), {points: pts, unit: ' kg', yFmt: function (v) { return kg(v); }});
      var first = S.length ? S[0][exMetric] : 0, last = S.length ? S[S.length - 1][exMetric] : 0;
      q('exNote').innerHTML = lab + (S.length >= 2 && first ? ': <b>' + (last >= first ? '+' : '') + Math.round(100 * (last - first) / first) + '%</b> since your first session' : '') +
        (exMetric === 'e1rm' ? ' · <span style="color:#ffb020">●</span> = PR' : '') + '.';
    }
    draw();
    q('exMetric').onclick = function (ev) {
      var m = ev.target.getAttribute && ev.target.getAttribute('data-m'); if (!m) return;
      exMetric = m; buzz(); Array.prototype.forEach.call(this.children, function (b) { b.classList.toggle('on', b.getAttribute('data-m') === m); }); draw();
    };
    var R = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15].filter(function (n) { return repBest[n]; });
    Charts.table(q('exReps'), ['Reps', 'Weight', 'Est. 1RM', 'When'], R.map(function (n) {
      var b = repBest[n]; return [n + (n === 1 ? ' rep' : ' reps'), kg(b.w) + ' kg', kg(n === 1 ? b.w : b.w * (1 + n / 30)) + ' kg', niceDate(b.date)];
    }));
    q('exSess').innerHTML = S.slice(-10).reverse().map(function (s) {
      return '<div class="pgrow" style="cursor:default"><div><b>' + e(niceDate(s.date)) + (s.pr ? ' 🏆' : '') + '</b><small>' +
        e(s.sets.map(function (x) { return (x.w ? kg(x.w) + '×' : '') + x.r; }).join(' · ')) + '</small></div><span class="v">' + kg(s.e1rm) + '<small>kg 1RM</small></span></div>';
    }).join('') || '<p class="cempty">No sessions yet.</p>';
  }).catch(function () { toast('Could not load ' + name); });
}

/* Android Back (the app asks window.GymBack first): close what's on top, Progress -> Home */
window.GymBack = function () {
  var on = function (id) { var x = q(id); return !!(x && x.classList.contains('on')); };
  if (on('sheet') && window.closeSheet) { closeSheet(); return true; }
  if (on('lvup')) { q('lvup').classList.remove('on'); return true; }
  if (on('prog')) { leave(); return true; }
  if (on('done') && q('homeBtn')) { q('homeBtn').click(); return true; }
  return false;
};

styles();          // the home-screen button uses these styles too
window.Progress = {open: open, exercise: exerciseSheet,
  refreshEvolution: function () { if (D) drawEvolution(); }};
})();
