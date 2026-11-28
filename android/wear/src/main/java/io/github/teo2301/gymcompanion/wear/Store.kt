package io.github.teo2301.gymcompanion.wear

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * The live workout, shared with the paired phone over the Wear OS Data Layer (no server, no internet).
 * Protocol: see WATCH_LINK_SPEC.md in the Gym Companion repo.
 *
 *   watch -> phone  /gym/op/<id>   one queued action (JSON in the "json" field), deleted once acknowledged
 *   phone -> watch  /gym/live      {version, session, summary, server_time}
 *   phone -> watch  /gym/plan      {routines, suggested, week, lifter, generated, progress{overall, weeks}}
 *   phone -> watch  /gym/ack/<id>  "the phone applied op <id>"
 *
 * Offline-first: every action is applied to the local copy straight away (same rules as the web app's
 * GymCore.applyOp), saved, and queued as a Data Layer item. The system delivers queued items whenever the
 * phone is reachable. While anything is still unacknowledged the local copy wins; once the queue is empty
 * the phone's copy is adopted (it is the authority).
 */
object Store {
    private val ui = Handler(Looper.getMainLooper())
    private lateinit var app: Context
    private val prefs by lazy { app.getSharedPreferences("gym", 0) }
    private val data: DataClient by lazy { Wearable.getDataClient(app) }

    var session: JSONObject? = null; private set
    var plan: JSONObject? = null; private set
    var lifter: JSONObject? = null; private set     // overall score/level/tier (also inside plan)
    var progress: JSONObject? = null; private set   // {overall, weeks}, refreshed by the phone after a workout
    var version = -1; private set
    var clockSkew = 0L; private set          // always 0: both devices follow network time
    var sync = Sync.UNKNOWN; private set
    enum class Sync { UNKNOWN, OK, PENDING, OFFLINE }

    private var queue = JSONArray()
    private val listeners = mutableListOf<() -> Unit>()
    @Volatile private var phoneNear = true
    @Volatile private var liveSeen = false

    fun init(ctx: Context) {
        if (::app.isInitialized) return
        app = ctx.applicationContext
        session = prefs.getString("session", null)?.let { JSONObject(it) }
        plan = prefs.getString("plan", null)?.let { JSONObject(it) }
        lifter = prefs.getString("lifter", null)?.let { JSONObject(it) }
        progress = prefs.getString("progress", null)?.let { JSONObject(it) }
        queue = JSONArray(prefs.getString("queue", "[]"))
        version = prefs.getInt("version", -1)
        liveSeen = prefs.getBoolean("live_seen", false)
        recomputeSync()
    }

    /** Last level the watch celebrated/seen; mirrors the phone's localStorage gymLv. */
    var lastLv: Int
        get() = prefs.getInt("last_lv", 0)
        set(v) { prefs.edit().putInt("last_lv", v).apply() }

    fun listen(l: () -> Unit) { listeners.add(l) }
    fun unlisten(l: () -> Unit) { listeners.remove(l) }
    private var tileKey = ""
    private fun changed() {
        listeners.toList().forEach { it() }
        // redraw the watch tile when something it shows changes (routine, current exercise, plan)
        val s = session
        val k = "${s?.optString("id")}|${s?.optBoolean("finished")}|${s?.optInt("current")}|${plan?.optLong("generated")}"
        if (k != tileKey && ::app.isInitialized) { tileKey = k; GymTile.update(app) }
    }
    fun now() = System.currentTimeMillis() + clockSkew

    private fun persist() {
        prefs.edit().putString("session", session?.toString()).putString("queue", queue.toString())
            .putInt("version", version).putBoolean("live_seen", liveSeen).apply()
    }

    private fun recomputeSync() {
        val pending = synchronized(this) { queue.length() } > 0
        sync = when {
            pending && !phoneNear -> Sync.OFFLINE
            pending -> Sync.PENDING
            liveSeen || plan != null -> Sync.OK
            else -> Sync.UNKNOWN
        }
    }

