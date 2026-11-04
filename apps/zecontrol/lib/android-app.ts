/** Added to the user agent by the Android app's WebView (see MainActivity.kt). */
const ANDROID_APP_MARKER = "ZeControlAndroid/";

export function isAndroidApp(userAgent: string | null | undefined) {
  return Boolean(userAgent?.includes(ANDROID_APP_MARKER));
}
