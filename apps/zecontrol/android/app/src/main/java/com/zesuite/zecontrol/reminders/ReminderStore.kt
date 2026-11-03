package com.zesuite.zecontrol.reminders

import android.content.Context
import java.time.LocalDate

/** Device state. Holds schedules and clock events, never authentication tokens. */
class ReminderStore(context: Context) {
    private val prefs = context.applicationContext
        .getSharedPreferences("zecontrol_reminders", Context.MODE_PRIVATE)

    var snapshot: Snapshot?
        get() = prefs.getString(KEY_SNAPSHOT, null)?.let(SnapshotJson::decode)
        set(value) {
            prefs.edit().apply {
                if (value == null) remove(KEY_SNAPSHOT) else putString(KEY_SNAPSHOT, SnapshotJson.encode(value))
            }.commit()
        }

    val delivered: Set<String>
        get() = prefs.getStringSet(KEY_DELIVERED, emptySet()).orEmpty().toSet()

    fun markDelivered(ids: Collection<String>, today: LocalDate) {
        val oldest = today.minusDays(5).toString()
        val kept = delivered.filter { it.substringBefore("|") >= oldest }
        prefs.edit().putStringSet(KEY_DELIVERED, (kept + ids).toSet()).commit()
    }

    fun clearDelivered() {
        prefs.edit().remove(KEY_DELIVERED).commit()
    }

    /** Reminders stay on unless this employee turned them off on this device. */
    fun remindersEnabled(profileId: String?): Boolean =
        profileId == null || !prefs.getStringSet(KEY_DISABLED, emptySet()).orEmpty().contains(profileId)

    fun setRemindersEnabled(profileId: String, enabled: Boolean) {
        val current = prefs.getStringSet(KEY_DISABLED, emptySet()).orEmpty().toMutableSet()
        if (enabled) current.remove(profileId) else current.add(profileId)
        prefs.edit().putStringSet(KEY_DISABLED, current).commit()
    }

    fun once(flag: String): Boolean {
        if (prefs.getBoolean(flag, false)) return false
        prefs.edit().putBoolean(flag, true).apply()
        return true
    }

    val wasAskedForNotifications: Boolean
        get() = prefs.getBoolean(FLAG_ASKED_NOTIFICATIONS, false)

    companion object {
        const val FLAG_ASKED_NOTIFICATIONS = "asked_notifications"
        const val FLAG_ASKED_LOCATION = "asked_location"
        const val FLAG_ASKED_BATTERY = "asked_battery"
        private const val KEY_SNAPSHOT = "snapshot"
        private const val KEY_DELIVERED = "delivered"
        private const val KEY_DISABLED = "disabled_profiles"
    }
}
