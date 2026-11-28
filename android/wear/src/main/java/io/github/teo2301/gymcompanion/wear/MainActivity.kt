package io.github.teo2301.gymcompanion.wear

import android.Manifest
import android.animation.ValueAnimator
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.text.TextUtils
import android.util.TypedValue
import android.view.GestureDetector
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.wear.ambient.AmbientLifecycleObserver
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Gym Companion for the Galaxy Watch.
 *   Home      -> suggested routine + all routines (bezel scrolls)
 *   Exercise  -> big weight × reps (bezel changes the highlighted one, tap to switch), ✓ logs the
 *                set; swipe left/right for the next/previous exercise; ≡ opens the exercise list
 *   Rest      -> countdown ring; bezel adds/removes 15 s; ends with a buzz, then back to Exercise
 *   Summary   -> time, volume, sets, PRs, heart rate
 * Everything mirrors the phone page (/gym/) live through the server; works offline too.
 */
class MainActivity : ComponentActivity() {
    private enum class Screen { HOME, EVOLUTION, EXERCISE, REST, LIST, CONFIRM, SUMMARY }

    private val ui = Handler(Looper.getMainLooper())
    private lateinit var root: FrameLayout
    private lateinit var content: FrameLayout
    private lateinit var burst: Burst
    private var screen = Screen.HOME
    private var W = 0
    private var shownKey = ""                // what's on screen, to avoid rebuilding (and re-animating) needlessly
    private var evoIndex = 0                 // week being replayed on the growth screen
    private var progressForSession = ""      // session id we already asked the server to rescore
    private var levelUpShownFor = ""         // session id whose level-up we celebrated

    // draft for the next set
    private var dW = 0.0; private var dR = 0; private var dFor = ""   // "ex:setcount"
    private var focusWeight = true
    private var lastPrSeen = ""

    // ---- Always On Display: stay on screen, dimmed
    private var ambient = false
    private val ambientObserver by lazy {
        AmbientLifecycleObserver(this, object : AmbientLifecycleObserver.AmbientLifecycleCallback {
            override fun onEnterAmbient(ambientDetails: AmbientLifecycleObserver.AmbientDetails) { ambient = true; shownKey = ""; render() }
            override fun onExitAmbient() { ambient = false; shownKey = ""; render() }
            override fun onUpdateAmbient() { shownKey = ""; render() }
        })
    }

    private val onStore: () -> Unit = { render() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Store.init(this)
        lifecycle.addObserver(ambientObserver)
        W = resources.displayMetrics.widthPixels
        root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        content = FrameLayout(this)
        burst = Burst(this).apply { visibility = View.GONE }
        root.addView(content, FrameLayout.LayoutParams(-1, -1))
        root.addView(burst, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)
        root.isFocusableInTouchMode = true
        root.requestFocus()
        if (Store.plan == null) Store.refreshPlan() else Store.refreshPlan()
        render()
    }

    override fun onResume() {
        super.onResume()
        Store.listen(onStore); Store.startLoop()
        if (Store.session?.optBoolean("finished") == false) GymService.start(this) else Aod.release(this)
        shownKey = ""; render()
    }

    override fun onPause() { super.onPause(); Store.unlisten(onStore); Store.stopLoop() }

    // =================================================================== rendering
    private fun session() = Store.session
    private fun curEx(): JSONObject? = session()?.let { s -> s.getJSONArray("exercises").optJSONObject(s.optInt("current")) }
    private fun restLeft(): Long {
        val s = session() ?: return 0
        if (s.isNull("rest_until")) return 0
        return s.getLong("rest_until") - Store.now()
    }

    private fun render() {
        val s = session()
        val want = when {
            screen == Screen.EVOLUTION && s == null -> Screen.EVOLUTION
            s == null -> Screen.HOME
            s.optBoolean("finished") -> Screen.SUMMARY
            screen == Screen.LIST || screen == Screen.CONFIRM -> screen
            restLeft() > 0 -> Screen.REST
            else -> Screen.EXERCISE
        }
        val key = want.name + "|" + (s?.toString()?.hashCode() ?: 0) + "|" + Store.sync + "|" +
            (Store.lifter?.optInt("lv") ?: 0) + "|" +
            (Store.progress?.optJSONObject("overall")?.optInt("lv") ?: 0) + "|" +
            (if (want == Screen.HOME) Store.plan?.optLong("generated") else "") + ambient
        if (key == shownKey && want == screen) return
        val changedScreen = want != screen
        shownKey = key
        screen = want
        when (want) {
            Screen.HOME -> buildHome()
            Screen.EVOLUTION -> buildEvolution()
            Screen.EXERCISE -> buildExercise()
            Screen.REST -> buildRest()
            Screen.LIST -> buildList()
            Screen.CONFIRM -> buildConfirm()
            Screen.SUMMARY -> buildSummary()
        }
        if (changedScreen && !ambient) enter(content)
        checkPr()
    }

