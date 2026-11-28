package io.github.teo2301.gymcompanion

import android.content.Context
import android.net.Uri
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Phone side of the watch link (see WATCH_LINK_SPEC.md): a small app-private queue of validated watch actions,
 * plus writes of /gym/live, /gym/plan and /gym/ack/<id> to the Wear OS Data Layer. No network, no server.
 * The queue file survives the app being closed; an op leaves it only when the page acknowledged applying it.
 */
class WatchLink private constructor(private val app: Context) {
    private val file = File(app.filesDir, "watch_ops.json")
    private val acks = app.getSharedPreferences("watchlink", 0)
    private val data: DataClient by lazy { Wearable.getDataClient(app) }

    @Synchronized private fun load(): MutableList<JSONObject> {
        val out = mutableListOf<JSONObject>()
        try {
            val arr = JSONArray(if (file.exists()) file.readText() else "[]")
            for (i in 0 until arr.length()) arr.optJSONObject(i)?.let { out.add(it) }
        } catch (e: Exception) { /* corrupt file: start empty */ }
        return out
    }

    @Synchronized private fun save(list: List<JSONObject>) {
        val tmp = File(file.parentFile, "watch_ops.tmp")
        tmp.writeText(JSONArray(list).toString())
        if (!tmp.renameTo(file)) { file.writeText(tmp.readText()); tmp.delete() }
    }

    /** Validate and queue one raw item from the watch. True if it was new. */
    @Synchronized fun enqueue(json: String): Boolean {
        val op = try { WatchOps.clean(JSONObject(json), System.currentTimeMillis()) } catch (e: Exception) { null } ?: return false
        val list = load()
        if (list.any { it.optString("id") == op.optString("id") }) return false
        if (list.size >= MAX_QUEUE) list.removeAt(0)
        list.add(op)
        save(list)
        return true
    }

    @Synchronized fun pending(): Int = load().size

    /** Queued ops, in application order (the page applies them; it acknowledges afterwards). */
    @Synchronized fun drain(): String = JSONArray(load().sortedWith(WatchOps.order)).toString()

    /** The page applied these ops: drop them from the queue and tell the watch. */
    @Synchronized fun ack(ids: List<String>) {
        val clean = ids.filter { it.matches(Regex("[A-Za-z0-9_-]{1,64}")) }
        if (clean.isEmpty()) return
        save(load().filter { it.optString("id") !in clean })
        val now = System.currentTimeMillis()
        val sent = try { JSONObject(acks.getString("sent", "{}")) } catch (e: Exception) { JSONObject() }
        for (id in clean) {
            put("/gym/ack/$id", JSONObject().put("t", now).toString())
            sent.put(id, now)
        }
        // the watch deletes its own op items; we remove our old ack items after a while so none pile up
        val keys = sent.keys().asSequence().toList()
        for (k in keys) if (now - sent.getLong(k) > ACK_TTL) { delete("/gym/ack/$k"); sent.remove(k) }
        acks.edit().putString("sent", sent.toString()).apply()
    }

    fun publish(path: String, json: String) = put(path, json)

    private fun put(path: String, json: String) {
        try {
            val req = PutDataMapRequest.create(path)
            req.dataMap.putString("json", json)
            data.putDataItem(req.asPutDataRequest().setUrgent())
        } catch (e: Exception) { /* no Play Services / no watch paired: nothing to do */ }
    }

    private fun delete(path: String) {
        try { data.deleteDataItems(Uri.Builder().scheme("wear").path(path).build()) } catch (e: Exception) { }
    }

    companion object {
        private const val MAX_QUEUE = 400
        private const val ACK_TTL = 15 * 60 * 1000L
        @Volatile private var inst: WatchLink? = null
        fun get(ctx: Context): WatchLink = inst ?: synchronized(this) { inst ?: WatchLink(ctx.applicationContext).also { inst = it } }
    }
}
