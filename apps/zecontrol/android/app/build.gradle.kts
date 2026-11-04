import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The publishable Supabase key is public (it ships in the website bundle), but
// it stays in the application's .env so there is a single source of truth.
fun dotEnv(name: String): String {
    val file = rootDir.resolve("../.env")
    if (!file.exists()) return ""
    return file.readLines()
        .firstOrNull { it.startsWith("$name=") }
        ?.substringAfter("=")
        ?.trim()
        .orEmpty()
}

val siteUrl = providers.gradleProperty("zecontrol.siteUrl")
    .orElse("https://zecontrol.vercel.app").get()
val supabaseUrl = providers.gradleProperty("zecontrol.supabaseUrl")
    .orElse(dotEnv("NEXT_PUBLIC_SUPABASE_URL")).get()
val supabaseKey = providers.gradleProperty("zecontrol.supabaseKey")
    .orElse(dotEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")).get()

// The signing key deliberately lives outside the repository.
val signingFile = File(System.getProperty("user.home"), ".zecontrol-android/keystore.properties")
val signing = Properties().apply {
    if (signingFile.exists()) signingFile.inputStream().use { load(it) }
}

android {
    namespace = "com.zesuite.zecontrol"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.zesuite.zecontrol"
        minSdk = 26
        targetSdk = 35
        versionCode = 4
        versionName = "1.0.3"
        buildConfigField("String", "SITE_URL", "\"${siteUrl.trimEnd('/')}\"")
        buildConfigField("String", "SUPABASE_URL", "\"${supabaseUrl.trimEnd('/')}\"")
        buildConfigField("String", "SUPABASE_KEY", "\"$supabaseKey\"")
    }

    signingConfigs {
        if (signingFile.exists()) {
            create("release") {
                storeFile = File(signing.getProperty("storeFile"))
                storePassword = signing.getProperty("storePassword")
                keyAlias = signing.getProperty("keyAlias")
                keyPassword = signing.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            signingConfig = signingConfigs.findByName("release")
        }
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.browser:browser:1.8.0")
    implementation("androidx.work:work-runtime:2.9.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
