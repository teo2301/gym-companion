/* Gym Companion - web-app glue for phones without the Android shell (iPhone above all).
 *  - keeps the screen awake while a workout is open (Screen Wake Lock API; all modes)
 *  - public web build only: offline cache (sw-public.js), persistent storage request, and a one-time
 *    "Add to Home Screen" tip in iOS Safari (Home Screen apps keep their data; Safari tabs can lose it
 *    after 7 days without a visit).
 * Inside the Android shells (window.GymBridge) only the wake lock part is active, and it is a no-op
 * there because the shell already keeps the screen on.
 */
(function () {
'use strict';
var PUBLIC = !!(window.GYM_PUBLIC || location.hash.indexOf('#public') === 0);
var IN_SHELL = !!window.GymBridge;
var STANDALONE = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
var IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

/* ---------- wake lock while the workout screen is showing */
var lock = null, want = false;
function acquire() {
  if (!want || lock || IN_SHELL || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  navigator.wakeLock.request('screen').then(function (l) {
    lock = l;
    l.addEventListener('release', function () { lock = null; });
  }).catch(function () {});
}
function release() { if (lock) { lock.release().catch(function () {}); lock = null; } }
function watchWorkout() {
  var work = document.getElementById('work');
  if (!work) return;
  var sync = function () { want = work.classList.contains('on'); if (want) acquire(); else release(); };
  new MutationObserver(sync).observe(work, {attributes: true, attributeFilter: ['class']});
  // iOS drops the lock whenever the page is hidden; take it again on return
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') acquire(); });
  sync();
}

/* ---------- public web app: offline cache + storage */
function registerOffline() {
  if (!PUBLIC || IN_SHELL || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('sw-public.js').catch(function () {});
}
function persistStorage() {
  if (!PUBLIC || IN_SHELL || !navigator.storage || !navigator.storage.persist) return;
  navigator.storage.persisted().then(function (p) { if (!p) navigator.storage.persist().catch(function () {}); })
    .catch(function () {});
}

/* ---------- iOS Safari: one-time Add to Home Screen tip */
function homeScreenTip() {
  if (!PUBLIC || IN_SHELL || !IOS || STANDALONE || lsGet('gymA2hsTip')) return;
  var d = document.createElement('div');
  d.setAttribute('style', 'position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:80;' +
    'background:#20252e;color:#eef0f3;border:1px solid #2a303a;border-radius:18px;padding:14px 16px;' +
    'font:15px/1.4 system-ui,-apple-system,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.5)');
  d.innerHTML = '<b style="font-size:16px">Install Gym Companion</b><br>' +
    '<span style="color:#8d94a0">Tap <b style="color:#eef0f3">Share</b> then <b style="color:#eef0f3">Add to Home Screen</b>. ' +
    'It works offline and keeps your workouts safe (Safari tabs can clear data you haven’t opened for a week).</span>' +
    '<button style="display:block;margin:10px 0 0 auto;border:0;border-radius:12px;padding:8px 16px;background:#d7ff3e;' +
    'color:#0c0e12;font:600 15px system-ui,-apple-system,sans-serif">Got it</button>';
  // Only on a quiet home screen: it steps aside for onboarding, sheets, workouts and the rest timer,
  // and comes back on the home screen until "Got it" is tapped.
  var on = function (id) { var e = document.getElementById(id); return !!(e && e.classList.contains('on')); };
  var timer = setInterval(function () {
    var quiet = on('home') && !on('sheet') && !on('rest') && !on('lvup');
    if (quiet && !d.parentNode) document.body.appendChild(d);
    else if (!quiet && d.parentNode) d.parentNode.removeChild(d);
  }, 1000);
  d.querySelector('button').onclick = function () {
    lsSet('gymA2hsTip', '1'); clearInterval(timer); if (d.parentNode) d.parentNode.removeChild(d);
  };
}

function boot() { watchWorkout(); registerOffline(); persistStorage(); homeScreenTip(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
