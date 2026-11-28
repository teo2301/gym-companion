/* Gym Companion charts: tiny dependency-free SVG charts for the Progress screen (works offline).
 * Rules (dataviz guide): one y-axis per chart, one series = one colour (no legend box, the card title
 * names it), 2px lines, <=24px bars with 4px rounded data-ends from the baseline, hairline recessive
 * grid, markers r>=4 with a 2px surface ring, tooltip on tap/drag (crosshair snaps to the nearest x;
 * bars/cells are their own hit targets, larger than the paint), and every chart has a table view.
 * Text is set with textContent (labels can come from user data).
 */
(function () {
'use strict';
var NS = 'http://www.w3.org/2000/svg';
var C = {get series() { return (getComputedStyle(document.documentElement).getPropertyValue('--volt').trim() || '#d7ff3e'); }, pr: '#ffb020', grid: '#2a303a', axis: '#5d6470', text: '#8d94a0', surface: '#181c23'};

function el(tag, attrs, parent) {
  var n = document.createElementNS(NS, tag);
  for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}
function txt(parent, x, y, s, anchor, cls) {
  var t = el('text', {x: x, y: y, 'text-anchor': anchor || 'start', 'class': cls || 'cax'}, parent);
  t.textContent = s;
  return t;
}
/* "nice" axis: ~4 ticks on round numbers */
function nice(min, max, n) {
  if (max === min) { max = min + 1; min = Math.max(0, min - 1); }
  var span = max - min, step = Math.pow(10, Math.floor(Math.log(span / n) / Math.LN10)), err = n / span * step;
  if (err <= 0.15) step *= 10; else if (err <= 0.35) step *= 5; else if (err <= 0.75) step *= 2;
  var lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, ticks = [];
  for (var v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return {lo: lo, hi: hi, ticks: ticks};
}
function fmtNum(v) {
  var a = Math.abs(v);
  if (a >= 1e6) return (Math.round(v / 1e5) / 10) + 'M';
  if (a >= 1e4) return Math.round(v / 1000) + 'k';
  if (a >= 1e3) return (Math.round(v / 100) / 10) + 'k';
  return String(Math.round(v * 10) / 10);
}
function dayMs(d) { return new Date(d + 'T12:00:00').getTime(); }
function shortDate(ms) { return new Date(ms).toLocaleDateString('en-GB', {day: 'numeric', month: 'short'}); }
function monthLabel(ms) { return new Date(ms).toLocaleDateString('en-GB', {month: 'short'}); }

/* ---------- shared tooltip (one per chart wrapper) */
function tooltip(wrap) {
  var t = document.createElement('div'); t.className = 'ctip'; t.hidden = true; wrap.appendChild(t);
  return {
    show: function (x, y, lines) {
      t.textContent = '';
      lines.forEach(function (l, i) {
        var row = document.createElement('div');
        if (i === 0) { row.className = 'ctv'; } else row.className = 'ctl';
        if (l.key) { var k = document.createElement('i'); k.style.background = l.key; row.appendChild(k); }
        row.appendChild(document.createTextNode(l.text));
        t.appendChild(row);
      });
      t.hidden = false;
      var w = wrap.clientWidth, tw = t.offsetWidth;
      t.style.left = Math.max(0, Math.min(w - tw, x - tw / 2)) + 'px';
      t.style.top = Math.max(0, y - t.offsetHeight - 12) + 'px';
    },
    hide: function () { t.hidden = true; }
  };
}
function frame(box, height) {
  box.textContent = '';
  var wrap = document.createElement('div'); wrap.className = 'cwrap'; box.appendChild(wrap);
  var W = Math.max(260, box.clientWidth || 320), H = height || 180;
  var svg = el('svg', {viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, role: 'img'}, wrap);
  return {wrap: wrap, svg: svg, W: W, H: H, tip: tooltip(wrap)};
}
function pointerX(svg, ev, W) {
  var r = svg.getBoundingClientRect();
  var cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
  return (cx - r.left) * (W / r.width);
}

/* ---------- line over time: opts {points:[{x:ms,y,label?,pr?}], yFmt, unit, height, zero,
 *            refs:[{y, label}] (horizontal reference lines, e.g. strength standards, labelled directly)} */
function line(box, opts) {
  var pts = (opts.points || []).filter(function (p) { return isFinite(p.y); });
  if (pts.length < 2) { empty(box, opts.emptyText || 'Not enough data yet — needs at least two sessions.'); return; }
  var f = frame(box, opts.height), svg = f.svg, W = f.W, H = f.H, L = 40, R = 12, T = 12, B = 24;
  var ys = pts.map(function (p) { return p.y; }), xs = pts.map(function (p) { return p.x; });
  var refs = (opts.refs || []).filter(function (r) { return isFinite(r.y) && r.y > 0; });
  var ry = ys.concat(refs.map(function (r) { return r.y; }));
  var ax = nice(opts.zero ? 0 : Math.min.apply(null, ry), Math.max.apply(null, ry), 4);
  var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
  if (x1 === x0) x1 = x0 + 864e5;
  var X = function (v) { return L + (v - x0) / (x1 - x0) * (W - L - R); };
  var Y = function (v) { return T + (1 - (v - ax.lo) / (ax.hi - ax.lo)) * (H - T - B); };
  var yf = opts.yFmt || fmtNum;
  ax.ticks.forEach(function (t) {
    el('line', {x1: L, x2: W - R, y1: Y(t), y2: Y(t), stroke: C.grid, 'stroke-width': 1}, svg);
    txt(svg, L - 6, Y(t) + 4, yf(t), 'end');
  });
  xTicks(svg, x0, x1, X, H, B);
  // reference lines: solid hairlines in the axis tone (recede behind the data), label above at the left;
  // a label that would crowd the previous one is dropped (the card text lists every threshold anyway)
  var lastLab = -99, refLabels = [];
  refs.slice().sort(function (a, b) { return b.y - a.y; }).forEach(function (r) {
    var y = Y(r.y);
    el('line', {x1: L, x2: W - R, y1: y, y2: y, stroke: C.axis, 'stroke-width': 1, 'class': 'cref'}, svg);
    if (r.label && y - lastLab >= 13) { refLabels.push([y, r.label]); lastLab = y; }
  });
  var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p.x).toFixed(1) + ',' + Y(p.y).toFixed(1); }).join('');
  el('path', {d: d, fill: 'none', stroke: C.series, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'}, svg);
  pts.forEach(function (p) {
    if (p.pr) el('circle', {cx: X(p.x), cy: Y(p.y), r: 5, fill: C.pr, stroke: C.surface, 'stroke-width': 2}, svg);
  });
  var last = pts[pts.length - 1];
  el('circle', {cx: X(last.x), cy: Y(last.y), r: 4.5, fill: C.series, stroke: C.surface, 'stroke-width': 2}, svg);
  // reference labels go on top of the series with a surface-coloured halo, so a line through them can't hide them
  // place each one where it covers no data point: left/right end, above/below its line
  refLabels.forEach(function (l) {
    var w = l[1].length * 6.3 + 4, spots = [[L + 4, l[0] - 4, 'start'], [W - R - 4, l[0] - 4, 'end'], [L + 4, l[0] + 13, 'start'], [W - R - 4, l[0] + 13, 'end']];
    var free = spots.filter(function (s) {
      var x0 = s[2] === 'start' ? s[0] : s[0] - w, x1 = x0 + w, y1 = s[1] + 3, y0 = s[1] - 11;
      return y1 <= H - B && !pts.some(function (p) { var px = X(p.x), py = Y(p.y); return px > x0 - 6 && px < x1 + 6 && py > y0 - 6 && py < y1 + 6; });
    })[0] || spots[0];
    var t = txt(svg, free[0], free[1], l[1], free[2], 'cax cref');
    t.setAttribute('stroke', C.surface); t.setAttribute('stroke-width', 4); t.setAttribute('stroke-linejoin', 'round');
    t.setAttribute('paint-order', 'stroke');
  });
  // no in-plot value label: the card's note states the latest value, and labels over a busy line collide
  // crosshair + tooltip
  var cross = el('line', {y1: T, y2: H - B, stroke: C.axis, 'stroke-width': 1, visibility: 'hidden'}, svg);
  var dot = el('circle', {r: 5, fill: C.series, stroke: C.surface, 'stroke-width': 2, visibility: 'hidden'}, svg);
  function at(ev) {
    var px = pointerX(svg, ev, W), best = pts[0], bd = Infinity;
    pts.forEach(function (p) { var dd = Math.abs(X(p.x) - px); if (dd < bd) { bd = dd; best = p; } });
    cross.setAttribute('x1', X(best.x)); cross.setAttribute('x2', X(best.x)); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', X(best.x)); dot.setAttribute('cy', Y(best.y)); dot.setAttribute('visibility', 'visible');
    var r = svg.getBoundingClientRect(), k = r.width / W;
    var lines = [{text: yf(best.y) + (opts.unit || '')}, {text: best.label || shortDate(best.x)}];
    if (best.pr) lines.push({text: '🏆 PR', key: C.pr});
    f.tip.show(X(best.x) * k, Y(best.y) * k, lines);
  }
  bindPointer(svg, at, function () { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); f.tip.hide(); });
}
function xTicks(svg, x0, x1, X, H, B) {
  var days = (x1 - x0) / 864e5, out = [], d = new Date(x0);
  if (days > 75) {                     // month starts
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    var every = days > 400 ? 3 : days > 200 ? 2 : 1;
    for (var i = 0; d.getTime() <= x1; i++, d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) if (i % every === 0) out.push(d.getTime());
  } else {                             // ~4 evenly spaced dates
    for (var j = 0; j <= 3; j++) out.push(x0 + (x1 - x0) * j / 3);
  }
  out.forEach(function (t, i) {
    var x = X(t);
    txt(svg, x, H - B + 16, days > 75 ? monthLabel(t) : shortDate(t), i === 0 && days <= 75 ? 'start' : (i === out.length - 1 && days <= 75 ? 'end' : 'middle'));
  });
}
// Touch: browsers fire pointerleave when the finger lifts, so a tooltip opened by a tap must survive it
// and close on the next tap elsewhere instead. Mouse: hide when the pointer leaves the chart.
function stickyLeave(target, leave) {
  target.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') leave(); });
  document.addEventListener('pointerdown', function (e) { if (!target.contains(e.target)) leave(); }, true);
}
function bindPointer(svg, move, leave) {
  svg.addEventListener('pointerdown', function (e) { move(e); });
  svg.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse' || e.buttons) move(e); });
  svg.addEventListener('touchmove', function (e) { move(e); }, {passive: true});
  stickyLeave(svg, leave);
  svg.style.touchAction = 'pan-y';
}

/* ---------- vertical bars: opts {items:[{x:ms or label, y, label?, now?}], yFmt, unit, height, max, ticks} */
function bars(box, opts) {
  var items = opts.items || [];
  // with a shared scale (opts.max) an all-zero chart still draws, so small multiples line up
  if (!items.length || (!opts.max && !items.some(function (i) { return i.y > 0; }))) { empty(box, opts.emptyText || 'Nothing in this period yet.'); return; }
  var f = frame(box, opts.height), svg = f.svg, W = f.W, H = f.H, L = 40, R = 8, T = 12, B = 24;
  // opts.max: shared y-scale for small multiples (every chart in the set gets the same top)
  var ax = nice(0, Math.max.apply(null, items.map(function (i) { return i.y; }).concat([opts.max || 0])), opts.ticks || 4), yf = opts.yFmt || fmtNum;
  var Y = function (v) { return T + (1 - v / ax.hi) * (H - T - B); };
  ax.ticks.forEach(function (t) { el('line', {x1: L, x2: W - R, y1: Y(t), y2: Y(t), stroke: C.grid, 'stroke-width': 1}, svg); txt(svg, L - 6, Y(t) + 4, yf(t), 'end'); });
  var band = (W - L - R) / items.length, bw = Math.max(2, Math.min(24, band - 2));
  var every = Math.max(1, Math.ceil(items.length / 6));
  items.forEach(function (it, i) {
    var cx = L + band * (i + 0.5), h = Math.max(it.y > 0 ? 2 : 0, Y(0) - Y(it.y)), x = cx - bw / 2, y = Y(0) - h, r = Math.min(4, bw / 2, h);
    if (h > 0) el('path', {d: 'M' + x + ',' + Y(0) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + bw - r) +
      'Q' + (x + bw) + ',' + y + ' ' + (x + bw) + ',' + (y + r) + 'V' + Y(0) + 'Z', fill: C.series, opacity: it.now ? 1 : 0.78, 'class': 'cbar'}, svg);
    // regular ticks every N bars, plus the last bar; drop a regular tick that would crowd the last one
    var lastI = items.length - 1;
    if (i === lastI || (i % every === 0 && lastI - i >= Math.max(2, every * 0.75)))
      txt(svg, Math.min(Math.max(cx, L + 16), W - R - 16), H - B + 16, it.label || shortDate(it.x), 'middle');
    var hit = el('rect', {x: cx - band / 2, y: T, width: band, height: H - T - B, fill: 'transparent', tabindex: 0}, svg);
    var show = function () {
      var k = svg.getBoundingClientRect().width / W;
      f.tip.show(cx * k, (Y(0) - h) * k, [{text: yf(it.y) + (opts.unit || '')}, {text: it.tip || it.label || shortDate(it.x)}]);
    };
    hit.addEventListener('pointerenter', show); hit.addEventListener('pointerdown', show); hit.addEventListener('focus', show);
  });
  stickyLeave(svg, function () { f.tip.hide(); });
}

