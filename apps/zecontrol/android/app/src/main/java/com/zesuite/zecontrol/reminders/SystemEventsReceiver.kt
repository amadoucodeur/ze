package com.zesuite.zecontrol.reminders

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlin.concurrent.thread

/** Android forgets alarms on reboot and app update; clock changes invalidate them. */
class SystemEventsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        val app = context.applicationContext
        thread(name = "zecontrol-reminder-restore") {
            try {
                ReminderController.reconcile(app)
                ReminderSyncWorker.schedule(app)
            } finally {
                pending.finish()
            }
        }
    }
}
