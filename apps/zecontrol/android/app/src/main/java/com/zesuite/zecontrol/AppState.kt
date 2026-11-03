package com.zesuite.zecontrol

/** Whether the app is on screen. Read from background threads. */
object AppState {
    @Volatile
    var isInForeground: Boolean = false
}
