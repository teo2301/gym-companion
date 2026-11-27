/* Gym Companion - shared data/engine layer (plain ES5, no dependencies).
 * Port of gym_progress.py / gym_api.py / gym_muscles.py + coaching.py standards.
 * Works on a phone with no server: all inputs are plain objects/arrays.
 */
(function (global) {
'use strict';

/* ---------- canonical constants ---------- */

var LEVELS = ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Elite'];

var MUSCLES = {
  chest: 'Chest', front_delts: 'Front delts', side_delts: 'Side delts', rear_delts: 'Rear delts',
  biceps: 'Biceps', triceps: 'Triceps', forearms: 'Forearms', abs: 'Abs', obliques: 'Obliques',
  traps: 'Traps', upper_back: 'Upper back', lats: 'Lats', lower_back: 'Lower back',
  glutes: 'Glutes', quads: 'Quads', hamstrings: 'Hamstrings', adductors: 'Adductors', calves: 'Calves'
};

// Official male 18-39 bodyweight standards (coaching.py).
var STRENGTH_STANDARDS = {
  'Bench Press (Barbell)': [0.50, 0.75, 1.00, 1.50, 2.00],
  'Squat (Barbell)': [0.75, 1.25, 1.50, 2.25, 2.75],
  'Deadlift (Barbell)': [1.00, 1.50, 2.00, 2.50, 3.00],
  'Romanian Deadlift (Barbell)': [0.75, 1.20, 1.60, 2.10, 2.60],
  'Overhead Press (Barbell)': [0.35, 0.55, 0.75, 1.00, 1.25],
  'Bent Over Row (Barbell)': [0.50, 0.75, 1.00, 1.35, 1.75],
  'Bench Press - Close Grip (Barbell)': [0.40, 0.65, 0.90, 1.30, 1.70]
};
// Logged weight is the ADDED plate; the rating uses total (bodyweight + plate).
var BODYWEIGHT_LOADED = {
  'Pull Up (Weighted)': [1.00, 1.20, 1.45, 1.75, 2.10],
  'Chin Up': [1.00, 1.20, 1.45, 1.75, 2.10]
};
// Approximate standards for the dumbbell/machine/cable lifts (gym_progress.py).
var APPROX = {
  'Bench Press (Dumbbell)': [0.20, 0.30, 0.42, 0.58, 0.75],
  'Incline Bench Press (Dumbbell)': [0.18, 0.27, 0.38, 0.52, 0.68],
  'Shoulder Press (Dumbbell)': [0.13, 0.22, 0.32, 0.45, 0.60],
  'Lateral Raise (Dumbbell)': [0.05, 0.09, 0.14, 0.20, 0.27],
  'Rear Delt Reverse Fly (Dumbbell)': [0.04, 0.08, 0.12, 0.18, 0.25],
  'Face Pull': [0.20, 0.33, 0.48, 0.66, 0.85],
  'Bicep Curl (Dumbbell)': [0.10, 0.16, 0.24, 0.33, 0.43],
  'Hammer Curl (Dumbbell)': [0.11, 0.18, 0.26, 0.36, 0.46],
  'Preacher Curl (Dumbbell)': [0.08, 0.13, 0.20, 0.28, 0.37],
  'Triceps Pushdown': [0.25, 0.42, 0.62, 0.85, 1.10],
  'Triceps Rope Pushdown': [0.22, 0.38, 0.56, 0.78, 1.00],
  'Lat Pulldown - Close Grip (Cable)': [0.50, 0.75, 1.00, 1.30, 1.60],
  'Iso-Lateral Row (Machine)': [0.40, 0.70, 1.00, 1.40, 1.80],
  'Seated Cable Row - Bar Grip': [0.45, 0.70, 1.00, 1.35, 1.70],
  'Leg Extension (Machine)': [0.50, 0.80, 1.15, 1.60, 2.05],
  'Lying Leg Curl (Machine)': [0.30, 0.50, 0.75, 1.00, 1.30],
  'Leg Press Horizontal (Machine)': [1.00, 1.70, 2.50, 3.40, 4.30],
  'Bulgarian Split Squat (Dumbbell)': [0.12, 0.25, 0.40, 0.58, 0.78],
  'Seated Calf Raise': [0.50, 0.90, 1.35, 1.85, 2.40],
  'Shrug (Barbell)': [0.75, 1.05, 1.45, 1.95, 2.45]
};

var MUSCLE_LIFTS = {
  chest: ['Bench Press (Barbell)', 'Bench Press (Dumbbell)', 'Incline Bench Press (Dumbbell)'],
  front_delts: ['Overhead Press (Barbell)', 'Shoulder Press (Dumbbell)'],
  side_delts: ['Lateral Raise (Dumbbell)'],
  rear_delts: ['Rear Delt Reverse Fly (Dumbbell)', 'Face Pull'],
  triceps: ['Bench Press - Close Grip (Barbell)', 'Triceps Pushdown', 'Triceps Rope Pushdown'],
  biceps: ['Bicep Curl (Dumbbell)', 'Hammer Curl (Dumbbell)', 'Preacher Curl (Dumbbell)', 'Chin Up'],
  lats: ['Pull Up (Weighted)', 'Chin Up', 'Lat Pulldown - Close Grip (Cable)'],
  upper_back: ['Bent Over Row (Barbell)', 'Iso-Lateral Row (Machine)', 'Seated Cable Row - Bar Grip'],
  traps: ['Shrug (Barbell)', 'Bent Over Row (Barbell)'],
  lower_back: ['Romanian Deadlift (Barbell)', 'Deadlift (Barbell)'],
  quads: ['Squat (Barbell)', 'Leg Press Horizontal (Machine)', 'Leg Extension (Machine)', 'Bulgarian Split Squat (Dumbbell)'],
  glutes: ['Squat (Barbell)', 'Romanian Deadlift (Barbell)', 'Bulgarian Split Squat (Dumbbell)'],
  hamstrings: ['Romanian Deadlift (Barbell)', 'Lying Leg Curl (Machine)'],
  calves: ['Seated Calf Raise']
};

var EXACT = {
  'Bench Press (Barbell)': [['chest'], ['front_delts', 'triceps']],
  'Bench Press (Dumbbell)': [['chest'], ['front_delts', 'triceps']],
  'Decline Bench Press (Barbell)': [['chest'], ['triceps', 'front_delts']],
  'Incline Bench Press (Dumbbell)': [['chest', 'front_delts'], ['triceps']],
  'Incline Bench Press (Smith Machine)': [['chest', 'front_delts'], ['triceps']],
  'Bench Press - Close Grip (Barbell)': [['triceps', 'chest'], ['front_delts']],
  'Smith Machine Close Grip Bench': [['triceps', 'chest'], ['front_delts']],
  'Butterfly (Pec Deck)': [['chest'], ['front_delts']],
  'Cable Fly Crossovers': [['chest'], ['front_delts']],
  'Push Up': [['chest'], ['triceps', 'front_delts', 'abs']],
  'Diamond Push Up': [['triceps', 'chest'], ['front_delts']],
  'Shoulder Press (Dumbbell)': [['front_delts'], ['side_delts', 'triceps']],
  'Overhead Press (Barbell)': [['front_delts'], ['side_delts', 'triceps', 'abs']],
  'Lateral Raise (Dumbbell)': [['side_delts'], ['traps']],
  'Rear Delt Reverse Fly (Dumbbell)': [['rear_delts'], ['upper_back']],
  'Rear Delt Reverse Fly (Machine)': [['rear_delts'], ['upper_back']],
  'Face Pull': [['rear_delts', 'upper_back'], ['traps', 'side_delts']],
  'Shrug (Barbell)': [['traps'], ['forearms']],
  'Bent Over Row (Barbell)': [['upper_back', 'lats'], ['rear_delts', 'biceps', 'lower_back']],
  'Iso-Lateral Row (Machine)': [['upper_back', 'lats'], ['rear_delts', 'biceps']],
  'Seated Cable Row - Bar Grip': [['upper_back', 'lats'], ['rear_delts', 'biceps']],
  'Low Cable Pulls': [['upper_back', 'lats'], ['biceps', 'rear_delts']],
  'Lat Pulldown - Close Grip (Cable)': [['lats'], ['biceps', 'upper_back']],
  'Pull Up': [['lats'], ['biceps', 'upper_back', 'forearms']],
  'Pull Up (Weighted)': [['lats'], ['biceps', 'upper_back', 'forearms']],
  'Chin Up': [['lats', 'biceps'], ['upper_back']],
  'Bicep Curl (Dumbbell)': [['biceps'], ['forearms']],
  'Bicep Curl (Barbell)': [['biceps'], ['forearms']],
  'Hammer Curl (Dumbbell)': [['biceps', 'forearms'], []],
  'Preacher Curl (Dumbbell)': [['biceps'], ['forearms']],
  'Behind the Back Curl (Cable)': [['biceps'], ['forearms']],
  'Skullcrusher (Dumbbell)': [['triceps'], []],
  'Triceps Pushdown': [['triceps'], []],
  'Triceps Rope Pushdown': [['triceps'], []],
  'Squat (Barbell)': [['quads', 'glutes'], ['adductors', 'lower_back', 'hamstrings']],
  'Leg Press Horizontal (Machine)': [['quads', 'glutes'], ['adductors']],
  'Bulgarian Split Squat (Dumbbell)': [['quads', 'glutes'], ['adductors', 'hamstrings']],
  'Lunge (Dumbbell)': [['quads', 'glutes'], ['adductors', 'hamstrings']],
  'Leg Extension (Machine)': [['quads'], []],
  'Leg Extension Plates': [['quads'], []],
  'Lying Leg Curl (Machine)': [['hamstrings'], ['calves']],
  'Romanian Deadlift (Barbell)': [['hamstrings', 'glutes'], ['lower_back', 'forearms', 'traps']],
  'Cable Pull Through': [['glutes', 'hamstrings'], ['lower_back']],
  'Seated Calf Raise': [['calves'], []],
  'Standing Calf Raise (Barbell)': [['calves'], []],
  'Calf Press (Machine)': [['calves'], []],
  'Calf Extension (Machine)': [['calves'], []],
  'Crunch': [['abs'], ['obliques']],
  'Crunch (Machine)': [['abs'], ['obliques']],
  'Plank': [['abs'], ['obliques', 'lower_back']]
};
var RULES = [
  ['close grip bench|dip', ['triceps', 'chest'], ['front_delts']],
  ['incline.*(press|bench)', ['chest', 'front_delts'], ['triceps']],
  ['bench|chest press|push ?up', ['chest'], ['front_delts', 'triceps']],
  ['fly|pec deck|crossover', ['chest'], ['front_delts']],
  ['lateral raise|upright row', ['side_delts'], ['traps']],
  ['rear delt|reverse fly|face pull', ['rear_delts'], ['upper_back']],
  ['shoulder press|overhead press|military|arnold', ['front_delts'], ['side_delts', 'triceps']],
  ['shrug', ['traps'], []],
  ['pulldown|pull ?up|chin ?up', ['lats'], ['biceps', 'upper_back']],
  ['row|cable pull', ['upper_back', 'lats'], ['rear_delts', 'biceps']],
  ['deadlift|good morning|hyperextension|back extension', ['hamstrings', 'glutes', 'lower_back'], ['traps']],
  ['hip thrust|glute|pull through|kickback', ['glutes'], ['hamstrings']],
  ['leg curl|hamstring', ['hamstrings'], []],
  ['leg extension', ['quads'], []],
  ['squat|leg press|lunge|step up|hack', ['quads', 'glutes'], ['adductors']],
  ['adductor|adduction', ['adductors'], []],
  ['calf', ['calves'], []],
  ['hammer', ['biceps', 'forearms'], []],
  ['curl', ['biceps'], ['forearms']],
  ['tricep|skull|pushdown|kickback', ['triceps'], []],
  ['wrist|grip|farmer', ['forearms'], []],
  ['crunch|sit ?up|leg raise|plank|ab ', ['abs'], ['obliques']],
  ['twist|woodchop|side bend', ['obliques'], ['abs']]
];
for (var ri = 0; ri < RULES.length; ri++) RULES[ri][0] = new RegExp(RULES[ri][0], 'i');

var MUSCLE_GROUP_KEYWORDS = [
  ['Legs', ['squat', 'leg press', 'leg extension', 'leg curl', 'lunge', 'calf', 'split squat']],
  ['Back', ['row', 'pulldown', 'pull up', 'pull-up', 'chin up', 'cable pull']],
  ['Shoulders', ['shoulder press', 'overhead press', 'lateral raise', 'rear delt', 'shrug', 'face pull']],
  ['Arms', ['curl', 'tricep', 'triceps', 'skullcrusher', 'pushdown']],
  ['Chest', ['bench', 'butterfly', 'pec deck', 'fly', 'push up', 'push-up', 'diamond push up']],
  ['Core', ['crunch', 'plank']],
  ['Cardio', ['treadmill', 'cycling', 'bike', 'run']]
];
var COMPOUND = /squat|deadlift|bench press|overhead press|shoulder press|row \(barbell\)|bent over row|pull ?up|chin ?up|\bdip|leg press|hip thrust|lunge/i;
var SKIP_TITLES = /cardio/i;
var REST_COMPOUND = 120, REST_ACCESSORY = 90;
var FIELDS = ['title', 'start_time', 'end_time', 'description', 'exercise_title', 'superset_id',
  'exercise_notes', 'set_index', 'set_type', 'weight_kg', 'reps', 'distance_km', 'duration_seconds', 'rpe'];
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var PUSH = {chest: 1, front_delts: 1, side_delts: 1, triceps: 1};
var PULL = {lats: 1, upper_back: 1, rear_delts: 1, biceps: 1};
var UPPER = {chest: 1, front_delts: 1, side_delts: 1, triceps: 1, lats: 1, upper_back: 1, rear_delts: 1, biceps: 1, traps: 1};
var LOWER = {quads: 1, hamstrings: 1, glutes: 1, calves: 1, adductors: 1};

/* ---------- small helpers ---------- */

function num(x, d) { var v = parseFloat(x); return isFinite(v) ? v : (d || 0); }
function r1(x) { return Math.round(x * 10) / 10; }
function r2(x) { return Math.round(x * 100) / 100; }
// Banker's rounding, matching Python's round() (canonical engine) on exact .5 values.
function rnd(x) {
  var f = Math.floor(x), d = x - f;
  if (Math.abs(d - 0.5) < 1e-9) return f % 2 ? f + 1 : f;
  return Math.round(x);
}
function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
function has(o, k) { return o != null && Object.prototype.hasOwnProperty.call(o, k); }
function keys(o) { return o ? Object.keys(o) : []; }
function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function fmtKg(x) { return String(r2(num(x))); }
function pad2(n) { return ('0' + n).slice(-2); }
function dateStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function appDate(ms) {
  var d = new Date(ms);
  return pad2(d.getDate()) + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ', ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
function parseAppDate(s) {
  var m = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4}),\s*(\d{1,2}):(\d{2})/.exec(String(s || '').trim());
  if (!m) return 0;
  var mi = MONTHS.indexOf(m[2].charAt(0).toUpperCase() + m[2].slice(1, 3).toLowerCase());
  if (mi < 0) return 0;
  return new Date(+m[3], mi, +m[1], +m[4], +m[5]).getTime();
}
function weekStart(ms) {
  var d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); return d.getTime();
}
function setW(x) { return num(has(x, 'weight_kg') ? x.weight_kg : x.w, 0); }
function setR(x) { return num(has(x, 'reps') ? x.reps : x.r, 0); }
function asArray(v) { return Array.isArray(v) ? v : []; }

