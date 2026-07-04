package net.customerchat.app

import android.net.Uri

object WebViewSecurity {
    private val sensitiveKeys = setOf("token", "session", "cookie", "password", "secret", "code", "setupToken")

    fun isAllowedUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        val uri = Uri.parse(url)
        val scheme = uri.scheme?.lowercase() ?: return false
        return scheme == "https" || scheme == "http"
    }

    fun sanitizeForLog(url: String?): String {
        if (url.isNullOrBlank()) return "[empty-url]"
        return try {
            val uri = Uri.parse(url)
            val builder = uri.buildUpon().clearQuery()
            val redacted = uri.queryParameterNames.joinToString("&") { key ->
                val value = if (sensitiveKeys.any { key.contains(it, ignoreCase = true) }) "[REDACTED]" else uri.getQueryParameter(key).orEmpty()
                "${key}=${value}"
            }
            if (redacted.isBlank()) builder.build().toString() else builder.encodedQuery(redacted).build().toString()
        } catch (_: Exception) {
            "[invalid-url]"
        }
    }
}
