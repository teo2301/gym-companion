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
  // An update that arrives while the app is open: offer a one-tap reload. Data lives in IndexedDB, so
  // reloading is safe even mid-workout. Skipped on the very first install (nothing was controlling yet).
  var hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (hadController) updateReady();
    hadController = true;
  });
  navigator.serviceWorker.register('sw-public.js').then(function (reg) {
    document.addEventListener('visibilitychange', function () {   // Home Screen apps resume rather than reload
      if (document.visibilityState === 'visible') reg.update().catch(function () {});
    });
  }).catch(function () {});
}
function updateReady() {
  if (document.getElementById('updPill')) return;
  var d = document.createElement('div');
  d.id = 'updPill';
  d.setAttribute('style', 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(14px + env(safe-area-inset-bottom));' +
    'z-index:85;display:flex;align-items:center;gap:4px;background:#d7ff3e;color:#0c0e12;border-radius:22px;' +
    'box-shadow:0 8px 24px rgba(0,0,0,.5);font:600 15px system-ui,-apple-system,sans-serif;white-space:nowrap');
  d.innerHTML = '<button data-a="go" style="border:0;background:none;color:inherit;font:inherit;padding:11px 4px 11px 18px">' +
    'New version ready \u00b7 <u>Update</u></button><button data-a="x" aria-label="Later" style="border:0;background:none;' +
    'color:inherit;font:inherit;padding:11px 16px 11px 8px">\u2715</button>';
  d.onclick = function (e) {
    var a = e.target.closest ? (e.target.closest('[data-a]') || {}).getAttribute && e.target.closest('[data-a]').getAttribute('data-a') : null;
    if (a === 'go') location.reload();
    else if (a === 'x') d.parentNode.removeChild(d);
  };
  document.body.appendChild(d);
}
function persistStorage() {
  if (!PUBLIC || IN_SHELL || !navigator.storage || !navigator.storage.persist) return;
  navigator.storage.persisted().then(function (p) { if (!p) navigator.storage.persist().catch(function () {}); })
    .catch(function () {});
}

/* ---------- iOS Safari: one-time Add to Home Screen tip (an ordinary card on the home screen, in the
 * page flow under the greeting, so it can never cover a button) */
function homeScreenTip() {
  if (!PUBLIC || IN_SHELL || !IOS || STANDALONE || lsGet('gymA2hsTip')) return;
  var anchor = document.getElementById('hellosub');
  if (!anchor || !anchor.parentNode) return;
  var d = document.createElement('div');
  d.id = 'a2hsTip';
  d.setAttribute('style', 'background:#20252e;color:#eef0f3;border:1px solid #2a303a;border-radius:18px;padding:14px 16px;' +
    'margin:-8px 0 18px;font:15px/1.4 system-ui,-apple-system,sans-serif');
  d.innerHTML = '<b style="font-size:16px">Install Gym Companion</b><br>' +
    '<span style="color:#8d94a0">Tap <b style="color:#eef0f3">Share</b> then <b style="color:#eef0f3">Add to Home Screen</b>. ' +
    'It works offline and keeps your workouts safe (Safari tabs can clear data you haven\u2019t opened for a week).</span>' +
    '<button style="display:block;margin:10px 0 0 auto;border:0;border-radius:12px;padding:8px 16px;background:#d7ff3e;' +
    'color:#0c0e12;font:600 15px system-ui,-apple-system,sans-serif">Got it</button>';
  d.querySelector('button').onclick = function () { lsSet('gymA2hsTip', '1'); if (d.parentNode) d.parentNode.removeChild(d); };
  anchor.parentNode.insertBefore(d, anchor.nextSibling);
}

function boot() { watchWorkout(); registerOffline(); persistStorage(); homeScreenTip(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
