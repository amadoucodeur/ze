package com.zesuite.zecontrol.reminders

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneOffset

class ReminderEngineTest {
    private fun ms(date: String, time: String) =
        LocalDate.parse(date).atTime(java.time.LocalTime.parse(time)).toInstant(ZoneOffset.UTC).toEpochMilli()

    private fun policy(
        start: String = "08:00",
        end: String = "17:00",
        days: Set<Int> = (1..7).toSet(),
        reminders: ReminderSettings = ReminderSettings(),
        mode: String = "fixed",
    ) = WorkPolicy(mode, days, start, end, emptyMap(), 60, 10, 360, reminders)

    private fun snapshot(
        events: List<ClockEvent>,
        policies: Map<String, WorkPolicy?>,
        closures: Set<String> = emptySet(),
    ) = Snapshot("p", "Africa/Abidjan", policies, events, closures)

    private fun week(policy: WorkPolicy?) =
        (1L..10L).associate { LocalDate.parse("2026-11-01").plusDays(it).toString() to policy }

    @Test
    fun overnightShiftGivesNoFalseArrivalAlertAtThreeInTheMorning() {
        val events = listOf(ClockEvent("start", ms("2026-11-03", "22:00")))
        val due = ReminderEngine.due(snapshot(events, week(policy("22:00", "06:00"))), ms("2026-11-04", "03:00"))
        assertTrue(due.toString(), due.none { it.category == ReminderCategory.ARRIVAL })
    }

    @Test
    fun overnightShiftRemindsAForgottenDepartureInTheMorning() {
        val events = listOf(ClockEvent("start", ms("2026-11-03", "22:00")))
        val due = ReminderEngine.due(snapshot(events, week(policy("22:00", "06:00"))), ms("2026-11-04", "06:00"))
        val departure = due.single { it.category == ReminderCategory.DEPARTURE }
        assertEquals("2026-11-03", departure.workDate)
        assertEquals("C’est l’heure de terminer", departure.title)
    }

    @Test
    fun overnightShiftOnADayFollowedByADayOffStillClosesInTheMorning() {
        val friday = policy("22:00", "06:00")
        val policies = mapOf("2026-11-06" to friday, "2026-11-07" to policy(days = emptySet()))
        val events = listOf(ClockEvent("start", ms("2026-11-06", "22:00")))
        val due = ReminderEngine.due(snapshot(events, policies), ms("2026-11-07", "06:10"))
        assertEquals(ReminderCategory.DEPARTURE, due.single().category)
    }

    @Test
    fun overnightDepartureFollowUpsRepeatThenHandOverToThePreviousDayReminder() {
        val events = listOf(ClockEvent("start", ms("2026-11-03", "22:00")))
        val data = snapshot(events, week(policy("22:00", "06:00")))
        val followUp = ReminderEngine.due(data, ms("2026-11-04", "08:00")).single()
        assertEquals(ReminderCategory.DEPARTURE, followUp.category)
        assertEquals("Départ non pointé depuis 120 min", followUp.title)
        val later = ReminderEngine.due(data, ms("2026-11-04", "12:30")).single()
        assertEquals(ReminderCategory.PREVIOUS_DAY, later.category)
        assertEquals("Départ oublié le 3 novembre", later.title)
    }

    @Test
    fun overnightFollowUpsNeverOverlapTheNextShift() {
        val events = listOf(ClockEvent("start", ms("2026-11-03", "20:00")))
        val policies = mapOf(
            "2026-11-03" to policy("20:00", "04:00"),
            "2026-11-04" to policy("09:00", "17:00"),
        )
        val due = ReminderEngine.due(snapshot(events, policies), ms("2026-11-04", "09:30"))
        assertTrue(due.toString(), due.none { it.category == ReminderCategory.DEPARTURE })
        assertTrue(due.toString(), due.any { it.category == ReminderCategory.ARRIVAL })
    }

    @Test
    fun overnightShiftClosedAfterMidnightIsNotAForgottenDeparture() {
        val events = listOf(
            ClockEvent("start", ms("2026-11-03", "22:00")),
            ClockEvent("end", ms("2026-11-04", "06:01")),
        )
        val due = ReminderEngine.due(snapshot(events, week(policy("22:00", "06:00"))), ms("2026-11-04", "12:00"))
        assertTrue(due.toString(), due.isEmpty())
    }

