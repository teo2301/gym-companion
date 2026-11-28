package io.github.teo2301.gymcompanion

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray

/** What the page can do for the watch link. Added to every WebView that runs the app as `GymWatchNative`. */
class GymWatchNative(private val ctx: Context, private val onDone: () -> Unit = {}) {
    @JavascriptInterface fun drainWatchOps(): String = WatchLink.get(ctx).drain()
    @JavascriptInterface fun pendingCount(): Int = WatchLink.get(ctx).pending()
    @JavascriptInterface fun ackWatchOps(idsJson: String) {
        val ids = try { JSONArray(idsJson).let { a -> (0 until a.length()).map { a.optString(it) } } } catch (e: Exception) { emptyList() }
        WatchLink.get(ctx).ack(ids)
    }
    @JavascriptInterface fun publishLive(json: String) = WatchLink.get(ctx).publish("/gym/live", json)
    @JavascriptInterface fun publishPlan(json: String) = WatchLink.get(ctx).publish("/gym/plan", json)
    @JavascriptInterface fun done() = onDone()
}

/**
 * Gets queued watch actions applied when the app is closed: if the Gym screen is open, it is poked; if not, the
 * same bundled page is loaded in an invisible WebView (same origin, so same IndexedDB) just long enough to apply
 * the queue and publish, then it is destroyed.
 */
object WatchSync {
    private val main = Handler(Looper.getMainLooper())
    private var headless: WebView? = null
    private const val LIFETIME_MS = 45_000L

    fun poke(ctx: Context) {
        val app = ctx.applicationContext
        main.post {
            val open = MainActivity.current
            if (open != null) { open.pokeWatch(); return@post }
            if (headless == null) startHeadless(app)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun startHeadless(app: Context) {
        val loader = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(app)).build()
        val wv = try { WebView(app) } catch (e: Exception) { return }
        headless = wv
        wv.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = true; allowFileAccess = false; allowContentAccess = false
        }
        wv.addJavascriptInterface(GymWatchNative(app) { main.post { stop() } }, "GymWatchNative")
        wv.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean { main.post { stop() }; return true }
        }
        wv.loadUrl(MainActivity.START_URL + "#watchsync")
        main.postDelayed({ stop() }, LIFETIME_MS)
    }

    private fun stop() {
        val wv = headless ?: return
        headless = null
        main.removeCallbacksAndMessages(null)
        try { wv.stopLoading(); wv.destroy() } catch (e: Exception) { }
    }
}
