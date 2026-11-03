package com.zesuite.zecontrol.reminders

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max

/**
 * Offline port of `currentWorkPolicyReminder` (lib/work-policy-evaluation.ts).
 *
 * For a shift within one calendar day the output is identical to the website,
 * which `ReminderParityTest` enforces against fixtures generated from the
 * TypeScript source. Unlike the website, overnight shifts are evaluated against
 * the day they started on, and a departure forgotten on a previous day also
 * produces a reminder.
 */
data class ClockEvent(val type: String, val pointedAtMs: Long)

data class DaySchedule(val startTime: String, val endTime: String, val breakMinutes: Int)

data class ReminderSettings(
    val enabled: Boolean = true,
    val arrivalEnabled: Boolean = true,
    val breakDueEnabled: Boolean = true,
    val breakEndEnabled: Boolean = true,
    val departureEnabled: Boolean = true,
    val followUpEnabled: Boolean = true,
    val warningPercent: Double = 85.0,
    val arrivalLeadMinutes: Double = 60.0,
    val repeatMinutes: Double = 15.0,
)

data class WorkPolicy(
    val mode: String,
    val days: Set<Int>,
    val startTime: String,
    val endTime: String,
    val daySchedules: Map<String, DaySchedule>,
    val breakMinutes: Int,
    val toleranceMinutes: Int,
    val minimumBreakAfterMinutes: Int,
    val reminders: ReminderSettings,
) {
    fun scheduleFor(weekday: Int): DaySchedule? {
        if (weekday !in days || mode == "attendance") return null
        return daySchedules[weekday.toString()]
            ?: DaySchedule(startTime, endTime, breakMinutes)
    }
}

data class Snapshot(
    val profileId: String,
    val timeZone: String,
    /** ISO date → resolved policy. A date present with `null` has no policy. */
    val policies: Map<String, WorkPolicy?>,
    val events: List<ClockEvent>,
    val pendingClosureDays: Set<String> = emptySet(),
    val eligible: Boolean = true,
    val eventsFetchedAtMs: Long = 0,
    val policiesFetchedAtMs: Long = 0,
)

enum class ReminderCategory { ARRIVAL, DEPARTURE, PAUSE_END, PAUSE_DUE, DAY_OPEN, PREVIOUS_DAY }

data class Reminder(
    val workDate: String,
    val key: String,
    val category: ReminderCategory,
    val title: String,
    val message: String,
) {
    val deliveryId: String get() = "$workDate|$key"
}

object ReminderEngine {
    private const val DAY = 24 * 60
    private const val MINUTE_MS = 60_000L
    private const val NIGHT_FOLLOW_UP_MINUTES = 6 * 60
    private const val PREVIOUS_DAY_LOOKBACK = 3L
    private const val PREVIOUS_DAY_LATEST_MINUTE = 8 * 60
    private val frenchDay = DateTimeFormatter.ofPattern("d MMMM", Locale.FRENCH)

    private fun minutesOf(value: String): Int {
        val parts = value.split(":")
        return parts[0].toInt() * 60 + parts[1].toInt()
    }

    private fun isOvernight(schedule: DaySchedule) =
        minutesOf(schedule.endTime) <= minutesOf(schedule.startTime)

    /** Everything the employee should be told about at `nowMs`. */
    fun due(snapshot: Snapshot, nowMs: Long): List<Reminder> {
        if (!snapshot.eligible) return emptyList()
        return listOfNotNull(previousDayReminder(snapshot, nowMs), shiftReminder(snapshot, nowMs))
    }

    /** First minute after `nowMs` at which a not yet delivered reminder appears. */
    fun nextFireAt(
        snapshot: Snapshot,
        nowMs: Long,
        delivered: Set<String>,
        horizonMinutes: Int = 36 * 60,
    ): Long? {
        if (!snapshot.eligible) return null
        val firstMinute = (nowMs / MINUTE_MS + 1) * MINUTE_MS
        for (step in 0 until horizonMinutes) {
            val candidate = firstMinute + step * MINUTE_MS
            if (due(snapshot, candidate).any { it.deliveryId !in delivered }) return candidate
        }
        return null
    }

