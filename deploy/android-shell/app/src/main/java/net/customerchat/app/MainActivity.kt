package net.customerchat.app

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebSettings
import android.widget.Toast

class MainActivity : Activity() {
    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.setSupportMultipleWindows(false)
            settings.safeBrowsingEnabled = true
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val url = request.url.toString()
                    return if (WebViewSecurity.isAllowedUrl(url)) {
                        false
                    } else {
                        Toast.makeText(this@MainActivity, R.string.blocked_url, Toast.LENGTH_SHORT).show()
                        true
                    }
                }

                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) {
                        Toast.makeText(this@MainActivity, R.string.load_error, Toast.LENGTH_LONG).show()
                    }
                }
            }
        }

        setContentView(webView)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        val startUrl = if (intent.getStringExtra("startMode") == "visitor") AppConfig.visitorRootUrl else AppConfig.adminUrl
        if (WebViewSecurity.isAllowedUrl(startUrl)) {
            webView.loadUrl(startUrl)
        } else {
            Toast.makeText(this, R.string.invalid_start_url, Toast.LENGTH_LONG).show()
        }
    }

    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
