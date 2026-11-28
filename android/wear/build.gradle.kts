import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release signing lives OUTSIDE the repo. Override the path with GYM_KEYSTORE_PROPS.
val keystorePropsFile = file(System.getenv("GYM_KEYSTORE_PROPS")
    ?: (System.getProperty("user.home") + "/keys/gym-companion-keystore.properties"))
val keystoreProps = Properties().apply {
    if (keystorePropsFile.exists()) keystorePropsFile.inputStream().use { load(it) }
}

android {
    namespace = "io.github.teo2301.gymcompanion.wear"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.teo2301.gymcompanion"
        minSdk = 30
        targetSdk = 36
        versionCode = 21
        versionName = "1.21"
    }

    signingConfigs {
        create("release") {
            if (keystoreProps.isNotEmpty()) {
                storeFile = file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (keystoreProps.isNotEmpty()) signingConfigs.getByName("release") else null
        }
    }

    lint {
        // GymTile uses ResolvableFuture from androidx.concurrent, the usual way to return a tile future
        disable += "RestrictedApi"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.13.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.11.0")
    implementation("androidx.wear:wear:1.3.0")
    implementation("androidx.wear.tiles:tiles:1.6.2")
    implementation("androidx.wear.protolayout:protolayout:1.4.2")
    implementation("androidx.concurrent:concurrent-futures:1.2.0")   // AmbientLifecycleObserver
    implementation("com.google.android.gms:play-services-wearable:19.0.0")   // Wear OS Data Layer (phone link)
}
