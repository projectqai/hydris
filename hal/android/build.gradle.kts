plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

// Extract Go AAR to get the gomobile-generated Java bindings.
val goAar = file("${rootProject.projectDir}/aar/libs/hydris-go.aar")
val extractDir = file("${layout.buildDirectory.get()}/go-aar-extract")

if (goAar.exists()) {
    extractDir.deleteRecursively()
    extractDir.mkdirs()
    copy {
        from(zipTree(goAar))
        into(extractDir)
    }
}

android {
    namespace = "ai.projectq.hydris.hal"
    compileSdk = 34

    defaultConfig {
        minSdk = 24
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    kotlinOptions {
        jvmTarget = "11"
    }
}

dependencies {
    // gomobile-generated classes.jar contains hydris.PlatformBLE etc.
    compileOnly(files("${extractDir}/classes.jar"))
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("com.github.mik3y:usb-serial-for-android:3.10.0")
}
