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
    // GitHub Pages URL - accessible from China
    private static final String APP_URL = "https://forever322.github.io/kaoyan-app/";
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
            settings.setAllowFileAccess(false);
            settings.setCacheMode(WebSettings.LOAD_DEFAULT);
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);
            settings.setSupportZoom(false);
            settings.setBuiltInZoomControls(false);
            settings.setDisplayZoomControls(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            // Fix garbled Chinese characters
            settings.setDefaultTextEncodingName("utf-8");
            settings.setBlockNetworkImage(false);
            settings.setAllowContentAccess(false);
            settings.setSaveFormData(true);
            settings.setLoadsImagesAutomatically(true);
            settings.setBlockNetworkImage(false);
            String ua = settings.getUserAgentString();
            settings.setUserAgentString(ua + " KaoyanApp/1.0");

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
                    Log.e(TAG, "Error: " + error.getDescription() + " for " + request.getUrl());
                    // Show error page
                    String errorHtml = "<html><body style='padding:40px;font-family:sans-serif;text-align:center;'>"
                        + "<h2>加载失败</h2>"
                        + "<p>" + error.getDescription() + "</p>"
                        + "<p>请检查网络连接后下拉刷新</p>"
                        + "</body></html>";
                    view.loadDataWithBaseURL(null, errorHtml, "text/html", "UTF-8", null);
                }

                @Override
                public void onReceivedSslError(WebView view, SslErrorHandler handler,
                                               SslError error) {
                    Log.e(TAG, "SSL Error: " + error.toString());
                    // Vercel uses valid SSL, but if there's an issue, still proceed
                    handler.proceed();
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    String url = request.getUrl().toString();
                    Uri uri = request.getUrl();
                    String host = uri.getHost();
                    if (host != null && (host.contains("vercel.app") || host.contains("kaoyan"))) {
                        return false;
                    }
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                        startActivity(intent);
                    } catch (Exception e) {
                        Log.w(TAG, "No browser found for: " + url);
                    }
                    return true;
                }
            });

            webView.setWebChromeClient(new WebChromeClient() {
                @Override
                public void onProgressChanged(WebView view, int newProgress) {
                    Log.d(TAG, "Progress: " + newProgress);
                }
            });

            if (savedInstanceState != null) {
                webView.restoreState(savedInstanceState);
            } else {
                webView.loadUrl(APP_URL);
            }

        } catch (Exception e) {
            Log.e(TAG, "Fatal error in onCreate", e);
            // Fallback: if WebView fails entirely, try opening in browser
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(APP_URL));
                startActivity(intent);
                finish();
            } catch (Exception ex) {
                Log.e(TAG, "Cannot even open browser", ex);
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
