import XCTest
@testable import TranslectMacOSVisionOCR

final class VisionOCRTests: XCTestCase {
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
}
