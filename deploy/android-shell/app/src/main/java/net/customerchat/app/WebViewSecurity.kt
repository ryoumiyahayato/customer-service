package net.customerchat.app

import android.net.Uri

object WebViewSecurity {
    private val sensitiveKeys = setOf(
        "token",
        "session",
        "cookie",
        "password",
        "secret",
        "code",
        "key",
        "setupToken",
        "SETUP_TOKEN",
        "ENCRYPTION_KEY",
    )
    private val developmentHosts = setOf("localhost", "127.0.0.1", "10.0.2.2", "::1")

    private fun effectivePort(uri: Uri): Int = when {
        uri.port != -1 -> uri.port
        uri.scheme.equals("https", ignoreCase = true) -> 443
        else -> 80
    }

    private fun sameOrigin(candidate: Uri, configured: Uri): Boolean =
        candidate.scheme.equals(configured.scheme, ignoreCase = true) &&
            candidate.host.equals(configured.host, ignoreCase = true) &&
            effectivePort(candidate) == effectivePort(configured)

    fun isAllowedUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        val uri = Uri.parse(url)
        val scheme = uri.scheme?.lowercase() ?: return false
        val host = uri.host?.lowercase() ?: return false
        if (uri.userInfo != null || uri.fragment != null) return false
        if (uri.queryParameterNames.any { key -> sensitiveKeys.any { key.contains(it, ignoreCase = true) } }) return false

        if (scheme == "http") return host in developmentHosts
        if (scheme != "https") return false

        val admin = Uri.parse(AppConfig.adminUrl)
        val visitor = Uri.parse(AppConfig.visitorRootUrl)
        val visitorHost = visitor.host?.lowercase() ?: return false
        val visitorOrigin = sameOrigin(uri, visitor)
        val visitorSubdomain = uri.scheme.equals(visitor.scheme, ignoreCase = true) &&
            host.endsWith(".$visitorHost") && effectivePort(uri) == effectivePort(visitor)
        return sameOrigin(uri, admin) || visitorOrigin || visitorSubdomain
    }

    fun sanitizeForLog(url: String?): String {
        if (url.isNullOrBlank()) return "[empty-url]"
        return try {
            val uri = Uri.parse(url)
            val scheme = uri.scheme?.lowercase() ?: return "[invalid-url]"
            val host = uri.host ?: return "[invalid-url]"
            val displayHost = if (host.contains(':')) "[$host]" else host
            val port = if (uri.port == -1) "" else ":${uri.port}"
            val path = uri.encodedPath.orEmpty()
            val query = if (uri.encodedQuery.isNullOrBlank()) "" else "?[REDACTED]"
            "$scheme://$displayHost$port$path$query"
        } catch (_: Exception) {
            "[invalid-url]"
        }
    }
}
