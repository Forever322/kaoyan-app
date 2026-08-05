import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val webProjectDir = rootProject.projectDir.parentFile
val webDistDir = File(webProjectDir, "dist")
val bundledWebAssetsDir = file("src/main/assets")
val isWindows = System.getProperty("os.name").lowercase().contains("windows")

// 签名配置：优先读取 android-twa/keystore.properties（不入库），
// 未提供时回退到 CI 约定的默认值（alias=kaoyan）。
val keystorePropsFile = rootProject.file("keystore.properties")
val keystoreProps = Properties()
if (keystorePropsFile.exists()) {
    keystorePropsFile.inputStream().use { keystoreProps.load(it) }
}
val releaseKeystoreFile = rootProject.file("release.keystore")

// Android 壳通过 file:///android_asset/index.html 启动网页。
// 每次构建 APK 前先打包 Vite，再同步整个 dist，避免 APK 携带过期或不完整资源。
val buildWebAssets = tasks.register<Exec>("buildWebAssets") {
    workingDir = webProjectDir
    if (isWindows) {
        commandLine("cmd", "/c", "pnpm", "build")
    } else {
        commandLine("pnpm", "build")
    }
    inputs.files(fileTree(webProjectDir) {
        include("src/**", "public/**", "index.html", "package.json", "pnpm-lock.yaml", "vite.config.js")
    })
    outputs.dir(webDistDir)
}

val syncWebAssets = tasks.register<Sync>("syncWebAssets") {
    dependsOn(buildWebAssets)
    from(webDistDir) {
        exclude(".idea/**")
    }
    into(bundledWebAssetsDir)
}

android {
    namespace = "com.kaoyan.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.kaoyan.app"
        minSdk = 24
        targetSdk = 36
        versionCode = 6
        versionName = "4.3"
    }

    signingConfigs {
        if (releaseKeystoreFile.exists()) {
            create("release") {
                storeFile = releaseKeystoreFile
                storePassword = keystoreProps.getProperty("storePassword", "kaoyan123")
                keyAlias = keystoreProps.getProperty("keyAlias", "kaoyan")
                keyPassword = keystoreProps.getProperty("keyPassword", "kaoyan123")
            }
        }
    }

    buildTypes {
        // debug 使用 Android SDK 自动生成的调试签名（标准做法）
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = false
            // 无 keystore 时退回 debug 签名，避免构建失败；CI 会先生成 release.keystore
            signingConfig = if (releaseKeystoreFile.exists()) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    buildFeatures {
        // AGP 8.x 默认关闭 BuildConfig 生成；MainActivity 使用 BuildConfig.VERSION_NAME
        buildConfig = true
        compose = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_11)
    }
}

dependencies {
    // Compose BOM 统一对齐 Compose 各构件版本
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    // ComponentActivity.setContent 扩展
    implementation("androidx.activity:activity-compose:1.10.1")
    // core-ktx 1.19.0 需要 compileSdk 37 + AGP 9.1；保持与 AGP 8.10 兼容使用 1.15.0
    implementation("androidx.core:core-ktx:1.15.0")
}

tasks.named("preBuild") {
    dependsOn(syncWebAssets)
}
