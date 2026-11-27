package io.github.teo2301.gymcompanion

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import java.io.File
import org.json.JSONObject

/**
 * Phone-only shell for the bundled Gym PWA. Nothing leaves the asset sandbox except explicit
 * external links, which are handed to the browser. The screen stays on while it's open.
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView

    /** Serves app/src/main/assets/ at https://appassets.androidplatform.net/assets/ so the page gets a
     *  real https origin (stable IndexedDB/localStorage) and file:// access can stay off. */
    private val assetLoader by lazy {
        WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()
    }

    private val openDocumentLauncher = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) {   // cancelled: settle the page's pending pickFile() promise instead of leaving it hanging
            webView.evaluateJavascript("window.GymFilePicked && window.GymFilePicked('', '')", null)
            return@registerForActivityResult
        }
        val displayName = queryDisplayName(uri)
        val text = try {
            contentResolver.openInputStream(uri)?.use { it.bufferedReader(Charsets.UTF_8).readText() } ?: ""
        } catch (e: Exception) { "" }
        webView.evaluateJavascript(
            "window.GymFilePicked(${JSONObject.quote(text)}, ${JSONObject.quote(displayName)})", null
        )
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val bg = Color.parseColor("#0c0e12")
        webView = WebView(this)
        val root = FrameLayout(this)
        root.setBackgroundColor(bg)
        root.addView(webView, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)
        webView.setBackgroundColor(bg)
        // targetSdk 36 is edge-to-edge: keep the page clear of the bars, cut-out and keyboard.
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            insets
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // Everything is served via WebViewAssetLoader, so no file:// or content:// access is needed.
            allowFileAccess = false
            allowContentAccess = false
        }
        webView.addJavascriptInterface(GymBridge(), "GymBridge")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            /** Renderer killed (OOM) or crashed: rebuild the activity instead of crashing the app.
             *  Data lives in IndexedDB/localStorage, so nothing is lost. */
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                (view.parent as? FrameLayout)?.removeView(view)
                view.destroy()
                recreate()
                return true
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (isAssetUrl(uri)) return false
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                } catch (e: ActivityNotFoundException) {
                    // Nothing can handle the link; stay on the current page.
                }
                return true
            }
        }


        installBackHandler()
        if (savedInstanceState == null) webView.loadUrl(START_URL) else webView.restoreState(savedInstanceState)
    }


    /** targetSdk 36 never calls onBackPressed() for back gestures, so Back is routed through the
     *  dispatcher: first let the page close what's on top (sheet, level-up overlay, workout summary),
     *  then page history, then leave the app. */
    private fun installBackHandler() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript(PAGE_BACK_JS) { handled ->
                    if (handled == "true") return@evaluateJavascript
                    if (webView.canGoBack()) { webView.goBack(); return@evaluateJavascript }
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                    isEnabled = true
                }
            }
        })
    }

    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); webView.saveState(outState) }
    override fun onPause() { super.onPause(); webView.onPause() }
    override fun onResume() { super.onResume(); webView.onResume() }

    /** Only the bundled app (https://appassets.androidplatform.net/assets/gym/...) stays in the WebView. */
    private fun isAssetUrl(uri: Uri): Boolean =
        uri.scheme == "https" && uri.host == ASSET_HOST && (uri.path ?: "").startsWith("/assets/gym/")

    /** Real MIME type so other apps open exports properly (JSON backup, Hevy-style CSV). */
    private fun mimeFor(fileName: String): String = when (fileName.substringAfterLast('.', "").lowercase()) {
        "json" -> "application/json"
        "csv" -> "text/csv"
        else -> "text/plain"
    }

    private fun queryDisplayName(uri: Uri): String = try {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0) cursor.getString(index) else null
            } else null
        } ?: uri.lastPathSegment ?: "picked.txt"
    } catch (e: Exception) {
        uri.lastPathSegment ?: "picked.txt"
    }

    private fun safeFileName(fileName: String): String {
        val base = fileName.substringAfterLast('/', fileName.substringAfterLast('\\', fileName)).trim()
        val cleaned = base.replace(Regex("[^A-Za-z0-9._-]"), "_").trim('.').take(120)
        return cleaned.ifEmpty { "gym-export.txt" }
    }

    /** MediaStore.Downloads on 29+, direct Downloads file on older devices; no storage permission. */
    private fun saveToDownloads(fileName: String, text: String): Boolean {
        val bytes = text.toByteArray(Charsets.UTF_8)
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
                    put(MediaStore.MediaColumns.MIME_TYPE, mimeFor(fileName))
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                }
                val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return false
                val out = contentResolver.openOutputStream(uri)
                if (out == null) {
                    contentResolver.delete(uri, null, null)
                    return false
                }
                out.use { it.write(bytes) }
                true
            } else {
                @Suppress("DEPRECATION")
                val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                if (!dir.exists() && !dir.mkdirs()) return false
                File(dir, fileName).writeBytes(bytes)
                true
            }
        } catch (e: Exception) {
            false
        }
    }

    inner class GymBridge {
        @JavascriptInterface
        fun saveFile(fileName: String, text: String): Boolean = saveToDownloads(safeFileName(fileName), text)

        @JavascriptInterface
        fun pickFile() {
            // @JavascriptInterface methods run on a WebView binder thread; launch from the UI thread.
            runOnUiThread { openDocumentLauncher.launch(arrayOf("*/*")) }
        }

        @JavascriptInterface
        fun mode(): String = "public"
    }

    companion object {
        /** Closes the top-most layer of the Gym page; returns true if it handled Back. */
        private const val PAGE_BACK_JS = """(function () {
  var on = function (id) { var e = document.getElementById(id); return !!(e && e.classList.contains('on')); };
  if (typeof window.GymBack === 'function') return !!window.GymBack();
  if (on('sheet') && typeof closeSheet === 'function') { closeSheet(); return true; }
  if (on('lvup')) { document.getElementById('lvup').classList.remove('on'); return true; }
  if (on('done') && document.getElementById('homeBtn')) { document.getElementById('homeBtn').click(); return true; }
  return false;
})()"""
        const val ASSET_HOST = WebViewAssetLoader.DEFAULT_DOMAIN
        const val START_URL = "https://$ASSET_HOST/assets/gym/index.html"
    }
}
