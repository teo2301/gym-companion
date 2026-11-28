package io.github.teo2301.gymcompanion

import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.WearableListenerService

/** Receives the watch's actions (/gym/op/<id>) even when the app is closed. */
class WearListener : WearableListenerService() {
    override fun onDataChanged(events: DataEventBuffer) {
        val link = WatchLink.get(this)
        var fresh = false
        for (e in events) {
            if (e.type != DataEvent.TYPE_CHANGED) continue
            val path = e.dataItem.uri.path ?: continue
            if (!path.startsWith("/gym/op/")) continue
            val json = try { DataMapItem.fromDataItem(e.dataItem).dataMap.getString("json") } catch (x: Exception) { null } ?: continue
            if (link.enqueue(json)) fresh = true
        }
        if (fresh) WatchSync.poke(applicationContext)
    }
}
