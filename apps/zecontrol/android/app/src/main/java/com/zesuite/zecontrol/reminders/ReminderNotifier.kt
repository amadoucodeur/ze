package com.zesuite.zecontrol.reminders

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.zesuite.zecontrol.MainActivity
import com.zesuite.zecontrol.R

object ReminderNotifier {
    private const val CHANNEL_ID = "clocking_reminders"
    const val POINTAGE_PATH = "/dashboard/pointage"

    fun ensureChannel(context: Context) {
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.reminder_channel_name),
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = context.getString(R.string.reminder_channel_description)
            enableVibration(true)
            lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
        }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    fun canNotify(context: Context): Boolean {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (!manager.areNotificationsEnabled()) return false
        return android.os.Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(
            context, Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
    }

    /** One slot per category: a follow-up replaces the previous message. */
    private fun notificationId(category: ReminderCategory) = 1000 + category.ordinal

    fun show(context: Context, reminder: Reminder): Boolean =
        post(context, notificationId(reminder.category), reminder.title, reminder.message, POINTAGE_PATH)

    fun showTest(context: Context, title: String, body: String, path: String): Boolean =
        post(context, 900, title, body, path)

    fun showSessionLost(context: Context): Boolean = post(
        context,
        901,
        context.getString(R.string.session_lost_title),
        context.getString(R.string.session_lost_message),
        "/connexion",
    )

    private fun post(context: Context, id: Int, title: String, body: String, path: String): Boolean {
        if (!canNotify(context)) return false
        ensureChannel(context)
        val intent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(MainActivity.EXTRA_PATH, path)
        val pending = PendingIntent.getActivity(
            context, id, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ContextCompat.getColor(context, R.color.brand_teal))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .addAction(0, context.getString(R.string.reminder_action_clock), pending)
            .build()
        return runCatching {
            context.getSystemService(NotificationManager::class.java).notify(id, notification)
        }.isSuccess
    }

    /** Removes messages which no longer apply, such as an arrival now clocked. */
    fun retainOnly(context: Context, stillDue: Set<ReminderCategory>) {
        val manager = context.getSystemService(NotificationManager::class.java)
        ReminderCategory.entries
            .filter { it !in stillDue }
            .forEach { manager.cancel(notificationId(it)) }
    }
}
