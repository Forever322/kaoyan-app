// 顶级构建文件：在此声明插件版本，供子模块按需应用
plugins {
    id("com.android.application") version "8.12.0" apply false
    id("org.jetbrains.kotlin.android") version "2.2.0" apply false
    // Compose 编译器插件版本必须与 Kotlin 插件版本完全一致
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.0" apply false
}
