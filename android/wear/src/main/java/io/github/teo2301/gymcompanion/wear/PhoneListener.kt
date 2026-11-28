package io.github.teo2301.gymcompanion.wear

import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.WearableListenerService

/** Receives what the phone publishes (/gym/live, /gym/plan, /gym/ack/<id>) even when the watch app is closed. */
class PhoneListener : WearableListenerService() {
    override fun onDataChanged(events: DataEventBuffer) {
        Store.init(this)
        val got = ArrayList<Pair<String, String>>()
        for (e in events) {
            if (e.type != DataEvent.TYPE_CHANGED) continue
            val path = e.dataItem.uri.path ?: continue
            if (!path.startsWith("/gym/") || path.startsWith("/gym/op/")) continue
            val json = try { DataMapItem.fromDataItem(e.dataItem).dataMap.getString("json") } catch (x: Exception) { null }
            if (json != null) got.add(path to json)
        }
        if (got.isEmpty()) return
        android.os.Handler(mainLooper).post { got.forEach { Store.onItem(it.first, it.second) } }
    }
}
