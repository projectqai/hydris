pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        maven { url = uri("https://jitpack.io") }
    }
}

rootProject.name = "hydris-android"
include(":aar")
include(":hal")
include(":testapp")

// The HAL module sources live outside the android/ tree.
project(":hal").projectDir = file("../hal/android")