    private fun shiftReminder(snapshot: Snapshot, nowMs: Long): Reminder? {
        val zone = ZoneId.of(snapshot.timeZone)
        val local = Instant.ofEpochMilli(nowMs).atZone(zone)
        val today = local.toLocalDate()
        val minutes = local.hour * 60 + local.minute

        val yesterday = today.minusDays(1)
        val yesterdayPolicy = snapshot.policies[yesterday.toString()]
        val yesterdaySchedule = yesterdayPolicy?.takeIf { it.mode == "fixed" }
            ?.scheduleFor(yesterday.dayOfWeek.value)
        if (yesterdayPolicy != null && yesterdaySchedule != null && isOvernight(yesterdaySchedule)) {
            // The shift which began yesterday evening, then its departure
            // follow-ups for as long as it stays open.
            val events = eventsBetween(snapshot, yesterday, today, zone, nowMs)
            val todayStart = snapshot.policies[today.toString()]
                ?.takeIf { it.mode == "fixed" }
                ?.scheduleFor(today.dayOfWeek.value)
                ?.let { minutesOf(it.startTime) }
                ?: DAY
            val rawEnd = minutesOf(yesterdaySchedule.endTime)
            val followingUp = events.lastOrNull()?.let { it.type != "end" } == true &&
                minutes < minOf(todayStart, rawEnd + NIGHT_FOLLOW_UP_MINUTES)
            if (minutes <= rawEnd || followingUp) {
                return evaluate(
                    yesterdayPolicy, yesterdaySchedule, events, nowMs, minutes + DAY, yesterday.toString(),
                )
            }
        }

        if (!snapshot.policies.containsKey(today.toString())) return null
        val events = eventsBetween(snapshot, today, today, zone, nowMs)
        val policy = snapshot.policies[today.toString()]
            ?: return fallback(events, nowMs, today.toString())
        if (policy.mode != "fixed") return null
        val schedule = policy.scheduleFor(today.dayOfWeek.value) ?: return null
        return evaluate(policy, schedule, events, nowMs, minutes, today.toString())
    }

    private fun eventsBetween(
        snapshot: Snapshot,
        first: LocalDate,
        last: LocalDate,
        zone: ZoneId,
        nowMs: Long,
    ): List<ClockEvent> {
        val from = first.atStartOfDay(zone).toInstant().toEpochMilli()
        val until = last.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
        return snapshot.events
            .filter { it.pointedAtMs in from until until && it.pointedAtMs <= nowMs }
            .sortedBy { it.pointedAtMs }
    }

    private fun workedMinutes(events: List<ClockEvent>, nowMs: Long): Int {
        var openedAt: Long? = null
        var worked = 0L
        for (event in events) {
            when (event.type) {
                "start", "resume" -> openedAt = event.pointedAtMs
                "break", "end" -> {
                    openedAt?.let { worked += max(0, event.pointedAtMs - it) }
                    openedAt = null
                }
            }
        }
        if (openedAt != null && events.lastOrNull()?.type != "end") {
            worked += max(0, nowMs - openedAt!!)
        }
        return (worked / MINUTE_MS).toInt()
    }

    private fun repeatedKey(prefix: String, overdue: Int, repeat: Double, followUp: Boolean): String {
        if (!followUp || overdue < 5) return "$prefix-100"
        return "$prefix-overdue-${floor((overdue - 5) / max(1.0, repeat)).toInt()}"
    }

    private fun percentLabel(value: Double) =
        if (value == floor(value)) value.toInt().toString() else value.toString()

