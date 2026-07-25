package com.kaoyan.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.net.http.SslError;

public class MainActivity extends Activity {
    private WebView webView;
    // 加载本地打包的页面（不依赖网络）
    private static final String APP_URL = "file:///android_asset/index.html";
    private static final String TAG = "KaoyanApp";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            webView = new WebView(this);
            setContentView(webView);

            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setAllowFileAccess(true);
            settings.setCacheMode(WebSettings.LOAD_DEFAULT);
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);
            settings.setSupportZoom(false);
            settings.setBuiltInZoomControls(false);
            settings.setDisplayZoomControls(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            settings.setDefaultTextEncodingName("utf-8");
            settings.setAllowContentAccess(false);
            settings.setSaveFormData(true);
            settings.setLoadsImagesAutomatically(true);
            String ua = settings.getUserAgentString();
            settings.setUserAgentString(ua + " KaoyanApp/2.0");

            webView.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageStarted(WebView view, String url, Bitmap favicon) {
                    Log.d(TAG, "Page started: " + url);
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    Log.d(TAG, "Page finished: " + url);
                }

                @Override
                public void onReceivedError(WebView view, WebResourceRequest request,
                                            WebResourceError error) {
                    // 只处理主框架错误，忽略图片/JS等子资源错误
                    if (request.isForMainFrame()) {
                        Log.e(TAG, "Main frame error: " + error.getDescription());
                        String errorHtml = "<html><body style='padding:40px;font-family:sans-serif;text-align:center;'>"
                            + "<h2>加载失败</h2><p>请检查网络后重试</p></body></html>";
                        view.loadDataWithBaseURL(null, errorHtml, "text/html", "UTF-8", null);
                    } else {
                        Log.w(TAG, "Sub-resource error (ignored): " + request.getUrl());
                    }
                }

                @Override
                public void onReceivedSslError(WebView view, SslErrorHandler handler,
                                               SslError error) {
                    // 仅对已知域名忽略SSL错误
                    String host = Uri.parse(error.getUrl()).getHost();
                    if (host != null && (host.contains("github") || host.contains("kaoyan"))) {
                        handler.proceed();
                    } else {
                        handler.cancel();
                    }
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    String url = request.getUrl().toString();
                    Uri uri = request.getUrl();
                    String host = uri.getHost();
                    String scheme = uri.getScheme();
                    // 本地文件、GitHub Pages等在WebView内打开
                    if (host == null || "file".equals(scheme)
                            || host.contains("kaoyan") || host.contains("github")) {
                        return false;
                    }
                    // 外部链接用系统浏览器打开
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                        startActivity(intent);
                    } catch (Exception e) {
                        Log.w(TAG, "No browser for: " + url);
                    }
                    return true;
                }
            });

            webView.setWebChromeClient(new WebChromeClient());

            if (savedInstanceState != null) {
                webView.restoreState(savedInstanceState);
            } else {
                webView.loadUrl(APP_URL);
            }

        } catch (Exception e) {
            Log.e(TAG, "Fatal onCreate error", e);
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW,
                    Uri.parse("https://forever322.github.io/kaoyan-app/"));
                startActivity(intent);
                finish();
            } catch (Exception ex) {
                Log.e(TAG, "Fallback also failed", ex);
            }
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
        if (webView != null) {
            webView.saveState(outState);
        }
    }

    @Override
    protected void onRestoreInstanceState(Bundle savedInstanceState) {
        super.onRestoreInstanceState(savedInstanceState);
        if (webView != null) {
            webView.restoreState(savedInstanceState);
        }
    }
}
