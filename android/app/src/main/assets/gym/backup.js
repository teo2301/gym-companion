/* Gym Companion - backup / export / restore UI glue.
 * Uses GymStore's saveFile/pickFile and, when present, the page's openSheet/closeSheet/toast.
 * Plain ES5, no dependencies.
 */
(function (global) {
'use strict';

var store = null, wired = false;

function $(id) { return document.getElementById(id); }
function say(msg) {
  if (typeof global.toast === 'function') global.toast(msg);
  else try { console.log(msg); } catch (e) {}
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c];
  });
}
function today() {
  var d = new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function onClick(id, fn) {
  var el = $(id);
  if (!el || el.__gymBackupWired) return;
  el.__gymBackupWired = true;
  el.addEventListener('click', function () {
    try { var p = fn(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  });
}
function countsOf(data) {
  var dates = (data.sessions || []).map(function (s) { return s.date_str || ''; })
    .filter(function (d) { return !!d; }).sort();
  return {sessions: (data.sessions || []).length,
    routines: Object.keys((data.routines && data.routines.templates) || {}).length,
    notes: Object.keys(data.notes || {}).length,
    custom: (data.customExercises || data.custom || []).length,
    photos: ((data.character && data.character.photos) || []).length + ((data.character && data.character.progress) || []).length,
    from: dates.length ? dates[0] : null, to: dates.length ? dates[dates.length - 1] : null};
}
function restoreChar(data, strategy) {
  if (!global.GymPhoto) return Promise.resolve(false);
  // Replace must clear photos too, even from an older backup that has no character field.
  var character = (data && data.character) || (strategy === 'replace' ? {mode: 'cartoon', photos: [], progress: []} : null);
  if (!character) return Promise.resolve(false);
  var merged = strategy === 'replace' ? Promise.resolve(character) : global.GymPhoto.data().then(function (cur) {
    // merge: keep what's on this phone, add the backup's photos it doesn't have (by id), newest 6 by date
    var byId = {};
    (cur.photos || []).concat((character && character.photos) || []).forEach(function (p) { if (p && p.id && !byId[p.id]) byId[p.id] = p; });
    var photos = Object.keys(byId).map(function (k) { return byId[k]; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var pb = {};                              // progress photos (1.19): same merge by id; older backups have none
    (cur.progress || []).concat((character && character.progress) || []).forEach(function (p) { if (p && p.id && !pb[p.id]) pb[p.id] = p; });
    return {mode: cur.photos && cur.photos.length ? cur.mode : character.mode, current: cur.current || character.current, photos: photos.slice(-6),
      progress: Object.keys(pb).map(function (k) { return pb[k]; })};
  });
  return merged.then(function (c) { return global.GymPhoto.saveData(c); }).then(function () {
    if (typeof global.renderLifter === 'function') global.renderLifter();
    if (global.Progress && typeof global.Progress.refreshEvolution === 'function') global.Progress.refreshEvolution();
    return true;
  }).catch(function () { return false; });
}
function restoreNow(data, strategy) {
  return store.restore(data, strategy).then(function (res) {
    return restoreChar(data, strategy).then(function (photos) {
      if (!res || !res.ok) {
        say(photos ? 'Photos restored — server data could not be' : ((res && res.error) || 'Restore failed'));
        return res;
      }
      if (typeof global.closeSheet === 'function') global.closeSheet();
      say(photos ? 'Backup restored, including your photos' : 'Backup restored');
      if (typeof global.loadPlan === 'function') global.loadPlan();
      return res;
    });
  });
}
function previewSheet(data) {
  var c = countsOf(data), when = data.exportedAt || 'unknown date';
  var html = '<h2 style="margin:0 0 6px;font-size:24px">Restore backup</h2>' +
    '<p class="sub" style="margin-bottom:12px">Exported ' + esc(when) +
      (c.from ? ' · workouts ' + esc(c.from) + ' → ' + esc(c.to) : '') + '</p>' +
    '<div class="list"><div class="prow"><div>Workouts</div><span class="num">' + c.sessions + '</span></div>' +
    '<div class="prow"><div>Routines</div><span class="num">' + c.routines + '</span></div>' +
    '<div class="prow"><div>Exercise notes</div><span class="num">' + c.notes + '</span></div>' +
    '<div class="prow"><div>Custom exercises</div><span class="num">' + c.custom + '</span></div>' +
    '<div class="prow"><div>Character + progress photos</div><span class="num">' + c.photos + '</span></div></div>' +
    '<button class="log" id="rMerge" style="margin-top:14px">Merge into this phone</button>' +
    '<button class="danger" id="rReplace">Replace everything</button>' +
    '<button class="danger" id="rCancel">Cancel</button>';
  if (typeof global.openSheet !== 'function') {
    if (!global.confirm('Restore this backup? OK = merge, Cancel = skip.')) return Promise.resolve(null);
    return restoreNow(data, 'merge');
  }
  global.openSheet(html);
  $('rMerge').onclick = function () { restoreNow(data, 'merge').catch(function () {}); };
  $('rReplace').onclick = function () {
    if (!global.confirm('Replace ALL gym data on this phone with the backup? This cannot be undone.')) return;
    restoreNow(data, 'replace').catch(function () {});
  };
  $('rCancel').onclick = function () { if (typeof global.closeSheet === 'function') global.closeSheet(); };
  return Promise.resolve(data);
}
function restorePreview(text) {
  var data;
  try { data = JSON.parse(String(text || '')); }
  catch (e) { say('That file is not valid JSON'); return Promise.resolve(false); }
  if (!data || data.schemaVersion !== 1 || (data.sessions && !Array.isArray(data.sessions))) {
    say('Not a valid Gym Companion backup'); return Promise.resolve(false);
  }
  return previewSheet(data);
}

var Backup = {
  init: function (s) {
    store = s;
    if (wired || typeof document === 'undefined') return Promise.resolve(store);
    wired = true;
    onClick('backupBtn', Backup.exportJson);
    onClick('csvBtn', Backup.exportCsv);
    onClick('restoreBtn', Backup.restoreFlow);
    onClick('summaryBackup', Backup.exportJson);
    onClick('summaryCsv', Backup.exportCsv);
    var fp = $('filePick');
    if (fp && fp.tagName === 'INPUT') {
      fp.addEventListener('change', function () {
        var f = fp.files && fp.files[0];
        if (!f) return;
        var fr = new FileReader();
        fr.onload = function () { restorePreview(String(fr.result || '')).catch(function () {}); };
        fr.readAsText(f);
      });
    } else onClick('filePick', Backup.restoreFlow);
    return Promise.resolve(store);
  },

  exportJson: function () {
    if (!store) return Promise.reject(new Error('Backup not initialised'));
    return store.backupData().then(function (data) {
      return (global.GymPhoto ? global.GymPhoto.data() : Promise.resolve(null)).then(function (character) {
        if (character) data.character = character;   // photos stay on-device; only this file carries them
        return store.saveFile('gym-backup-' + today() + '.json', JSON.stringify(data, null, 2))
          .then(function (ok) {
            // false = share sheet cancelled or the Android bridge failed: don't count it as a backup
            if (ok === false) { say('Backup not saved'); return null; }
            return store.set('lastBackupAt', Date.now()).then(function () { say('Backup saved'); return data; });
          });
      });
    }).catch(function (e) { say('Backup failed'); throw e; });
  },

  exportCsv: function () {
    if (!store) return Promise.reject(new Error('Backup not initialised'));
    return store.backupData().then(function (data) {
      // Private server already keeps the Hevy-compatible companion CSV verbatim.
      var text = data.companion_csv || data.hevy_csv ||
        (global.GymCore && typeof global.GymCore.csv === 'function'
          ? global.GymCore.csv(data.sessions || []) : '');
      if (!text || text.indexOf('\n') < 0) { say('Nothing to export yet'); return null; }
      return store.saveFile('gym-workouts-' + today() + '.csv', text).then(function (ok) {
        if (ok === false) { say('CSV not saved'); return null; }
        say('Workout CSV saved'); return text;
      });
    }).catch(function (e) { say('CSV export failed'); throw e; });
  },

  restoreFlow: function () {
    if (!store) return Promise.reject(new Error('Backup not initialised'));
    return store.pickFile().then(function (text) { return text ? restorePreview(text) : false; });  // '' = picker cancelled
  },

  maybeNudge: function () {
    if (!store || store.mode !== 'public') return Promise.resolve(false);
    return Promise.all([store.get('lastBackupAt'), store.get('lastBackupNudge'), store.backupData()])
      .then(function (v) {
        var sessions = (v[2] && v[2].sessions) || [];
        if (!sessions.length) return false;                 // never nag before the first workout
        if (Date.now() - num(v[0]) <= 7 * 86400000) return false;
        if (v[1] === today()) return false;                  // once per day
        return store.set('lastBackupNudge', today()).then(function () {
          say('Back up your gym data'); return true;
        });
      }).catch(function () { return false; });
  },

  snapshotAfterFinish: function () {
    return store && store.snapshot ? store.snapshot().catch(function () {}) : Promise.resolve(null);
  }
};

function num(x) { var v = parseFloat(x); return isFinite(v) ? v : 0; }

global.Backup = Backup;
})(window);
