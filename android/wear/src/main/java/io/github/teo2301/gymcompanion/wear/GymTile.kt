package io.github.teo2301.gymcompanion.wear

import android.content.Context
import androidx.concurrent.futures.ResolvableFuture
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.DimensionBuilders.wrap
import androidx.wear.protolayout.DimensionBuilders.sp
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.LayoutElementBuilders.Box
import androidx.wear.protolayout.LayoutElementBuilders.Column
import androidx.wear.protolayout.LayoutElementBuilders.FontStyle
import androidx.wear.protolayout.LayoutElementBuilders.Spacer
import androidx.wear.protolayout.LayoutElementBuilders.Text
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * Watch tile (swipe left from the watch face): the next routine, days since the last workout and
 * this week's totals - or the live workout if one is running. Tap anywhere to open the app.
 */
class GymTile : TileService() {

    override fun onTileRequest(req: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> {
        Store.init(this)
        val f = ResolvableFuture.create<TileBuilders.Tile>()
        f.set(
            TileBuilders.Tile.Builder()
                .setResourcesVersion(RES)
                .setFreshnessIntervalMillis(30 * 60 * 1000L)
                .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(layout(this)))
                .build()
        )
        // fetch fresh numbers for next time (the tile re-requests itself when the plan changes)
        val age = System.currentTimeMillis() - (Store.plan?.optLong("generated") ?: 0L)
        if (age > 10 * 60 * 1000L) Store.refreshPlan { ok -> if (ok) update(this) }   // stale: refresh, then redraw once
        return f
    }

    override fun onTileResourcesRequest(req: RequestBuilders.ResourcesRequest): ListenableFuture<ResourceBuilders.Resources> {
        val f = ResolvableFuture.create<ResourceBuilders.Resources>()
        f.set(ResourceBuilders.Resources.Builder().setVersion(RES).build())
        return f
    }

    private fun txt(t: String, size: Float, color: Int, bold: Boolean = false) =
        Text.Builder().setText(t).setMaxLines(1)
            .setFontStyle(FontStyle.Builder().setSize(sp(size)).setColor(argb(color))
                .setWeight(if (bold) LayoutElementBuilders.FONT_WEIGHT_BOLD else LayoutElementBuilders.FONT_WEIGHT_NORMAL).build())
            .build()

    private fun gap(h: Float) = Spacer.Builder().setHeight(dp(h)).build()

    private fun layout(ctx: Context): LayoutElementBuilders.LayoutElement {
        val col = Column.Builder().setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
        val s = Store.session
        val plan = Store.plan
        val lif = plan?.optJSONObject("lifter")
        col.addContent(txt(if (lif != null) "GYM · LV ${lif.optInt("lv")}" else "GYM", 12f, C.VOLT, true)).addContent(gap(4f))
        if (s != null && !s.optBoolean("finished")) {
            val ex = s.getJSONArray("exercises").optJSONObject(s.optInt("current"))
            val done = ex?.getJSONArray("done")?.length() ?: 0
            val tot = ex?.optJSONArray("target")?.length() ?: 0
            col.addContent(txt("Workout live", 11f, C.DIM))
                .addContent(txt(s.optString("routine"), 20f, 0xFFFFFFFF.toInt(), true))
                .addContent(gap(4f))
                .addContent(txt((ex?.optString("name") ?: "").replace(Regex(" \\(.*\\)"), ""), 13f, 0xFFFFFFFF.toInt()))
                .addContent(txt("set ${minOf(done + 1, maxOf(tot, 1))} of $tot", 12f, C.DIM))
                .addContent(gap(10f)).addContent(chip("Open"))
        } else if (plan != null) {
            val next = plan.optString("suggested", "")
            val wk = plan.optJSONObject("week")
            col.addContent(txt("Up next", 11f, C.DIM))
                .addContent(txt(next, 22f, 0xFFFFFFFF.toInt(), true))
                .addContent(gap(6f))
            wk?.let {
                val last = it.optString("last_date", "")
                col.addContent(txt("Last: " + ago(last) + (if (it.optString("last_title").isNotEmpty()) " · " + it.optString("last_title") else ""), 12f, C.DIM))
                    .addContent(txt("This week: ${it.optInt("workouts")} workouts · ${it.optInt("sets")} sets", 12f, C.DIM))
            }
            col.addContent(gap(10f)).addContent(chip("Start"))
        } else {
            col.addContent(txt("Open the app once", 13f, C.DIM)).addContent(txt("to load routines", 13f, C.DIM))
        }
        val open = ModifiersBuilders.Clickable.Builder().setId("open")
            .setOnClick(ActionBuilders.LaunchAction.Builder()
                .setAndroidActivity(ActionBuilders.AndroidActivity.Builder()
                    .setPackageName(ctx.packageName).setClassName(MainActivity::class.java.name).build()).build()).build()
        return Box.Builder().setWidth(expand()).setHeight(expand())
            .setModifiers(ModifiersBuilders.Modifiers.Builder().setClickable(open).build())
            .addContent(col.build()).build()
    }

    private fun chip(label: String) = Box.Builder().setWidth(dp(96f)).setHeight(dp(38f))
        .setModifiers(ModifiersBuilders.Modifiers.Builder().setBackground(
            ModifiersBuilders.Background.Builder().setColor(argb(C.VOLT))
                .setCorner(ModifiersBuilders.Corner.Builder().setRadius(dp(19f)).build()).build()).build())
        .addContent(txt(label, 15f, C.BG, true)).build()

    private fun ago(d: String): String = try {
        val days = ((System.currentTimeMillis() - SimpleDateFormat("yyyy-MM-dd", Locale.UK).parse(d)!!.time) / 86400000L).toInt()
        when (days) { 0 -> "today"; 1 -> "yesterday"; else -> "$days days ago" }
    } catch (e: Exception) { "—" }

    companion object {
        const val RES = "1"
        fun update(ctx: Context) = try { getUpdater(ctx).requestUpdate(GymTile::class.java) } catch (e: Exception) { }
    }
}
