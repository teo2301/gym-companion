package io.github.teo2301.gymcompanion

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class WatchOpsTest {
    private val now = 1_800_000_000_000L
    private fun op(vararg kv: Pair<String, Any?>) = JSONObject().apply { kv.forEach { put(it.first, it.second) } }

    @Test fun acceptsLogAndRebuildsFromKnownKeys() {
        val c = WatchOps.clean(op("id" to "a-1", "op" to "log", "t" to now, "ex" to 2, "w" to 60.5, "r" to 8, "evil" to "x"), now)!!
        assertEquals(60.5, c.getDouble("w"), 0.0); assertEquals(8, c.getInt("r")); assertFalse(c.has("evil"))
    }
    @Test fun rejectsBadIdsKindsAndTimes() {
        assertNull(WatchOps.clean(op("id" to "a b", "op" to "finish", "t" to now), now))
        assertNull(WatchOps.clean(op("id" to "a", "op" to "format_disk", "t" to now), now))
        assertNull(WatchOps.clean(op("id" to "a", "op" to "finish", "t" to 0), now))
        assertNull(WatchOps.clean(op("id" to "a", "op" to "finish", "t" to now + 3 * 24 * 3600 * 1000L), now))
    }
    @Test fun rejectsOutOfRangeNumbers() {
        assertNull(WatchOps.clean(op("id" to "a", "op" to "log", "t" to now, "ex" to 0, "w" to -1.0, "r" to 5), now))
        assertNull(WatchOps.clean(op("id" to "a", "op" to "log", "t" to now, "ex" to 0, "w" to 9999.0, "r" to 5), now))
        assertNull(WatchOps.clean(op("id" to "a", "op" to "log", "t" to now, "ex" to 500, "w" to 5.0, "r" to 5), now))
        assertNull(WatchOps.clean(op("id" to "a", "op" to "hr", "t" to now, "bpm" to 999), now))
        assertNull(WatchOps.clean(op("id" to "a", "op" to "log", "t" to now, "ex" to 0, "r" to 5), now))   // missing w
    }
    @Test fun startNeedsRoutineAndExercises() {
        val ex = JSONArray().put(JSONObject().put("name", "Squat"))
        assertNotNull(WatchOps.clean(op("id" to "s", "op" to "start", "t" to now, "routine" to "Legs", "exercises" to ex), now))
        assertNull(WatchOps.clean(op("id" to "s", "op" to "start", "t" to now, "routine" to "", "exercises" to ex), now))
        assertNull(WatchOps.clean(op("id" to "s", "op" to "start", "t" to now, "routine" to "Legs", "exercises" to JSONArray()), now))
        assertNull(WatchOps.clean(op("id" to "s", "op" to "start", "t" to now, "routine" to "Legs", "exercises" to JSONArray().put("junk")), now))
    }
    @Test fun ordersByTimeThenId() {
        val list = listOf(op("id" to "b", "t" to 5), op("id" to "a", "t" to 5), op("id" to "z", "t" to 1)).sortedWith(WatchOps.order)
        assertEquals(listOf("z", "a", "b"), list.map { it.getString("id") })
    }
}
