package io.github.teo2301.gymcompanion.wear

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.view.View
import android.view.animation.DecelerateInterpolator
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.sin
import kotlin.random.Random

object C {
    val BG = Color.parseColor("#0C0E12")
    val CARD = Color.parseColor("#1A1E25")
    val CARD2 = Color.parseColor("#262B34")
    val VOLT = Color.parseColor("#D7FF3E")
    val VOLT_DIM = Color.parseColor("#2C3514")
    val DIM = Color.parseColor("#8D94A0")
    val DIM2 = Color.parseColor("#5D6470")
    val HR = Color.parseColor("#FF5A6E")
    val PR = Color.parseColor("#FFB020")
    val OK = Color.parseColor("#3EE08F")
}

/** Full-screen ring hugging the round display edge. [progress] 0..1 animates smoothly. */
class EdgeRing(ctx: Context) : View(ctx) {
    var color = C.VOLT
        set(v) { field = v; invalidate() }
    var track = C.CARD
    var stroke = 0f
    var glow = true
    private var shown = 0f
    private var anim: ValueAnimator? = null
    private val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
    private val g = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
    private val r = RectF()

    init { setLayerType(LAYER_TYPE_SOFTWARE, null) }   // needed for the blur glow

    /** Animate to [v] (0..1). [ms] 0 = jump. */
    fun setProgress(v: Float, ms: Long = 600) {
        anim?.cancel()
        if (ms <= 0) { shown = v; invalidate(); return }
        anim = ValueAnimator.ofFloat(shown, v).apply {
            duration = ms; interpolator = DecelerateInterpolator(2f)
            addUpdateListener { shown = it.animatedValue as Float; invalidate() }
            start()
        }
    }

    /** For the rest countdown: set directly every frame. */
    fun setNow(v: Float) { anim?.cancel(); shown = v; invalidate() }

    override fun onDraw(c: Canvas) {
        val s = if (stroke > 0) stroke else width * 0.035f
        val inset = s / 2 + width * 0.012f
        r.set(inset, inset, width - inset, height - inset)
        p.strokeWidth = s; p.color = track
        c.drawArc(r, 0f, 360f, false, p)
        if (shown <= 0.001f) return
        if (glow) {
            g.strokeWidth = s * 1.6f; g.color = color; g.alpha = 110
            g.maskFilter = BlurMaskFilter(s * 1.4f, BlurMaskFilter.Blur.NORMAL)
            c.drawArc(r, -90f, 360f * shown, false, g)
        }
        p.color = color
        c.drawArc(r, -90f, 360f * shown, false, p)
    }
}

/** Small progress ring for list rows. */
class MiniRing(ctx: Context) : View(ctx) {
    var progress = 0f
    private val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
    private val r = RectF()
    override fun onDraw(c: Canvas) {
        val s = width * 0.13f
        r.set(s, s, width - s, height - s)
        p.strokeWidth = s; p.color = C.CARD2; c.drawArc(r, 0f, 360f, false, p)
        p.color = if (progress >= 1f) C.OK else C.VOLT
        if (progress > 0) c.drawArc(r, -90f, 360f * min(progress, 1f), false, p)
    }
}

/** Particle burst for personal records. */
class Burst(ctx: Context) : View(ctx) {
    private class P(var x: Float, var y: Float, var vx: Float, var vy: Float, val c: Int, val s: Float, var rot: Float, val vr: Float)
    private val parts = mutableListOf<P>()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var t0 = 0L
    private val cols = intArrayOf(C.VOLT, C.PR, C.OK, Color.WHITE, C.HR)

    fun fire() {
        parts.clear()
        val cx = width / 2f; val cy = height / 2f
        repeat(70) {
            val a = Random.nextFloat() * 6.283f; val sp = width * (0.010f + Random.nextFloat() * 0.022f)
            parts.add(P(cx, cy, cos(a) * sp, sin(a) * sp - width * 0.01f, cols[it % cols.size],
                width * (0.012f + Random.nextFloat() * 0.014f), Random.nextFloat() * 360, (Random.nextFloat() - .5f) * 20))
        }
        t0 = System.currentTimeMillis(); visibility = VISIBLE; invalidate()
    }

