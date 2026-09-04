import XCTest
@testable import TranslectMacOSVisionOCR

final class VisionOCRTests: XCTestCase {
    func testDetectsBothVerticalTextDirectionsFromVisionCorners() {
        XCTAssertEqual(
            normalizedTextRotation(
                topLeft: CGPoint(x: 0.1, y: 0.2),
                topRight: CGPoint(x: 0.1, y: 0.8),
                imageWidth: 1000,
                imageHeight: 1000
            ),
            -90
        )
        XCTAssertEqual(
            normalizedTextRotation(
                topLeft: CGPoint(x: 0.1, y: 0.8),
                topRight: CGPoint(x: 0.1, y: 0.2),
                imageWidth: 1000,
                imageHeight: 1000
            ),
            90
        )
    }

    func testKeepsHorizontalVisionTextUnrotated() {
        XCTAssertEqual(
            normalizedTextRotation(
                topLeft: CGPoint(x: 0.1, y: 0.5),
                topRight: CGPoint(x: 0.8, y: 0.5),
                imageWidth: 1000,
                imageHeight: 1000
            ),
            0
        )
    }

    func testPreservesTheRequestIDWhenImageDataCannotBeRead() {
        let message = Data(
            #"{"id":"image-a","imageDataUrl":"not-a-data-url"}"#.utf8
        )

        let response = handleVisionOCRMessage(message)

        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.id, "image-a")
        XCTAssertNil(response.observations)
        XCTAssertEqual(response.error, "Invalid image data URL.")
    }

    func testGroupsNearbyVisionLinesForAppleIntelligenceTranslation() {
        let observations = [
            VisionOCRObservation(
                text: "Hello",
                confidence: 0.98,
                x: 40,
                y: 20,
                width: 120,
                height: 30
            ),
            VisionOCRObservation(
                text: "World",
                confidence: 0.93,
                x: 42,
                y: 58,
                width: 128,
                height: 30
            ),
            VisionOCRObservation(
                text: "Separate",
                confidence: 0.91,
                x: 300,
                y: 150,
                width: 80,
                height: 20
            )
        ]

        let groups = groupAppleIntelligenceObservations(observations)

        XCTAssertEqual(groups.count, 2)
        XCTAssertEqual(groups[0].text, "Hello\nWorld")
        XCTAssertEqual(groups[0].observationIndexes, [0, 1])
        XCTAssertEqual(groups[1].text, "Separate")
        XCTAssertEqual(groups[1].observationIndexes, [2])
    }

    func testKeepsCloselyStackedTweetMetadataControlsAndBodyInSeparateGroups() {
        let observations = [
            VisionOCRObservation(
                text: "@thsottiaux · 6min",
                confidence: 0.98,
                x: 119,
                y: 16,
                width: 142,
                height: 13
            ),
            VisionOCRObservation(
                text: "Mostrar traducción",
                confidence: 0.96,
                x: 60,
                y: 40,
                width: 112,
                height: 11
            ),
            VisionOCRObservation(
                text: "We kept ourselves busy with GPT-5.6 Sol.",
                confidence: 0.99,
                x: 60,
                y: 62,
                width: 360,
                height: 15
            )
        ]

        let groups = groupAppleIntelligenceObservations(observations)

        XCTAssertEqual(groups.map(\.observationIndexes), [[0], [1], [2]])
    }

    func testKeepsHorizontalAndVerticalVisionTextInSeparateGroups() {
        let observations = [
            VisionOCRObservation(
                text: "Capability coverage",
                confidence: 1,
                x: 104,
                y: 283,
                width: 23,
                height: 194,
                rotation: -90
            ),
            VisionOCRObservation(
                text: "60%",
                confidence: 1,
                x: 151,
                y: 347,
                width: 59,
                height: 16
            )
        ]

        let groups = groupAppleIntelligenceObservations(observations)

        XCTAssertEqual(groups.map(\.observationIndexes), [[0], [1]])
    }

    func testMergesLabelsAndTranslationsBackOntoExactVisionBoxes() {
        let observations = [
            VisionOCRObservation(
                text: "Hello",
                confidence: 0.98,
                x: 40,
                y: 20,
                width: 120,
                height: 30
            ),
            VisionOCRObservation(
                text: "World",
                confidence: 0.93,
                x: 42,
                y: 58,
                width: 128,
                height: 30
            )
        ]
        let groups = groupAppleIntelligenceObservations(observations)
        let translations = [
            AppleIntelligenceGroupTranslation(
                groupIndex: 0,
                semanticLabel: "body",
                translatedText: "你好世界"
            )
        ]

        let merged = mergeAppleIntelligenceTranslations(
            observations: observations,
            groups: groups,
            translations: translations,
            imageID: "image-a"
        )

        XCTAssertEqual(merged.count, 2)
        XCTAssertEqual(merged[0].flow_group_id, "image-a:flow:0")
        XCTAssertEqual(merged[0].flow_box_index, 0)
        XCTAssertEqual(merged[0].semantic_label, "body")
        XCTAssertEqual(merged[0].translated_text, "你好世界")
        XCTAssertEqual(merged[1].flow_box_index, 1)
        XCTAssertEqual(merged[1].x, 42)
        XCTAssertEqual(merged[1].y, 58)
        XCTAssertEqual(merged[1].rotation, 0)
    }

    func testOmitsUnchangedAppleIntelligenceTextFromOverlays() {
        let observations = [
            VisionOCRObservation(
                text: "P8181189/8811111118898141",
                confidence: 0.3,
                x: 40,
                y: 120,
                width: 900,
                height: 70
            )
        ]
        let groups = groupAppleIntelligenceObservations(observations)
        let translations = [
            AppleIntelligenceGroupTranslation(
                groupIndex: 0,
                semanticLabel: "other",
                translatedText: "P8181189/8811111118898141"
            )
        ]

        let merged = mergeAppleIntelligenceTranslations(
            observations: observations,
            groups: groups,
            translations: translations,
            imageID: "image-a"
        )

        XCTAssertTrue(merged.isEmpty)
    }

    func testOmitsAsciiOnlyMetadataRewritesFromOverlays() {
        let observations = [
            VisionOCRObservation(
                text: "Grok 4.5 (high)",
                confidence: 0.3,
                x: 300,
                y: 400,
                width: 48,
                height: 74
            )
        ]
        let groups = groupAppleIntelligenceObservations(observations)
        let translations = [
            AppleIntelligenceGroupTranslation(
                groupIndex: 0,
                semanticLabel: "metadata",
                translatedText: "Grok 4.5 / high"
            )
        ]

        let merged = mergeAppleIntelligenceTranslations(
            observations: observations,
            groups: groups,
            translations: translations,
            imageID: "image-a"
        )

        XCTAssertTrue(merged.isEmpty)
    }

    func testOmitsNumericOnlyAppleIntelligenceRewritesFromOverlays() {
        let observations = [
            VisionOCRObservation(
                text: "€2",
                confidence: 0.3,
                x: 620,
                y: 420,
                width: 18,
                height: 14
            )
        ]
        let groups = groupAppleIntelligenceObservations(observations)
        let translations = [
            AppleIntelligenceGroupTranslation(
                groupIndex: 0,
                semanticLabel: "body",
                translatedText: "27.8"
            )
        ]

        let merged = mergeAppleIntelligenceTranslations(
            observations: observations,
            groups: groups,
            translations: translations,
            imageID: "image-a"
        )

        XCTAssertTrue(merged.isEmpty)
    }

    func testAppleIntelligencePromptRepeatsTheTranslationTargetWithTheSourceText() {
        let prompt = buildAppleIntelligenceTranslationPrompt(
            groups: [
                AppleIntelligenceTextGroup(
                    index: 3,
                    observationIndexes: [4],
                    text: "Smaller"
                )
            ],
            targetLanguage: "Traditional Chinese"
        )

        XCTAssertTrue(prompt.contains("TARGET_LANGUAGE: Traditional Chinese"))
        XCTAssertTrue(prompt.contains("Translate every translatable word and phrase"))
        XCTAssertTrue(prompt.contains("GROUP_INDEX 3\nSmaller"))
    }

    func testRecognizesAppleIntelligenceNativeMessagesWithoutChangingVisionRequests() {
        let localRequest = Data(
            #"{"operation":"apple-intelligence-translate","imageDataUrl":"data:image/png;base64,AA==","targetLanguage":"Traditional Chinese"}"#.utf8
        )
        let visionRequest = Data(
            #"{"imageDataUrl":"data:image/png;base64,AA=="}"#.utf8
        )

        XCTAssertTrue(isAppleIntelligenceTranslationRequest(localRequest))
        XCTAssertFalse(isAppleIntelligenceTranslationRequest(visionRequest))
    }

    func testExcludesDecorationOnlyGroupsFromAppleIntelligenceTranslation() {
        let groups = [
            AppleIntelligenceTextGroup(
                index: 0,
                observationIndexes: [0],
                text: ">"
            ),
            AppleIntelligenceTextGroup(
                index: 1,
                observationIndexes: [1],
                text: "Price >"
            ),
            AppleIntelligenceTextGroup(
                index: 2,
                observationIndexes: [2],
                text: "330W"
            )
        ]

        let filtered = filterAppleIntelligenceTranslationGroups(groups)

        XCTAssertEqual(filtered.map(\.index), [1, 2])
    }

    func testCapsAppleIntelligenceGroupsBeforeDenseLayoutsBecomeOneHugePrompt() {
        let observations = (0..<10).map { index in
            VisionOCRObservation(
                text: "Line \(index)",
                confidence: 0.9,
                x: 20,
                y: Double(index * 25),
                width: 120,
                height: 20
            )
        }

        let groups = groupAppleIntelligenceObservations(observations)

        XCTAssertEqual(groups.count, 2)
        XCTAssertEqual(groups.first?.observationIndexes, Array(0..<8))
        XCTAssertEqual(groups.dropFirst().first?.observationIndexes, [8, 9])
    }

    func testBatchesAppleIntelligenceGroupsByTextSizeAndGroupCount() {
        let groups = [
            AppleIntelligenceTextGroup(index: 0, observationIndexes: [0], text: "aaaa"),
            AppleIntelligenceTextGroup(index: 1, observationIndexes: [1], text: "bbbb"),
            AppleIntelligenceTextGroup(index: 2, observationIndexes: [2], text: "cccc"),
            AppleIntelligenceTextGroup(index: 3, observationIndexes: [3], text: "d")
        ]

        let batches = makeAppleIntelligenceTranslationBatches(
            groups,
            maxGroupCount: 3,
            maxSourceBytes: 8
        )

        XCTAssertEqual(batches.map { $0.map(\.index) }, [[0, 1], [2, 3]])
    }

}
