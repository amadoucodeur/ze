package com.zesuite.zecontrol.reminders

import org.json.JSONArray
import org.json.JSONObject

/** JSON mapping for server payloads and for the snapshot stored on the device. */
object SnapshotJson {
    /** Mirrors `isWorkPolicyDefinition`: anything else is treated as no policy. */
    fun policyFromDefinition(definition: JSONObject?): WorkPolicy? {
        if (definition == null) return null
        return runCatching {
            val mode = definition.getString("mode")
            if (mode !in setOf("fixed", "flexible", "attendance")) return null
            val daysJson = definition.getJSONArray("days")
            val days = (0 until daysJson.length()).map { daysJson.getInt(it) }.toSet()
            val schedules = mutableMapOf<String, DaySchedule>()
            definition.optJSONObject("daySchedules")?.let { json ->
                for (key in json.keys()) {
                    val value = json.getJSONObject(key)
                    schedules[key] = DaySchedule(
                        value.getString("startTime"),
                        value.getString("endTime"),
                        value.getInt("breakMinutes"),
                    )
                }
            }
            WorkPolicy(
                mode = mode,
                days = days,
                startTime = definition.getString("startTime"),
                endTime = definition.getString("endTime"),
                daySchedules = schedules,
                breakMinutes = definition.getInt("breakMinutes"),
                toleranceMinutes = definition.getInt("toleranceMinutes"),
                minimumBreakAfterMinutes = definition.getInt("minimumBreakAfterMinutes"),
                reminders = settingsFrom(definition.optJSONObject("reminders")),
            )
        }.getOrNull()
    }

    private fun settingsFrom(json: JSONObject?): ReminderSettings {
        val base = ReminderSettings()
        if (json == null) return base
        return ReminderSettings(
            enabled = json.optBoolean("enabled", base.enabled),
            arrivalEnabled = json.optBoolean("arrivalEnabled", base.arrivalEnabled),
            breakDueEnabled = json.optBoolean("breakDueEnabled", base.breakDueEnabled),
            breakEndEnabled = json.optBoolean("breakEndEnabled", base.breakEndEnabled),
            departureEnabled = json.optBoolean("departureEnabled", base.departureEnabled),
            followUpEnabled = json.optBoolean("followUpEnabled", base.followUpEnabled),
            warningPercent = json.optDouble("warningPercent", base.warningPercent),
            arrivalLeadMinutes = json.optDouble("arrivalLeadMinutes", base.arrivalLeadMinutes),
        )
    }

    private fun policyToDefinition(policy: WorkPolicy) = JSONObject().apply {
        put("mode", policy.mode)
        put("days", JSONArray(policy.days.toList()))
        put("startTime", policy.startTime)
        put("endTime", policy.endTime)
        put("breakMinutes", policy.breakMinutes)
        put("toleranceMinutes", policy.toleranceMinutes)
        put("minimumBreakAfterMinutes", policy.minimumBreakAfterMinutes)
        put("daySchedules", JSONObject().apply {
            policy.daySchedules.forEach { (day, schedule) ->
                put(day, JSONObject().apply {
                    put("startTime", schedule.startTime)
                    put("endTime", schedule.endTime)
                    put("breakMinutes", schedule.breakMinutes)
                })
            }
        })
        put("reminders", JSONObject().apply {
            val settings = policy.reminders
            put("enabled", settings.enabled)
            put("arrivalEnabled", settings.arrivalEnabled)
            put("breakDueEnabled", settings.breakDueEnabled)
            put("breakEndEnabled", settings.breakEndEnabled)
            put("departureEnabled", settings.departureEnabled)
            put("followUpEnabled", settings.followUpEnabled)
            put("warningPercent", settings.warningPercent)
            put("arrivalLeadMinutes", settings.arrivalLeadMinutes)
        })
    }

    fun encode(snapshot: Snapshot): String = JSONObject().apply {
        put("profileId", snapshot.profileId)
        put("timeZone", snapshot.timeZone)
        put("eligible", snapshot.eligible)
        put("eventsFetchedAtMs", snapshot.eventsFetchedAtMs)
        put("policiesFetchedAtMs", snapshot.policiesFetchedAtMs)
        put("pendingClosureDays", JSONArray(snapshot.pendingClosureDays.toList()))
        put("events", JSONArray().apply {
            snapshot.events.forEach { event ->
                put(JSONObject().apply {
                    put("type", event.type)
                    put("at", event.pointedAtMs)
                })
            }
        })
        put("policies", JSONObject().apply {
            snapshot.policies.forEach { (date, policy) ->
                put(date, policy?.let(::policyToDefinition) ?: JSONObject.NULL)
            }
        })
    }.toString()

    fun decode(value: String): Snapshot? = runCatching {
        val json = JSONObject(value)
        val policies = mutableMapOf<String, WorkPolicy?>()
        json.getJSONObject("policies").let { map ->
            for (date in map.keys()) policies[date] = policyFromDefinition(map.optJSONObject(date))
        }
        val events = json.getJSONArray("events").let { array ->
            (0 until array.length()).map {
                val event = array.getJSONObject(it)
                ClockEvent(event.getString("type"), event.getLong("at"))
            }
        }
        val closures = json.getJSONArray("pendingClosureDays").let { array ->
            (0 until array.length()).map { array.getString(it) }.toSet()
        }
        Snapshot(
            profileId = json.getString("profileId"),
            timeZone = json.getString("timeZone"),
            policies = policies,
            events = events,
            pendingClosureDays = closures,
            eligible = json.optBoolean("eligible", true),
            eventsFetchedAtMs = json.optLong("eventsFetchedAtMs"),
            policiesFetchedAtMs = json.optLong("policiesFetchedAtMs"),
        )
    }.getOrNull()
}