    private fun go(s: Screen) { screen = s; shownKey = ""; render() }

    private fun enter(v: View, dx: Float = 0f) {
        v.alpha = 0f; v.scaleX = 0.94f; v.scaleY = 0.94f; v.translationX = dx
        v.animate().alpha(1f).scaleX(1f).scaleY(1f).translationX(0f).setDuration(320)
            .setInterpolator(DecelerateInterpolator(2f)).start()
    }

    // ---------- small view helpers
    private fun sp(v: Float) = v
    private fun tv(text: CharSequence, size: Float, color: Int = Color.WHITE, bold: Boolean = false, lines: Int = 1) =
        TextView(this).apply {
            this.text = text; textSize = size; setTextColor(color); gravity = Gravity.CENTER
            typeface = Typeface.create("sans-serif", if (bold) Typeface.BOLD else Typeface.NORMAL)
            if (bold) letterSpacing = -0.02f
            maxLines = lines; ellipsize = TextUtils.TruncateAt.END
            fontFeatureSettings = "tnum"
        }

    private fun place(v: View, cxFrac: Float, cyFrac: Float, wFrac: Float, hFrac: Float = -1f, parent: FrameLayout = content) {
        val w = (W * wFrac).toInt(); val h = if (hFrac < 0) ViewGroup.LayoutParams.WRAP_CONTENT else (W * hFrac).toInt()
        parent.addView(v, FrameLayout.LayoutParams(w, h).apply {
            leftMargin = (W * cxFrac - w / 2f).toInt()
            if (hFrac < 0) { topMargin = (W * cyFrac).toInt() } else topMargin = (W * cyFrac - h / 2f).toInt()
        })
    }

    private fun pill(text: String, bg: Int, fg: Int, size: Float = 13f, bold: Boolean = true, click: () -> Unit) =
        tv(text, size, fg, bold).apply {
            background = GradientDrawable().apply { cornerRadius = 999f; setColor(bg) }
            setOnClickListener { haptic(this); pressAnim(this); click() }
        }