/* ---------- horizontal bars with direct labels: opts {items:[{label, value, text, color?}], max, band:[lo,hi], bandLabel} */
function hbars(box, opts) {
  box.textContent = '';
  var items = opts.items || [];
  if (!items.length) { empty(box, opts.emptyText || 'Nothing yet.'); return; }
  var max = opts.max || Math.max.apply(null, items.map(function (i) { return i.value; })) || 1;
  var list = document.createElement('div'); list.className = 'chb'; box.appendChild(list);
  if (opts.band) {
    var key = document.createElement('div'); key.className = 'chbkey';
    var sw = document.createElement('i'); key.appendChild(sw); key.appendChild(document.createTextNode(opts.bandLabel || ''));
    list.appendChild(key);
  }
  items.forEach(function (it) {
    var row = document.createElement('div'); row.className = 'chbr';
    var lab = document.createElement('span'); lab.className = 'chbl'; lab.textContent = it.label; row.appendChild(lab);
    var track = document.createElement('span'); track.className = 'chbt';
    if (opts.band) {
      var b = document.createElement('i'); b.className = 'chbband';
      b.style.left = (100 * opts.band[0] / max) + '%'; b.style.width = (100 * (Math.min(opts.band[1], max) - opts.band[0]) / max) + '%';
      track.appendChild(b);
    }
    var fill = document.createElement('i'); fill.className = 'chbf';
    fill.style.width = Math.max(it.value > 0 ? 1.5 : 0, 100 * Math.min(1, it.value / max)) + '%';
    if (it.color) fill.style.background = it.color;
    track.appendChild(fill); row.appendChild(track);
    var v = document.createElement('span'); v.className = 'chbv'; v.textContent = it.text != null ? it.text : fmtNum(it.value); row.appendChild(v);
    if (it.onclick) { row.classList.add('tap'); row.onclick = it.onclick; }
    list.appendChild(row);
  });
}

