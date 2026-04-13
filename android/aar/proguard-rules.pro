# Go/gomobile bindings
-keep class hydris.** { *; }
-keep class go.** { *; }
-keep class go.Seq* { *; }

# Kotlin wrapper
-keep class ai.projectq.hydris.** { *; }

# JNI
-keepclasseswithmembernames class * {
    native <methods>;
}
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
