package com.zesuite.zecontrol

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.zesuite.zecontrol.reminders.ReminderController
import com.zesuite.zecontrol.reminders.ReminderNotifier
import com.zesuite.zecontrol.reminders.ReminderStore
import com.zesuite.zecontrol.reminders.ReminderSyncWorker
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

class MainActivity : ComponentActivity() {
    private val siteUri by lazy { Uri.parse(BuildConfig.SITE_URL) }
    private val siteOrigin get() = BuildConfig.SITE_URL
    private val mainHandler = Handler(Looper.getMainLooper())
    private val background = Executors.newSingleThreadExecutor()
    private val store by lazy { ReminderStore(this) }

    private lateinit var root: FrameLayout
    private lateinit var progress: ProgressBar
    private var webView: WebView? = null
    private var stateScript: ScriptHandler? = null
    private var replyProxy: JavaScriptReplyProxy? = null

    private var contentReady = false
    private var showingOffline = false
    private var lastSiteUrl: String? = null
    private var backgroundedAt = 0L
    @Volatile private var lastSyncAt = 0L

    private var pendingGeolocationOrigin: String? = null
    private var pendingGeolocationCallback: GeolocationPermissions.Callback? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            publishState()
            ReminderController.reconcile(this)
            continueSetup()
        }

    private val locationPermission =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
            val granted = result.values.any { it }
            pendingGeolocationCallback?.invoke(pendingGeolocationOrigin, granted, false)
            pendingGeolocationCallback = null
            pendingGeolocationOrigin = null
            if (granted) warnIfLocationOff()
            continueSetup()
        }

    private val fileChooser =
        registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
            fileCallback?.onReceiveValue(uri?.let { arrayOf(it) })
            fileCallback = null
        }

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            mainHandler.post {
                if (showingOffline) {
                    retry()
                } else {
                    // The site's service worker may be showing its own offline page.
                    webView?.evaluateJavascript(
                        "if (document.title.indexOf('Hors connexion') === 0) location.reload();",
                        null,
                    )
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        splash.setKeepOnScreenCondition { !contentReady }
        // Never hold the splash on a bad network: the page has its own states.
        mainHandler.postDelayed({ contentReady = true }, SPLASH_LIMIT_MS)

        enableEdgeToEdge()
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
        // Phones are portrait, as on the website; tablets keep every orientation.
        if (resources.configuration.smallestScreenWidthDp < 600) {
            requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        }
        ReminderNotifier.ensureChannel(this)
        ReminderSyncWorker.schedule(this)

        root = FrameLayout(this).apply {
            setBackgroundColor(ContextCompat.getColor(context, R.color.brand_dark))
        }
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = true
            visibility = View.GONE
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(4), Gravity.TOP)
            elevation = dp(4).toFloat()
        }
        setContentView(root)
        // The site does not draw behind the system bars, and the keyboard must
        // not hide inputs now that the window is edge-to-edge.
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime(),
            )
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) ||
            !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
        ) {
            contentReady = true
            askToUpdateWebView()
            return
        }

        createWebView()
        val path = intent?.getStringExtra(EXTRA_PATH)
        val restored = savedInstanceState?.let { webView?.restoreState(it) } != null
        if (path != null) loadPath(path) else if (!restored) loadPath(START_PATH)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val view = webView
                if (view != null && view.canGoBack() && !showingOffline) {
                    view.goBack()
                } else {
                    moveTaskToBack(true)
                }
            }
        })
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView() {
        val view = WebView(this)
        view.setBackgroundColor(ContextCompat.getColor(this, R.color.brand_background))
        view.overScrollMode = View.OVER_SCROLL_NEVER
        view.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            setGeolocationEnabled(true)
            cacheMode = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            // The layouts are designed per device; a forced zoom would break them.
            textZoom = 100
            userAgentString = "$userAgentString ZeControlAndroid/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        view.webViewClient = client
        view.webChromeClient = chromeClient

        // Restricted to our origin: pages from a payment provider get no bridge.
        val origins = setOf(siteOrigin)
        WebViewCompat.addWebMessageListener(view, "ZeControlNative", origins) { _, message, _, isMainFrame, reply ->
            if (isMainFrame) {
                replyProxy = reply
                message.data?.let(::handleBridgeMessage)
            }
        }
        WebViewCompat.addDocumentStartJavaScript(
            view,
            assets.open("native-bridge.js").bufferedReader().use { it.readText() },
            origins,
        )
        webView = view
        root.removeAllViews()
        root.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(progress)
        installStateScript()
    }

    private fun bridgeState(): JSONObject = JSONObject().put(
        "notificationPermission",
        when {
            ReminderNotifier.canNotify(this) -> "granted"
            Build.VERSION.SDK_INT >= 33 && store.wasAskedForNotifications -> "denied"
            Build.VERSION.SDK_INT >= 33 -> "default"
            else -> "denied"
        },
    )

    /** Must be available synchronously to the website's first render. */
    private fun installStateScript() {
        val view = webView ?: return
        stateScript?.remove()
        stateScript = WebViewCompat.addDocumentStartJavaScript(
            view,
            "window.__ZE_NATIVE_STATE=${bridgeState()};",
            setOf(siteOrigin),
        )
    }

    private fun publishState() {
        installStateScript()
        replyProxy?.let { proxy ->
            runCatching {
                proxy.postMessage(JSONObject().put("type", "state").put("state", bridgeState()).toString())
            }
        }
    }

    private fun handleBridgeMessage(raw: String) {
        val message = runCatching { JSONObject(raw) }.getOrNull() ?: return
        when (message.optString("type")) {
            "clockingChanged" -> syncSoon(force = true)
            "requestNotificationPermission" -> requestNotifications()
            "notify" -> ReminderNotifier.showTest(
                this,
                message.optString("title"),
                message.optString("body"),
                ReminderNotifier.POINTAGE_PATH,
            )
            "setReminders" -> background.execute {
                setRemindersFromPage(message.optBoolean("enabled"), message.optString("profile"))
            }
            "saveFile" -> saveFile(message.optString("name"), message.optString("mime"), message.optString("base64"))
        }
    }

    private fun setRemindersFromPage(enabled: Boolean, requestedBy: String) {
        val session = ReminderController.currentSession() ?: return
        if (!enabled && requestedBy != session.profileId) return
        store.setRemindersEnabled(session.profileId, enabled)
        ReminderController.reconcile(this)
    }

    private fun syncSoon(force: Boolean = false) {
        if (background.isShutdown) return
        background.execute {
            val now = SystemClock.elapsedRealtime()
            // Opening the app triggers several page events for the same state.
            if (force || lastSyncAt == 0L || now - lastSyncAt > SYNC_SPACING_MS) {
                lastSyncAt = now
                runCatching { ReminderController.sync(this, force) }
            }
            val session = ReminderController.currentSession()
            val snapshot = store.snapshot
            mainHandler.post {
                if (session != null) syncReminderCard(session.profileId)
                if (session != null && snapshot?.profileId == session.profileId && snapshot.eligible) {
                    continueSetup()
                }
            }
        }
    }

    /** Lets the profile card reflect the native state on the page. */
    private fun syncReminderCard(profileId: String) {
        val enabled = store.remindersEnabled(profileId)
        val value = if (enabled) JSONObject.quote(profileId) else "null"
        webView?.evaluateJavascript(
            """
            (function(){ try {
              if (location.origin !== ${JSONObject.quote(siteOrigin)}) return;
              var k = "zecontrol-pwa-reminders-enabled", v = $value;
              if (v) localStorage.setItem(k, v); else localStorage.removeItem(k);
            } catch (e) {} })();
            """.trimIndent(),
            null,
        )
    }

    /**
     * Asks once for what clocking needs, right after sign-in. Asked during the
     * first clock-in, the location prompt would eat into the page's GPS timeout.
     */
    private fun continueSetup() {
        if (isFinishing) return
        when {
            Build.VERSION.SDK_INT >= 33 && !ReminderNotifier.canNotify(this) &&
                store.once(ReminderStore.FLAG_ASKED_NOTIFICATIONS) ->
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            !hasLocationPermission() && store.once(ReminderStore.FLAG_ASKED_LOCATION) ->
                locationPermission.launch(LOCATION_PERMISSIONS)
            else -> offerBatteryExemption()
        }
    }

    private fun requestNotifications() {
        if (!ReminderNotifier.canNotify(this) && Build.VERSION.SDK_INT >= 33 &&
            store.once(ReminderStore.FLAG_ASKED_NOTIFICATIONS)
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            publishState()
        }
    }

    private fun offerBatteryExemption() {
        val power = getSystemService(PowerManager::class.java)
        if (power.isIgnoringBatteryOptimizations(packageName)) return
        if (isFinishing || !store.once(ReminderStore.FLAG_ASKED_BATTERY)) return
        AlertDialog.Builder(this)
            .setTitle(R.string.battery_title)
            .setMessage(R.string.battery_message)
            .setPositiveButton(R.string.battery_accept) { _, _ ->
                @SuppressLint("BatteryLife")
                val intent = Intent(
                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:$packageName"),
                )
                runCatching { startActivity(intent) }
            }
            .setNegativeButton(R.string.later, null)
            .show()
    }

    private val client = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            if (uri.scheme == "native") {
                retry()
                return true
            }
            if (!request.isForMainFrame) return false
            if (uri.scheme == "https" && uri.host == siteUri.host) return false
            if (uri.scheme == "https" && isPaymentHost(uri.host)) return false
            if (uri.host == supabaseHost() && uri.path?.startsWith("/auth/v1/authorize") == true) {
                // Google refuses to sign in inside a WebView. Only owners use it;
                // they don't clock in, and they keep working in the browser.
                toast(getString(R.string.google_in_browser))
                openInBrowser(Uri.parse("$siteOrigin/connexion"))
                return true
            }
            openExternally(uri)
            return true
        }

        override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
            if (isSiteUrl(url)) lastSiteUrl = url
            mainHandler.removeCallbacks(showProgress)
            mainHandler.postDelayed(showProgress, SLOW_LOAD_MS)
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
            if (isSiteUrl(url)) lastSiteUrl = url
        }

        override fun onPageCommitVisible(view: WebView, url: String) {
            contentReady = true
        }

        override fun onPageFinished(view: WebView, url: String) {
            mainHandler.removeCallbacks(showProgress)
            progress.visibility = View.GONE
            contentReady = true
            CookieManager.getInstance().flush()
            showingOffline = url.startsWith(OFFLINE_URL)
            if (isSiteUrl(url)) syncSoon()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame && request.url.toString() != OFFLINE_URL) {
                showOfflinePage()
            }
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // Android reclaimed the renderer: rebuild instead of crashing the app.
            root.removeView(view)
            view.destroy()
            webView = null
            replyProxy = null
            stateScript = null
            createWebView()
            webView?.loadUrl(lastSiteUrl ?: "$siteOrigin$START_PATH")
            return true
        }
    }

    private val chromeClient = object : WebChromeClient() {
        override fun onGeolocationPermissionsShowPrompt(
            origin: String,
            callback: GeolocationPermissions.Callback,
        ) {
            if (Uri.parse(origin).host != siteUri.host) {
                callback.invoke(origin, false, false)
                return
            }
            if (hasLocationPermission()) {
                warnIfLocationOff()
                callback.invoke(origin, true, false)
                return
            }
            pendingGeolocationCallback?.invoke(pendingGeolocationOrigin, false, false)
            pendingGeolocationOrigin = origin
            pendingGeolocationCallback = callback
            locationPermission.launch(LOCATION_PERMISSIONS)
        }

        override fun onShowFileChooser(
            view: WebView,
            callback: ValueCallback<Array<Uri>>,
            params: FileChooserParams,
        ): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            fileChooser.launch("image/*")
            return true
        }
    }

    private val showProgress = Runnable { progress.visibility = View.VISIBLE }

    private fun hasLocationPermission() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun warnIfLocationOff() {
        val location = getSystemService(LocationManager::class.java)
        if (location.isLocationEnabled || isFinishing) return
        AlertDialog.Builder(this)
            .setTitle(R.string.location_off_title)
            .setMessage(R.string.location_off_message)
            .setPositiveButton(R.string.location_open_settings) { _, _ ->
                runCatching { startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)) }
            }
            .setNegativeButton(R.string.later, null)
            .show()
    }

    private fun isSiteUrl(url: String) = Uri.parse(url).host == siteUri.host

    private fun isPaymentHost(host: String?) =
        host == "paydunya.com" || host?.endsWith(".paydunya.com") == true

    private fun supabaseHost() = Uri.parse(BuildConfig.SUPABASE_URL).host

    private fun loadPath(path: String) {
        // Only ever an internal path, whatever the intent contains.
        val safe = if (path.startsWith("/") && !path.startsWith("//")) path else START_PATH
        webView?.loadUrl("$siteOrigin$safe")
    }

    private fun showOfflinePage() {
        showingOffline = true
        contentReady = true
        webView?.loadUrl(OFFLINE_URL)
    }

    private fun retry() {
        showingOffline = false
        webView?.loadUrl(lastSiteUrl ?: "$siteOrigin$START_PATH")
    }

    private fun openInBrowser(uri: Uri) {
        try {
            CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(this, uri)
        } catch (_: ActivityNotFoundException) {
            openExternally(uri)
        }
    }

    private fun openExternally(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: ActivityNotFoundException) {
            toast(getString(R.string.no_app_for_link))
        }
    }

    private fun saveFile(name: String, mime: String, base64: String) {
        background.execute {
            val safeName = File(name).name.ifBlank { "export" }
            val result = runCatching {
                val directory = File(cacheDir, "exports").apply { mkdirs() }
                directory.listFiles()?.forEach { it.delete() }
                val file = File(directory, safeName)
                file.writeBytes(Base64.decode(base64, Base64.DEFAULT))
                FileProvider.getUriForFile(this, "$packageName.files", file)
            }
            mainHandler.post {
                val uri = result.getOrNull()
                if (uri == null) {
                    toast(getString(R.string.file_failed))
                    return@post
                }
                toast(getString(R.string.file_saved, safeName))
                val view = Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, mime.substringBefore(";").ifBlank { "application/octet-stream" })
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                val share = Intent(Intent.ACTION_SEND)
                    .setType(mime.substringBefore(";").ifBlank { "application/octet-stream" })
                    .putExtra(Intent.EXTRA_STREAM, uri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                val chooser = Intent.createChooser(view, getString(R.string.file_open_with))
                    .putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(share))
                runCatching { startActivity(chooser) }
            }
        }
    }

    private fun askToUpdateWebView() {
        AlertDialog.Builder(this)
            .setTitle(R.string.webview_title)
            .setMessage(R.string.webview_message)
            .setCancelable(false)
            .setPositiveButton(R.string.webview_update) { _, _ ->
                openExternally(Uri.parse("market://details?id=com.google.android.webview"))
            }
            .show()
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.getStringExtra(EXTRA_PATH)?.let(::loadPath)
    }

    override fun onResume() {
        super.onResume()
        AppState.isInForeground = true
        webView?.onResume()
        webView?.resumeTimers()
        getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(networkCallback)
        publishState()
        val away = SystemClock.elapsedRealtime() - backgroundedAt
        if (backgroundedAt != 0L && away > STALE_PAGE_MS && !showingOffline && intent?.getStringExtra(EXTRA_PATH) == null) {
            // The page's data predates this absence; it may have changed elsewhere.
            webView?.reload()
        } else {
            syncSoon()
        }
        intent?.removeExtra(EXTRA_PATH)
    }

    override fun onPause() {
        AppState.isInForeground = false
        backgroundedAt = SystemClock.elapsedRealtime()
        runCatching {
            getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(networkCallback)
        }
        CookieManager.getInstance().flush()
        webView?.onPause()
        webView?.pauseTimers()
        // Anything the page was covering is now the notification's job.
        background.execute { runCatching { ReminderController.reconcile(this) } }
        super.onPause()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        publishState()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView?.saveState(outState)
    }

    override fun onDestroy() {
        mainHandler.removeCallbacksAndMessages(null)
        webView?.destroy()
        webView = null
        background.shutdown()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_PATH = "com.zesuite.zecontrol.PATH"
        private const val START_PATH = "/dashboard"
        private const val OFFLINE_URL = "file:///android_asset/offline.html"
        private const val SPLASH_LIMIT_MS = 3_500L
        private const val SLOW_LOAD_MS = 700L
        private const val STALE_PAGE_MS = 30 * 60_000L
        private const val SYNC_SPACING_MS = 20_000L
        private val LOCATION_PERMISSIONS = arrayOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        )
    }
}
