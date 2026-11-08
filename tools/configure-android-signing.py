#!/usr/bin/env python3
"""Configure the generated Tauri Android Gradle project to sign release APKs."""

from pathlib import Path

gradle_file = Path("src-tauri/gen/android/app/build.gradle.kts")
if not gradle_file.is_file():
    raise SystemExit(f"Android Gradle file not found: {gradle_file}")

source = gradle_file.read_text(encoding="utf-8")

if "signingConfigs {" in source:
    raise SystemExit("Android signing config already exists; refusing to add a duplicate.")

android_build_types = "    buildTypes {"
if source.count(android_build_types) != 1:
    raise SystemExit("Could not uniquely locate android.buildTypes block; refusing to patch.")

if "import java.io.FileInputStream" not in source:
    properties_import = "import java.util.Properties"
    if properties_import not in source:
        raise SystemExit("Could not locate Properties import.")
    source = source.replace(
        properties_import,
        properties_import + "\nimport java.io.FileInputStream",
        1,
    )

signing_config = """    signingConfigs {
        create("release") {
            val keystorePropertiesFile = rootProject.file("keystore.properties")
            require(keystorePropertiesFile.exists()) {
                "Android release signing file is missing: keystore.properties"
            }
            val keystoreProperties = Properties().apply {
                load(FileInputStream(keystorePropertiesFile))
            }

            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["keyPassword"] as String
            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["storePassword"] as String
        }
    }

"""
source = source.replace(android_build_types, signing_config + android_build_types, 1)

release_block = '        getByName("release") {'
if source.count(release_block) != 1:
    raise SystemExit("Could not uniquely locate release build type; refusing to patch.")

source = source.replace(
    release_block,
    release_block + '\n            signingConfig = signingConfigs.getByName("release")',
    1,
)

gradle_file.write_text(source, encoding="utf-8")
print("Configured Android release signing.")
