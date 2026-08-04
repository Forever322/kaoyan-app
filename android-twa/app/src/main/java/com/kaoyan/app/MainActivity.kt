package com.kaoyan.app

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView

/**
 * 考研择校助手 - WebView 容器（Kotlin + Jetpack Compose）
 * 加载打包在 assets/ 中的本地网页（无需网络）
 *
 * 全屏沉浸样式由 res/values/themes.xml 中的 AppTheme 统一声明，
 * 无需在代码中手动设置窗口标志。
 */
class MainActivity : ComponentActivity() {

    private var webView: WebView? = null
    private var webViewState: Bundle? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            // 进程被杀重建时，Compose 的 savedInstanceState 不会自动流入 remember，
            // 因此显式注入 Activity 恢复的 WebView 状态。
            val restoredState = remember { savedInstanceState }
            WebViewHolder(
                restoredState = restoredState,
                onWebViewReady = { webView = it },
            )
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView?.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        // WebView 的实际销毁交给 Compose 的 DisposableEffect；
        // 仅断开 Activity 对实例的引用，避免重复 destroy。
        webView = null
        super.onDestroy()
    }
}

/** 应用品牌色：深海军蓝（与 Web 端 --color-bg 一致） */
private val BrandBackground = Color(0xFF071525)

private const val TAG = "KaoyanApp"
private const val APP_URL = "file:///android_asset/index.html"
private const val FALLBACK_URL = "https://forever322.github.io/kaoyan-app/"

@Composable
private fun WebViewHolder(
    restoredState: Bundle?,
    onWebViewReady: (WebView) -> Unit,
) {
    val context = LocalContext.current
    val webView = remember { createWebView(context, restoredState, onWebViewReady) }
    val backDispatcherOwner = LocalOnBackPressedDispatcherOwner.current

    DisposableEffect(webView) {
        // 返回键：优先在 WebView 历史记录内后退
        val backCallback = object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    backDispatcherOwner?.onBackPressedDispatcher?.onBackPressed()
                }
            }
        }
        backDispatcherOwner?.onBackPressedDispatcher?.addCallback(backCallback)

        onDispose {
            backCallback.remove()
            webView.destroy()
        }
    }

    AndroidView(
        factory = { webView },
        modifier = Modifier
            .fillMaxSize()
            .background(BrandBackground),
    )
}

@SuppressLint("SetJavaScriptEnabled")
private fun createWebView(
    context: android.content.Context,
    savedInstanceState: Bundle?,
    onWebViewReady: (WebView) -> Unit,
): WebView {
    // 在 Compose 外一次性构建 WebView 并完成全部配置，随后交给 AndroidView 挂入窗口。
    val webView = WebView(context)

    try {
        // ===== WebView 核心设置 =====
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true

            // 允许 file:// 协议下加载本地 CSS/JS/图片
            allowFileAccess = true
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = true
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = true
            allowContentAccess = true

            cacheMode = WebSettings.LOAD_DEFAULT
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            defaultTextEncodingName = "utf-8"
            saveFormData = true
            loadsImagesAutomatically = true

            userAgentString = "$userAgentString KaoyanApp/${BuildConfig.VERSION_NAME}"
        }

        // ===== WebViewClient =====
        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                Log.d(TAG, "onPageStarted: $url")
            }

            override fun onPageFinished(view: WebView, url: String) {
                Log.d(TAG, "onPageFinished: $url")
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError?,
            ) {
                if (request.isForMainFrame) {
                    Log.e(TAG, "Main frame error: ${error?.description}")
                    val html = "<!DOCTYPE html><html><head>" +
                        "<meta charset='utf-8'>" +
                        "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
                        "</head><body style='padding:40px;font-family:sans-serif;text-align:center;'>" +
                        "<h2>加载失败</h2><p>请重新打开应用</p></body></html>"
                    view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
                } else {
                    Log.w(TAG, "Sub-resource error (ignored): ${request.url}")
                }
            }

            override fun onReceivedSslError(
                view: WebView,
                handler: SslErrorHandler,
                error: SslError,
            ) {
                val host = Uri.parse(error.url)?.host
                if (host != null && (host.contains("github") || host.contains("kaoyan"))) {
                    handler.proceed()
                } else {
                    handler.cancel()
                }
            }

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                val uri = request.url
                val scheme = uri.scheme
                val host = uri.host
                if ("file" == scheme || host == null ||
                    host.contains("kaoyan") || host.contains("github")
                ) {
                    return false
                }
                return try {
                    view.context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                    true
                } catch (e: Exception) {
                    Log.w(TAG, "No browser for: $uri")
                    true
                }
            }
        }

        // ===== WebChromeClient：JS 控制台日志 =====
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                Log.d(TAG, "JS [${msg.messageLevel()}]: ${msg.message()}")
                return true
            }
        }

        // 清除旧缓存，确保加载最新本地文件
        webView.clearCache(true)

        // 加载本地页面
        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            webView.loadUrl(APP_URL)
        }

        onWebViewReady(webView)
    } catch (e: Exception) {
        Log.e(TAG, "Fatal error in createWebView", e)
        try {
            webView.context.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse(FALLBACK_URL))
            )
        } catch (ex: Exception) {
            Log.e(TAG, "Fallback also failed", ex)
        }
        // WebView 的 context 即宿主 Activity，致命错误时关闭
        (webView.context as? android.app.Activity)?.finish()
    }

    return webView
}
