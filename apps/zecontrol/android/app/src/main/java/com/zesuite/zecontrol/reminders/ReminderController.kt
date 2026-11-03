package com.zesuite.zecontrol.reminders

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import android.webkit.CookieManager
import com.zesuite.zecontrol.AppState
import com.zesuite.zecontrol.BuildConfig
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.ZoneId
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Keeps the local reminder plan up to date.
 *
 * Reminders are decided on the device from the last known snapshot, so one still
 * fires without a network. The network only makes the snapshot fresher.
 */
object ReminderController {
    private const val TAG = "ZeControlReminders"
    private const val POLICY_MAX_AGE_MS = 6 * 60 * 60_000L
    private const val POLICY_DAYS_BEHIND = 3L
    private const val POLICY_DAYS_AHEAD = 13L
    private const val QUIET_SYNC_INTERVAL_MS = 6 * 60 * 60_000L
    private const val BUSY_WINDOW_MINUTES = 2 * 60

    private val lock = ReentrantLock()

    enum class SyncResult { UPDATED, SIGNED_OUT, UNAVAILABLE }

    fun currentSession(): AuthSession? = when (val state = readSession()) {
        is SessionState.Active -> state.session
        else -> null
    }

    private sealed interface SessionState {
        data class Active(val session: AuthSession) : SessionState
        data object SignedOut : SessionState
        /** Not a sign-out: the known schedule must survive this. */
        data object Unreadable : SessionState
    }

    private fun readSession(): SessionState = try {
        val header = CookieManager.getInstance().getCookie(BuildConfig.SITE_URL)
        val session = AuthCookies.parse(header)
        when {
            session != null -> SessionState.Active(session)
            AuthCookies.isPresent(header) -> SessionState.Unreadable
            else -> SessionState.SignedOut
        }
    } catch (_: Exception) {
        // For example while Android System WebView is being updated.
        SessionState.Unreadable
    }

    /**
     * Refreshes the snapshot, then replans.
     *
     * `force` is for moments which need current data, such as a new clock event.
     * `quick` is for an alarm: Android limits its time, so it only rereads clock
     * events and never risks losing the reminder to a long refresh.
     */
    fun sync(context: Context, force: Boolean = false, quick: Boolean = false): SyncResult = lock.withLock {
        val app = context.applicationContext
        val store = ReminderStore(app)
        val nowMs = System.currentTimeMillis()

        var session = when (val state = readSession()) {
            is SessionState.Active -> state.session
            SessionState.SignedOut -> return signedOut(app, store)
            SessionState.Unreadable -> {
                reconcile(app)
                return SyncResult.UNAVAILABLE
            }
        }

        if (session.isExpired(nowMs)) {
            // While the page is on screen, it renews its own session. Renewing
            // from two places could burn the rotating refresh token.
            if (AppState.isInForeground || (!force && !worthRenewing(store, nowMs))) {
                reconcile(app)
                return SyncResult.UNAVAILABLE
            }
            if (!renewThroughWebsite()) {
                reconcile(app)
                return SyncResult.UNAVAILABLE
            }
            session = when (val state = readSession()) {
                is SessionState.Active -> state.session
                SessionState.SignedOut -> return signedOut(app, store)
                SessionState.Unreadable -> {
                    reconcile(app)
                    return SyncResult.UNAVAILABLE
                }
            }
            if (session.isExpired(System.currentTimeMillis())) {
                reconcile(app)
                return SyncResult.UNAVAILABLE
            }
        }

        val result = runCatching {
            val known = store.snapshot?.takeIf { it.profileId == session.profileId && it.eligible }
            if (quick && known != null) refreshEvents(store, known, session, nowMs)
            else refresh(store, session, nowMs)
        }
        result.exceptionOrNull()?.let { Log.w(TAG, "sync failed: ${it.javaClass.simpleName}") }
        reconcile(app)
        return if (result.isSuccess) SyncResult.UPDATED else SyncResult.UNAVAILABLE
    }

    private fun refreshEvents(store: ReminderStore, known: Snapshot, session: AuthSession, nowMs: Long) {
        val api = SupabaseApi(BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_KEY, session.accessToken, 4_000)
        store.snapshot = known.copy(
            events = api.recentEvents(session.profileId),
            pendingClosureDays = api.pendingClosureDays(session.profileId, known.timeZone),
            eventsFetchedAtMs = nowMs,
        )
    }

    private fun signedOut(context: Context, store: ReminderStore): SyncResult {
        // Signing out on purpose happens on screen. Off screen, the session was
        // lost: the employee must know their reminders have stopped.
        if (!AppState.isInForeground && store.snapshot?.eligible == true) {
            ReminderNotifier.showSessionLost(context)
        }
        store.snapshot = null
        store.clearDelivered()
        cancelAlarm(context)
        ReminderNotifier.retainOnly(context, emptySet())
        return SyncResult.SIGNED_OUT
    }