    override fun onDraw(c: Canvas) {
        val k = (System.currentTimeMillis() - t0) / 1400f
        if (k >= 1f || parts.isEmpty()) { visibility = GONE; return }
        paint.alpha = ((1 - k) * 255).toInt()
        for (p in parts) {
            p.vy += width * 0.0009f; p.vx *= 0.985f; p.x += p.vx; p.y += p.vy; p.rot += p.vr
            paint.color = p.c; paint.alpha = ((1 - k) * 255).toInt()
            c.save(); c.rotate(p.rot, p.x, p.y); c.drawRect(p.x - p.s, p.y - p.s / 2, p.x + p.s, p.y + p.s / 2, paint); c.restore()
        }
        postInvalidateOnAnimation()
    }
}

/** Small XP bar, same colours as the phone's lifter card. */
class XpBar(ctx: Context) : View(ctx) {
    var progress = 0f
        set(v) { field = v.coerceIn(0f, 1f); invalidate() }
    private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = C.CARD2 }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = C.VOLT }

    override fun onDraw(c: Canvas) {
        val r = height / 2f
        c.drawRoundRect(0f, 0f, width.toFloat(), height.toFloat(), r, r, track)
        if (progress > 0f) c.drawRoundRect(0f, 0f, maxOf(r * 2f, width * progress), height.toFloat(), r, r, fill)
    }
}

/**
 * Canvas port of the phone's `character.js`: a double-biceps pose whose muscles grow with the
 * overall strength score. Gear unlocks by tier: wristbands (1), headband (2), belt (3),
 * gold belt + aura (4). One score drives every dimension, so it can animate between weeks.
 */
class LifterView(ctx: Context) : View(ctx) {
    var score = 0f
        set(v) { field = v.coerceIn(-1f, 5f); invalidate() }
    var ambient = false
        set(v) { field = v; invalidate() }

