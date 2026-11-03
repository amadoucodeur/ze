package com.zesuite.zecontrol

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Base64
import android.webkit.CookieManager
import com.zesuite.zecontrol.reminders.ReminderController
import com.zesuite.zecontrol.reminders.ReminderStore
import com.zesuite.zecontrol.reminders.SnapshotJson

/** Debug builds only: loads a schedule from adb to test real alarms on a device. */
class DebugSnapshotReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        intent.getStringExtra("cookie")?.let {
            CookieManager.getInstance().setCookie(BuildConfig.SITE_URL, it)
            CookieManager.getInstance().flush()
        }
        val encoded = intent.getStringExtra("snapshot") ?: return
        val snapshot = SnapshotJson.decode(String(Base64.decode(encoded, Base64.DEFAULT))) ?: return
        val store = ReminderStore(context)
        store.clearDelivered()
        store.snapshot = snapshot
        ReminderController.reconcile(context)
    }
}