/* ---------- plan primitives ---------- */

// Estimated 1RM (Epley), rounded like gym_api._e1rm.
function e1rm(w, r) { w = num(w); r = num(r); return w <= 0 || r <= 0 ? 0 : r1(w * (1 + r / 30)); }

function step(name) {
  var n = String(name || '').toLowerCase();
  if (n.indexOf('barbell') >= 0 || n.indexOf('smith') >= 0 || n.indexOf('weighted') >= 0) return 2.5;
  if (n.indexOf('dumbbell') >= 0) return 2;
  return 5;
}
function goalReps(name) { return COMPOUND.test(String(name || '')) ? 8 : 12; }

// Double progression. Returns the target array; `why` is available as a (hidden) property.
function target(name, lastSets, stepSize) {
  var work = asArray(lastSets).filter(function (s) { return (s.set_type || 'normal') !== 'warmup'; });
  if (!work.length) work = asArray(lastSets);
  if (!work.length) {
    var none = [];
    Object.defineProperty(none, 'why', {value: '', writable: true, configurable: true});
    return none;
  }
  var top = 0, i;
  for (i = 0; i < work.length; i++) top = Math.max(top, setW(work[i]));
  var goal = goalReps(name), out, why, x;
  if (top <= 0) {
    out = work.map(function (s) { return {w: 0, r: setR(s) + 1}; });
    why = '+1 rep each set';
  } else {
    var atTop = work.filter(function (s) { return setW(s) === top; });
    if (atTop.every(function (s) { return setR(s) >= goal; })) {
      var low = COMPOUND.test(String(name || '')) ? 6 : 8;
      var reps = Math.max(low, Math.min.apply(null, atTop.map(setR)) - 4);
      out = work.map(function (s) {
        return setW(s) === top ? {w: r2(top + num(stepSize)), r: reps} : {w: setW(s), r: setR(s)};
      });
      why = 'add ' + fmtKg(stepSize) + ' kg';
    } else {
      out = work.map(function (s) {
        x = setR(s);
        return setW(s) === top ? {w: top, r: Math.min(x + 1, Math.max(goal, x))} : {w: setW(s), r: x};
      });
      why = '+1 rep at ' + fmtKg(top) + ' kg';
    }
  }
  Object.defineProperty(out, 'why', {value: why, writable: true, configurable: true});
  Object.defineProperty(out, 'target', {value: out});
  return out;
}

