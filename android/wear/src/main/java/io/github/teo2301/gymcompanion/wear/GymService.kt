package io.github.teo2301.gymcompanion.wear

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator

/**
 * Runs while a workout is live: keeps the sync loop alive with the screen off, reads heart rate
 * (sent to the server every 15 s so the phone shows it too), and buzzes when rest is over even if
 * the watch screen is off.
 */
class GymService : Service(), SensorEventListener {
    private val ui = Handler(Looper.getMainLooper())
    private var wake: PowerManager.WakeLock? = null
    private var sensors: SensorManager? = null
    private var lastBpm = 0
    private var lastSentBpm = 0L
    private var armedFor = 0L

    private val restDone = Runnable {
        val v = getSystemService(Vibrator::class.java)
        v?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 350, 150, 350, 150, 600), -1))
    }

    private val onChange: () -> Unit = { check() }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Aod.hold(this)     // keep the workout visible (dimmed) between sets
        Store.init(this)
        goForeground()
        startSensors()
        Store.listen(onChange)
        Store.startLoop()
        check()
        return START_STICKY
    }

    /** Re-arm the rest buzz; stop when the workout is over. */
    private fun check() {
        val s = Store.session
        if (s == null || s.optBoolean("finished")) { stopSelf(); return }
        val until = if (s.isNull("rest_until")) 0L else s.getLong("rest_until")
        if (until != armedFor) {
            ui.removeCallbacks(restDone); armedFor = until
            val wait = until - Store.now()
            if (until > 0 && wait > 0) ui.postDelayed(restDone, wait)
        }
    }

    private fun has(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    private fun goForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH, "Workout in progress", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = Notification.Builder(this, CH).setContentTitle("Workout in progress").setContentText("Tap to open")
            .setSmallIcon(R.drawable.ic_launcher).setOngoing(true).setContentIntent(open).build()
        try { startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH) } catch (e: Exception) {
            try { startForeground(1, n) } catch (e2: Exception) { }
        }
    }

    @SuppressLint("WakelockTimeout")
    private fun startSensors() {
        if (wake == null) wake = (getSystemService(Context.POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "gym:workout").apply { acquire(3 * 3600 * 1000L) }
        if (sensors == null && has(hrPermission())) {
            sensors = getSystemService(SensorManager::class.java)
            sensors?.getDefaultSensor(Sensor.TYPE_HEART_RATE)?.let { sensors?.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL) }
        }
    }

    override fun onSensorChanged(e: SensorEvent) {
        if (e.sensor.type != Sensor.TYPE_HEART_RATE || e.values.isEmpty()) return
        val bpm = e.values[0].toInt()
        if (bpm < 35) return
        lastBpm = bpm
        HeartRate.bpm = bpm; HeartRate.at = System.currentTimeMillis()
        if (System.currentTimeMillis() - lastSentBpm > 15000) {
            lastSentBpm = System.currentTimeMillis()
            ui.post { if (Store.session?.optBoolean("finished") == false) Store.heartRate(bpm) }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    override fun onDestroy() {
        Store.unlisten(onChange)
        ui.removeCallbacksAndMessages(null)
        sensors?.unregisterListener(this)
        wake?.let { if (it.isHeld) it.release() }
        Aod.release(this)
        super.onDestroy()
    }

    companion object {
        const val CH = "workout"
        fun hrPermission() =
            if (Build.VERSION.SDK_INT >= 36) "android.permission.health.READ_HEART_RATE" else Manifest.permission.BODY_SENSORS
        fun start(ctx: Context) = ctx.startForegroundService(Intent(ctx, GymService::class.java))
    }
}

/** Latest heart rate, read by the UI for a live number (the server only gets one every 15 s). */
object HeartRate { @Volatile var bpm = 0; @Volatile var at = 0L }
