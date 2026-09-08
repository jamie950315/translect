import XCTest
@testable import TranslectMacOSVisionOCR

final class NativeMessagingTests: XCTestCase {
    private func readMessage(_ bytes: Data, chunkSize: Int = .max) throws -> Data? {
        var remaining = bytes
        return try readNativeMessage { count in
            let chunk = remaining.prefix(min(count, chunkSize))
            remaining.removeFirst(chunk.count)
            return Data(chunk)
        }
    }

    func testEmptyInputIsCleanEOF() throws {
        XCTAssertNil(try readMessage(Data()))
    }

    func testReadsFragmentedHeaderAndBody() throws {
        let framed = try encodeNativeMessage(["message": "hello"])
        XCTAssertEqual(try readMessage(framed, chunkSize: 1), framed.dropFirst(4))
    }

    func testRejectsTruncatedHeaderAndBody() {
        XCTAssertThrowsError(try readMessage(Data([2, 0])))
        XCTAssertThrowsError(try readMessage(Data([2, 0, 0, 0, 123])))
    }

    func testRejectsEmptyAndOversizedFramesBeforeReadingBody() {
        XCTAssertThrowsError(try readMessage(Data([0, 0, 0, 0])))
        XCTAssertThrowsError(try readMessage(Data([255, 255, 255, 255])))
    }

    func testRejectsResponseBeyondBrowserLimit() {
        XCTAssertThrowsError(try encodeNativeMessage(String(repeating: "a", count: 1024 * 1024)))
    }

    func testPropagatesReadFailure() {
        struct ReadFailure: Error {}
        XCTAssertThrowsError(try readNativeMessage { _ in throw ReadFailure() }) { error in
            XCTAssertTrue(error is ReadFailure)
        }
    }
}
