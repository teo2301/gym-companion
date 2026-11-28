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
    namespace = "io.github.teo2301.gymcompanion"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.teo2301.gymcompanion"
        minSdk = 26
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
    implementation("androidx.webkit:webkit:1.18.0")
    implementation("com.google.android.gms:play-services-wearable:19.0.0")   // Wear OS Data Layer (watch link)
    implementation("androidx.fragment:fragment:1.8.9")   // play-services-wearable drags in an ancient fragment that lint rejects for the activity-result API
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")   // real org.json for JVM unit tests (android.jar only has stubs)
}
