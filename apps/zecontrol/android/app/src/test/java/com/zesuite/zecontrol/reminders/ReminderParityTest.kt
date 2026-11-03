package com.zesuite.zecontrol.reminders

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.zip.GZIPInputStream

/** The Kotlin engine must answer exactly like the website, minute by minute. */
class ReminderParityTest {
    @Test
    fun matchesTheWebsiteForEveryMinuteOfEveryScenario() {
        val text = GZIPInputStream(javaClass.classLoader!!.getResourceAsStream("reminder-parity.json.gz")!!)
            .bufferedReader().readText()
        val fixtures = JSONObject(text)
        val day = fixtures.getString("day")
        val cases = fixtures.getJSONArray("cases")
        assertTrue(cases.length() > 200)
        var compared = 0
        for (index in 0 until cases.length()) {
            val scenario = cases.getJSONObject(index)
            val name = scenario.getString("name")
            val policy = SnapshotJson.policyFromDefinition(scenario.getJSONObject("definition"))!!
            val eventsJson = scenario.getJSONArray("events")
            val allEvents = (0 until eventsJson.length()).map {
                val event = eventsJson.getJSONObject(it)
                ClockEvent(event.getString("type"), event.getLong("at"))
            }
            val expected = mutableMapOf<Int, List<String>>()
            scenario.getJSONArray("expected").let { rows ->
                for (row in 0 until rows.length()) {
                    val value = rows.getJSONArray(row)
                    expected[value.getInt(0)] = listOf(value.getString(1), value.getString(2), value.getString(3))
                }
            }
            val startMs = scenario.getLong("startMs")
            for (minute in 0 until 24 * 60) {
                val nowMs = startMs + minute * 60_000L + 17_000L
                val snapshot = Snapshot(
                    profileId = "p",
                    timeZone = scenario.getString("timeZone"),
                    policies = mapOf(day to policy),
                    events = allEvents,
                )
                val actual = ReminderEngine.due(snapshot, nowMs).firstOrNull()
                    ?.let { listOf(it.key, it.title, it.message) }
                assertEquals("$name at minute $minute", expected[minute], actual)
                compared++
            }
        }
        println("compared $compared minutes")
    }
}
