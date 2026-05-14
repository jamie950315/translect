// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "TranslectMacOSVisionOCR",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(
            name: "translect-macos-vision-ocr",
            targets: ["TranslectMacOSVisionOCR"]
        )
    ],
    targets: [
        .executableTarget(
            name: "TranslectMacOSVisionOCR"
        )
    ]
)
