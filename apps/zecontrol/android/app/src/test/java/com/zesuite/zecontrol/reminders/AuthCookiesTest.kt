package com.zesuite.zecontrol.reminders

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test
import java.util.Base64

class AuthCookiesTest {
    private fun b64(value: String) =
        Base64.getUrlEncoder().withoutPadding().encodeToString(value.toByteArray())

    private val token = "${b64("""{"alg":"HS256"}""")}.${b64("""{"sub":"11111111-2222-3333-4444-555555555555"}""")}.sig"
    private val session = JSONObject()
        .put("access_token", token)
        .put("refresh_token", "refresh")
        .put("expires_at", 1_800_000_000L)
        .toString()

    @Test
    fun readsTheBase64CookieWrittenBySupabaseSsr() {
        val parsed = AuthCookies.parse("other=1; sb-abc-auth-token=base64-${b64(session)}; last=2")!!
        assertEquals("11111111-2222-3333-4444-555555555555", parsed.profileId)
        assertEquals(token, parsed.accessToken)
        assertEquals(1_800_000_000_000L, parsed.expiresAtMs)
    }

    @Test
    fun reassemblesChunksInNumericOrderWhateverTheirPosition() {
        val value = "base64-${b64(session)}"
        val pieces = value.chunked(20)
        val header = pieces.withIndex().reversed()
            .joinToString("; ") { (index, piece) -> "sb-abc-auth-token.$index=$piece" }
        assertEquals(token, AuthCookies.parse(header)!!.accessToken)
        assertTrue(pieces.size > 10)
    }

    @Test
    fun readsAUrlEncodedCookie() {
        val encoded = java.net.URLEncoder.encode(session, "UTF-8")
        assertEquals(token, AuthCookies.parse("sb-abc-auth-token=$encoded")!!.accessToken)
    }

    @Test
    fun ignoresAnonymousOrCorruptedCookies() {
        assertNull(AuthCookies.parse(null))
        assertNull(AuthCookies.parse("theme=dark"))
        assertNull(AuthCookies.parse("sb-abc-auth-token=base64-not-json"))
        assertNull(AuthCookies.parse("sb-abc-auth-token-code-verifier=abc"))
    }

    @Test
    fun anUnreadableCookieIsNotMistakenForASignOut() {
        assertTrue(AuthCookies.isPresent("a=1; sb-abc-auth-token=corrupted"))
        assertTrue(AuthCookies.isPresent("sb-abc-auth-token.0=part"))
        assertFalse(AuthCookies.isPresent("theme=dark"))
        assertFalse(AuthCookies.isPresent("sb-abc-auth-token-code-verifier=abc"))
        assertFalse(AuthCookies.isPresent(null))
    }

    @Test
    fun treatsASessionCloseToExpiryAsExpired() {
        val parsed = AuthCookies.parse("sb-abc-auth-token=base64-${b64(session)}")!!
        assertTrue(parsed.isExpired(1_800_000_000_000L - 30_000))
        assertFalse(parsed.isExpired(1_800_000_000_000L - 120_000))
    }
}