    @Test
    fun forgottenDepartureIsReportedTheNextMorningOnlyOnce() {
        val events = listOf(ClockEvent("start", ms("2026-11-03", "08:00")))
        val data = snapshot(events, week(policy()))
        assertTrue(ReminderEngine.due(data, ms("2026-11-04", "07:00")).isEmpty())
        val reminder = ReminderEngine.due(data, ms("2026-11-04", "07:45")).single()
        assertEquals(ReminderCategory.PREVIOUS_DAY, reminder.category)
        assertEquals("Départ oublié le 3 novembre", reminder.title)
        // Once delivered, nothing is repeated before today's own arrival reminder.
        val next = ReminderEngine.nextFireAt(data, ms("2026-11-04", "07:45"), setOf(reminder.deliveryId))
        assertEquals(ms("2026-11-04", "07:51"), next)
    }

    @Test
    fun aPendingClosureRequestSilencesTheForgottenDeparture() {
        val events = listOf(ClockEvent("start", ms("2026-11-03", "08:00")))
        val due = ReminderEngine.due(
            snapshot(events, week(policy()), setOf("2026-11-03")),
            ms("2026-11-04", "07:45"),
        )
        assertTrue(due.isEmpty())
    }

    @Test
    fun anOldForgottenDepartureStopsBeingReported() {
        val events = listOf(ClockEvent("start", ms("2026-11-03", "08:00")))
        val due = ReminderEngine.due(
            snapshot(events, week(policy(days = emptySet()))),
            ms("2026-11-08", "09:00"),
        )
        assertTrue(due.isEmpty())
    }

    @Test
    fun adminDisablingDepartureRemindersAlsoSilencesForgottenDays() {
        val settings = ReminderSettings(departureEnabled = false)
        val events = listOf(ClockEvent("start", ms("2026-11-03", "08:00")))
        val due = ReminderEngine.due(
            snapshot(events, week(policy(reminders = settings, days = emptySet()))),
            ms("2026-11-04", "09:00"),
        )
        assertTrue(due.isEmpty())
    }

    @Test
    fun plansTheExactMinuteOfTheNextReminder() {
        val data = snapshot(emptyList(), week(policy()))
        // Default settings: 85% of a 60 minute lead, so nine minutes before the shift.
        assertEquals(ms("2026-11-04", "07:51"), ReminderEngine.nextFireAt(data, ms("2026-11-04", "06:00"), emptySet()))
    }

    @Test
    fun clockingInMovesThePlanFromArrivalToBreak() {
        val data = snapshot(listOf(ClockEvent("start", ms("2026-11-04", "07:58"))), week(policy()))
        val next = ReminderEngine.nextFireAt(data, ms("2026-11-04", "08:00"), emptySet())
        // Default settings: 85% of 360 worked minutes after 07:58.
        assertEquals(ms("2026-11-04", "13:04"), next)
    }

    @Test
    fun aFinishedDayPlansNothingBeforeTomorrow() {
        val events = listOf(
            ClockEvent("start", ms("2026-11-04", "08:00")),
            ClockEvent("end", ms("2026-11-04", "17:00")),
        )
        val data = snapshot(events, week(policy()))
        assertEquals(ms("2026-11-05", "07:51"), ReminderEngine.nextFireAt(data, ms("2026-11-04", "17:00"), emptySet()))
    }

    @Test
    fun withoutPolicyTheSafetyNetRemindsAnOpenDay() {
        val events = listOf(ClockEvent("start", ms("2026-11-04", "08:00")))
        val due = ReminderEngine.due(snapshot(events, mapOf("2026-11-04" to null)), ms("2026-11-04", "18:30"))
        assertEquals("Votre journée est toujours ouverte", due.single().title)
    }

    @Test
    fun anIneligibleProfileIsNeverReminded() {
        val data = snapshot(emptyList(), week(policy())).copy(eligible = false)
        assertTrue(ReminderEngine.due(data, ms("2026-11-04", "09:00")).isEmpty())
        assertNull(ReminderEngine.nextFireAt(data, ms("2026-11-04", "06:00"), emptySet()))
    }

    @Test
    fun snapshotSurvivesStorageUnchanged() {
        val original = snapshot(
            listOf(ClockEvent("start", ms("2026-11-04", "08:00"))),
            mapOf(
                "2026-11-04" to policy().copy(
                    daySchedules = mapOf("3" to DaySchedule("09:00", "12:00", 15)),
                    reminders = ReminderSettings(warningPercent = 70.0, repeatMinutes = 7.0),
                ),
                "2026-11-05" to null,
            ),
            setOf("2026-11-03"),
        )
        assertEquals(original, SnapshotJson.decode(SnapshotJson.encode(original)))
        assertNull(SnapshotJson.decode("corrupted"))
    }
}
