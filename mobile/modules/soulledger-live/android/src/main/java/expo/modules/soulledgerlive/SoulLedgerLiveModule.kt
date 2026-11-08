package expo.modules.soulledgerlive

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android's live progress (mobile/src/liveProgress.ts): one ongoing notification, posted here rather than through
 * expo-notifications because expo's builder never calls setVisibility — every notification it posts is PRIVATE — and
 * the system resets an app-created channel's lockscreenVisibility PUBLIC to NO_OVERRIDE, so only the notification's own
 * visibility can make it PUBLIC (华为 TAS-AL00 2026-11-08: record vis=PRIVATE, channel mLockscreenVisibility=-1000).
 * The channel is DEFAULT importance, silenced: a LOW channel is "silent" and Android 12 / EMUI keep silent
 * notifications off the lock screen. Importance cannot be raised on an existing channel, hence a new id.
 */
class SoulLedgerLiveModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("no React context")

  override fun definition() = ModuleDefinition {
    Name("SoulLedgerLive")

    /** Posts the notification, or replaces it in place. false: notifications are off for the app. */
    AsyncFunction("notify") { channelName: String, title: String, body: String, progress: Double ->
      val ctx = context
      val manager = NotificationManagerCompat.from(ctx)
      if (!manager.areNotificationsEnabled()) return@AsyncFunction false
      ensureChannel(ctx, channelName)
      val text = body.substringBefore('\n')
      val notification = NotificationCompat.Builder(ctx, CHANNEL)
        .setSmallIcon(smallIcon(ctx))
        .setContentTitle(title)
        .setContentText(text)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setProgress(100, (progress.coerceIn(0.0, 1.0) * 100).toInt(), false)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setShowWhen(false)
        .setCategory(NotificationCompat.CATEGORY_PROGRESS)
        .setContentIntent(openLife(ctx))
        .apply { color(ctx)?.let { setColor(it) } }
        .build()
      post(manager, notification)
    }

    AsyncFunction("end") {
      NotificationManagerCompat.from(context).cancel(TAG, ID)
    }
  }

  /** POST_NOTIFICATIONS is asked for in JS (liveProgress.ts `mayNotify`); a revoke between check and post is false. */
  @SuppressLint("MissingPermission")
  private fun post(manager: NotificationManagerCompat, notification: android.app.Notification): Boolean =
    try {
      manager.notify(TAG, ID, notification)
      true
    } catch (e: SecurityException) {
      false
    }

  private fun ensureChannel(ctx: Context, name: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = ctx.getSystemService(NotificationManager::class.java)
    // The old LOW channel (posted through expo-notifications) would linger in the app's settings.
    nm.deleteNotificationChannel(OLD_CHANNEL)
    val channel = NotificationChannel(CHANNEL, name, NotificationManager.IMPORTANCE_DEFAULT).apply {
      setSound(null, null)
      enableVibration(false)
      enableLights(false)
      setShowBadge(false)
      lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
    }
    // Re-creating an existing channel only updates its name (the language may have changed).
    nm.createNotificationChannel(channel)
  }

  /** Tapping opens 本世: the app's own soulledger://life link (mobile/src/links.ts). */
  private fun openLife(ctx: Context): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("soulledger://life")).setPackage(ctx.packageName)
    return PendingIntent.getActivity(ctx, ID, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun meta(ctx: Context) =
    try {
      ctx.packageManager.getApplicationInfo(ctx.packageName, PackageManager.GET_META_DATA).metaData
    } catch (e: Exception) {
      null
    }

  /** The icon expo-notifications uses (app.json's expo-notifications `icon`, as manifest meta-data), else the app's. */
  private fun smallIcon(ctx: Context): Int =
    meta(ctx)?.getInt(ICON_KEY, 0)?.takeIf { it != 0 } ?: ctx.applicationInfo.icon

  private fun color(ctx: Context): Int? =
    meta(ctx)?.getInt(COLOR_KEY, 0)?.takeIf { it != 0 }?.let {
      try {
        ctx.resources.getColor(it, null)
      } catch (e: Exception) {
        null
      }
    }

  companion object {
    const val CHANNEL = "live-progress-v2"
    const val OLD_CHANNEL = "live-progress"
    const val TAG = "live-progress"
    const val ID = 7301
    const val ICON_KEY = "expo.modules.notifications.default_notification_icon"
    const val COLOR_KEY = "expo.modules.notifications.default_notification_color"
  }
}
