/* Gym Companion cardio: the in-workout cardio panel (timer, mode, speed/distance/kcal, log interval) and a
 * deterministic, offline "health benefits" analysis of a whole workout. No AI, no network.
 * Calories: MET x bodyweight (kg) x hours, METs from the Compendium of Physical Activities (approximate).
 * Uses page helpers: $, esc, op, buzz, toast, now, prog, plan, MN, GymCore.
 */
(function () {
'use strict';
var MODES = ['jog', 'run', 'sprint'];
var LABELS = {treadmill: {jog: 'Jog', run: 'Run', sprint: 'Sprint'}, other: {jog: 'Easy', run: 'Steady', sprint: 'Sprint'}};
var DEFAULT_KMH = {jog: 8, run: 10.5, sprint: 16};
// treadmill MET by speed (km/h): walking -> running, interpolated
var TREAD = [[3, 2.8], [4, 3.0], [5.5, 3.8], [6.5, 5.0], [8, 8.3], [9.7, 9.8], [11.3, 11.0], [12.9, 11.8], [14.5, 12.8], [16.1, 14.5], [17.7, 16.0], [19.3, 19.0], [22.5, 23.0]];
var MACHINE_MET = {cycling: {jog: 5.5, run: 7.5, sprint: 11.0}, rowing: {jog: 4.8, run: 7.0, sprint: 12.0}, elliptical: {jog: 4.6, run: 6.0, sprint: 8.5}};

function q(id) { return document.getElementById(id); }
function e(t) { return window.esc(String(t == null ? '' : t)); }
function kind(name) {
  var n = String(name || '').toLowerCase();
  return /tread|run/.test(n) ? 'treadmill' : /cycl|bike/.test(n) ? 'cycling' : /row/.test(n) ? 'rowing' : /ellip|cross/.test(n) ? 'elliptical' : 'treadmill';
}
function labels(name) { return kind(name) === 'treadmill' ? LABELS.treadmill : LABELS.other; }
function met(name, mode, kmh) {
  var k = kind(name);
  if (k !== 'treadmill') return MACHINE_MET[k][mode] || MACHINE_MET[k].run;
  var v = kmh > 0 ? kmh : DEFAULT_KMH[mode] || 10;
  if (v <= TREAD[0][0]) return TREAD[0][1];
  for (var i = 1; i < TREAD.length; i++) if (v <= TREAD[i][0]) {
    var a = TREAD[i - 1], b = TREAD[i]; return a[1] + (b[1] - a[1]) * (v - a[0]) / (b[0] - a[0]);
  }
  return TREAD[TREAD.length - 1][1];
}
function bodyweight() { return (window.prog && prog.bodyweight) || 75; }
function kcal(name, mode, kmh, sec, kg) { return Math.round(met(name, mode, kmh) * (kg || bodyweight()) * sec / 3600); }
function mmss(sec) { sec = Math.max(0, Math.round(sec)); var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return (h ? h + ':' + ('0' + m).slice(-2) : m) + ':' + ('0' + s).slice(-2); }
function nowMs() { return typeof window.now === 'function' ? window.now() : Date.now(); }
function elapsed(ex) { var t = ex.timer || {}; return (t.acc || 0) + (t.run_since ? Math.max(0, nowMs() - t.run_since) : 0); }
function setText(d, name) {
  var L = labels(name);
  return (L[d.mode] || d.mode) + ' · ' + mmss(d.sec) + (d.km ? ' · ' + d.km + ' km' : '') + (d.kmh ? ' · ' + d.kmh + ' km/h' : '') + (d.kcal ? ' · ' + d.kcal + ' kcal' : '');
}

/* ---------- styles */
(function styles() {
  if (q('cardioCss')) return;
  var s = document.createElement('style'); s.id = 'cardioCss';
  s.textContent = [
    '.cdp{margin-top:6px}.cdclock{font:800 56px/1 ui-monospace,Menlo,monospace;text-align:center;letter-spacing:.02em;margin:6px 0 10px}',
    '.cdclock.run{color:var(--volt)}',
    '.cdbtns{display:grid;grid-template-columns:2fr 1fr;gap:8px;margin-bottom:12px}.cdbtns button{height:52px;border-radius:16px;font-weight:800;font-size:17px;background:var(--card2);color:var(--text)}',
    '.cdbtns button.go{background:var(--volt);color:#0c0e12}',
    '.cdmode{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px}.cdmode button{height:42px;border-radius:12px;background:var(--card2);color:var(--dim);font-weight:800}',
    '.cdmode button.on{background:var(--line);color:var(--text);box-shadow:inset 0 0 0 1.5px var(--volt)}',
    '.cdin{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}.cdin label{display:block;font-size:12px;color:var(--dim);font-weight:700}',
    '.cdin input{width:100%;margin:4px 0 0;height:46px;text-align:center;font-size:18px}',
    '.cdset{display:flex;align-items:center;gap:8px;padding:9px 12px;border-radius:12px;background:var(--card2);margin-bottom:6px;font-size:14.5px}',
    '.cdset b{flex:1;min-width:0}.cdset .x{color:var(--dim);font-size:16px;padding:4px 8px}',
    /* benefits card */
    '.hb{background:var(--card);border-radius:20px;padding:16px;margin-top:14px;text-align:left}',
    '.hbh{display:flex;align-items:center;gap:14px;margin-bottom:10px}.hbs{width:64px;height:64px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font:900 22px/1 system-ui,sans-serif;color:#0c0e12;background:var(--volt)}',
    '.hbh b{display:block;font-size:18px}.hbh small{color:var(--dim);font-size:13px}',
    '.hb h4{margin:12px 0 6px;font-size:14px;color:var(--dim);text-transform:uppercase;letter-spacing:.06em}',
    '.hb ul{margin:0;padding-left:18px}.hb li{margin:4px 0;font-size:14.5px;line-height:1.45}',
    '.hbbar{display:grid;grid-template-columns:minmax(96px,34%) 1fr auto;gap:8px;align-items:center;font-size:13px;margin:5px 0}.hbbar i{display:block;height:8px;border-radius:4px;background:var(--card2);position:relative;overflow:hidden}',
    '.hbbar i span{position:absolute;left:0;top:0;bottom:0;background:var(--volt);border-radius:4px}.hbbar em{font-style:normal;text-align:right;color:var(--dim);white-space:nowrap}',
    '.hbnote{color:var(--dim2);font-size:12px;margin-top:10px}'
  ].join('\n');
  document.head.appendChild(s);
})();

/* ---------- the in-workout panel (built once per exercise so polling never wipes what you typed) */
var P = {key: null, mode: 'run', kcalEdited: false, tick: null};
function render(ex, idx) {
  var card = q('exCard'); if (!card) return;
  var panel = q('cardioPanel');
  if (!panel) { panel = document.createElement('div'); panel.id = 'cardioPanel'; panel.className = 'cdp'; card.insertBefore(panel, q('logBtn')); }
  panel.style.display = '';
  var key = idx + ':' + ex.name;
  if (P.key !== key) build(panel, ex, idx, key);
  sync(ex, idx);
}
function hide() { var p = q('cardioPanel'); if (p) p.style.display = 'none'; if (P.tick) { clearInterval(P.tick); P.tick = null; } P.key = null; }
function build(panel, ex, idx, key) {
  P.key = key; P.kcalEdited = false;
  var last = (ex.done || []).filter(function (d) { return d.mode; }).slice(-1)[0];
  P.mode = last ? last.mode : 'run';
  var L = labels(ex.name), tread = kind(ex.name) === 'treadmill';
  panel.innerHTML = '<div class="cdclock num" id="cdClock">0:00</div>' +
    '<div class="cdbtns"><button class="go" id="cdGo">Start</button><button id="cdReset">Reset</button></div>' +
    '<div class="cdmode" id="cdMode">' + MODES.map(function (m) { return '<button data-m="' + m + '">' + L[m] + '</button>'; }).join('') + '</div>' +
    '<div class="cdin">' +
    '<label>Speed (km/h)<input class="txt num" id="cdKmh" type="number" inputmode="decimal" step="0.1" min="0" max="60" placeholder="' + (tread ? DEFAULT_KMH[P.mode] : '–') + '"></label>' +
    '<label>Distance (km)<input class="txt num" id="cdKm" type="number" inputmode="decimal" step="0.01" min="0" max="200" placeholder="auto"></label>' +
    '<label>Minutes<input class="txt num" id="cdMin" type="number" inputmode="decimal" step="0.5" min="0" placeholder="from timer"></label>' +
    '<label>Calories (kcal)<input class="txt num" id="cdKcal" type="number" inputmode="numeric" step="1" min="0" placeholder="0"></label></div>';
  var lb = q('logBtn'); lb.style.display = '';
  q('cdMode').onclick = function (ev) {
    var m = ev.target.getAttribute && ev.target.getAttribute('data-m'); if (!m) return;
    P.mode = m; buzz(8); markMode(); if (tread && !q('cdKmh').value) q('cdKmh').placeholder = DEFAULT_KMH[m]; suggest(ex);
  };
  q('cdGo').onclick = function () {
    var running = !!(currentEx() && currentEx().timer && currentEx().timer.run_since);
    buzz(12); op({op: 'ctimer', ex: idx, action: running ? 'pause' : 'start'}).catch(function () { toast('Offline — timer not saved'); });
  };
  q('cdReset').onclick = function () { buzz(); op({op: 'ctimer', ex: idx, action: 'reset'}); q('cdMin').value = ''; };
  ['cdKmh', 'cdKm', 'cdMin'].forEach(function (id) { q(id).addEventListener('input', function () { suggest(currentEx() || ex); }); });
  q('cdKcal').addEventListener('input', function () { P.kcalEdited = this.value !== ''; });
  markMode();
  if (P.tick) clearInterval(P.tick);
  P.tick = setInterval(function () { var x = currentEx(); if (x && x.cardio) { clock(x); suggest(x); } }, 500);
}
function currentEx() { return typeof window.curEx === 'function' ? window.curEx() : null; }
function markMode() { Array.prototype.forEach.call(q('cdMode').children, function (b) { b.classList.toggle('on', b.getAttribute('data-m') === P.mode); }); }
function seconds(ex) { var m = parseFloat(q('cdMin').value); return m > 0 ? Math.round(m * 60) : Math.round(elapsed(ex) / 1000); }
/* fill the empty fields from the others: distance = speed x time, speed = distance / time, kcal from MET */
function values(ex) {
  var sec = seconds(ex), kmh = parseFloat(q('cdKmh').value), km = parseFloat(q('cdKm').value);
  if (!(kmh > 0) && km > 0 && sec > 0) kmh = Math.round(km / (sec / 3600) * 10) / 10;
  if (!(kmh > 0) && kind(ex.name) === 'treadmill') kmh = DEFAULT_KMH[P.mode];
  if (!(km > 0) && kmh > 0 && sec > 0 && kind(ex.name) === 'treadmill') km = Math.round(kmh * sec / 3600 * 100) / 100;
  var kc = P.kcalEdited ? parseFloat(q('cdKcal').value) || 0 : kcal(ex.name, P.mode, kmh, sec);
  return {sec: sec, kmh: kmh > 0 ? kmh : 0, km: km > 0 ? km : 0, kcal: kc, mode: P.mode};
}
function suggest(ex) {
  if (!q('cdKcal')) return;
  var v = values(ex);
  q('cdKm').placeholder = v.km ? v.km : 'auto';
  if (!P.kcalEdited) q('cdKcal').value = v.sec ? v.kcal : '';
}
function clock(ex) {
  var c = q('cdClock'); if (!c) return;
  var run = !!(ex.timer && ex.timer.run_since);
  c.textContent = mmss(elapsed(ex) / 1000); c.classList.toggle('run', run);
  var go = q('cdGo'); go.textContent = run ? 'Pause' : (elapsed(ex) > 0 ? 'Resume' : 'Start');
}
function sync(ex, idx) {
  clock(ex);
  var lb = q('logBtn'); lb.textContent = 'Log interval';
  lb.onclick = null;
  var sets = (ex.done || []).filter(function (d) { return d.mode; });
  q('exSets').innerHTML = sets.length ? sets.map(function (d, i) {
    return '<div class="cdset"><b>' + e(setText(d, ex.name)) + '</b>' + (i === sets.length - 1 ? '<button class="x" data-cundo="1" aria-label="Undo">↺</button>' : '') + '</div>';
  }).join('') : '<p class="sub" style="margin:2px 2px 8px">Start the timer, then log each interval (sprints can be several).</p>';
  var u = q('exSets').querySelector('[data-cundo]');
  if (u) u.onclick = function () { buzz(); op({op: 'undo', ex: idx}); };
}
function logInterval() {
  var ex = currentEx(); if (!ex || !ex.cardio) return false;
  var v = values(ex);
  if (!(v.sec > 0) && !(v.km > 0)) { toast('Start the timer or enter minutes/distance'); return true; }
  buzz([12, 40, 12]);
  op({op: 'clog', ex: window.live.current, sec: v.sec, km: v.km, kmh: v.kmh, kcal: v.kcal, mode: v.mode})
    .then(function () { q('cdMin').value = ''; q('cdKm').value = ''; P.kcalEdited = false; q('cdKcal').value = ''; })
    .catch(function () { toast('Offline — interval not saved'); });
  return true;
}

/* ---------- health benefits: deterministic analysis of one workout ----------
 * w = {exercises:[{name, sets:[{w,r,type}|{type:'cardio',sec,km,kmh,kcal,mode}]}], minutes, hr_avg, hr_max, prs}
 * ctx = {bodyweight, weekAvg (workouts/week, last 4 weeks), streak} */
function analyze(w, ctx) {
  ctx = ctx || {};
  var C = window.GymCore, cardio = [], strength = [], muscles = {}, prs = (w.prs || []).length;
  (w.exercises || []).forEach(function (x) {
    (x.sets || []).forEach(function (s) {
      if (s.type === 'cardio' || s.mode) {
        var c = {name: x.name, sec: +s.sec || 0, km: +s.km || 0, kmh: +s.kmh || 0, kcal: +s.kcal || 0, mode: s.mode || 'jog'};
        if (!c.kcal && c.sec) c.kcal = kcal(c.name, c.mode, c.kmh, c.sec, ctx.bodyweight);   // older entries without calories
        cardio.push(c);
      }
      else if (s.type !== 'warmup' && +s.r > 0) {
        strength.push({name: x.name, w: +s.w || 0, r: +s.r});
        var mm = C && C.musclesFor ? C.musclesFor(x.name, []) : {primary: []};
        (mm.primary || []).forEach(function (m) { muscles[m] = (muscles[m] || 0) + 1; });
      }
    });
  });
  var cMin = cardio.reduce(function (a, c) { return a + c.sec; }, 0) / 60;
  var hrFrac = w.hr_avg ? w.hr_avg / 190 : 0;                    // ~HRmax for an adult in their 30s
  var vigMin = cardio.reduce(function (a, c) { return a + (c.mode === 'sprint' || c.mode === 'run' || hrFrac >= 0.77 ? c.sec / 60 : 0); }, 0);
  var modMin = cMin - vigMin, eqMin = modMin + 2 * vigMin;        // guidelines: 1 vigorous min = 2 moderate
  var kc = cardio.reduce(function (a, c) { return a + c.kcal; }, 0);
  var sets = strength.length, vol = strength.reduce(function (a, s) { return a + s.w * s.r; }, 0);
  var mus = Object.keys(muscles), names = window.MN || {};
  var hasSprint = cardio.some(function (c) { return c.mode === 'sprint'; });

  // effectiveness: cardio part /50, strength part /50, rescaled when the workout is only one of them
  var cardioPts = cardio.length ? Math.min(1, eqMin / 50) * 35 + (cMin ? 15 * Math.min(1, vigMin / Math.max(cMin, 1)) : 0) : 0;
  var strPts = sets ? Math.min(1, sets / 15) * 30 + Math.min(1, mus.length / 6) * 12 + Math.min(1, prs / 2) * 8 : 0;
  var score = cardio.length && sets ? cardioPts + strPts : cardio.length ? cardioPts * 2 : strPts * 2;
  if (ctx.weekAvg >= 3) score += 5; else if (ctx.weekAvg > 0 && ctx.weekAvg < 1.5) score -= 5;
  score = Math.max(0, Math.min(100, Math.round(score)));
  var label = score >= 80 ? 'Excellent' : score >= 60 ? 'Strong' : score >= 40 ? 'Solid' : 'Light';

  var benefits = [];
  if (cardio.length) {
    benefits.push('Cardiorespiratory endurance: ' + Math.round(cMin) + ' min of cardio' + (kc ? ' (about ' + kc + ' kcal)' : '') + ' trains your heart and lungs to deliver oxygen.');
    if (eqMin >= 20 || vigMin >= 8) benefits.push('VO₂max and stroke volume: enough sustained ' + (vigMin >= 8 ? 'vigorous ' : '') + 'effort to push your aerobic capacity up over the coming weeks.');
    benefits.push('Blood pressure and insulin sensitivity: regular sessions like this lower resting blood pressure and help your muscles use blood sugar.');
    if (kc >= 150) benefits.push('Weight management: ' + kc + ' kcal burned is a meaningful share of a daily calorie deficit.');
    if (hasSprint) benefits.push('Sprints: anaerobic power and speed, plus a bigger after-burn (EPOC) for an hour or more afterwards.');
  }
  if (sets) {
    var top = mus.sort(function (a, b) { return muscles[b] - muscles[a]; }).slice(0, 4).map(function (m) { return names[m] || m; });
    benefits.push('Strength and muscle: ' + sets + ' working sets' + (top.length ? ' mainly for ' + top.join(', ') : '') + ' — the stimulus that builds strength and size.');
    benefits.push('Bones and metabolism: loading strengthens bones and joints, and extra muscle raises the calories you burn at rest.');
    if (prs) benefits.push(prs + ' personal record' + (prs > 1 ? 's' : '') + ': clear proof of progressive overload.');
  }

  var how = [];
  if (cardio.length) how.push(['Cardio vs weekly goal', Math.min(100, Math.round(100 * eqMin / 150)), Math.round(eqMin) + ' of 150 min']);
  if (cardio.length) how.push(['Intensity', Math.round(100 * (cMin ? vigMin / cMin : 0)), w.hr_avg ? 'avg ' + w.hr_avg + ' bpm' : (hasSprint ? 'sprints' : vigMin ? 'running pace' : 'easy pace')]);
  if (sets) how.push(['Training volume', Math.min(100, Math.round(100 * sets / 15)), sets + ' sets']);
  if (sets) how.push(['Muscles covered', Math.min(100, Math.round(100 * mus.length / 6)), mus.length + ' groups']);
  if (ctx.weekAvg != null) how.push(['Consistency', Math.min(100, Math.round(100 * ctx.weekAvg / 3)), ctx.weekAvg + '/week']);

  var next;
  if (cardio.length && !sets) {
    next = hasSprint ? (cMin < 15 ? 'Add a 10-minute easy cool-down after the sprints to build your aerobic base too.' : 'Great mix. Next time try one more sprint, or the same sprints slightly faster.')
      : cMin < 20 ? 'Aim for 20–30 minutes next time, or add 4–6 × 30-second sprints for a bigger fitness gain.'
      : 'Add 4–6 × 30-second sprints to the end to train speed and raise the after-burn.';
  } else if (sets && !cardio.length) {
    next = sets < 10 ? 'Add 2–3 more working sets next time for a stronger stimulus.' :
      !muscles.quads && !muscles.glutes && !muscles.hamstrings ? 'Include a leg exercise (squat, lunge or leg press) to balance the week.' :
      'Finish with 10–15 minutes of cardio to cover heart health too.';
  } else {
    next = eqMin < 20 ? 'Good combo. Stretch the cardio to 20+ minutes when you have time.' : 'Excellent all-round session. Keep the same mix and add a little weight or pace next week.';
  }
  if (ctx.weekAvg != null && ctx.weekAvg < 2) next += ' Two to three sessions a week is where results really come.';
  return {score: score, label: label, benefits: benefits, how: how, next: next,
    cardio: {minutes: Math.round(cMin), kcal: kc, km: Math.round(cardio.reduce(function (a, c) { return a + c.km; }, 0) * 100) / 100}, sets: sets, volume: Math.round(vol)};
}
function card(a) {
  if (!a || (!a.sets && !a.cardio.minutes)) return '';
  return '<div class="hb"><div class="hbh"><span class="hbs">' + a.score + '</span><div><b>' + e(a.label) + ' workout</b><small>Effectiveness score out of 100</small></div></div>' +
    '<h4>What it did for you</h4><ul>' + a.benefits.map(function (b) { return '<li>' + e(b) + '</li>'; }).join('') + '</ul>' +
    '<h4>How effective</h4>' + a.how.map(function (h) {
      return '<div class="hbbar"><span>' + e(h[0]) + '</span><i><span style="width:' + Math.max(2, Math.min(100, h[1])) + '%"></span></i><em>' + e(h[2]) + '</em></div>'; }).join('') +
    '<h4>Next time</h4><ul><li>' + e(a.next) + '</li></ul>' +
    '<p class="hbnote">An estimate for general fitness from what you logged — not medical advice.</p></div>';
}
function ctx() {
  var w = window.plan && plan.week;
  return {bodyweight: bodyweight(), weekAvg: w && w.avg_workouts_4w != null ? w.avg_workouts_4w : null, streak: w ? w.streak_weeks : 0};
}
/* workout shape from a live session (finish screen) */
function fromLive(s) {
  return {exercises: (s.exercises || []).map(function (x) {
    return {name: x.name, sets: (x.done || []).map(function (d) { return d.mode ? {type: 'cardio', sec: d.sec, km: d.km, kmh: d.kmh, kcal: d.kcal, mode: d.mode} : {w: d.w, r: d.r}; })};
  }), minutes: s.summary ? s.summary.minutes : 0, hr_avg: s.summary && s.summary.hr_avg, hr_max: s.summary && s.summary.hr_max, prs: (s.summary && s.summary.prs) || []};
}

window.Cardio = {render: render, hide: hide, logInterval: logInterval, analyze: analyze, card: card, ctx: ctx, fromLive: fromLive,
  kcal: kcal, met: met, labels: labels, setText: setText, mmss: mmss};
})();
