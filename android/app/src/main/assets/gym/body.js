/* Gym Companion body map: front + back figure, one SVG region per muscle (left half drawn,
   right half mirrored). Muscle ids match gym_muscles.py.  window.BodyMap.svg(fills, opts) */
(function () {
  'use strict';
  // ---- FRONT (left half, x < 100)
  var F = {
    front_delts: 'M71,83 C62,82 55,87 52,95 C51,100 52,104 53,108 C57,103 62,100 69,99 C71,94 72,88 71,83Z',
    side_delts: 'M64,80 C55,80 47,86 45,96 C44,102 45,107 47,111 C49,104 50,98 53,93 C56,87 61,83 67,82Z',
    chest: 'M98,88 C88,86 79,86 72,90 C70,96 69,103 70,109 C73,118 81,124 91,124 C95,124 98,122 98,119Z',
    biceps: 'M52,111 C47,113 44,121 43,131 C42,141 44,150 47,154 C51,150 55,141 57,131 C58,123 57,116 55,111Z',
    forearms: 'M45,157 C40,162 37,172 36,183 C35,193 36,201 37,206 L42,206 C45,197 49,186 51,176 C53,168 52,161 49,157Z',
    abs: 'M99,127 C92,127 87,128 85,131 L85,150 C85,163 86,180 88,194 C91,203 95,207 99,208Z',
    obliques: 'M83,128 C78,128 74,131 73,137 C72,150 73,166 76,180 C79,190 83,196 86,199 C84,182 83,164 83,148Z',
    traps: 'M90,70 C86,74 80,77 73,80 C79,81 86,82 92,84 C95,80 97,75 97,70Z',
    adductors: 'M97,222 C93,222 89,226 87,233 C86,245 87,258 89,268 C92,262 95,250 97,238Z',
    quads: 'M84,214 C76,216 70,224 68,236 C66,252 67,270 70,286 C73,296 78,302 84,303 C89,298 91,286 90,272 C89,256 87,240 86,226 C86,221 86,217 84,214Z',
    calves: 'M73,318 C69,326 67,338 67,351 C67,364 70,376 74,384 L80,384 C82,372 83,358 83,345 C83,333 81,323 78,317Z'
  };
  // ---- BACK (left half)
  var B = {
    traps: 'M99,68 C95,72 88,77 77,81 C84,84 90,88 94,94 C96,104 98,116 99,124Z',
    rear_delts: 'M70,82 C60,81 51,87 47,97 C46,102 46,107 47,111 C52,106 58,103 66,102 C70,96 72,89 70,82Z',
    side_delts: 'M47,111 C45,104 45,96 49,89 C52,85 56,82 62,81 C55,88 51,96 50,106Z',
    upper_back: 'M92,96 C86,92 79,90 72,92 C71,99 72,106 75,112 C80,116 87,118 93,118 C95,111 94,103 92,96Z',
    lats: 'M74,115 C72,124 72,136 74,148 C77,162 83,174 90,182 C93,176 95,166 96,154 C96,142 95,130 93,121 C87,120 80,118 74,115Z',
    lower_back: 'M98,160 C95,170 92,182 90,194 C92,202 95,206 99,207Z',
    triceps: 'M52,111 C47,114 44,122 43,132 C42,142 44,150 47,154 C51,149 55,140 56,130 C57,122 56,116 54,111Z',
    forearms: 'M45,157 C40,162 37,172 36,183 C35,193 36,201 37,206 L42,206 C45,197 49,186 51,176 C53,168 52,161 49,157Z',
    glutes: 'M98,206 C90,204 81,206 76,213 C72,221 72,231 76,238 C82,244 91,245 98,241Z',
    hamstrings: 'M85,248 C77,248 71,255 70,266 C69,280 71,293 75,303 C79,306 84,306 88,303 C91,292 92,278 91,264 C90,256 88,250 85,248Z',
    calves: 'M72,316 C67,324 66,336 67,348 C68,358 71,366 75,370 C79,366 82,356 82,345 C82,333 80,323 77,316Z'
  };
  // silhouette (whole body outline, left half) drawn under the muscles
  var SIL = 'M100,10 C88,10 81,19 81,31 C81,41 85,49 91,54 L91,66 C84,72 74,77 64,79 C52,82 45,90 43,101 C40,114 40,128 40,142 ' +
    'C38,152 35,164 33,178 C31,192 31,202 32,212 C33,220 36,226 38,226 C41,226 43,220 43,212 C44,200 47,188 51,176 ' +
    'C54,166 56,156 58,146 C60,134 62,122 66,112 C68,124 69,138 70,150 C70,170 70,190 69,206 C67,226 66,248 66,270 ' +
    'C66,290 68,306 68,318 C66,334 65,350 66,366 C67,378 69,388 70,396 C68,402 66,408 70,410 L86,410 C88,404 85,396 84,388 ' +
    'C85,372 86,352 86,334 C86,322 88,312 90,302 C93,284 95,264 97,244 L99,232 L100,232Z';

  function mirror(d) { return '<g transform="translate(200,0) scale(-1,1)">' + d + '</g>'; }
  function regions(map, fills, view) {
    var out = '';
    Object.keys(map).forEach(function (m) {
      var f = fills[m] || '#252a33';
      var p = '<path class="mreg" data-m="' + m + '" data-v="' + view + '" d="' + map[m] + '" style="fill:' + f + '"/>';
      out += p + mirror(p);
    });
    return out;
  }
  // definition lines drawn over the regions (ab segments, linea alba, spine)
  var LINES = {
    front: 'M100,127 L100,206 M86,148 C92,150 108,150 114,148 M87,168 C93,170 107,170 113,168 M88,187 C94,189 106,189 112,187 M100,88 L100,123',
    back: 'M100,96 L100,206 M100,206 L100,240'
  };
  function figure(map, fills, view, x) {
    return '<g transform="translate(' + x + ',0)">' +
      '<path d="' + SIL + '" fill="#15181e"/>' + mirror('<path d="' + SIL + '" fill="#15181e"/>') +
      regions(map, fills, view) +
      '<path d="' + LINES[view] + '" fill="none" stroke="#0c0e12" stroke-width="1.6" stroke-linecap="round" pointer-events="none"/></g>';
  }
  /* fills: {muscle: css colour}; returns SVG markup with front (left) and back (right) */
  function svg(fills, opts) {
    opts = opts || {};
    return '<svg class="bodymap" viewBox="0 0 400 420" xmlns="http://www.w3.org/2000/svg">' +
      figure(F, fills, 'front', 0) + figure(B, fills, 'back', 200) +
      (opts.labels === false ? '' : '<text x="100" y="418" class="bmlab">FRONT</text><text x="300" y="418" class="bmlab">BACK</text>') +
      '</svg>';
  }
  window.BodyMap = {svg: svg, FRONT: F, BACK: B};
})();