    private fun circleBtn(text: String, bg: Int, fg: Int, size: Float, click: () -> Unit) =
        tv(text, size, fg, true).apply {
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(bg) }
            setOnClickListener { haptic(this); click() }
        }

    private fun pressAnim(v: View) {
        v.animate().scaleX(0.9f).scaleY(0.9f).setDuration(70).withEndAction {
            v.animate().scaleX(1f).scaleY(1f).setDuration(260).setInterpolator(OvershootInterpolator(3f)).start()
        }.start()
    }

    private fun haptic(v: View) = v.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
    private fun buzz(ms: Long) = getSystemService(Vibrator::class.java)?.vibrate(VibrationEffect.createOneShot(ms, 200))

    private fun syncDot() {
        val col = when (Store.sync) { Store.Sync.OK -> C.OK; Store.Sync.PENDING -> C.PR; Store.Sync.OFFLINE -> C.HR; else -> C.DIM2 }
        val d = View(this).apply { background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(col) } }
        val s = (W * 0.022f).toInt()
        content.addView(d, FrameLayout.LayoutParams(s, s).apply { leftMargin = W / 2 - s / 2; topMargin = (W * 0.045f).toInt() })
    }

    private fun fmt(w: Double) = if (w == w.toLong().toDouble()) w.toLong().toString() else ("%.2f".format(w)).trimEnd('0').trimEnd('.')
    private fun setStr(o: JSONObject) = (if (o.optDouble("w") > 0) fmt(o.optDouble("w")) + "×" else "") + o.optInt("r")
    private fun setsStr(a: JSONArray?, max: Int = 4): String {
        if (a == null) return ""
        return (0 until minOf(a.length(), max)).joinToString(" ") { setStr(a.getJSONObject(it)) }
    }

    // =================================================================== HOME
    private fun buildHome() {
        content.removeAllViews()
        val plan = Store.plan
        if (ambient) { place(tv("Gym", 20f, Color.WHITE, true), .5f, .42f, .8f); return }
        val scroll = ScrollView(this).apply { isVerticalScrollBarEnabled = false; isFocusableInTouchMode = true }
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(W / 9, (W * 0.14f).toInt(), W / 9, (W * 0.25f).toInt()) }
        scroll.addView(col)
        content.addView(scroll, FrameLayout.LayoutParams(-1, -1))
        col.addView(tv("GYM", 11f, C.VOLT, true).apply { letterSpacing = 0.2f })
        Store.lifter?.let { l ->
            val lv = l.optInt("lv")
            if (Store.lastLv == 0) Store.lastLv = lv
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(10, 8, 14, 8)
                background = GradientDrawable().apply { cornerRadius = 55f; setColor(C.CARD) }
                setOnClickListener { haptic(this); buzz(20); go(Screen.EVOLUTION) }
            }
            val fig = LifterView(this).apply {
                score = l.optDouble("score", 0.0).toFloat()
                ambient = this@MainActivity.ambient
            }
            card.addView(fig, LinearLayout.LayoutParams((W * 0.18f).toInt(), (W * 0.225f).toInt()))
            val info = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            info.addView(tv("LV $lv · ${l.optString("tier")}", 9.5f, C.VOLT, true))
            val xp = XpBar(this).apply { progress = l.optDouble("xp", 0.0).toFloat() }
            info.addView(xp, LinearLayout.LayoutParams((W * 0.26f).toInt(), (W * 0.018f).toInt()).apply { topMargin = 8 })
            info.addView(tv("tap · growth", 8.5f, C.DIM), LinearLayout.LayoutParams(-2, -2).apply { topMargin = 6 })
            card.addView(info, LinearLayout.LayoutParams(0, -2, 1f))
            col.addView(card, LinearLayout.LayoutParams(-1, -2).apply { topMargin = 12 })
        }
        if (plan == null) {
            col.addView(tv("Open Gym Companion on your phone to load your routines", 12f, C.DIM).apply { setPadding(14, 30, 14, 0); gravity = Gravity.CENTER })
            col.addView(pill("Retry", C.CARD2, Color.WHITE) { Store.refreshPlan() }.apply { setPadding(40, 18, 40, 18) },
                LinearLayout.LayoutParams(-2, -2).apply { topMargin = 20 })
            return
        }
        val routines = plan.getJSONArray("routines")
        val sug = plan.optString("suggested")
        val order = (0 until routines.length()).map { routines.getJSONObject(it) }.sortedBy { if (it.getString("name") == sug) 0 else 1 }
        order.forEachIndexed { i, r ->
            val first = i == 0
            val box = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
                setPadding(20, if (first) 26 else 18, 20, if (first) 26 else 18)
                background = GradientDrawable().apply { cornerRadius = 60f; setColor(if (first) C.VOLT else C.CARD) }
                setOnClickListener { haptic(this); pressAnim(this); startRoutine(r) }
            }
            if (first) box.addView(tv("UP NEXT", 9f, C.BG, true).apply { letterSpacing = 0.18f })
            box.addView(tv(r.getString("name"), if (first) 19f else 15f, if (first) C.BG else Color.WHITE, true))
            box.addView(tv("${r.getJSONArray("exercises").length()} exercises · ${ago(r.optString("last_date"))}", 10f, if (first) Color.parseColor("#3A4515") else C.DIM))
            col.addView(box, LinearLayout.LayoutParams(-1, -2).apply { topMargin = if (first) 14 else 8 })
            box.alpha = 0f; box.translationY = 30f
            box.animate().alpha(1f).translationY(0f).setStartDelay(60L * i).setDuration(380).setInterpolator(DecelerateInterpolator(2f)).start()
        }
        syncDot()
        scroll.requestFocus()
    }

    // =================================================================== GROWTH / EVOLUTION
    private fun buildEvolution() {
        content.removeAllViews()
        val weeks = Store.progress?.optJSONArray("weeks") ?: JSONArray()
        if (ambient) { place(tv("Growth", 18f, Color.WHITE, true), .5f, .42f, .8f); return }
        if (weeks.length() == 0) {
            place(tv("No history yet", 13f, C.DIM), .5f, .34f, .8f)
            place(tv("Finish a workout to start", 10f, C.DIM2), .5f, .43f, .8f)
            place(pill("Back", C.CARD2, Color.WHITE) { go(Screen.HOME) }, .5f, .72f, .34f, .13f)
            return
        }
        evoIndex = evoIndex.coerceIn(0, weeks.length() - 1)
        val w = weeks.getJSONObject(evoIndex)
        val fig = LifterView(this).apply { score = w.optDouble("score", 0.0).toFloat() }
        place(fig, .5f, .32f, .44f, .55f)
        val date = try {
            SimpleDateFormat("d MMM", Locale.UK).format(SimpleDateFormat("yyyy-MM-dd", Locale.UK).parse(w.getString("week"))!!)
        } catch (e: Exception) { w.optString("week") }
        place(tv("w/c $date · Lv ${w.optInt("lv")}", 11f, C.VOLT, true), .5f, .65f, .8f)
        place(tv("${evoIndex + 1}/${weeks.length()} · bezel to travel", 9f, C.DIM), .5f, .73f, .8f)
        place(pill("Back", C.CARD2, Color.WHITE) { go(Screen.HOME) }, .5f, .86f, .3f, .12f)
    }

    private fun ago(d: String): String {
        if (d.isEmpty()) return ""
        return try {
            val days = ((System.currentTimeMillis() - SimpleDateFormat("yyyy-MM-dd", Locale.UK).parse(d)!!.time) / 86400000L).toInt()
            when (days) { 0 -> "today"; 1 -> "yesterday"; else -> "${days}d ago" }
        } catch (e: Exception) { "" }
    }

    private fun startRoutine(r: JSONObject) {
        val need = listOf(GymService.hrPermission(), Manifest.permission.POST_NOTIFICATIONS)
            .filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (need.isNotEmpty() && !getSharedPreferences("gym", 0).getBoolean("asked", false)) {
            getSharedPreferences("gym", 0).edit().putBoolean("asked", true).apply()
            pendingStart = r
            requestPermissions(need.toTypedArray(), 1); return
        }
        buzz(60)
        Store.start(r)
        GymService.start(this)
    }

    private var pendingStart: JSONObject? = null
    override fun onRequestPermissionsResult(code: Int, perms: Array<String>, results: IntArray) {
        super.onRequestPermissionsResult(code, perms, results)
        pendingStart?.let { pendingStart = null; startRoutine(it) }
    }

    // =================================================================== EXERCISE
    private fun target(ex: JSONObject): JSONObject {
        val t = ex.optJSONArray("target") ?: JSONArray(); val n = ex.getJSONArray("done").length()
        return t.optJSONObject(minOf(n, t.length() - 1)) ?: ex.getJSONArray("done").optJSONObject(n - 1) ?: JSONObject().put("w", 20).put("r", 10)
    }

    private lateinit var wView: TextView
    private lateinit var rView: TextView

    private val skipWarm = mutableSetOf<String>()      // "sessionId:exercise" whose warm-ups were skipped

    /** Index of the next warm-up set to do, or -1 when warm-ups are done/skipped/not applicable. */
    private fun nextWarm(s: JSONObject, idx: Int, ex: JSONObject): Int {
        val wu = ex.optJSONArray("warmup") ?: return -1
        if (wu.length() == 0 || ex.getJSONArray("done").length() > 0 || "${s.optString("id")}:$idx" in skipWarm) return -1
        val wd = ex.optJSONArray("warm_done") ?: JSONArray()
        val ticked = (0 until wd.length()).map { wd.getInt(it) }.toSet()
        return (0 until wu.length()).firstOrNull { it !in ticked } ?: -1
    }

    private fun buildExercise() {
        content.removeAllViews()
        val s = session()!!; val exs = s.getJSONArray("exercises"); val idx = s.optInt("current")
        val ex = exs.getJSONObject(idx); val done = ex.getJSONArray("done")
        val nTarget = maxOf(ex.optJSONArray("target")?.length() ?: 0, 1)
        val warmK = nextWarm(s, idx, ex)
        val key = if (warmK >= 0) "w$idx:$warmK" else "$idx:${done.length()}"
        if (key != dFor) {
            val t = if (warmK >= 0) ex.getJSONArray("warmup").getJSONObject(warmK) else target(ex)
            dW = t.optDouble("w"); dR = t.optInt("r"); dFor = key
        }

        if (ambient) {
            place(tv(ex.getString("name"), 13f, Color.WHITE, false, 2), .5f, .26f, .7f)
            place(tv("${fmt(dW)} kg × $dR", 22f, Color.WHITE), .5f, .45f, .8f)
            place(tv(if (warmK >= 0) "Warm-up ${warmK + 1}" else "Set ${minOf(done.length() + 1, nTarget)} of $nTarget", 11f, C.DIM2), .5f, .62f, .8f)
            return
        }
        // workout progress around the edge
        var all = 0; var did = 0
        for (i in 0 until exs.length()) { val e = exs.getJSONObject(i); val t = maxOf(e.optJSONArray("target")?.length() ?: 0, 1); all += t; did += minOf(e.getJSONArray("done").length(), t) }
        val ring = EdgeRing(this).apply { stroke = W * 0.022f; glow = false }
        content.addView(ring, FrameLayout.LayoutParams(-1, -1))
        ring.setProgress(lastRing, 0); ring.setProgress(did.toFloat() / all); lastRing = did.toFloat() / all
        syncDot()

        val note = ex.optString("note", "")
        val title = tv(ex.getString("name").replace(Regex(" \\((Barbell|Dumbbell|Machine|Cable)\\)"), ""), 15f, Color.WHITE, true, 2)
        if (note.isNotEmpty()) title.setOnClickListener { haptic(it); showNote(note) }
        place(title, .5f, .12f, .66f)
        val hrNow = if (System.currentTimeMillis() - HeartRate.at < 30000) "  ♥${HeartRate.bpm}" else ""
        val noteMark = if (note.isNotEmpty()) "  ✎" else ""
        val label = if (warmK >= 0) "WARM-UP ${warmK + 1}/${ex.getJSONArray("warmup").length()}$noteMark"
                    else "SET ${minOf(done.length() + 1, nTarget)}/$nTarget$hrNow$noteMark"
        place(tv(label, 10f, if (warmK >= 0) C.DIM else C.VOLT, true).apply {
            letterSpacing = 0.12f
            if (note.isNotEmpty()) setOnClickListener { haptic(it); showNote(note) }
        }, .5f, .285f, .8f)

        // weight × reps: the highlighted one follows the bezel
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER or Gravity.BOTTOM }
        wView = tv(fmt(dW), 34f, Color.WHITE, true)
        rView = tv(dR.toString(), 34f, Color.WHITE, true)
        val kg = tv(" kg", 11f, C.DIM).apply { setPadding(0, 0, 0, 14) }
        val x = tv("  ×  ", 16f, C.DIM2).apply { setPadding(0, 0, 0, 10) }
        row.addView(wView); row.addView(kg); row.addView(x); row.addView(rView)
        place(row, .5f, .355f, .9f)
        wView.setOnClickListener { focusWeight = true; haptic(it); paintFocus() }
        rView.setOnClickListener { focusWeight = false; haptic(it); paintFocus() }
        paintFocus()
        if (warmK >= 0) { wView.alpha = 0.75f; rView.alpha = 0.75f }

        val last = ex.optJSONArray("last")
        val hint = when {
            warmK >= 0 -> "then " + setStr(target(ex)) + " × ${nTarget} sets"
            done.length() > 0 -> "done: " + setsStr(done)
            last != null && last.length() > 0 -> "last: " + setsStr(last)
            else -> ex.optString("why")
        }
        place(tv(hint, 10f, C.DIM), .5f, .55f, .74f)

        // ✓ log (outlined while warming up)
        val check = if (warmK >= 0) circleBtn("✓", C.CARD2, C.VOLT, 26f) { buzz(25); Store.warm(idx, warmK) }
                    else circleBtn("✓", C.VOLT, C.BG, 26f) { logSet(idx) }
        place(check, .5f, .78f, .25f, .25f)
        check.elevation = 8f
        // left: undo (or skip warm-ups) · right: list
        val left = if (warmK >= 0) circleBtn("⏭", C.CARD, Color.WHITE, 14f) { skipWarm.add("${s.optString("id")}:$idx"); dFor = ""; buzz(30); shownKey = ""; render() }
                   else circleBtn("↺", C.CARD, if (done.length() > 0) Color.WHITE else C.DIM2, 15f) { if (done.length() > 0) { Store.undo(idx); buzz(30) } }
        place(left, .22f, .70f, .15f, .15f)
        val list = circleBtn("≡", C.CARD, Color.WHITE, 17f) { go(Screen.LIST) }
        place(list, .78f, .70f, .15f, .15f)

        // swipe left/right = next/previous exercise
        val gd = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(e: MotionEvent) = true
            override fun onFling(e1: MotionEvent?, e2: MotionEvent, vx: Float, vy: Float): Boolean {
                if (e1 == null || abs(e2.x - e1.x) < W * 0.2f || abs(vx) < abs(vy)) return false
                val n = exs.length(); val next = if (e2.x < e1.x) (idx + 1) % n else (idx - 1 + n) % n
                haptic(content); Store.select(next)
                content.post { enter(content, if (e2.x < e1.x) W * 0.25f else -W * 0.25f) }
                return true
            }
        })
        content.setOnTouchListener { _, ev -> gd.onTouchEvent(ev) }
    }
    private var lastRing = 0f

    private fun paintFocus() {
        if (!::wView.isInitialized) return
        wView.setTextColor(if (focusWeight) C.VOLT else Color.WHITE)
        rView.setTextColor(if (!focusWeight) C.VOLT else Color.WHITE)
    }

    private fun bumpView(v: TextView, text: String, up: Boolean) {
        v.text = text
        v.translationY = if (up) W * 0.03f else -W * 0.03f
        v.alpha = 0.4f
        v.animate().translationY(0f).alpha(1f).setDuration(160).setInterpolator(DecelerateInterpolator()).start()
    }

    private fun logSet(idx: Int) {
        buzz(40)
        val ex = curEx() ?: return
        Store.log(idx, dW, dR)
        // celebrate immediately if it was a PR (Store marks it locally)
        val d = ex.getJSONArray("done"); val lastSet = d.optJSONObject(d.length() - 1)
        if (lastSet != null && !lastSet.isNull("pr")) celebrate(ex.getString("name"), lastSet)
    }

    private fun checkPr() {
        // PRs logged on the phone: celebrate on the watch too
        val s = session() ?: return
        val exs = s.getJSONArray("exercises")
        for (i in 0 until exs.length()) {
            val d = exs.getJSONObject(i).getJSONArray("done")
            for (k in 0 until d.length()) {
                val x = d.getJSONObject(k)
                val key = "${s.optString("id")}:$i:$k"
                if (!x.isNull("pr") && key > lastPrSeen && Store.now() - x.optLong("t") < 8000) {
                    lastPrSeen = key; if (!ambient) celebrate(exs.getJSONObject(i).getString("name"), x)
                }
            }
        }
    }

    private fun showNote(note: String) {
        val box = tv(note, 13f, Color.WHITE, false, 6).apply {
            setPadding(W / 10, W / 14, W / 10, W / 14)
            background = GradientDrawable().apply { cornerRadius = W * 0.08f; setColor(Color.parseColor("#EE1F2430")); setStroke(3, C.VOLT) }
        }
        root.addView(box, FrameLayout.LayoutParams((W * 0.78f).toInt(), -2).apply { gravity = Gravity.CENTER })
        box.alpha = 0f; box.scaleX = 0.9f; box.scaleY = 0.9f
        box.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(220).start()
        val dismiss = Runnable { box.animate().alpha(0f).setDuration(200).withEndAction { root.removeView(box) }.start() }
        box.setOnClickListener { ui.removeCallbacks(dismiss); dismiss.run() }
        ui.postDelayed(dismiss, 5000)
    }

    private var celebrated = ""
    private fun celebrate(name: String, set: JSONObject) {
        val k = name + set.optLong("t")
        if (k == celebrated) return
        celebrated = k
        getSystemService(Vibrator::class.java)?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 60, 60, 60, 60, 160), -1))
        burst.post { burst.fire() }
        val t = tv("🏆 PR", 22f, C.PR, true)
        val p = FrameLayout.LayoutParams(-2, -2).apply { gravity = Gravity.CENTER }
        root.addView(t, p)
        t.scaleX = 0f; t.scaleY = 0f
        t.animate().scaleX(1f).scaleY(1f).setDuration(420).setInterpolator(OvershootInterpolator(2.5f)).withEndAction {
            t.animate().alpha(0f).translationY(-W * 0.15f).setStartDelay(900).setDuration(400).withEndAction { root.removeView(t) }.start()
        }.start()
    }

    // =================================================================== REST
    private lateinit var restRing: EdgeRing
    private lateinit var restText: TextView
    private val restTick = object : Runnable {
        override fun run() {
            if (screen != Screen.REST) return
            val s = session() ?: return
            val left = restLeft()
            if (left <= 0) { go(Screen.EXERCISE); return }
            val total = maxOf(s.optInt("rest_total", 90), 1) * 1000f
            restRing.setNow(left / total)
            val secs = ((left + 999) / 1000).toInt()
            restText.text = "%d:%02d".format(secs / 60, secs % 60)
            val ending = secs <= 10
            restRing.color = if (ending) C.HR else C.VOLT
            if (ending && !ambient) { val k = 1f + 0.04f * kotlin.math.sin(System.currentTimeMillis() / 90.0).toFloat(); restText.scaleX = k; restText.scaleY = k }
            if (ambient) ui.postDelayed(this, 1000) else restRing.postOnAnimation(this)
        }
    }

    private fun buildRest() {
        content.removeAllViews()
        val ex = curEx() ?: return
        if (ambient) {
            val until = session()!!.getLong("rest_until")
            place(tv("REST UNTIL", 10f, C.DIM2), .5f, .3f, .8f)
            place(tv(SimpleDateFormat("HH:mm:ss", Locale.UK).format(Date(until)), 24f, Color.WHITE), .5f, .4f, .8f)
            place(tv(ex.getString("name"), 11f, C.DIM2, false, 2), .5f, .6f, .7f)
            return
        }
        restRing = EdgeRing(this).apply { stroke = W * 0.05f; track = C.VOLT_DIM }
        content.addView(restRing, FrameLayout.LayoutParams(-1, -1))
        syncDot()
        place(tv("REST", 11f, C.DIM, true).apply { letterSpacing = 0.25f }, .5f, .2f, .6f)
        restText = tv("0:00", 46f, Color.WHITE, true)
        place(restText, .5f, .27f, .8f)
        val t = target(ex)
        place(tv("next  " + ex.getString("name").replace(Regex(" \\(.*\\)"), ""), 11f, C.DIM, false, 1), .5f, .52f, .66f)
        place(tv("${if (t.optDouble("w") > 0) fmt(t.optDouble("w")) + " kg × " else ""}${t.optInt("r")}", 15f, Color.WHITE, true), .5f, .60f, .7f)
        ex.optString("note", "").takeIf { it.isNotEmpty() }?.let { place(tv("✎ $it", 9.5f, C.VOLT, false, 1), .5f, .685f, .62f) }
        place(pill("+30", C.CARD2, Color.WHITE) { Store.restAdd(30) }, .33f, .80f, .24f, .13f)
        place(pill("Skip", C.VOLT, C.BG) { Store.restSkip() }, .67f, .80f, .24f, .13f)
        ui.removeCallbacks(restTick); restRing.postOnAnimation(restTick)
    }

    // =================================================================== LIST
    private fun buildList() {
        content.removeAllViews()
        val s = session() ?: return
        val exs = s.getJSONArray("exercises")
        val scroll = ScrollView(this).apply { isVerticalScrollBarEnabled = false; isFocusableInTouchMode = true }
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(W / 8, (W * 0.13f).toInt(), W / 8, (W * 0.22f).toInt()) }
        scroll.addView(col); content.addView(scroll, FrameLayout.LayoutParams(-1, -1))
        val mins = ((Store.now() - s.getLong("started")) / 60000).toInt()
        val sum = Store.summary(s)
        col.addView(tv(s.getString("routine"), 15f, Color.WHITE, true))
        col.addView(tv("$mins min · ${"%,d".format(sum.optInt("volume"))} kg", 10f, C.DIM))
        for (i in 0 until exs.length()) {
            val e = exs.getJSONObject(i); val n = e.getJSONArray("done").length(); val t = maxOf(e.optJSONArray("target")?.length() ?: 0, 1)
            val rowv = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(18, 14, 18, 14)
                background = GradientDrawable().apply { cornerRadius = 40f; setColor(if (i == s.optInt("current")) C.CARD2 else C.CARD) }
                setOnClickListener { haptic(this); Store.select(i); go(Screen.EXERCISE) }
            }
            val mr = MiniRing(this).apply { progress = n.toFloat() / t }
            rowv.addView(mr, LinearLayout.LayoutParams((W * 0.08f).toInt(), (W * 0.08f).toInt()).apply { rightMargin = 14 })
            val txt = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            txt.addView(tv(e.getString("name"), 12f, if (n >= t) C.DIM else Color.WHITE, true).apply { gravity = Gravity.START })
            txt.addView(tv("$n/$t sets", 9.5f, C.DIM).apply { gravity = Gravity.START })
            rowv.addView(txt, LinearLayout.LayoutParams(0, -2, 1f))
            col.addView(rowv, LinearLayout.LayoutParams(-1, -2).apply { topMargin = 8 })
            rowv.alpha = 0f; rowv.animate().alpha(1f).setStartDelay(30L * i).setDuration(250).start()
        }
        col.addView(pill("Back", C.CARD2, Color.WHITE) { go(Screen.EXERCISE) }.apply { setPadding(0, 22, 0, 22) }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = 18 })
        col.addView(pill("Finish workout", C.VOLT, C.BG) { go(Screen.CONFIRM) }.apply { setPadding(0, 22, 0, 22) }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = 8 })
        col.addView(tv("Hold to discard", 9.5f, C.DIM2).apply {
            setPadding(0, 22, 0, 0)
            setOnLongClickListener { buzz(200); Store.discard(); true }
        })
        scroll.requestFocus()
    }

    private fun buildConfirm() {
        content.removeAllViews()
        place(tv("Finish & save?", 16f, Color.WHITE, true), .5f, .28f, .8f)
        val sum = Store.summary(session()!!)
        place(tv("${sum.optInt("sets")} sets · ${"%,d".format(sum.optInt("volume"))} kg", 11f, C.DIM), .5f, .40f, .8f)
        place(circleBtn("✓", C.VOLT, C.BG, 24f) { buzz(120); screen = Screen.SUMMARY; Store.finish() }, .62f, .66f, .22f, .22f)
        place(circleBtn("✕", C.CARD2, Color.WHITE, 18f) { go(Screen.LIST) }, .36f, .66f, .18f, .18f)
    }

    // =================================================================== SUMMARY
    private fun buildSummary() {
        content.removeAllViews()
        val s = session() ?: return
        val sum = s.optJSONObject("summary") ?: Store.summary(s)
        val check = circleBtn("✓", C.VOLT, C.BG, 20f) {}
        place(check, .5f, .17f, .15f, .15f)
        check.scaleX = 0f; check.scaleY = 0f
        check.animate().scaleX(1f).scaleY(1f).setDuration(600).setInterpolator(OvershootInterpolator(3f)).start()
        place(tv(s.getString("routine") + " done", 14f, Color.WHITE, true), .5f, .26f, .76f)
        val prs = sum.optJSONArray("prs")?.length() ?: 0
        val lines = mutableListOf("${sum.optInt("minutes")}" to "min", "%,d".format(sum.optInt("volume")) to "kg", "${sum.optInt("sets")}" to "sets")
        if (prs > 0) lines.add("$prs" to if (prs == 1) "PR" else "PRs")
        if (!sum.isNull("hr_avg")) lines.add("${sum.optInt("hr_avg")}" to "avg bpm")
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER }
        lines.forEachIndexed { i, (v, u) ->
            val t = tv("", if (lines.size > 4) 13f else 15f, if (u.startsWith("PR")) C.PR else Color.WHITE, true)
            col.addView(t)
            countUp(t, v, u, 250L + i * 120)
        }
        place(col, .5f, .355f, .8f)
        (Store.progress?.optJSONObject("overall") ?: Store.lifter)?.let { l ->
            place(tv("LV ${l.optInt("lv")} · ${l.optString("tier")}", 11f, C.VOLT, true), .5f, .55f, .8f)
            place(XpBar(this).apply { progress = l.optDouble("xp", 0.0).toFloat() }, .5f, .60f, .46f, .018f)
        }
        place(pill("Done", C.CARD2, Color.WHITE) { Store.close() }, .5f, .83f, .34f, .13f)
        if (prs > 0) burst.postDelayed({ burst.fire() }, 500)
        maybeRefreshProgress(s)
    }

    /** Rescore once the finish op has been saved; the server writes the CSV before replying. */
    private fun maybeRefreshProgress(s: JSONObject) {
        val id = s.optString("id")
        if (Store.sync != Store.Sync.OK || progressForSession == id) return
        progressForSession = id
        Store.refreshProgress { ok ->
            if (!ok) progressForSession = ""
            else { shownKey = ""; render(); checkLevelUp() }
        }
    }

    /** Same rule as the phone's localStorage gymLv: celebrate only the first sight of a new level. */
    private fun checkLevelUp() {
        val s = Store.session ?: return
        val l = Store.progress?.optJSONObject("overall") ?: return
        val lv = l.optInt("lv")
        val prev = Store.lastLv
        Store.lastLv = lv
        if (prev > 0 && lv > prev && levelUpShownFor != s.optString("id") && !ambient) {
            levelUpShownFor = s.optString("id")
            showLevelUp(prev, lv, l)
        }
    }

    private fun showLevelUp(a: Int, b: Int, l: JSONObject) {
        val unlocks = arrayOf("wristbands", "headband", "lifting belt", "gold belt + aura")
        val oldTier = ((a - 1) / 10).coerceIn(0, 4)
        val newTier = ((b - 1) / 10).coerceIn(0, 4)
        val overlay = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#EE0C0E12"))
            isClickable = true
            alpha = 0f
            animate().alpha(1f).setDuration(260).start()
        }
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER }
        val fig = LifterView(this).apply { score = l.optDouble("score", 0.0).toFloat() }
        col.addView(fig, LinearLayout.LayoutParams((W * 0.42f).toInt(), (W * 0.525f).toInt()))
        col.addView(tv("LEVEL UP", 10f, C.VOLT, true).apply { letterSpacing = 0.25f })
        col.addView(tv("Lv $a → $b", 17f, Color.WHITE, true))
        col.addView(tv(l.optString("tier"), 11f, C.DIM, true))
        if (newTier > oldTier && newTier >= 1) {
            col.addView(tv("UNLOCKED " + unlocks[newTier - 1].uppercase(Locale.UK), 9f, C.PR, true))
        }
        overlay.addView(col, FrameLayout.LayoutParams(-2, -2).apply { gravity = Gravity.CENTER })
        // between content and Burst, so a Store redraw can't dismiss it and confetti stays on top
        root.addView(overlay, 1, FrameLayout.LayoutParams(-1, -1))
        fig.post { fig.animateTo(l.optDouble("score", 0.0).toFloat(), 700); fig.flex() }
        getSystemService(Vibrator::class.java)?.vibrate(
            VibrationEffect.createWaveform(longArrayOf(0, 60, 60, 60, 60, 160), -1))
        burst.post { burst.fire() }
        val dismiss = Runnable {
            if (overlay.parent != null) overlay.animate().alpha(0f).setDuration(220).withEndAction { content.removeView(overlay) }.start()
        }
        overlay.setOnClickListener { ui.removeCallbacks(dismiss); dismiss.run() }
        ui.postDelayed(dismiss, 4200)
    }

    private fun countUp(t: TextView, v: String, unit: String, delay: Long) {
        val target = v.replace(",", "").toIntOrNull() ?: 0
        ValueAnimator.ofInt(0, target).apply {
            duration = 900; startDelay = delay; interpolator = DecelerateInterpolator(2f)
            addUpdateListener { t.text = "%,d $unit".format(it.animatedValue as Int) }
            start()
        }
        t.text = "0 $unit"
    }

    // =================================================================== bezel
    override fun dispatchGenericMotionEvent(ev: MotionEvent): Boolean {
        if (ev.action == MotionEvent.ACTION_SCROLL && ev.isFromSource(InputDevice.SOURCE_ROTARY_ENCODER)) {
            val dir = if (-ev.getAxisValue(MotionEvent.AXIS_SCROLL) > 0) 1 else -1
            when (screen) {
                Screen.EXERCISE -> {
                    val ex = curEx() ?: return true
                    if (focusWeight) {
                        dW = maxOf(0.0, ((dW + dir * ex.optDouble("step", 2.5)) * 100).roundToInt() / 100.0)
                        bumpView(wView, fmt(dW), dir > 0)
                    } else {
                        dR = (dR + dir).coerceIn(0, 100); bumpView(rView, dR.toString(), dir > 0)
                    }
                    window.decorView.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                    return true
                }
                Screen.REST -> {
                    if (restLeft() + dir * 15000 > 1000) Store.restAdd(dir * 15)
                    window.decorView.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                    return true
                }
                Screen.EVOLUTION -> {
                    val weeks = Store.progress?.optJSONArray("weeks") ?: JSONArray()
                    if (weeks.length() > 0) {
                        evoIndex = (evoIndex + dir).coerceIn(0, weeks.length() - 1)
                        shownKey = ""; render()
                        window.decorView.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                    }
                    return true
                }
                else -> {}
            }
        }
        return super.dispatchGenericMotionEvent(ev)
    }
}