    private fun evaluate(
        policy: WorkPolicy,
        schedule: DaySchedule,
        events: List<ClockEvent>,
        nowMs: Long,
        currentMinutes: Int,
        workDate: String,
    ): Reminder? {
        val settings = policy.reminders
        if (!settings.enabled) return null
        fun reminder(key: String, category: ReminderCategory, title: String, message: String) =
            Reminder(workDate, key, category, title, message)

        val last = events.lastOrNull()
        val start = minutesOf(schedule.startTime)
        val rawEnd = minutesOf(schedule.endTime)
        val end = if (rawEnd <= start) rawEnd + DAY else rawEnd

        if (last == null && currentMinutes < end && settings.arrivalEnabled) {
            val windowStart = start - settings.arrivalLeadMinutes
            val reminderAt = windowStart +
                ceil(settings.arrivalLeadMinutes * (settings.warningPercent / 100))
            if (currentMinutes >= reminderAt && currentMinutes < start) {
                return reminder(
                    "arrival-warning-${percentLabel(settings.warningPercent)}",
                    ReminderCategory.ARRIVAL,
                    "Votre service commence bientôt",
                    "Pensez à pointer votre arrivée. Il reste ${start - currentMinutes} min avant ${schedule.startTime}.",
                )
            }
            if (currentMinutes >= start) {
                val elapsed = currentMinutes - start
                val toleranceLeft = max(0, policy.toleranceMinutes - elapsed)
                return reminder(
                    repeatedKey("arrival", elapsed, settings.repeatMinutes, settings.followUpEnabled),
                    ReminderCategory.ARRIVAL,
                    if (elapsed == 0) "C’est l’heure de commencer"
                    else "Arrivée non pointée depuis $elapsed min",
                    if (toleranceLeft > 0) "Pointez votre arrivée. Il reste $toleranceLeft min de tolérance."
                    else "Pointez dès votre arrivée. Le retard restera simplement visible dans votre journée.",
                )
            }
            return null
        }

        if (last == null || last.type == "end") return null

        if (currentMinutes >= end && settings.departureEnabled) {
            val overdue = currentMinutes - end
            return reminder(
                repeatedKey("departure", overdue, settings.repeatMinutes, settings.followUpEnabled),
                ReminderCategory.DEPARTURE,
                if (overdue == 0) "C’est l’heure de terminer"
                else "Départ non pointé depuis $overdue min",
                "Si votre journée est terminée, pensez à pointer votre départ.",
            )
        }

        if (last.type == "break" && schedule.breakMinutes > 0 && settings.breakEndEnabled) {
            val elapsed = max(0L, (nowMs - last.pointedAtMs) / MINUTE_MS).toInt()
            val remaining = max(0, schedule.breakMinutes - elapsed)
            val overdue = max(0, elapsed - schedule.breakMinutes)
            if (elapsed < ceil(schedule.breakMinutes * (settings.warningPercent / 100))) return null
            if (remaining > 0) {
                return reminder(
                    "pause-end-warning-${percentLabel(settings.warningPercent)}",
                    ReminderCategory.PAUSE_END,
                    "Votre pause se termine bientôt",
                    "$remaining min restantes sur les ${schedule.breakMinutes} min autorisées.",
                )
            }
            return reminder(
                repeatedKey("pause-end", overdue, settings.repeatMinutes, settings.followUpEnabled),
                ReminderCategory.PAUSE_END,
                if (overdue > 0) "Pause dépassée de $overdue min"
                else "Votre temps de pause est atteint",
                "Pensez à pointer votre reprise lorsque vous recommencez.",
            )
        }

        val hasBreak = events.any { it.type == "break" }
        val breakDueAt = policy.minimumBreakAfterMinutes
        if (
            !hasBreak && breakDueAt > 0 && settings.breakDueEnabled &&
            (last.type == "start" || last.type == "resume")
        ) {
            val worked = workedMinutes(events, nowMs)
            if (worked < ceil(breakDueAt * (settings.warningPercent / 100))) return null
            if (worked < breakDueAt) {
                return reminder(
                    "pause-due-warning-${percentLabel(settings.warningPercent)}",
                    ReminderCategory.PAUSE_DUE,
                    "Votre pause approche",
                    "Encore ${breakDueAt - worked} min avant la pause prévue.",
                )
            }
            val overdue = worked - breakDueAt
            return reminder(
                repeatedKey("pause-due", overdue, settings.repeatMinutes, settings.followUpEnabled),
                ReminderCategory.PAUSE_DUE,
                if (overdue > 0) "Pause attendue depuis $overdue min"
                else "C’est le moment de prendre votre pause",
                "Une pause de ${schedule.breakMinutes} min est prévue. Pointez-la lorsque vous vous arrêtez.",
            )
        }
        return null
    }

