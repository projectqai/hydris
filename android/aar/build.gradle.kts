plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

// Extract Go AAR at configuration time (it's already built by gomobile before Gradle runs)
val goAar = file("libs/hydris-go.aar")
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
    namespace = "ai.projectq.hydris"
    compileSdk = 34

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("proguard-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    kotlinOptions {
        jvmTarget = "11"
    }

    sourceSets["main"].jniLibs.srcDir("${extractDir}/jni")
}

dependencies {
    api(files("${extractDir}/classes.jar"))
    api(project(":hal"))
    implementation("androidx.core:core-ktx:1.12.0")
}