    // ------------------------------------------------------------------ actions
    fun act(op: JSONObject) {
        op.put("id", UUID.randomUUID().toString()).put("t", now())
        applyLocal(op)
        synchronized(this) {
            // one heart-rate reading is enough while the phone is away: drop older unsent ones
            if (op.getString("op") == "hr") {
                val keep = JSONArray()
                for (k in 0 until queue.length()) {
                    val q = queue.getJSONObject(k)
                    if (q.getString("op") == "hr") deleteItem("/gym/op/" + q.getString("id")) else keep.put(q)
                }
                queue = keep
            }
            queue.put(op)
        }
        recomputeSync(); persist(); changed()
        putOp(op)
        checkPhone()
    }

    fun start(routine: JSONObject) = act(JSONObject().put("op", "start").put("routine", routine.getString("name"))
        .put("exercises", routine.getJSONArray("exercises")).put("last_volume", routine.optInt("last_volume")))
    fun log(ex: Int, w: Double, r: Int) = act(JSONObject().put("op", "log").put("ex", ex).put("w", w).put("r", r))
    fun undo(ex: Int) = act(JSONObject().put("op", "undo").put("ex", ex))
    fun select(ex: Int) = act(JSONObject().put("op", "select").put("ex", ex))
    fun restAdd(secs: Int) = act(JSONObject().put("op", "rest_add").put("secs", secs))
    fun restSkip() = act(JSONObject().put("op", "rest_skip"))
    fun finish() = act(JSONObject().put("op", "finish"))
    fun close() = act(JSONObject().put("op", "close"))
    fun discard() = act(JSONObject().put("op", "discard"))
    fun warm(ex: Int, i: Int) = act(JSONObject().put("op", "warm").put("ex", ex).put("i", i))
    fun heartRate(bpm: Int) = act(JSONObject().put("op", "hr").put("bpm", bpm))

    // ------------------------------------------------------------------ local copy of the server rules
    private fun e1rm(w: Double, r: Int) = if (w <= 0 || r <= 0) 0.0 else w * (1 + r / 30.0)

    private fun markPr(ex: JSONObject, w: Double, r: Int): String? {
        val best = ex.optJSONObject("best") ?: JSONObject()
        val done = ex.optJSONArray("done") ?: JSONArray()
        var bestE = best.optDouble("e1rm", 0.0); var bestW = best.optDouble("max_w", 0.0)
        for (i in 0 until done.length()) {
            val d = done.getJSONObject(i)
            bestE = maxOf(bestE, e1rm(d.optDouble("w"), d.optInt("r"))); bestW = maxOf(bestW, d.optDouble("w"))
        }
        if (w > 0 && best.optDouble("e1rm", 0.0) > 0 && e1rm(w, r) > bestE) return "e1rm"
        if (w > 0 && best.optDouble("max_w", 0.0) > 0 && w > bestW) return "weight"
        return null
    }

    private fun targets(ex: JSONObject) = ex.optJSONArray("target")?.length() ?: 0