/* ---------- training calendar: opts {days:{'YYYY-MM-DD': value}, weeks, end: ms, fmt} (Mon..Sun rows) */
function calendar(box, opts) {
  var weeks = opts.weeks || 26, f = frame(box, 0), wrap = f.wrap; wrap.textContent = '';
  var end = new Date(opts.end || Date.now()); end.setHours(12, 0, 0, 0);
  var start = new Date(end); start.setDate(start.getDate() - (start.getDay() + 6) % 7 - 7 * (weeks - 1));
  var vals = Object.keys(opts.days || {}).map(function (k) { return opts.days[k]; });
  var max = Math.max.apply(null, vals.concat([1]));
  var W = Math.max(260, box.clientWidth || 320), gap = 3, cell = Math.min(16, Math.floor((W - 22 - gap * weeks) / weeks)), H = 7 * (cell + gap) + 18;
  var svg = el('svg', {viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, role: 'img'}, wrap);
  var tip = tooltip(wrap), lastMonth = -1, lastLabelX = -99;
  ['M', '', 'W', '', 'F', '', ''].forEach(function (s, i) { if (s) txt(svg, 0, 14 + i * (cell + gap) + cell / 2, s); });
  for (var w = 0; w < weeks; w++) {
    for (var dIdx = 0; dIdx < 7; dIdx++) {
      var day = new Date(start); day.setDate(start.getDate() + w * 7 + dIdx);
      if (day > end) continue;
      var key = day.getFullYear() + '-' + ('0' + (day.getMonth() + 1)).slice(-2) + '-' + ('0' + day.getDate()).slice(-2);
      var v = (opts.days || {})[key] || 0, x = 18 + w * (cell + gap), y = 14 + dIdx * (cell + gap);
      if (dIdx === 0 && day.getMonth() !== lastMonth) {            // label a month unless it would crowd the previous label
        lastMonth = day.getMonth();
        if (x - lastLabelX >= 30) { txt(svg, x, 9, monthLabel(day.getTime())); lastLabelX = x; }
      }
      // sequential, one hue: volt at increasing strength; empty days recede to the grid tone
      var step = v ? Math.min(4, 1 + Math.floor(3 * v / max)) : 0;
      var rect = el('rect', {x: x, y: y, width: cell, height: cell, rx: 3, fill: step ? C.series : C.grid, 'fill-opacity': [1, 0.3, 0.55, 0.8, 1][step], tabindex: 0}, svg);
      (function (k2, v2, x2, y2) {
        var show = function () {
          var s = svg.getBoundingClientRect().width / W;
          tip.show((x2 + cell / 2) * s, y2 * s, [{text: v2 ? (opts.fmt ? opts.fmt(v2) : v2) : 'Rest day'}, {text: new Date(k2 + 'T12:00:00').toLocaleDateString('en-GB', {weekday: 'short', day: 'numeric', month: 'short'})}]);
        };
        rect.addEventListener('pointerenter', show); rect.addEventListener('pointerdown', show); rect.addEventListener('focus', show);
      })(key, v, x, y);
    }
  }
  stickyLeave(svg, function () { tip.hide(); });
}

function empty(box, text) {
  box.textContent = '';
  var p = document.createElement('p'); p.className = 'cempty'; p.textContent = text; box.appendChild(p);
}

/* ---------- table view: rows = [[cells...]], head = [...] */
function table(box, head, rows) {
  box.textContent = '';
  if (!rows.length) { empty(box, 'No data in this period.'); return; }
  var wrap = document.createElement('div'); wrap.className = 'ctbl';
  var t = document.createElement('table'), tr = document.createElement('tr');
  head.forEach(function (h) { var th = document.createElement('th'); th.textContent = h; tr.appendChild(th); });
  t.appendChild(tr);
  rows.forEach(function (r) {
    var row = document.createElement('tr');
    r.forEach(function (c) { var td = document.createElement('td'); td.textContent = c; row.appendChild(td); });
    t.appendChild(row);
  });
  wrap.appendChild(t); box.appendChild(wrap);
}

window.Charts = {line: line, bars: bars, hbars: hbars, calendar: calendar, table: table, empty: empty,
  fmtNum: fmtNum, dayMs: dayMs, shortDate: shortDate, colors: C};
})();
