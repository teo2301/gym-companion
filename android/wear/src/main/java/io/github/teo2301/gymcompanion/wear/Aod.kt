package io.github.teo2301.gymcompanion.wear

import android.content.Context
import android.content.pm.PackageManager
import android.provider.Settings

/**
 * Always-On Display only while a session is running. AOD is off system-wide (battery); when a
 * match/workout starts this turns it on so the live screen stays visible (dimmed), and puts the
 * previous value back when the session ends. Needs WRITE_SECURE_SETTINGS, granted over adb
 * (pm grant io.github.teo2301.gymcompanion android.permission.WRITE_SECURE_SETTINGS) - without it this does nothing.
 * The original value is kept in prefs, so a crash mid-session is undone on the next launch.
 */
object Aod {
    private const val KEY = "ambient_enabled"
    private const val PREFS = "aod"

    private fun allowed(ctx: Context) =
        ctx.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") == PackageManager.PERMISSION_GRANTED

    fun hold(ctx: Context) {
        if (!allowed(ctx)) return
        val p = ctx.getSharedPreferences(PREFS, 0)
        if (p.getBoolean("held", false)) return
        val cr = ctx.contentResolver
        val prev = Settings.Global.getInt(cr, KEY, -1)
        p.edit().putBoolean("held", true).putInt("prev", prev).apply()
        try { Settings.Global.putInt(cr, KEY, 1) } catch (e: Exception) { }
    }

    fun release(ctx: Context) {
        val p = ctx.getSharedPreferences(PREFS, 0)
        if (!p.getBoolean("held", false)) return
        val prev = p.getInt("prev", -1)
        if (allowed(ctx) && prev >= 0) try { Settings.Global.putInt(ctx.contentResolver, KEY, prev) } catch (e: Exception) { }
        p.edit().putBoolean("held", false).apply()
    }
}
