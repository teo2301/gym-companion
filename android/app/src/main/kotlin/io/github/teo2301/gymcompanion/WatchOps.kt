package io.github.teo2301.gymcompanion

import org.json.JSONArray
import org.json.JSONObject

/**
 * Validation of actions arriving from the watch (the web app's GymCore.applyOp vocabulary).
 * Every field is type- and range-checked and the result is rebuilt from known keys only, so a malformed or
 * hostile item can never reach the page with unexpected content. Pure Kotlin so it can be unit tested.
 */
object WatchOps {
    private val ID = Regex("[A-Za-z0-9_-]{1,64}")
    private const val DAY = 24 * 3600 * 1000L
    private const val MAX_START_BYTES = 60_000
    private const val MAX_EXERCISES = 30

    /** Returns the cleaned op, or null if it must be dropped. */
    fun clean(raw: JSONObject, now: Long): JSONObject? {
        val id = raw.optString("id", "")
        val kind = raw.optString("op", "")
        val t = raw.optLong("t", 0)
        if (!ID.matches(id) || t <= 0 || t > now + DAY) return null
        val out = JSONObject().put("id", id).put("op", kind).put("t", t)
        fun int(key: String, lo: Int, hi: Int): Int? {
            if (!raw.has(key) || raw.isNull(key)) return null
            val d = raw.optDouble(key, Double.NaN)
            if (d.isNaN() || d.isInfinite() || d < lo || d > hi) return null
            return d.toInt()
        }
        when (kind) {
            "log" -> {
                val ex = int("ex", 0, 99) ?: return null
                val r = int("r", 0, 1000) ?: return null
                val w = raw.optDouble("w", Double.NaN)
                if (w.isNaN() || w.isInfinite() || w < 0 || w > 2000) return null
                out.put("ex", ex).put("w", w).put("r", r)
            }
            "undo", "select" -> out.put("ex", int("ex", 0, 99) ?: return null)
            "warm" -> out.put("ex", int("ex", 0, 99) ?: return null).put("i", int("i", 0, 50) ?: return null)
            "rest_add" -> out.put("secs", int("secs", -600, 600) ?: return null)
            "hr" -> out.put("bpm", int("bpm", 30, 250) ?: return null)
            "rest_skip", "finish", "close", "discard" -> {}
            "start" -> {
                val name = raw.optString("routine", "").trim().take(60)
                val src = raw.optJSONArray("exercises") ?: return null
                if (name.isEmpty() || src.length() == 0 || src.length() > MAX_EXERCISES) return null
                val exs = JSONArray()
                for (i in 0 until src.length()) exs.put(src.optJSONObject(i) ?: return null)
                if (exs.toString().length > MAX_START_BYTES) return null
                out.put("routine", name).put("exercises", exs).put("last_volume", int("last_volume", 0, 100_000_000) ?: 0)
            }
            else -> return null
        }
        return out
    }

    /** Ascending time, ties by id: the order the page applies them in. */
    val order: Comparator<JSONObject> = Comparator { a, b ->
        val d = a.optLong("t").compareTo(b.optLong("t"))
        if (d != 0) d else a.optString("id").compareTo(b.optString("id"))
    }
}
