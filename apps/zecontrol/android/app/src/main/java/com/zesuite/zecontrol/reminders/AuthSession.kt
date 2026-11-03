package com.zesuite.zecontrol.reminders

import org.json.JSONObject
import java.net.URLDecoder
import java.util.Base64

data class AuthSession(val accessToken: String, val profileId: String, val expiresAtMs: Long) {
    fun isExpired(nowMs: Long, marginMs: Long = 60_000) = nowMs >= expiresAtMs - marginMs
}

/**
 * Reads the session @supabase/ssr stores in cookies: `sb-<ref>-auth-token`,
 * possibly split into `.0`, `.1`… chunks, with an optional `base64-` prefix.
 * The tokens are never persisted anywhere but the WebView cookie jar.
 */
object AuthCookies {
    private val cookieName = Regex("^sb-[^=]+-auth-token(?:\\.(\\d+))?$")

    /** True when a session cookie exists, even one this version cannot read. */
    fun isPresent(cookieHeader: String?): Boolean =
        cookieHeader.orEmpty().split(";").any { part ->
            cookieName.matches(part.substringBefore("=").trim())
        }

    fun parse(cookieHeader: String?): AuthSession? {
        if (cookieHeader.isNullOrBlank()) return null
        val chunks = cookieHeader.split(";")
            .mapNotNull { part ->
                val index = part.indexOf('=')
                if (index <= 0) return@mapNotNull null
                val match = cookieName.matchEntire(part.substring(0, index).trim())
                    ?: return@mapNotNull null
                (match.groupValues[1].toIntOrNull() ?: -1) to part.substring(index + 1).trim()
            }
            .sortedBy { it.first }
        if (chunks.isEmpty()) return null
        return runCatching {
            val joined = chunks.joinToString("") { it.second }
            val json = JSONObject(
                if (joined.startsWith("base64-")) {
                    String(Base64.getUrlDecoder().decode(joined.removePrefix("base64-")))
                } else {
                    URLDecoder.decode(joined, "UTF-8")
                },
            )
            val token = json.getString("access_token")
            AuthSession(token, subject(token), json.getLong("expires_at") * 1000)
        }.getOrNull()
    }

    private fun subject(token: String): String {
        val payload = token.split(".")[1]
        return JSONObject(String(Base64.getUrlDecoder().decode(payload))).getString("sub")
    }
}