    private val path = Path()
    private val fillP = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val strokeP = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND
    }
    private var flexAmt = 0f
    private var anim: ValueAnimator? = null

    /** Grow/shrink smoothly to a new score (e.g. replaying weekly levels). */
    fun animateTo(v: Float, ms: Long = 600) {
        anim?.cancel()
        anim = ValueAnimator.ofFloat(score, v.coerceIn(-1f, 5f)).apply {
            duration = ms; interpolator = DecelerateInterpolator(2f)
            addUpdateListener { score = it.animatedValue as Float }
            start()
        }
    }

    /** Two quick bicep pumps + a hop, matching the phone's `.flex` animation on level-up. */
    fun flex() {
        ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 520L; repeatCount = 1; repeatMode = ValueAnimator.REVERSE
            addUpdateListener { flexAmt = it.animatedValue as Float; invalidate() }
            start()
        }
    }

    override fun onDraw(c: Canvas) {
        super.onDraw(c)
        val s = min(width / 200f, height / 250f)
        c.save()
        c.translate((width - 200f * s) / 2f, (height - 250f * s) / 2f - 6f * flexAmt)
        c.scale(s, s)
        drawLifter(c)
        c.restore()
    }

    private fun skinShader(skinL: Int, skin: Int) =
        LinearGradient(0f, 30f, 0f, 160f, skinL, skin, Shader.TileMode.CLAMP)

    private fun drawLifter(c: Canvas) {
        val m = ((score + 0.3f) / 5.3f).coerceIn(0f, 1f)
        val tier = if (score < 0) -1 else minOf(4, floor(score).toInt())
        val skin = if (ambient) Color.WHITE else Color.parseColor("#e9b48a")
        val skinD = if (ambient) Color.GRAY else Color.parseColor("#c98d62")
        val skinL = if (ambient) Color.WHITE else Color.parseColor("#f6cfa9")
        val hair = if (ambient) Color.GRAY else Color.parseColor("#2a2320")
        val volt = if (ambient) Color.WHITE else Color.parseColor("#d7ff3e")
        val ink = if (ambient) Color.GRAY else Color.parseColor("#0c0e12")
        val S = 26f + 17f * m
        val Wt = 19f + 3f * m
        val arm = 11f + 9f * m
        val fore = 9f + 5f * m
        val bic = (6f + 8f * m) * (1f + 0.3f * flexAmt)
        val delt = 8f + 7f * m
        val thigh = 15f + 10f * m
        val calf = 10f + 6f * m
        val ex = S + 24f + 5f * m
        val shader = skinShader(skinL, skin)

        // Elite aura
        if (tier >= 4 && !ambient) {
            fillP.shader = RadialGradient(100f, 120f, 98f, Color.argb(140, 255, 211, 90),
                Color.argb(0, 255, 211, 90), Shader.TileMode.CLAMP)
            c.drawCircle(100f, 120f, 98f, fillP)
            fillP.shader = null
        }
        // floor shadow
        fillP.color = Color.BLACK; fillP.alpha = 90
        c.drawOval(100f - (34f + 10f * m), 238f, 100f + (34f + 10f * m), 248f, fillP)
        fillP.alpha = 255

        // legs
        strokeP.color = skin; strokeP.strokeWidth = thigh
        for (side in intArrayOf(-1, 1)) {
            val sf = side.toFloat()
            val hx = 100f + sf * 11f
            val kx = 100f + sf * (15f + 2f * m)
            val ax = 100f + sf * 15f
            c.drawLine(hx, 168f, kx, 205f, strokeP)
            strokeP.strokeWidth = calf
            c.drawLine(kx, 207f, ax, 232f, strokeP)
            strokeP.strokeWidth = thigh
            strokeP.color = skinD; strokeP.strokeWidth = 1.6f
            strokeP.alpha = (51 + 153 * m).toInt()
            val sx = kx + sf * calf * 0.25f
            path.moveTo(sx, 210f)
            path.quadTo(sx + sf * calf * 0.35f, 218f, sx, 226f)
            c.drawPath(path, strokeP); path.reset()
            strokeP.alpha = 255; strokeP.color = skin; strokeP.strokeWidth = thigh
            fillP.color = ink
            c.drawRoundRect(RectF(ax - 9f, 230f, ax + 9f, 238f), 4f, 4f, fillP)
            strokeP.color = Color.parseColor("#2a303a"); strokeP.strokeWidth = 1.5f
            c.drawRoundRect(RectF(ax - 9f, 230f, ax + 9f, 238f), 4f, 4f, strokeP)
            strokeP.color = skin; strokeP.strokeWidth = thigh
        }

        // shorts
        path.moveTo(100f - Wt - 2f, 150f)
        path.lineTo(100f + Wt + 2f, 150f)
        path.lineTo(100f + Wt + 6f, 184f)
        path.lineTo(104f, 184f); path.lineTo(100f, 170f); path.lineTo(96f, 184f)
        path.lineTo(100f - Wt - 6f, 184f); path.close()
        fillP.color = volt
        c.drawPath(path, fillP); path.reset()
        strokeP.color = Color.parseColor("#9fc21c"); strokeP.strokeWidth = 1.5f
        c.drawLine(100f, 154f, 100f, 170f, strokeP)

        // arms (behind the torso edge)
        strokeP.color = skin; strokeP.strokeWidth = arm
        for (side in intArrayOf(-1, 1)) {
            val sf = side.toFloat()
            val sx = 100f + sf * (S - 4f)
            val elx = 100f + sf * ex
            val fx = 100f + sf * (ex + 4f)
            c.drawLine(sx, 94f, elx, 92f, strokeP)
            strokeP.strokeWidth = fore
            c.drawLine(elx, 92f, fx, 52f, strokeP)
            strokeP.strokeWidth = arm
            if (tier >= 1) {   // wristbands
                strokeP.color = volt; strokeP.strokeWidth = fore + 2f
                strokeP.strokeCap = Paint.Cap.BUTT
                c.drawLine(fx - sf * 0.5f, 61f, fx - sf * 0.2f, 67f, strokeP)
                strokeP.strokeCap = Paint.Cap.ROUND; strokeP.color = skin; strokeP.strokeWidth = arm
            }
            fillP.shader = shader
            c.drawCircle(100f + sf * (S + 11f + 3f * m), 88f - 2f * m, bic, fillP)
            fillP.shader = null
            strokeP.color = skinD; strokeP.strokeWidth = 1.6f
            strokeP.alpha = (64 + 153 * m).toInt()
            val bx = 100f + sf * (S + 5f)
            val by = 91f + bic * 0.3f
            path.moveTo(bx, by)
            path.quadTo(bx + sf * (bic + 3f), by + bic * 0.35f, bx + sf * (2f * bic + 4f), by)
            c.drawPath(path, strokeP); path.reset()
            strokeP.alpha = 255; strokeP.color = skin; strokeP.strokeWidth = arm
            fillP.color = skin
            c.drawCircle(fx, 52f, 7f + 2f * m, fillP)
        }

        // torso (V-taper)
        path.moveTo(100f - S, 88f)
        path.quadTo(100f - S - 3f, 112f, 100f - Wt - 3f, 134f)
        path.lineTo(100f - Wt, 152f); path.lineTo(100f + Wt, 152f)
        path.lineTo(100f + Wt + 3f, 134f)
        path.quadTo(100f + S + 3f, 112f, 100f + S, 88f)
        path.quadTo(100f, 76f, 100f - S, 88f); path.close()
        fillP.shader = shader; c.drawPath(path, fillP); fillP.shader = null; path.reset()
        // delts
        fillP.shader = shader
        for (side in intArrayOf(-1, 1)) c.drawCircle(100f + side * (S - 2f), 92f, delt, fillP)
        fillP.shader = null
        // pecs
        strokeP.color = skinD; strokeP.strokeWidth = 2f
        strokeP.alpha = (64 + 166 * m).toInt()
        for (side in intArrayOf(-1, 1)) {
            val sf = side.toFloat()
            path.moveTo(100f, 93f)
            path.quadTo(100f + sf * S * 0.8f, 88f, 100f + sf * S * 0.85f, 103f)
            path.quadTo(100f + sf * S * 0.55f, 116f + 3f * m, 100f, 112f + 3f * m)
            c.drawPath(path, strokeP); path.reset()
        }
        // abs
        val ao = 0.12f + 0.6f * m
        fillP.color = skinD; fillP.alpha = (ao * 140f).toInt()
        for (r in 0..2) for (side in intArrayOf(-1, 1)) {
            val x = if (side < 0) 89.5f else 101.5f
            c.drawRoundRect(RectF(x, 119f + r * 10f, x + 9f, 127f + r * 10f), 3f, 3f, fillP)
        }
        fillP.alpha = 255
        strokeP.color = skinD; strokeP.strokeWidth = 1.4f
        strokeP.alpha = (ao * 255f).toInt()
        c.drawLine(100f, 116f, 100f, 148f, strokeP)
        strokeP.alpha = 255
        // belt
        if (tier >= 3) {
            fillP.color = if (tier >= 4) Color.parseColor("#ffc23a") else Color.parseColor("#2b2f37")
            c.drawRoundRect(RectF(100f - Wt - 2f, 140f, 100f + Wt + 2f, 152f), 3f, 3f, fillP)
            strokeP.color = if (tier >= 4) Color.parseColor("#fff3c2") else Color.parseColor("#9aa3ad")
            strokeP.strokeWidth = 2f
            c.drawRoundRect(RectF(94f, 141.5f, 106f, 150.5f), 2f, 2f, strokeP)
        }

        // neck + traps
        val nw = 9f + 4f * m
        path.moveTo(100f - nw, 84f); path.lineTo(100f - nw + 2f, 66f)
        path.lineTo(100f + nw - 2f, 66f); path.lineTo(100f + nw, 84f); path.close()
        fillP.color = skin
        c.drawPath(path, fillP); path.reset()
        if (m > 0.4f) for (side in intArrayOf(-1, 1)) {
            val sf = side.toFloat()
            path.moveTo(100f + sf * nw, 84f)
            path.quadTo(100f + sf * (nw + 10f), 80f, 100f + sf * (S - 6f), 84f)
            path.close(); fillP.color = skin; c.drawPath(path, fillP); path.reset()
        }
        // head
        fillP.shader = shader; c.drawCircle(100f, 48f, 19f, fillP); fillP.shader = null
        fillP.color = hair
        path.moveTo(81f, 46f)
        path.quadTo(81f, 27f, 100f, 27f)
        path.quadTo(119f, 27f, 119f, 46f)
        path.quadTo(113f, 37f, 100f, 37f)
        path.quadTo(87f, 37f, 81f, 46f); path.close()
        c.drawPath(path, fillP); path.reset()
        if (tier >= 2) {   // headband
            fillP.color = volt
            path.moveTo(81.5f, 42f)
            path.quadTo(100f, 35f, 118.5f, 42f)
            path.lineTo(118.5f, 47f)
            path.quadTo(100f, 40f, 81.5f, 47f); path.close()
            c.drawPath(path, fillP); path.reset()
        }
        fillP.color = ink
        c.drawCircle(93f, 51f, 2.2f, fillP); c.drawCircle(107f, 51f, 2.2f, fillP)
        strokeP.color = ink; strokeP.strokeWidth = 2f
        path.moveTo(94f, 58f); path.quadTo(100f, 62f + 2f * m, 106f, 58f)
        c.drawPath(path, strokeP); path.reset()
    }
}