    /** Same safety net as `fallbackClockingReminder` when no policy applies. */
    private fun fallback(events: List<ClockEvent>, nowMs: Long, workDate: String): Reminder? {
        val last = events.lastOrNull() ?: return null
        val elapsed = ((nowMs - last.pointedAtMs) / MINUTE_MS).toInt()
        if (last.type == "break" && elapsed >= 60) {
            return Reminder(
                workDate, "fallback-resume", ReminderCategory.PAUSE_END,
                "Pause en cours depuis $elapsed min",
                "Pensez à enregistrer votre reprise lorsque vous recommencez.",
            )
        }
        if ((last.type == "start" || last.type == "resume") && elapsed >= 10 * 60) {
            return Reminder(
                workDate, "fallback-finish-day", ReminderCategory.DAY_OPEN,
                "Votre journée est toujours ouverte",
                "Si vous avez terminé, pensez à enregistrer votre départ.",
            )
        }
        return null
    }

    /**
     * A departure forgotten on a previous day. It mirrors the website's
     * `previousOpenClockingDay`, except an overnight shift closed after midnight
     * is not reported as forgotten.
     */
    private fun previousDayReminder(snapshot: Snapshot, nowMs: Long): Reminder? {
        val zone = ZoneId.of(snapshot.timeZone)
        val local = Instant.ofEpochMilli(nowMs).atZone(zone)
        val today = local.toLocalDate()
        val minutes = local.hour * 60 + local.minute
        val todayStart = today.atStartOfDay(zone).toInstant().toEpochMilli()

        val todayPolicy = snapshot.policies[today.toString()]
        val todaySchedule = todayPolicy?.takeIf { it.mode == "fixed" }
            ?.scheduleFor(today.dayOfWeek.value)
        val fireAt = if (todaySchedule != null) {
            minOf(PREVIOUS_DAY_LATEST_MINUTE, max(0, minutesOf(todaySchedule.startTime) - 15))
        } else {
            PREVIOUS_DAY_LATEST_MINUTE
        }
        if (minutes < fireAt) return null

        val sorted = snapshot.events.filter { it.pointedAtMs <= nowMs }.sortedBy { it.pointedAtMs }
        val lastBeforeToday = sorted.lastOrNull { it.pointedAtMs < todayStart } ?: return null
        if (lastBeforeToday.type == "end") return null

        val day = Instant.ofEpochMilli(lastBeforeToday.pointedAtMs).atZone(zone).toLocalDate()
        if (day.isBefore(today.minusDays(PREVIOUS_DAY_LOOKBACK))) return null
        if (day.toString() in snapshot.pendingClosureDays) return null

        val policy = snapshot.policies[day.toString()]
        if (snapshot.policies.containsKey(day.toString())) {
            if (policy != null && (!policy.reminders.enabled || !policy.reminders.departureEnabled)) {
                return null
            }
        }
        val schedule = policy?.takeIf { it.mode == "fixed" }?.scheduleFor(day.dayOfWeek.value)
        if (schedule != null && isOvernight(schedule)) {
            val next = sorted.firstOrNull { it.pointedAtMs > lastBeforeToday.pointedAtMs }
            if (next?.type == "end") return null
            val nightEnd = day.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli() +
                (minutesOf(schedule.endTime) + NIGHT_FOLLOW_UP_MINUTES) * MINUTE_MS
            if (nowMs <= nightEnd) return null
        }

        return Reminder(
            day.toString(),
            "previous-departure",
            ReminderCategory.PREVIOUS_DAY,
            "Départ oublié le ${day.format(frenchDay)}",
            "Votre journée n’a pas été clôturée. Vous pourrez renseigner ce départ juste après avoir pointé votre arrivée.",
        )
    }
}
