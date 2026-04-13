# Hydris Engine ProGuard Rules

-keep class hydris.** { *; }
-keep class go.** { *; }
-keep class ai.projectq.hydris.** { *; }
-keep class com.hoho.android.usbserial.** { *; }
-keepclasseswithmembernames class * {
    native <methods>;
}
