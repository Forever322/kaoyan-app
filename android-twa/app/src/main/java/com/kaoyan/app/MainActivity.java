package com.kaoyan.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.net.http.SslError;

/**
 * 考研择校助手 - WebView 容器
 * 加载打包在 assets/ 中的本地网页（无需网络）
 */
public class MainActivity extends Activity {
    private static final String TAG = "KaoyanApp";
    private static final String APP_URL = "file:///android_asset/index.html";
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );

        try {
            webView = new WebView(this);
            setContentView(webView);

            // ===== WebView 核心设置 =====
            WebSettings s = webView.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setDatabaseEnabled(true);

            // 允许 file:// 协议下加载本地 CSS/JS/图片
            s.setAllowFileAccess(true);
            s.setAllowFileAccessFromFileURLs(true);
            s.setAllowUniversalAccessFromFileURLs(true);
            s.setAllowContentAccess(true);

            s.setCacheMode(WebSettings.LOAD_DEFAULT);
            s.setUseWideViewPort(true);
            s.setLoadWithOverviewMode(true);
            s.setSupportZoom(false);
            s.setBuiltInZoomControls(false);
            s.setDisplayZoomControls(false);
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            s.setDefaultTextEncodingName("utf-8");
            s.setSaveFormData(true);
            s.setLoadsImagesAutomatically(true);

            String ua = s.getUserAgentString();
            s.setUserAgentString(ua + " KaoyanApp/3.0");

            // ===== WebViewClient =====
            webView.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageStarted(WebView view, String url, Bitmap favicon) {
                    Log.d(TAG, "onPageStarted: " + url);
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    Log.d(TAG, "onPageFinished: " + url);
                }

                @Override
                public void onReceivedError(WebView view, WebResourceRequest request,
                                            WebResourceError error) {
                    if (request.isForMainFrame()) {
                        Log.e(TAG, "Main frame error: " + error.getDescription());
                        String html = "<!DOCTYPE html><html><head>"
                            + "<meta charset='utf-8'>"
                            + "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                            + "</head><body style='padding:40px;font-family:sans-serif;text-align:center;'>"
                            + "<h2>加载失败</h2><p>请重新打开应用</p></body></html>";
                        view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
                    } else {
                        Log.w(TAG, "Sub-resource error (ignored): " + request.getUrl());
                    }
                }

                @Override
                public void onReceivedSslError(WebView view, SslErrorHandler handler,
                                               SslError error) {
                    String host = Uri.parse(error.getUrl()).getHost();
                    if (host != null && (host.contains("github") || host.contains("kaoyan"))) {
                        handler.proceed();
                    } else {
                        handler.cancel();
                    }
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    Uri uri = request.getUrl();
                    String scheme = uri.getScheme();
                    String host = uri.getHost();
                    if ("file".equals(scheme) || host == null
                            || host.contains("kaoyan") || host.contains("github")) {
                        return false;
                    }
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (Exception e) {
                        Log.w(TAG, "No browser for: " + uri);
                    }
                    return true;
                }
            });

            // ===== WebChromeClient：JS 控制台日志 =====
            webView.setWebChromeClient(new WebChromeClient() {
                @Override
                public boolean onConsoleMessage(ConsoleMessage msg) {
                    Log.d(TAG, "JS [" + msg.messageLevel() + "]: " + msg.message());
                    return true;
                }
            });

            // 加载本地页面
            if (savedInstanceState != null) {
                webView.restoreState(savedInstanceState);
            } else {
                webView.loadUrl(APP_URL);
            }

        } catch (Exception e) {
            Log.e(TAG, "Fatal error in onCreate", e);
            try {
                startActivity(new Intent(Intent.ACTION_VIEW,
                    Uri.parse("https://forever322.github.io/kaoyan-app/")));
            } catch (Exception ex) {
                Log.e(TAG, "Fallback also failed", ex);
            }
            finish();
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView != null && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    protected void onRestoreInstanceState(Bundle savedInstanceState) {
        super.onRestoreInstanceState(savedInstanceState);
        if (webView != null) webView.restoreState(savedInstanceState);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
