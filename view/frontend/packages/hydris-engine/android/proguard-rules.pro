# Hydris Engine ProGuard Rules
# Keep native methods and JNI bindings

# Keep all Hydris classes and their native methods
-keep class hydris.** { *; }

# Keep Go bindings and Seq classes
-keep class go.** { *; }
-keep class go.Seq** { *; }

# Keep all classes with native methods
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep constructors for native callback classes
-keepclasseswithmembers class * {
    native <methods>;
}
