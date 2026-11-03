package com.zesuite.zecontrol.reminders

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlin.concurrent.thread

/** A reminder moment arrived: check against fresh data, then decide locally. */
class ReminderAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        val app = context.applicationContext
        thread(name = "zecontrol-reminder-alarm") {
            try {
                // A clock event made elsewhere must not trigger a false reminder.
                // On failure, sync still falls back to the stored snapshot.
                ReminderController.sync(app, quick = true)
            } catch (_: Exception) {
                runCatching { ReminderController.reconcile(app) }
            } finally {
                pending.finish()
            }
        }
    }
}
