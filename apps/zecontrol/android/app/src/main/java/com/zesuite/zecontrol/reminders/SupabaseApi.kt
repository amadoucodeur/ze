package com.zesuite.zecontrol.reminders

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

class ApiException(val status: Int) : IOException("HTTP $status")

data class Identity(val eligible: Boolean, val timeZone: String)

/**
 * Read-only access for the signed-in employee, through the same RLS-protected
 * tables and RPC as `PwaLifecycle`. No business rule is decided here.
 */
class SupabaseApi(
    private val baseUrl: String,
    private val publishableKey: String,
    private val accessToken: String,
    private val timeoutMs: Int = 8_000,
) {
    private fun request(path: String, schema: String?, body: String? = null): String {
        val connection = URL("$baseUrl$path").openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = timeoutMs
            connection.readTimeout = timeoutMs
            connection.setRequestProperty("apikey", publishableKey)
            connection.setRequestProperty("Authorization", "Bearer $accessToken")
            connection.setRequestProperty("Accept", "application/json")
            if (schema != null) connection.setRequestProperty("Accept-Profile", schema)
            if (body != null) {
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                if (schema != null) connection.setRequestProperty("Content-Profile", schema)
                connection.outputStream.use { it.write(body.toByteArray()) }
            }
            val status = connection.responseCode
            if (status !in 200..299) throw ApiException(status)
            return connection.inputStream.bufferedReader().use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }

    private fun encode(value: String) = URLEncoder.encode(value, "UTF-8")

    fun recentEvents(profileId: String): List<ClockEvent> {
        val rows = JSONArray(
            request(
                "/rest/v1/events?select=type,pointed_at" +
                    "&profile_id=eq.${encode(profileId)}" +
                    "&event_status=in.(accepted,pending)" +
                    "&order=pointed_at.desc&limit=60",
                "zecontrol",
            ),
        )
        return (0 until rows.length()).map {
            val row = rows.getJSONObject(it)
            ClockEvent(row.getString("type"), parseInstant(row.getString("pointed_at")))
        }.sortedBy { it.pointedAtMs }
    }

    fun pendingClosureDays(profileId: String, timeZone: String): Set<String> {
        val rows = JSONArray(
            request(
                "/rest/v1/event_change_requests?select=requested_pointed_at" +
                    "&profile_id=eq.${encode(profileId)}" +
                    "&request_kind=eq.missing_event&requested_type=eq.end&status=eq.pending",
                "zecontrol",
            ),
        )
        val zone = ZoneId.of(timeZone)
        return (0 until rows.length()).map {
            Instant.ofEpochMilli(parseInstant(rows.getJSONObject(it).getString("requested_pointed_at")))
                .atZone(zone).toLocalDate().toString()
        }.toSet()
    }

    fun policyFor(profileId: String, date: LocalDate): WorkPolicy? {
        val body = JSONObject()
            .put("target_profile_id", profileId)
            .put("target_work_date", date.toString())
            .toString()
        val response = request("/rest/v1/rpc/resolve_work_policy", "zecontrol", body).trim()
        if (response.isEmpty() || response == "null") return null
        return SnapshotJson.policyFromDefinition(JSONObject(response).optJSONObject("definition"))
    }

    companion object {
        const val DEFAULT_TIME_ZONE = "Africa/Abidjan"

        /** Answer of the website's `/api/notifications/context`. */
        fun parseIdentity(body: String): Identity {
            val json = JSONObject(body)
            val timeZone = json.optString("timeZone")
                .takeIf { it.isNotBlank() && it != "null" && runCatching { ZoneId.of(it) }.isSuccess }
                ?: DEFAULT_TIME_ZONE
            return Identity(json.optBoolean("eligible", false), timeZone)
        }

        /** PostgREST timestamps such as `2026-11-03T08:00:12.34+00:00`. */
        fun parseInstant(value: String): Long =
            java.time.OffsetDateTime.parse(value.replace(" ", "T")).toInstant().toEpochMilli()
    }
}
