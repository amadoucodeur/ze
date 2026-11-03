package com.zesuite.zecontrol.reminders

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.time.LocalDate
import kotlin.concurrent.thread

/** Exercises real HTTP against a PostgREST-shaped server. */
class SupabaseApiTest {
    private lateinit var server: ServerSocket
    private val seen = java.util.Collections.synchronizedList(mutableListOf<Map<String, String?>>())
    private val responses = mutableMapOf<String, Pair<Int, String>>()

    @Before
    fun start() {
        server = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
        thread(isDaemon = true) {
            while (!server.isClosed) {
                val socket = runCatching { server.accept() }.getOrNull() ?: break
                socket.use(::answer)
            }
        }
    }

    private fun answer(socket: Socket) {
        val input = socket.getInputStream().bufferedReader()
        val (method, target) = input.readLine().split(" ")
        val headers = generateSequence { input.readLine() }
            .takeWhile { it.isNotEmpty() }
            .associate { it.substringBefore(":").lowercase() to it.substringAfter(":").trim() }
        val length = headers["content-length"]?.toInt() ?: 0
        val requestBody = CharArray(length).also { input.read(it, 0, length) }.concatToString()
        val path = target.substringBefore("?")
        seen += mapOf(
            "path" to path,
            "query" to java.net.URLDecoder.decode(target.substringAfter("?", ""), "UTF-8"),
            "method" to method,
            "apikey" to headers["apikey"],
            "auth" to headers["authorization"],
            "accept" to headers["accept-profile"],
            "content" to headers["content-profile"],
            "body" to requestBody,
        )
        val (status, body) = responses[path] ?: (404 to "{}")
        val bytes = body.toByteArray()
        socket.getOutputStream().apply {
            write("HTTP/1.1 $status X\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
            write(bytes)
            flush()
        }
    }

    @After
    fun stop() = server.close()

    private fun api() = SupabaseApi("http://127.0.0.1:${server.localPort}", "publishable", "token")

    @Test
    fun readsEventsThroughTheZeControlSchemaOldestFirst() {
        responses["/rest/v1/events"] = 200 to """[
            {"type":"break","pointed_at":"2026-11-04T12:00:00.5+00:00"},
            {"type":"start","pointed_at":"2026-11-04T08:00:00+00:00"}
        ]"""
        val events = api().recentEvents("user")
        assertEquals(listOf("start", "break"), events.map { it.type })
        val request = seen.single()
        assertEquals("zecontrol", request["accept"])
        assertEquals("publishable", request["apikey"])
        assertEquals("Bearer token", request["auth"])
        assertTrue(request["query"]!!.contains("event_status=in.(accepted,pending)"))
        assertTrue(request["query"]!!.contains("profile_id=eq.user"))
    }

    @Test
    fun resolvesThePolicyWithTheSameRpcAsTheWebsite() {
        responses["/rest/v1/rpc/resolve_work_policy"] = 200 to """{"definition":{
            "mode":"fixed","days":[1,2,3],"startTime":"08:00","endTime":"17:00","daySchedules":{},
            "weeklyTargetMinutes":2400,"breakMinutes":60,"toleranceMinutes":10,"roundingMinutes":0,
            "overtimeEnabled":true,"overtimeApprovalRequired":true,"minimumRestMinutes":660,
            "minimumBreakAfterMinutes":360}}"""
        val policy = api().policyFor("user", LocalDate.parse("2026-11-04"))!!
        assertEquals(setOf(1, 2, 3), policy.days)
        assertEquals(true, policy.reminders.enabled)
        val request = seen.single()
        assertEquals("POST", request["method"])
        assertEquals("zecontrol", request["content"])
        assertTrue(request["body"]!!.contains("\"target_work_date\":\"2026-11-04\""))
    }

    @Test
    fun aDayWithoutPolicyIsNotAnError() {
        responses["/rest/v1/rpc/resolve_work_policy"] = 200 to "null"
        assertNull(api().policyFor("user", LocalDate.parse("2026-11-04")))
    }

    @Test
    fun readsTheIdentityAnsweredByTheWebsite() {
        val identity = SupabaseApi.parseIdentity("""{"profileId":"p","eligible":true,"timeZone":"Europe/Paris"}""")
        assertTrue(identity.eligible)
        assertEquals("Europe/Paris", identity.timeZone)
        assertFalse(SupabaseApi.parseIdentity("""{"profileId":"p","eligible":false,"timeZone":null}""").eligible)
    }

    @Test
    fun anInvalidTimeZoneFallsBackInsteadOfBreakingReminders() {
        val identity = SupabaseApi.parseIdentity("""{"eligible":true,"timeZone":"Mars/Olympus"}""")
        assertEquals("Africa/Abidjan", identity.timeZone)
    }

    @Test
    fun aRejectedPolicyRequestIsReportedWithItsStatus() {
        responses["/rest/v1/rpc/resolve_work_policy"] = 400 to """{"code":"42703"}"""
        val error = assertThrows(ApiException::class.java) {
            api().policyFor("user", LocalDate.parse("2026-11-04"))
        }
        assertEquals(400, error.status)
    }

    @Test
    fun anExpiredTokenIsReportedAndNotReadAsAnEmptyDay() {
        responses["/rest/v1/events"] = 401 to """{"message":"JWT expired"}"""
        val error = assertThrows(ApiException::class.java) { api().recentEvents("user") }
        assertEquals(401, error.status)
    }
}