    private fun applyLocal(op: JSONObject) {
        val kind = op.getString("op"); val t = op.getLong("t")
        val s = session
        if (kind == "start") {
            if (s != null && !s.optBoolean("finished")) return
            val exs = JSONArray()
            val src = op.getJSONArray("exercises")
            for (i in 0 until src.length()) exs.put(JSONObject(src.getJSONObject(i).toString()).put("done", JSONArray()))
            session = JSONObject().put("id", op.getString("id")).put("routine", op.getString("routine"))
                .put("started", t).put("exercises", exs).put("current", 0).put("rest_until", JSONObject.NULL)
                .put("rest_total", 0).put("hr_log", JSONArray()).put("finished", false)
                .put("last_volume", op.optInt("last_volume"))
            return
        }
        if (kind == "close") { if (s != null && s.optBoolean("finished")) session = null; return }
        if (s == null || s.optBoolean("finished")) return
        val exs = s.getJSONArray("exercises")
        val i = op.optInt("ex", s.optInt("current"))
        val ex = if (i in 0 until exs.length()) exs.getJSONObject(i) else null
        when (kind) {
            "log" -> if (ex != null) {
                val w = op.getDouble("w"); val r = op.getInt("r")
                val pr = markPr(ex, w, r)
                ex.getJSONArray("done").put(JSONObject().put("w", w).put("r", r).put("t", t).put("pr", pr ?: JSONObject.NULL))
                s.put("current", i)
                val secs = ex.optInt("rest", 90)
                s.put("rest_until", t + secs * 1000L).put("rest_total", secs)
                if (ex.getJSONArray("done").length() >= targets(ex)) {
                    val order = (i + 1 until exs.length()) + (0 until i)
                    order.firstOrNull { exs.getJSONObject(it).getJSONArray("done").length() < targets(exs.getJSONObject(it)) }
                        ?.let { s.put("current", it) }
                }
            }
            "undo" -> if (ex != null) {
                val d = ex.getJSONArray("done")
                if (d.length() > 0) d.remove(d.length() - 1)
                s.put("current", i).put("rest_until", JSONObject.NULL)
            }
            "select" -> if (ex != null) s.put("current", i)
            "warm" -> if (ex != null) {
                val k = op.getInt("i")
                val wd = ex.optJSONArray("warm_done") ?: JSONArray().also { ex.put("warm_done", it) }
                val at = (0 until wd.length()).firstOrNull { wd.getInt(it) == k }
                if (at != null) wd.remove(at)
                else if (k in 0 until (ex.optJSONArray("warmup")?.length() ?: 0)) {
                    wd.put(k); s.put("rest_until", t + 60_000L).put("rest_total", 60)
                }
            }
            "rest_add" -> if (!s.isNull("rest_until")) {
                s.put("rest_until", s.getLong("rest_until") + op.getInt("secs") * 1000L)
                s.put("rest_total", s.optInt("rest_total") + op.getInt("secs"))
            }
            "rest_skip" -> s.put("rest_until", JSONObject.NULL)
            "hr" -> { s.put("hr", JSONObject().put("bpm", op.getInt("bpm")).put("t", t)); s.getJSONArray("hr_log").put(op.getInt("bpm")) }
            "finish" -> { s.put("ended", t).put("finished", true).put("rest_until", JSONObject.NULL); s.put("summary", summary(s)) }
            "discard" -> session = null
        }
    }

    fun summary(s: JSONObject): JSONObject {
        val exs = s.getJSONArray("exercises")
        var sets = 0; var vol = 0.0; val prs = JSONArray(); var exDone = 0
        for (i in 0 until exs.length()) {
            val e = exs.getJSONObject(i); val d = e.getJSONArray("done")
            if (d.length() > 0) exDone++
            for (k in 0 until d.length()) {
                val x = d.getJSONObject(k); sets++; vol += x.optDouble("w") * x.optInt("r")
                if (!x.isNull("pr")) prs.put(JSONObject().put("ex", e.getString("name")).put("w", x.optDouble("w")).put("r", x.optInt("r")).put("kind", x.optString("pr")))
            }
        }
        val hr = s.optJSONArray("hr_log") ?: JSONArray()
        var sum = 0; var mx = 0
        for (k in 0 until hr.length()) { sum += hr.getInt(k); mx = maxOf(mx, hr.getInt(k)) }
        val end = if (s.has("ended")) s.getLong("ended") else now()
        return JSONObject().put("minutes", ((end - s.getLong("started")) / 60000.0).toInt()).put("sets", sets)
            .put("volume", vol.toInt()).put("prs", prs).put("exercises_done", exDone)
            .put("last_volume", s.opt("last_volume")).put("hr_avg", if (hr.length() > 0) sum / hr.length() else JSONObject.NULL)
            .put("hr_max", if (hr.length() > 0) mx else JSONObject.NULL)
    }

    // ------------------------------------------------------------------ Data Layer transport
    private fun uri(path: String): Uri = Uri.Builder().scheme("wear").path(path).build()

    private fun deleteItem(path: String) { try { data.deleteDataItems(uri(path)) } catch (e: Exception) { } }

    private fun putOp(op: JSONObject) {
        try {
            val req = PutDataMapRequest.create("/gym/op/" + op.getString("id"))
            req.dataMap.putString("json", op.toString())
            data.putDataItem(req.asPutDataRequest().setUrgent())
        } catch (e: Exception) { /* stays queued; re-sent on the next start */ }
    }

    /** Re-send everything still queued (the system ignores items that are already delivered). */
    private fun flush() {
        val pending = synchronized(this) { JSONArray(queue.toString()) }
        for (k in 0 until pending.length()) putOp(pending.getJSONObject(k))
    }

