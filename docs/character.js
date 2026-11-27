/* Gym Companion lifter avatar: a double-biceps pose whose muscles grow with the strength score.
   Lifter.svg(score, opts) -> SVG markup. score = overall strength score (0..5; tiers are
   Beginner 0-1, Novice 1-2, Intermediate 2-3, Advanced 3-4, Elite 4-5). Kit unlocks by tier:
   wristbands (Novice), headband (Intermediate), lifting belt (Advanced), gold belt + aura (Elite). */
(function () {
  'use strict';
  var HAIR = '#2a2320', VOLT = '#d7ff3e', INK = '#0c0e12';
  // Skin tones: [base, shade (muscle lines), highlight (gradient top)]. 'beige' is the original look.
  var TONES = {
    porcelain: ['#f3d2bb', '#d6a689', '#fce6d7'],
    beige:     ['#e9b48a', '#c98d62', '#f6cfa9'],
    tan:       ['#d39a6a', '#ad7445', '#e7b88c'],
    olive:     ['#b47e52', '#8d5b33', '#cb9a6e'],
    brown:     ['#8d5a37', '#6b3f22', '#a8744d'],
    deep:      ['#5f3b23', '#432817', '#7c5135']
  };
  var TONE_ORDER = ['porcelain', 'beige', 'tan', 'olive', 'brown', 'deep'], tone = 'beige';
  var SKIN = TONES.beige[0], SKIN_D = TONES.beige[1], SKIN_L = TONES.beige[2];
  /** Choose the character's skin tone; unknown ids fall back to the default. Returns the id used. */
  function setTone(id) {
    tone = TONES[id] ? id : 'beige';
    SKIN = TONES[tone][0]; SKIN_D = TONES[tone][1]; SKIN_L = TONES[tone][2];
    return tone;
  }

  function f(n) { return n.toFixed(1); }

  function svg(score, opts) {
    opts = opts || {};
    var m = Math.max(0, Math.min(1, (score + 0.3) / 5.3));   // muscularity 0..1
    var tier = score < 0 ? -1 : Math.min(4, Math.floor(score));
    var S = 26 + 17 * m;            // half shoulder width
    var Wt = 19 + 3 * m;            // half waist
    var arm = 11 + 9 * m, fore = 9 + 5 * m, bic = 6 + 8 * m, delt = 8 + 7 * m;
    var thigh = 15 + 10 * m, calf = 10 + 6 * m;
    var ex = S + 24 + 5 * m;        // elbow x offset
    var o = '';
    o += '<svg class="lifter' + (opts.cls ? ' ' + opts.cls : '') + '" viewBox="0 0 200 250" xmlns="http://www.w3.org/2000/svg">';
    o += '<defs><radialGradient id="aura" cx="50%" cy="45%" r="50%"><stop offset="0" stop-color="#ffd35a" stop-opacity=".55"/>' +
      '<stop offset="1" stop-color="#ffd35a" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + SKIN_L + '"/><stop offset="1" stop-color="' + SKIN + '"/></linearGradient></defs>';
    if (tier >= 4) o += '<circle class="aura" cx="100" cy="120" r="98" fill="url(#aura)"/>';
    o += '<ellipse cx="100" cy="243" rx="' + f(34 + 10 * m) + '" ry="5" fill="#000" opacity=".35"/>';

    // legs
    o += '<g class="legs" stroke-linecap="round" fill="none">';
    [-1, 1].forEach(function (s) {
      var hx = 100 + s * 11, kx = 100 + s * (15 + 2 * m), ax = 100 + s * 15;
      o += '<path d="M' + f(hx) + ',168 L' + f(kx) + ',205" stroke="' + SKIN + '" stroke-width="' + f(thigh) + '"/>';
      o += '<path d="M' + f(kx) + ',207 L' + f(ax) + ',232" stroke="' + SKIN + '" stroke-width="' + f(calf) + '"/>';
      o += '<path d="M' + f(kx + s * calf * 0.25) + ',210 q' + f(s * calf * 0.35) + ',8 0,16" stroke="' + SKIN_D + '" stroke-width="1.6" opacity="' + f(0.2 + 0.6 * m) + '"/>';
      o += '<path d="M' + f(ax - 9) + ',238 h18 a4,4 0 0 0 0,-8 h-14 a4,4 0 0 0 -4,8z" fill="' + INK + '" stroke="#2a303a" stroke-width="1.5" transform="translate(' + (s > 0 ? 2 : -2) + ',0)"/>';
    });
    o += '</g>';
    // shorts
    o += '<path d="M' + f(100 - Wt - 2) + ',150 L' + f(100 + Wt + 2) + ',150 L' + f(100 + Wt + 6) + ',184 L104,184 L100,170 L96,184 L' + f(100 - Wt - 6) + ',184Z" fill="' + VOLT + '"/>';
    o += '<path d="M100,154 L100,170" stroke="#9fc21c" stroke-width="1.5"/>';

    // arms (double biceps), behind the torso edge
    o += '<g class="arms" stroke-linecap="round" fill="none">';
    [-1, 1].forEach(function (s) {
      var sx = 100 + s * (S - 4), elx = 100 + s * ex, ely = 92, fx = 100 + s * (ex + 4), fy = 52;
      o += '<g class="arm a' + (s < 0 ? 'l' : 'r') + '">';
      o += '<path d="M' + f(sx) + ',94 L' + f(elx) + ',' + ely + '" stroke="' + SKIN + '" stroke-width="' + f(arm) + '"/>';
      o += '<path d="M' + f(elx) + ',' + ely + ' L' + f(fx) + ',' + fy + '" stroke="' + SKIN + '" stroke-width="' + f(fore) + '"/>';
      // biceps peak
      o += '<circle class="bic" cx="' + f(100 + s * (S + 11 + 3 * m)) + '" cy="' + f(88 - 2 * m) + '" r="' + f(bic) + '" fill="url(#skin)"/>';
      o += '<path d="M' + f(100 + s * (S + 5)) + ',' + f(91 + bic * 0.3) + ' q' + f(s * (bic + 3)) + ',' + f(bic * 0.35) + ' ' + f(s * (2 * bic + 4)) + ',0" stroke="' + SKIN_D + '" stroke-width="1.6" opacity="' + f(0.25 + 0.6 * m) + '"/>';
      o += '<circle cx="' + f(fx) + '" cy="' + fy + '" r="' + f(7 + 2 * m) + '" fill="' + SKIN + '"/>';
      if (tier >= 1) o += '<path d="M' + f(fx - s * 0.5) + ',' + (fy + 9) + ' L' + f(fx - s * 0.2) + ',' + (fy + 15) + '" stroke="' + VOLT + '" stroke-width="' + f(fore + 2) + '" stroke-linecap="butt"/>';
      o += '</g>';
    });
    o += '</g>';

    // torso (V-taper)
    o += '<g class="torso">';
    o += '<path d="M' + f(100 - S) + ',88 Q' + f(100 - S - 3) + ',112 ' + f(100 - Wt - 3) + ',134 L' + f(100 - Wt) + ',152 L' + f(100 + Wt) + ',152 L' + f(100 + Wt + 3) + ',134 Q' + f(100 + S + 3) + ',112 ' + f(100 + S) + ',88 Q100,76 ' + f(100 - S) + ',88Z" fill="url(#skin)"/>';
    // delts
    [-1, 1].forEach(function (s) { o += '<circle cx="' + f(100 + s * (S - 2)) + '" cy="92" r="' + f(delt) + '" fill="url(#skin)"/>'; });
    // pecs
    var po = 0.25 + 0.65 * m;
    [-1, 1].forEach(function (s) {
      o += '<path d="M100,93 Q' + f(100 + s * S * 0.8) + ',88 ' + f(100 + s * S * 0.85) + ',103 Q' + f(100 + s * S * 0.55) + ',' + f(116 + 3 * m) + ' 100,' + f(112 + 3 * m) + '" fill="none" stroke="' + SKIN_D + '" stroke-width="2" opacity="' + f(po) + '"/>';
    });
    // abs
    var ao = 0.12 + 0.6 * m;
    for (var r = 0; r < 3; r++) [-1, 1].forEach(function (s) {
      o += '<rect x="' + f(s < 0 ? 100 - 10.5 : 101.5) + '" y="' + f(119 + r * 10) + '" width="9" height="8" rx="3" fill="' + SKIN_D + '" opacity="' + f(ao * 0.55) + '"/>';
    });
    o += '<path d="M100,116 L100,148" stroke="' + SKIN_D + '" stroke-width="1.4" opacity="' + f(ao) + '"/>';
    // belt
    if (tier >= 3) {
      var bc = tier >= 4 ? '#ffc23a' : '#2b2f37';
      o += '<rect x="' + f(100 - Wt - 2) + '" y="140" width="' + f(2 * Wt + 4) + '" height="12" rx="3" fill="' + bc + '"/>';
      o += '<rect x="94" y="141.5" width="12" height="9" rx="2" fill="none" stroke="' + (tier >= 4 ? '#fff3c2' : '#9aa3ad') + '" stroke-width="2"/>';
    }
    o += '</g>';

    // neck + head
    var nw = 9 + 4 * m;
    o += '<path d="M' + f(100 - nw) + ',84 L' + f(100 - nw + 2) + ',66 L' + f(100 + nw - 2) + ',66 L' + f(100 + nw) + ',84Z" fill="' + SKIN + '"/>';
    if (m > 0.4) [-1, 1].forEach(function (s) { o += '<path d="M' + f(100 + s * nw) + ',84 Q' + f(100 + s * (nw + 10)) + ',80 ' + f(100 + s * (S - 6)) + ',84" fill="' + SKIN + '"/>'; });
    o += '<g class="head">';
    o += '<circle cx="100" cy="48" r="19" fill="url(#skin)"/>';
    o += '<path d="M81,46 Q81,27 100,27 Q119,27 119,46 Q113,37 100,37 Q87,37 81,46Z" fill="' + HAIR + '"/>';
    if (tier >= 2) o += '<path d="M81.5,42 Q100,35 118.5,42 L118.5,47 Q100,40 81.5,47Z" fill="' + VOLT + '"/>';
    o += '<circle cx="93" cy="51" r="2.2" fill="' + INK + '"/><circle cx="107" cy="51" r="2.2" fill="' + INK + '"/>';
    o += '<path d="M94,58 Q100,' + f(62 + 2 * m) + ' 106,58" fill="none" stroke="' + INK + '" stroke-width="2" stroke-linecap="round"/>';
    o += '</g></svg>';
    return o;
  }
  window.Lifter = {svg: svg, setTone: setTone, tone: function () { return tone; },
    tones: function () { return TONE_ORDER.map(function (k) { return {id: k, color: TONES[k][0]}; }); }};
})();