    private fun refresh(store: ReminderStore, session: AuthSession, nowMs: Long) {
        val previous = store.snapshot?.takeIf { it.profileId == session.profileId }
        if (previous == null) {
            store.snapshot = null
            store.clearDelivered()
        }
        val api = SupabaseApi(BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_KEY, session.accessToken)
        val identity = fetchIdentity()
        val zone = ZoneId.of(identity.timeZone)
        val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()

        var policies = previous?.policies.orEmpty()
        var policiesFetchedAt = previous?.policiesFetchedAtMs ?: 0
        val needsPolicies = identity.eligible && (
            nowMs - policiesFetchedAt > POLICY_MAX_AGE_MS || today.toString() !in policies
        )
        if (needsPolicies) {
            val dates = (-POLICY_DAYS_BEHIND..POLICY_DAYS_AHEAD).map { today.plusDays(it) }
            try {
                policies = dates.associate { it.toString() to api.policyFor(session.profileId, it) }
                policiesFetchedAt = nowMs
            } catch (error: ApiException) {
                if (error.status == 401 || error.status == 403 || error.status !in 400..499) throw error
                // The server rejects the policy request. Keep what is known. With
                // nothing known, open days and forgotten departures are still
                // reminded, and every later sync tries again.
                Log.w(TAG, "work policy unavailable: ${error.status}")
                if (today.toString() !in policies) {
                    policies = dates.associate { it.toString() to null }
                }
            }
        }

        store.snapshot = Snapshot(
            profileId = session.profileId,
            timeZone = identity.timeZone,
            policies = policies,
            events = if (identity.eligible) api.recentEvents(session.profileId) else emptyList(),
            pendingClosureDays = if (identity.eligible) {
                api.pendingClosureDays(session.profileId, identity.timeZone)
            } else {
                emptySet()
            },
            eligible = identity.eligible,
            eventsFetchedAtMs = nowMs,
            policiesFetchedAtMs = policiesFetchedAt,
        )
    }

    private fun fetchIdentity(): Identity {
        val origin = BuildConfig.SITE_URL
        val connection = URL("$origin/api/notifications/context").openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 8_000
            connection.readTimeout = 8_000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Cookie", CookieManager.getInstance().getCookie(origin).orEmpty())
            val status = connection.responseCode
            if (status !in 200..299) throw ApiException(status)
            return SupabaseApi.parseIdentity(connection.inputStream.bufferedReader().use { it.readText() })
        } finally {
            connection.disconnect()
        }
    }

    /** Renewal rotates the session, so it is only done when data is about to matter. */
    private fun worthRenewing(store: ReminderStore, nowMs: Long): Boolean {
        val snapshot = store.snapshot ?: return true
        if (nowMs - snapshot.eventsFetchedAtMs > QUIET_SYNC_INTERVAL_MS) return true
        val delivered = store.delivered
        return ReminderEngine.due(snapshot, nowMs).any { it.deliveryId !in delivered } ||
            ReminderEngine.nextFireAt(snapshot, nowMs, delivered, BUSY_WINDOW_MINUTES) != null
    }

    /**
     * The site's proxy renews an expired session and answers with `Set-Cookie`.
     * Letting it do so keeps the cookie format owned by the website.
     */
    private fun renewThroughWebsite(): Boolean = runCatching {
        val cookies = CookieManager.getInstance()
        val origin = BuildConfig.SITE_URL
        val connection = URL("$origin/api/notifications/subscription")
            .openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 8_000
            connection.readTimeout = 8_000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Cookie", cookies.getCookie(origin).orEmpty())
            val status = connection.responseCode
            connection.headerFields
                .filterKeys { it.equals("Set-Cookie", ignoreCase = true) }
                .values.flatten()
                .forEach { cookies.setCookie(origin, it) }
            cookies.flush()
            status in 200..399
        } finally {
            connection.disconnect()
        }
    }.getOrDefault(false)

    /**
     * Shows what is due now and plans the next alarm, without any network. Safe
     * to call at any time: the delivery ledger prevents repeated messages.
     */
    fun reconcile(context: Context) = lock.withLock {
        val app = context.applicationContext
        val store = ReminderStore(app)
        val snapshot = store.snapshot
        if (snapshot == null || !snapshot.eligible || !store.remindersEnabled(snapshot.profileId)) {
            cancelAlarm(app)
            ReminderNotifier.retainOnly(app, emptySet())
            return@withLock
        }

        val onScreen = AppState.isInForeground
        if (!onScreen && !ReminderNotifier.canNotify(app)) {
            // Nothing can be shown: keep reminders pending, without waking the
            // phone for them. The periodic worker retries once allowed.
            cancelAlarm(app)
            return@withLock
        }

        val nowMs = System.currentTimeMillis()
        val today = Instant.ofEpochMilli(nowMs).atZone(ZoneId.of(snapshot.timeZone)).toLocalDate()
        val due = ReminderEngine.due(snapshot, nowMs)
        val fresh = due.filter { it.deliveryId !in store.delivered }
        // On screen, the page already shows this state.
        if (!onScreen) fresh.forEach { ReminderNotifier.show(app, it) }
        if (fresh.isNotEmpty()) store.markDelivered(fresh.map { it.deliveryId }, today)
        ReminderNotifier.retainOnly(app, due.map { it.category }.toSet())

        val next = ReminderEngine.nextFireAt(snapshot, nowMs, store.delivered)
        if (next == null) cancelAlarm(app) else setAlarm(app, next)
    }

    private fun alarmIntent(context: Context) = PendingIntent.getBroadcast(
        context,
        1,
        Intent(context, ReminderAlarmReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun setAlarm(context: Context, atMs: Long) {
        val manager = context.getSystemService(AlarmManager::class.java)
        val intent = alarmIntent(context)
        val exactAllowed = Build.VERSION.SDK_INT < 31 || manager.canScheduleExactAlarms()
        try {
            if (exactAllowed) {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, intent)
            } else {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, intent)
            }
        } catch (_: SecurityException) {
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, intent)
        }
        Log.i(TAG, "next reminder alarm at ${Instant.ofEpochMilli(atMs)}")
    }

    private fun cancelAlarm(context: Context) {
        context.getSystemService(AlarmManager::class.java).cancel(alarmIntent(context))
    }
}