    private fun checkPhone() {
        try {
            Wearable.getNodeClient(app).connectedNodes.addOnSuccessListener { nodes ->
                val near = nodes.isNotEmpty()
                ui.post { if (near != phoneNear) { phoneNear = near; recomputeSync(); changed() } }
            }
        } catch (e: Exception) { }
    }

    /** Read every item the phone has published (they persist) and apply them. */
    private fun readAll(done: (Boolean) -> Unit = {}) {
        try {
            data.getDataItems(uri("/gym/"), DataClient.FILTER_PREFIX).addOnSuccessListener { buf ->
                val items = ArrayList<Pair<String, String>>()
                try {
                    for (item in buf) {
                        val path = item.uri.path ?: continue
                        val json = try { DataMapItem.fromDataItem(item).dataMap.getString("json") } catch (e: Exception) { null }
                        if (json != null) items.add(path to json)
                    }
                } finally { buf.release() }
                ui.post {
                    // live last: it is adopted only when the acks above emptied the queue
                    items.sortedBy { if (it.first == "/gym/live") 2 else if (it.first.startsWith("/gym/ack/")) 1 else 0 }
                        .forEach { onItem(it.first, it.second, quiet = true) }
                    recomputeSync(); changed()
                    done(plan != null)
                }
            }.addOnFailureListener { ui.post { done(plan != null) } }
        } catch (e: Exception) { done(plan != null) }
    }

    /** Called by PhoneListener (items changing while we run) and readAll (items already there). */
    fun onItem(path: String, json: String, quiet: Boolean = false) {
        val o = try { JSONObject(json) } catch (e: Exception) { return }
        when {
            path == "/gym/plan" -> adoptPlan(o)
            path == "/gym/live" -> adoptLive(o)
            path.startsWith("/gym/ack/") -> ack(path.removePrefix("/gym/ack/"))
        }
        if (!quiet) { recomputeSync(); changed() }
    }

    private fun adoptPlan(p: JSONObject) {
        p.optJSONObject("progress")?.let { progress = it; prefs.edit().putString("progress", it.toString()).apply() }
        p.remove("progress")
        plan = p
        p.optJSONObject("lifter")?.let { lifter = it }
        progress?.optJSONObject("overall")?.let { lifter = it }
        prefs.edit().putString("plan", p.toString()).putString("lifter", lifter?.toString()).apply()
    }

    /** The phone applied this op: forget it, and tidy up its items. */
    private fun ack(id: String) {
        var removed = false
        synchronized(this) {
            val keep = JSONArray()
            for (k in 0 until queue.length()) { val q = queue.getJSONObject(k); if (q.getString("id") == id) removed = true else keep.put(q) }
            queue = keep
        }
        if (!removed) return
        deleteItem("/gym/op/$id")
        persist()
        if (synchronized(this) { queue.length() } == 0) readLiveOnly()
    }

    private fun readLiveOnly() {
        try {
            data.getDataItems(uri("/gym/live")).addOnSuccessListener { buf ->
                var json: String? = null
                try { for (item in buf) json = try { DataMapItem.fromDataItem(item).dataMap.getString("json") } catch (e: Exception) { json } } finally { buf.release() }
                json?.let { j -> ui.post { try { adoptLive(JSONObject(j)); recomputeSync(); changed() } catch (e: Exception) { } } }
            }
        } catch (e: Exception) { }
    }

    /** Adopt the phone's state, unless local actions are still waiting to be acknowledged. */
    private fun adoptLive(st: JSONObject) {
        liveSeen = true
        if (synchronized(this) { queue.length() } > 0) return
        val v = st.optInt("version", -1)
        val next = if (st.isNull("session")) null else st.optJSONObject("session")
        if (v == version && (session != null) == (next != null)) return
        version = v
        session = next
        persist()
    }

    /** Re-read the phone's published plan. done(true) if a plan is available. */
    fun refreshPlan(done: (Boolean) -> Unit = {}) { checkPhone(); readAll(done) }

    /** The phone republishes progress after a workout; just re-read it. */
    fun refreshProgress(done: (Boolean) -> Unit = {}) = readAll { done(progress != null) }

    /** Called when a screen or the workout service starts: resend the queue and pick up what the phone sent. */
    fun startLoop() { flush(); checkPhone(); readAll() }
    fun stopLoop() { }
}
