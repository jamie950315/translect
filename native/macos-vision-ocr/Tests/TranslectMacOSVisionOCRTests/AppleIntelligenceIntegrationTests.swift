import Foundation
import XCTest
@testable import TranslectMacOSVisionOCR

final class AppleIntelligenceIntegrationTests: XCTestCase {
    func testRealImageTranslation() async throws {
        guard let fixture = ProcessInfo.processInfo.environment["TRANSLECT_AI_FIXTURE"] else {
            throw XCTSkip("Set TRANSLECT_AI_FIXTURE to run on-device translation against an image.")
        }
        var isDirectory: ObjCBool = false
        _ = FileManager.default.fileExists(atPath: fixture, isDirectory: &isDirectory)
        let fixtures: [String]
        if isDirectory.boolValue {
            fixtures = try FileManager.default.contentsOfDirectory(atPath: fixture)
                .filter { $0.hasSuffix("-source.png") }
                .sorted().map { (fixture as NSString).appendingPathComponent($0) }
        } else {
            fixtures = [fixture]
        }
        XCTAssertFalse(fixtures.isEmpty, "No source fixtures found")
        for fixture in fixtures {
            try await checkFixture(fixture)
        }
    }

    private func checkFixture(_ fixture: String) async throws {
        let image = try Data(contentsOf: URL(fileURLWithPath: fixture))
        let dataURL = "data:image/png;base64," + image.base64EncodedString()
        let started = Date()
        let ocr = try recognizeText(request: VisionOCRRequest(id: "integration", imageDataUrl: dataURL, languages: nil, recognitionLevel: "accurate"))
        let groups = filterAppleIntelligenceTranslationGroups(groupAppleIntelligenceObservations(ocr.observations ?? []))
        print("AI_INTEGRATION fixture=\((fixture as NSString).lastPathComponent) OCR seconds=\(Date().timeIntervalSince(started)) lines=\(ocr.observations?.count ?? 0) groups=\(groups.count)")
        let request = try JSONSerialization.data(withJSONObject: ["id": "integration", "operation": "apple-intelligence-translate", "imageDataUrl": dataURL, "targetLanguage": "Traditional Chinese"])
        let translationStarted = Date()
        let response = await handleAppleIntelligenceMessage(request)
        print("AI_INTEGRATION translation seconds=\(Date().timeIntervalSince(translationStarted)) ok=\(response.ok) overlays=\(response.observations?.count ?? 0) error=\(response.error ?? "none")")
        if ProcessInfo.processInfo.environment["TRANSLECT_AI_PRINT_TRANSLATIONS"] == "1" {
            for observation in (response.observations ?? []).filter({ $0.flow_box_index == 0 }) {
                print("AI_INTEGRATION \(observation.flow_group_id): \(observation.translated_text)")
            }
        }
        XCTAssertTrue(response.ok, "\((fixture as NSString).lastPathComponent): \(response.error ?? "Missing response")")
        for observation in response.observations ?? [] {
            XCTAssertTrue((ocr.observations ?? []).contains {
                $0.text == observation.text && $0.x == observation.x && $0.y == observation.y
                    && $0.width == observation.width && $0.height == observation.height
                    && $0.rotation == observation.rotation
            }, "Translation changed an original OCR frame")
        }
    }
}