// Python's round() is round-half-to-even (8.5 -> 8); match it so warm-ups equal the server's.
function pyRound(v) {
  var f = Math.floor(v);
  if (Math.abs(v - f - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(v);
}
function roundTo(x, s) { return r2(pyRound(x / s) * s); }
// Ramp-up sets for heavier compounds only; never counted as working sets.
function warmup(name, targetSets) {
  var n = String(name || '').toLowerCase(), t = asArray(targetSets);
  if (!COMPOUND.test(name) || !t.length) return [];
  var top = 0;
  t.forEach(function (s) { top = Math.max(top, setW(s)); });
  var sets = [];
  if (n.indexOf('barbell') >= 0 || n.indexOf('smith') >= 0) {
    if (top < 40) return [];
    sets = [[20, 10], [roundTo(top * 0.5, 2.5), 5], [roundTo(top * 0.7, 2.5), 3], [roundTo(top * 0.85, 2.5), 2]];
  } else if (n.indexOf('dumbbell') >= 0) {
    if (top < 16) return [];
    sets = [[roundTo(top * 0.5, 2), 8], [roundTo(top * 0.75, 2), 4]];
  } else if (n.indexOf('machine') >= 0 || n.indexOf('press') >= 0) {
    if (top < 40) return [];
    sets = [[roundTo(top * 0.5, 5), 8], [roundTo(top * 0.75, 5), 4]];
  } else return [];
  var out = [], seen = {}, k;
  for (k = 0; k < sets.length; k++) {
    var w = sets[k][0];
    if (w < top && !seen[w] && (!out.length || w > out[out.length - 1].w)) {
      seen[w] = 1; out.push({w: w, r: sets[k][1]});
    }
  }
  return out;
}

/* ---------- muscle mapping ---------- */

// User-defined exercises override the keyword rules with their chosen muscle map.
function customMap(custom) {
  var out = {}, i, c, n;
  if (Array.isArray(custom)) {
    for (i = 0; i < custom.length; i++) {
      c = custom[i]; n = typeof c === 'string' ? c : (c && c.name);
      if (n) out[n] = typeof c === 'string' ? {} : c;
    }
  } else if (custom && typeof custom === 'object') out = custom;
  return out;
}
function musclesFor(name, custom) {
  var cm = customMap(custom)[name];
  if (cm && ((asArray(cm.primary).length) || (asArray(cm.secondary).length)))
    return {primary: asArray(cm.primary).slice(), secondary: asArray(cm.secondary).slice()};
  if (has(EXACT, name)) return {primary: EXACT[name][0].slice(), secondary: EXACT[name][1].slice()};
  var n = String(name || '').toLowerCase(), i;
  for (i = 0; i < RULES.length; i++) if (RULES[i][0].test(n)) return {primary: RULES[i][1].slice(), secondary: RULES[i][2].slice()};
  return {primary: [], secondary: []};
}
function alternatives(name, allNames, custom) {
  var mine = musclesFor(name, custom).primary;
  if (!mine.length) return [];
  return asArray(allNames).filter(function (other) {
    if (other === name) return false;
    var p = musclesFor(other, custom).primary;
    return p.length > 0 && p[0] === mine[0];
  });
}
function classify(name) {
  var n = String(name || '').toLowerCase(), g, i;
  for (i = 0; i < MUSCLE_GROUP_KEYWORDS.length; i++) {
    g = MUSCLE_GROUP_KEYWORDS[i];
    for (var j = 0; j < g[1].length; j++) if (n.indexOf(g[1][j]) >= 0) return g[0];
  }
  return 'Other';
}

/* ---------- strength rating / progress ---------- */

function rateLift(name, e1rmKg, bw) {
  var e = num(e1rmKg), w = num(bw), out;
  if (w <= 0 || e <= 0) return null;
  var loaded = has(BODYWEIGHT_LOADED, name);
  var th = (loaded ? BODYWEIGHT_LOADED[name] : null) || STRENGTH_STANDARDS[name] || APPROX[name];
  if (!th) return null;
  var total = loaded ? e + w : e, ratio = total / w, idx = -1, i;
  for (i = 0; i < th.length; i++) if (ratio >= th[i]) idx = i;
  var nextLevel = idx + 1 < th.length ? LEVELS[idx + 1] : null;
  var floor = idx >= 0 ? th[idx] : 0;
  var progress = idx + 1 < th.length ? (ratio - floor) / (th[idx + 1] - floor) : 1;
  var kg = idx + 1 < th.length ? (th[idx + 1] - ratio) * w : 0;
  out = {
    exercise: name, e1rm: e, total_kg: total, bodyweight_loaded: loaded, ratio: ratio,
    level: idx >= 0 ? LEVELS[idx] : 'Untrained', level_index: idx, next_level: nextLevel,
    next_ratio: idx + 1 < th.length ? th[idx + 1] : null, kg_to_next: Math.max(0, kg),
    progress_in_level: clamp(progress, 0, 1), thresholds: th,
    approx: has(APPROX, name) && !has(STRENGTH_STANDARDS, name) && !loaded
  };
  return out;
}
function score(r) { return r.level_index >= 0 ? r.level_index + r.progress_in_level : r.progress_in_level - 1; }

function bestEntry(v) {
  if (Array.isArray(v)) return {e: num(v[0]), w: num(v[1]), r: num(v[2]), date: v[3] || '0000-01-01'};
  if (v && typeof v === 'object') return {e: num(has(v, 'e1rm') ? v.e1rm : v.est_1rm), w: num(v.w), r: num(v.r), date: v.date || v.date_str || '0000-01-01'};
  return {e: num(v), w: 0, r: 0, date: '0000-01-01'};
}
function bestsUntil(sessions, until, seedBests) {
  var best = {}, name, v, i, j, s, sets, x, e;
  for (name in (seedBests || {})) {
    if (!has(seedBests, name)) continue;
    v = bestEntry(seedBests[name]);
    if (v.e > 0 && (!best[name] || v.e > best[name][0])) best[name] = [v.e, v.w, v.r, v.date];
  }
  for (i = 0; i < sessions.length; i++) {
    s = sessions[i];
    if (until != null && s.start > until) break;
    for (name in s.exercises) {
      if (!has(s.exercises, name)) continue;
      sets = s.exercises[name];
      for (j = 0; j < sets.length; j++) {
        x = sets[j];
        if (x.set_type === 'warmup' || setR(x) <= 0) continue;
        e = e1rm(setW(x), setR(x));
        if (e > (best[name] ? best[name][0] : 0)) best[name] = [e, setW(x), setR(x), s.date_str];
      }
    }
  }
  return best;
}
function muscleLevels(bests, bw, custom) {
  var out = {}, m, lifts, cands, i, r, official, b, name, info, be, cm, extra = {};
  cm = customMap(custom);
  // A custom lift with a reference max can rate its main muscle using that muscle's yardstick.
  // Unrated custom lifts never reach this list, so they only affect volume/history.
  for (name in cm) {
    if (!has(cm, name) || !has(bests, name)) continue;
    info = cm[name]; be = bestEntry(bests[name]);
    if (be.e <= 0 || !asArray(info && info.primary).length) continue;
    for (i = 0; i < info.primary.length; i++) {
      m = info.primary[i]; lifts = MUSCLE_LIFTS[m];
      if (!lifts || !lifts.length || !has(MUSCLE_LIFTS, m)) continue;
      r = rateLift(lifts[0], be.e, bw);
      if (!r) continue;
      r.exercise = name; r.approx = true; r.score = r2(score(r));
      r.w = be.w; r.r = be.r; r.date = be.date;
      (extra[m] || (extra[m] = [])).push(r);
    }
  }
  for (m in MUSCLE_LIFTS) {
    if (!has(MUSCLE_LIFTS, m)) continue;
    lifts = MUSCLE_LIFTS[m]; cands = [];
    for (i = 0; i < lifts.length; i++) {
      if (!has(bests, lifts[i])) continue;
      be = bestEntry(bests[lifts[i]]);
      r = rateLift(lifts[i], be.e, bw);
      if (!r) continue;
      r.score = r2(score(r)); r.w = be.w; r.r = be.r; r.date = be.date;
      cands.push(r);
    }
    if (extra[m]) cands = cands.concat(extra[m]);
    official = cands.filter(function (c) { return !c.approx; });
    cands = official.length ? official : cands;  // official standards win over approximate ones
    if (!cands.length) continue;
    b = cands[0];
    for (i = 1; i < cands.length; i++) if (cands[i].score > b.score) b = cands[i];
    out[m] = {level: b.level, level_index: b.level_index, score: b.score, lift: b.exercise,
      e1rm: r1(b.e1rm), w: b.w, r: b.r, date: b.date, next_level: b.next_level,
      kg_to_next: r1(b.kg_to_next), progress: r2(b.progress_in_level), approx: b.approx};
  }
  return out;
}
function overall(levels) {
  var vals = keys(levels).map(function (m) { return num(levels[m].score); });
  if (!vals.length) return {score: 0, lv: 1, xp: 0, tier: 'Untrained', tier_index: -1};
  var sc = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
  var ti = sc >= 0 ? clamp(Math.floor(sc), -1, 4) : -1;
  var raw = sc * 10;
  var lv = clamp((raw >= 0 ? Math.floor(raw) : Math.ceil(raw)) + 1, 1, 50);
  var xp = r2(raw - (raw >= 0 ? Math.floor(raw) : Math.ceil(raw)));
  return {score: Math.round(sc * 1000) / 1000, lv: lv, xp: xp, tier: ti >= 0 ? LEVELS[ti] : 'Untrained', tier_index: ti};
}

/* ---------- session normalisation (live CSV shapes -> one shape) ---------- */

function canonSets(raw, warmDone) {
  var out = [], i, x;
  for (i = 0; i < asArray(raw).length; i++) {
    x = raw[i];
    out.push({weight_kg: setW(x), reps: setR(x), set_type: x.set_type || 'normal',
      distance_km: num(has(x, 'distance_km') ? x.distance_km : 0),
      set_index: has(x, 'set_index') ? num(x.set_index) : i,
      duration_seconds: num(x.duration_seconds), rpe: has(x, 'rpe') ? x.rpe : null,
      t: x.t || null, pr: x.pr || null});
  }
  var wd = asArray(warmDone).slice().sort(function (a, b) { return a - b; });
  for (i = 0; i < wd.length; i++) {
    var k = +wd[i], w = asArray(raw)[k];
    if (w) out.push({weight_kg: setW(w), reps: setR(w), set_type: 'warmup', distance_km: 0,
      set_index: k, duration_seconds: 0, rpe: null, t: null, pr: null});
  }
  return out;
}
function normalizeSession(s) {
  if (!s) return null;
  var start = num(has(s, 'start') ? s.start : (has(s, 'started') ? s.started : parseAppDate(s.start_time)), 0);
  if (!start && s.date_str) start = new Date(s.date_str + 'T00:00:00').getTime() || 0;
  var end = num(has(s, 'end') ? s.end : (has(s, 'ended') ? s.ended : parseAppDate(s.end_time)), 0);
  var title = s.title || s.routine || 'Workout';
  var ex = {}, name, sets;
  if (Array.isArray(s.exercises)) {
    for (var i = 0; i < s.exercises.length; i++) {
      var e = s.exercises[i];
      if (!e || !e.name) continue;
      ex[e.name] = canonSets(e.done || [], e.warm_done || []);
    }
  } else {
    for (name in (s.exercises || {})) {
      if (!has(s.exercises, name)) continue;
      ex[name] = canonSets(s.exercises[name]);
    }
  }
  var totalSets = 0, volume = 0;
  for (name in ex) {
    if (!has(ex, name)) continue;
    sets = ex[name]; totalSets += sets.length;
    for (var j = 0; j < sets.length; j++) volume += sets[j].weight_kg * sets[j].reps;
  }
  return {
    id: s.id || null, start: start, end: end,
    date_str: s.date_str || dateStr(new Date(start || Date.now())),
    title: title, day: s.day || new Date(start || Date.now()).toLocaleString('en-GB', {weekday: 'long'}),
    exercises: ex, total_sets: has(s, 'total_sets') ? num(s.total_sets) : totalSets,
    total_volume_kg: has(s, 'total_volume_kg') ? num(s.total_volume_kg) : volume,
    duration_min: has(s, 'duration_min') ? num(s.duration_min) : (end && start ? rnd((end - start) / 60000) : 0),
    live: Array.isArray(s.exercises) ? s : null
  };
}
function normalizeSessions(sessions) {
  return asArray(sessions).map(normalizeSession).filter(function (s) { return !!s; })
    .sort(function (a, b) { return a.start - b.start; });
}
function isStrength(sets) {
  var i;
  for (i = 0; i < sets.length; i++) if (setR(sets[i]) > 0) break;
  if (i === sets.length) return false;
  for (i = 0; i < sets.length; i++) if (num(sets[i].distance_km) > 0) return false;
  return true;
}
function workSets(sets) {
  var w = sets.filter(function (s) { return s.set_type !== 'warmup'; });
  return w.length ? w : sets;
}

function bodyWeek(sessions, days, custom) {
  days = days || 7;
  var now = Date.now(), out = {}, m, i, name, sets, mm, n, k, age, d;
  for (m in MUSCLES) if (has(MUSCLES, m)) out[m] = {sets: 0, days_since: null};
  sessions = normalizeSessions(sessions);
  for (i = 0; i < sessions.length; i++) {
    age = (now - sessions[i].start) / 86400000;
    for (name in sessions[i].exercises) {
      if (!has(sessions[i].exercises, name)) continue;
      sets = sessions[i].exercises[name];
      if (!isStrength(sets)) continue;
      mm = musclesFor(name, custom); n = workSets(sets).length;
      for (k = 0; k < mm.primary.length; k++) {
        m = mm.primary[k];
        if (!has(out, m)) continue;
        if (age <= days) out[m].sets += n;
        d = age > 0 ? Math.floor(age) : Math.ceil(age);   // Python int(age)
        if (out[m].days_since === null || d < out[m].days_since) out[m].days_since = d;
      }
      for (k = 0; k < mm.secondary.length; k++) {
        m = mm.secondary[k];
        if (!has(out, m)) continue;
        if (age <= days) out[m].sets += n * 0.5;
        d = age > 0 ? Math.floor(age) : Math.ceil(age);
        if (out[m].days_since === null || d < out[m].days_since) out[m].days_since = d;
      }
    }
  }
  for (m in out) if (has(out, m)) out[m].sets = r1(out[m].sets);
  return out;
}
function weekStats(sessions) {
  var monday = weekStart(Date.now()), wk = [], last = null, i;
  sessions = normalizeSessions(sessions);
  for (i = 0; i < sessions.length; i++) {
    if (sessions[i].start >= monday && !SKIP_TITLES.test(sessions[i].title)) wk.push(sessions[i]);
    if (!SKIP_TITLES.test(sessions[i].title) && (!last || sessions[i].start > last.start)) last = sessions[i];
  }
  return {workouts: wk.length,
    sets: wk.reduce(function (a, s) { return a + num(s.total_sets); }, 0),
    volume: rnd(wk.reduce(function (a, s) { return a + num(s.total_volume_kg); }, 0)),
    last_date: last ? last.date_str : null, last_title: last ? last.title : null};
}

// Full progress object (same shape as /api/gym/progress).
function progress(opts) {
  opts = opts || {};
  var sessions = normalizeSessions(opts.sessions);
  var bw = num(opts.bodyweight) > 0 ? num(opts.bodyweight) : 75;
  var seed = opts.seedBests || {}, custom = opts.custom;
  var now = Date.now();
  var levels = muscleLevels(bestsUntil(sessions, null, seed), bw, custom);
  var ov = overall(levels), weeks = [], sets, m, i, j;
  if (sessions.length) {
    var wk = weekStart(sessions[0].start), end, guard = 0;
    while (wk <= now && guard++ < 800) {
      end = wk + 7 * 86400000; sets = {};
      for (i = 0; i < sessions.length; i++) {
        if (sessions[i].start < wk || sessions[i].start >= end) continue;
        for (m in sessions[i].exercises) {
          var setsFor = sessions[i].exercises[m];
          if (!isStrength(setsFor)) continue;
          var mm = musclesFor(m, custom), n = workSets(setsFor).length, k;
          for (k = 0; k < mm.primary.length; k++) sets[mm.primary[k]] = (sets[mm.primary[k]] || 0) + n;
          for (k = 0; k < mm.secondary.length; k++) sets[mm.secondary[k]] = (sets[mm.secondary[k]] || 0) + n * 0.5;
        }
      }
      for (m in sets) if (has(sets, m)) sets[m] = r1(sets[m]);
      var sc = overall(muscleLevels(bestsUntil(sessions, end, seed), bw, custom));
      weeks.push({week: dateStr(new Date(wk)), sets: sets, score: sc.score, lv: sc.lv});
      wk = end;
    }
  }
  var then = muscleLevels(bestsUntil(sessions, now - 30 * 86400000, seed), bw, custom);
  var gains = keys(levels).map(function (x) {
    return {muscle: x, gain: levels[x].score - (then[x] ? then[x].score : levels[x].score)};
  }).sort(function (a, b) { return b.gain - a.gain; });
  var most = gains.length && gains[0].gain > 0.05 ? {muscle: gains[0].muscle, gain: r2(gains[0].gain)} : null;
  var recent = {};
  for (i = Math.max(0, weeks.length - 4); i < weeks.length; i++)
    for (m in weeks[i].sets) if (has(weeks[i].sets, m)) recent[m] = (recent[m] || 0) + weeks[i].sets[m];
  function sumSet(map) {
    return Object.keys(map).reduce(function (a, x) { return a + (recent[x] || 0); }, 0);
  }
  var weakest = null, strongest = null;
  keys(levels).forEach(function (x) {
    if (weakest === null || levels[x].score < levels[weakest].score) weakest = x;
    if (strongest === null || levels[x].score > levels[strongest].score) strongest = x;
  });
  return {bodyweight: bw, muscles: levels, overall: ov, weeks: weeks, most_improved: most,
    balance: {push: rnd(sumSet(PUSH)), pull: rnd(sumSet(PULL)), upper: rnd(sumSet(UPPER)), lower: rnd(sumSet(LOWER))},
    weakest: weakest, strongest: strongest, levels: LEVELS};
}

/* ---------- history + plan ---------- */

function exerciseHistory(name, ctx) {
  ctx = ctx || {};
  var sessions = normalizeSessions(ctx.sessions), pts = [], best = 0, i, j, sets, work, top, e, pr;
  for (i = 0; i < sessions.length; i++) {
    sets = sessions[i].exercises[name];
    if (!sets || !isStrength(sets)) continue;
    work = workSets(sets); top = work[0];
    for (j = 1; j < work.length; j++) if (e1rm(setW(work[j]), setR(work[j])) > e1rm(setW(top), setR(top)) ||
        (e1rm(setW(work[j]), setR(work[j])) === e1rm(setW(top), setR(top)) && setW(work[j]) > setW(top))) top = work[j];
    e = e1rm(setW(top), setR(top)); pr = e > best && best > 0; best = Math.max(best, e);
    pts.push({date: sessions[i].date_str, e1rm: e, w: setW(top), r: setR(top), pr: pr,
      volume: rnd(work.reduce(function (a, x) { return a + setW(x) * setR(x); }, 0)),
      sets: work.map(function (x) { return {w: setW(x), r: setR(x)}; })});
  }
  var names = {}, all;
  sessions.forEach(function (s) { Object.keys(s.exercises).forEach(function (n) { names[n] = 1; }); });
  asArray(ctx.custom).forEach(function (c) { var n = typeof c === 'string' ? c : (c && c.name); if (n) names[n] = 1; });
  all = Object.keys(names).sort();
  return {name: name, sessions: pts, muscles: musclesFor(name, ctx.custom),
    note: (ctx.notes && ctx.notes[name]) || '', alternatives: alternatives(name, all, ctx.custom)};
}

function routineConfig(v) {
  var out = {templates: {}, hidden: []}, i;
  if (Array.isArray(v)) {
    for (i = 0; i < v.length; i++) if (v[i] && v[i].name && !v[i]['delete']) out.templates[v[i].name] = asArray(v[i].exercises);
    return out;
  }
  if (!v || typeof v !== 'object') return out;
  if (v.templates && typeof v.templates === 'object') {
    for (i = 0; i < Object.keys(v.templates).length; i++) { var n = Object.keys(v.templates)[i]; out.templates[n] = asArray(v.templates[n]); }
    out.hidden = asArray(v.hidden).slice();
  } else {
    for (i = 0; i < Object.keys(v).length; i++) { var k = Object.keys(v)[i]; out.templates[k] = asArray(v[k]); }
  }
  return out;
}
function customNames(custom) {
  return asArray(custom).map(function (c) { return typeof c === 'string' ? c : (c && c.name); })
    .filter(function (n) { return !!n; });
}

// Same shape as /api/gym/plan.
function buildPlan(opts) {
  opts = opts || {};
  var sessions = normalizeSessions(opts.sessions);
  var notes = opts.notes || {}, cfg = routineConfig(opts.routines);
  var custom = customNames(opts.custom), seed = opts.seedBests || {};
  var lastBy = {}, bestBy = {}, weightsBy = {}, i, j, name, sets, work, x, e, b, tr, tg;
  for (name in seed) {
    if (!has(seed, name)) continue;
    var v = bestEntry(seed[name]);
    if (v.e > 0) bestBy[name] = {e1rm: v.e, w: v.w, r: v.r, max_w: v.w};
  }
  for (i = 0; i < sessions.length; i++) {
    for (name in sessions[i].exercises) {
      if (!has(sessions[i].exercises, name)) continue;
      sets = sessions[i].exercises[name];
      if (!isStrength(sets)) continue;
      work = workSets(sets);
      lastBy[name] = {date: sessions[i].date_str, sets: work};
      if (!weightsBy[name]) weightsBy[name] = [];
      for (j = 0; j < work.length; j++) {
        x = work[j]; weightsBy[name].push(setW(x));
        b = bestBy[name] || (bestBy[name] = {e1rm: 0, w: 0, r: 0, max_w: 0});
        e = e1rm(setW(x), setR(x));
        if (e > b.e1rm) { b.e1rm = e; b.w = setW(x); b.r = setR(x); }
        b.max_w = Math.max(b.max_w, setW(x));
      }
    }
  }
  function exInfo(n) {
    var last = lastBy[n] || {date: null, sets: []}, st = step(n);
    tr = target(n, last.sets, st); tg = asArray(tr);
    var why = tr.why || '';
    if (!tg.length) { tg = [{w: 20, r: 10}, {w: 20, r: 10}, {w: 20, r: 10}]; why = 'new exercise'; }
    return {name: n,
      last: last.sets.map(function (s) { return {w: setW(s), r: setR(s)}; }),
      last_date: last.date, target: tg, why: why, step: st, warmup: warmup(n, tg),
      rest: COMPOUND.test(n) ? REST_COMPOUND : REST_ACCESSORY,
      best: bestBy[n] || {e1rm: 0, w: 0, r: 0, max_w: 0},
      group: classify(n), muscles: musclesFor(n, custom), note: notes[n] || ''};
  }
  var byTitle = {}, titles = [], k;
  for (i = 0; i < sessions.length; i++) {
    if (SKIP_TITLES.test(sessions[i].title)) continue;
    if (!byTitle[sessions[i].title]) { byTitle[sessions[i].title] = []; titles.push(sessions[i].title); }
    byTitle[sessions[i].title].push(sessions[i]);
  }
  var routines = [], tnames = titles.concat(Object.keys(cfg.templates).filter(function (t) { return titles.indexOf(t) < 0; }));
  for (i = 0; i < tnames.length; i++) {
    var title = tnames[i];
    if (cfg.hidden.indexOf(title) >= 0) continue;
    var ss = byTitle[title] || [], latest = ss.length ? ss[ss.length - 1] : null;
    if (ss.length < 2 && !has(cfg.templates, title)) continue;
    var names = has(cfg.templates, title) ? cfg.templates[title].slice() :
      Object.keys(latest.exercises).filter(function (n) { return isStrength(latest.exercises[n]); });
    routines.push({name: title, count: ss.length, last_date: latest ? latest.date_str : null,
      last_volume: latest ? rnd(latest.total_volume_kg) : null,
      last_minutes: latest ? latest.duration_min : null,
      custom: has(cfg.templates, title), exercises: names.map(exInfo)});
  }
  routines.sort(function (a, b) { return (b.last_date || '9999').localeCompare(a.last_date || '9999'); });
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var recent = routines.filter(function (r) {
    if (!r.last_date || r.count < 3) return false;
    var d = new Date(r.last_date + 'T00:00:00');
    return (today.getTime() - d.getTime()) / 86400000 <= 42;
  });
  var suggested = recent.length ? recent.slice().sort(function (a, b) { return (a.last_date || '').localeCompare(b.last_date || ''); })[0].name :
    (routines.length ? routines[0].name : null);
  var catalogue = Object.keys(lastBy).concat(custom, Object.keys(cfg.templates), Object.keys(notes));
  var seen = {};
  catalogue = catalogue.filter(function (n) { if (!n || seen[n]) return false; seen[n] = 1; return true; });
  catalogue.sort(function (a, b) {
    var d = (weightsBy[b] ? weightsBy[b].length : 0) - (weightsBy[a] ? weightsBy[a].length : 0);
    return d || a.localeCompare(b);
  });
  var lifter = null;
  try { lifter = progress(opts).overall; } catch (err) { /* progress is optional */ }
  return {routines: routines, suggested: suggested, exercises: catalogue.map(exInfo),
    body: bodyWeek(sessions, 7, custom), week: weekStats(sessions), lifter: lifter,
    muscle_names: MUSCLES, generated: Date.now()};
}

/* ---------- live-session operations ---------- */

function summary(s) {
  s = s || {};
  var sets = [], i, j, e, d, hr = s.hr_log || [], end = num(s.ended != null ? s.ended : s.end, Date.now());
  if (Array.isArray(s.exercises)) {
    for (i = 0; i < s.exercises.length; i++) {
      e = s.exercises[i];
      for (j = 0; j < asArray(e.done).length; j++) {
        d = e.done[j]; sets.push({ex: e.name, w: num(d.w), r: num(d.r), pr: d.pr || null});
      }
    }
  } else {
    Object.keys(s.exercises || {}).forEach(function (name) {
      asArray(s.exercises[name]).forEach(function (d) {
        if (d.set_type === 'warmup') return;
        sets.push({ex: name, w: setW(d), r: setR(d), pr: d.pr || null});
      });
    });
  }
  var vol = sets.reduce(function (a, x) { return a + x.w * x.r; }, 0);
  var start = num(s.started != null ? s.started : s.start, end);
  return {minutes: rnd((end - start) / 60000), sets: sets.length, volume: rnd(vol),
    prs: sets.filter(function (x) { return !!x.pr; }).map(function (x) { return {ex: x.ex, w: x.w, r: x.r, kind: x.pr}; }),
    last_volume: s.last_volume == null ? null : s.last_volume,
    hr_avg: hr.length ? rnd(hr.reduce(function (a, b) { return a + num(b); }, 0) / hr.length) : null,
    hr_max: hr.length ? Math.max.apply(null, hr.map(num)) : null,
    exercises_done: Array.isArray(s.exercises) ? s.exercises.filter(function (e) { return asArray(e.done).length > 0; }).length :
      Object.keys(s.exercises || {}).filter(function (n) { return asArray(s.exercises[n]).length > 0; }).length};
}
function markPr(ex, w, r) {
  var best = ex.best || {}, prior = asArray(ex.done), bestE = num(best.e1rm), bestW = num(best.max_w), i, v;
  for (i = 0; i < prior.length; i++) {
    v = e1rm(num(prior[i].w), num(prior[i].r));
    if (v > bestE) bestE = v;
    bestW = Math.max(bestW, num(prior[i].w));
  }
  if (w > 0 && num(best.e1rm) > 0 && e1rm(w, r) > bestE) return 'e1rm';
  if (w > 0 && num(best.max_w) > 0 && w > bestW) return 'weight';
  return null;
}
function newExercise(name, ctx) {
  ctx = ctx || {};
  var notes = typeof ctx.notes === 'function' ? (ctx.notes() || {}) : (ctx.notes || {});
  var custom = typeof ctx.custom === 'function' ? (ctx.custom() || []) : (ctx.custom || []);
  var info = customMap(custom)[name] || {}, ref = info.ref_max || {}, tg, best;
  if (num(ref.w) > 0 && num(ref.r) > 0) {
    tg = [{w: num(ref.w), r: num(ref.r)}, {w: num(ref.w), r: num(ref.r)}, {w: num(ref.w), r: num(ref.r)}];
    best = {e1rm: e1rm(ref.w, ref.r), w: num(ref.w), r: num(ref.r), max_w: num(ref.w)};
  } else {
    tg = [{w: 20, r: 10}, {w: 20, r: 10}, {w: 20, r: 10}]; best = {e1rm: 0, max_w: 0};
  }
  return {name: name, last: [], target: tg, why: ref.w > 0 ? 'reference max' : 'new exercise',
    warmup: warmup(name, tg), step: step(name), rest: COMPOUND.test(name) ? REST_COMPOUND : REST_ACCESSORY,
    best: best, group: classify(name), muscles: musclesFor(name, custom), note: notes[name] || ''};
}

// Port of gym_api._apply. Returns a NEW state; never mutates the input.
function applyOp(state, op, ctx) {
  var st = clone(state || {version: 0, session: null});
  ctx = ctx || {};
  if (Array.isArray(op)) {
    for (var q = 0; q < op.length; q++) st = applyOp(st, op[q], ctx);
    return st;
  }
  if (!op || !op.op) return st;
  var kind = op.op, t = num(op.t, 0) || (typeof ctx.now === 'function' ? ctx.now() : Date.now());
  var s = st.session, exs, i, ex, info, plan, k, wd, secs, bpm, nxt;
  function getPlan() {
    if (typeof ctx.plan !== 'function') return null;
    var p = ctx.plan();
    return p && !p.then ? p : null;
  }
  if (kind === 'start') {
    if (s && !s.finished) return st;      // never clobber a workout in progress
    plan = getPlan(); exs = asArray(op.exercises);
    if (!exs.length && plan) {
      var r = asArray(plan.routines).filter(function (x) { return x.name === op.routine; })[0];
      if (r) exs = asArray(r.exercises);
    }
    var routine = op.routine || 'Workout', lastvol = null;
    if (!plan) plan = getPlan();
    if (plan) {
      var rr = asArray(plan.routines).filter(function (x) { return x.name === routine; })[0];
      if (rr) lastvol = rr.last_volume;
    }
    st.session = {id: op.sid || op.id || uid(), routine: routine, started: t,
      exercises: exs.map(function (e) { var z = clone(e); z.done = asArray(e.done).slice(); z.warm_done = asArray(e.warm_done).slice(); return z; }),
      current: 0, rest_until: null, rest_total: 0, hr: null, hr_log: [], last_volume: lastvol, finished: false};
    return st;
  }
  if (kind === 'close') {
    if (s && s.finished) st.session = null;
    return st;
  }
  if (!s || s.finished) return st;
  exs = s.exercises || (s.exercises = []);
  i = op.ex == null ? s.current : num(op.ex, -1);
  ex = exs[i] && typeof i === 'number' && i >= 0 && i < exs.length ? exs[i] : null;
  if (kind === 'log' && ex) {
    ex.done = asArray(ex.done);
    var w = num(op.w), r = num(op.r);
    ex.done.push({w: w, r: r, t: t, pr: markPr(ex, w, r)});
    s.current = i;
    secs = num(op.rest, ex.rest || REST_ACCESSORY);
    s.rest_until = t + secs * 1000; s.rest_total = secs;
    if (ex.done.length >= asArray(ex.target).length) {
      nxt = null;
      var order = [];
      for (k = i + 1; k < exs.length; k++) order.push(k);
      for (k = 0; k < i; k++) order.push(k);
      for (k = 0; k < order.length; k++) {
        var oi = order[k], oe = exs[oi];
        if (asArray(oe.done).length < asArray(oe.target).length) { nxt = oi; break; }
      }
      if (nxt !== null) s.current = nxt;
    }
  } else if (kind === 'undo' && ex && asArray(ex.done).length) {
    ex.done.pop(); s.current = i; s.rest_until = null;
  } else if (kind === 'edit' && ex) {
    k = num(op.i, -1);
    if (k >= 0 && k < asArray(ex.done).length) {
      var d = ex.done[k];
      d.w = num(op.w, d.w); d.r = num(op.r, d.r);
      d.pr = markPr({best: ex.best, done: ex.done.slice(0, k)}, d.w, d.r);
    }
  } else if (kind === 'warm' && ex) {
    k = num(op.i, -1); wd = ex.warm_done || (ex.warm_done = []);
    if (wd.indexOf(k) >= 0) wd.splice(wd.indexOf(k), 1);
    else if (k >= 0 && k < asArray(ex.warmup).length) {
      wd.push(k); s.rest_until = t + 60000; s.rest_total = 60;
    }
  } else if (kind === 'swap' && ex && op.name) {
    plan = getPlan();
    info = plan && asArray(plan.exercises).filter(function (e) { return e.name === op.name; })[0];
    info = info || (typeof ctx.newExercise === 'function' ? ctx.newExercise(op.name) : newExercise(op.name, ctx));
    if (asArray(ex.done).length) { exs.splice(i + 1, 0, clone(info)); s.current = i + 1; }
    else { info.done = []; exs[i] = clone(info); }
  } else if (kind === 'note') {
    for (k = 0; k < exs.length; k++) if (exs[k].name === op.name) exs[k].note = op.text || '';
  } else if (kind === 'select' && ex) {
    s.current = i;
  } else if (kind === 'rest') {
    secs = num(op.secs, 90); s.rest_until = t + secs * 1000; s.rest_total = secs;
  } else if (kind === 'rest_add' && s.rest_until) {
    secs = num(op.secs, 30); s.rest_until += secs * 1000; s.rest_total += secs;
  } else if (kind === 'rest_skip') {
    s.rest_until = null;
  } else if (kind === 'add_ex' && op.name) {
    plan = getPlan();
    info = plan && asArray(plan.exercises).filter(function (e) { return e.name === op.name; })[0];
    info = info || (typeof ctx.newExercise === 'function' ? ctx.newExercise(op.name) : newExercise(op.name, ctx));
    info.done = []; exs.push(clone(info)); s.current = exs.length - 1;
  } else if (kind === 'hr') {
    bpm = num(op.bpm);
    if (bpm > 30 && bpm < 230) { s.hr = {bpm: bpm, t: t}; s.hr_log = asArray(s.hr_log); s.hr_log.push(bpm); }
  } else if (kind === 'finish') {
    s.ended = t; s.summary = summary(s); s.finished = true; s.rest_until = null;
  } else if (kind === 'discard') {
    st.session = null;
  }
  return st;
}

/* ---------- Hevy-compatible CSV ---------- */

function quoteCsv(v) {
  var s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRows(session) {
  if (!session) return [];
  var start = num(has(session, 'started') ? session.started : (has(session, 'start') ? session.start : parseAppDate(session.start_time)), Date.now());
  var end = num(has(session, 'ended') ? session.ended : (has(session, 'end') ? session.end : parseAppDate(session.end_time)), Date.now());
  var title = session.routine || session.title || 'Workout';
  var s0 = appDate(start), s1 = appDate(end), rows = [], i, j, k, e, warm, d, kind;
  if (Array.isArray(session.exercises)) {
    for (i = 0; i < session.exercises.length; i++) {
      e = session.exercises[i]; d = asArray(e.done);
      if (!d.length) continue;
      warm = asArray(e.warm_done).slice().sort(function (a, b) { return a - b; }).filter(function (w) { return w < asArray(e.warmup).length; })
        .map(function (w) { return {d: e.warmup[w], kind: 'warmup'}; });
      k = 0;
      warm.concat(d.map(function (x) { return {d: x, kind: 'normal'}; })).forEach(function (row) {
        rows.push({title: title, start_time: s0, end_time: s1, description: 'Gym Companion',
          exercise_title: e.name, superset_id: '', exercise_notes: '', set_index: k++, set_type: row.kind,
          weight_kg: fmtKg(row.d.w), reps: num(row.d.r), distance_km: '', duration_seconds: '', rpe: ''});
      });
    }
  } else {
    for (i = 0; i < Object.keys(session.exercises || {}).length; i++) {
      var name = Object.keys(session.exercises)[i]; k = 0;
      asArray(session.exercises[name]).forEach(function (x) {
        rows.push({title: title, start_time: s0, end_time: s1, description: 'Gym Companion',
          exercise_title: name, superset_id: '', exercise_notes: '', set_index: k++,
          set_type: x.set_type === 'warmup' ? 'warmup' : 'normal',
          weight_kg: fmtKg(setW(x)), reps: setR(x), distance_km: '', duration_seconds: '', rpe: ''});
      });
    }
  }
  return rows;
}
function csv(sessions) {
  var lines = [FIELDS.join(',')], seen = {}, i, j, row, s, key;
  for (i = 0; i < asArray(sessions).length; i++) {
    s = sessions[i];
    var rows = csvRows(s);
    if (!rows.length) continue;
    // Hevy treats (title, start_time) as the identity of a workout - skip replays.
    key = rows[0].title + '|' + rows[0].start_time;
    if (seen[key]) continue;
    seen[key] = 1;
    for (j = 0; j < rows.length; j++) {
      row = rows[j];
      lines.push(FIELDS.map(function (f) { return quoteCsv(row[f]); }).join(','));
    }
  }
  return lines.join('\r\n') + '\r\n';
}

global.GymCore = {
  MUSCLES: MUSCLES, LEVELS: LEVELS, MUSCLE_LIFTS: MUSCLE_LIFTS, APPROX: APPROX,
  STRENGTH_STANDARDS: STRENGTH_STANDARDS, BODYWEIGHT_LOADED: BODYWEIGHT_LOADED, FIELDS: FIELDS,
  e1rm: e1rm, step: step, goalReps: goalReps, target: target, warmup: warmup,
  musclesFor: musclesFor, alternatives: alternatives, classify: classify,
  rateLift: rateLift, score: score, muscleLevels: muscleLevels, overall: overall, progress: progress,
  bodyWeek: bodyWeek, weekStats: weekStats, history: exerciseHistory, buildPlan: buildPlan,
  summary: summary, newExercise: newExercise, applyOp: applyOp,
  csvRows: csvRows, csv: csv, normalizeSession: normalizeSession, normalizeSessions: normalizeSessions
};
})(window);
