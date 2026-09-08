import Foundation
import Security
import XCTest
@testable import TranslectMacOSVisionOCR

final class PersistentSettingsTests: XCTestCase {
    private final class MemoryStore: SettingsDataStore {
        var data: Data?
        var writes = 0
        var fails = false
        var concurrentRecord: Data?
        func load() throws -> Data? {
            if fails { throw SettingsPersistenceError.keychain(-25293) }
            return data
        }
        func save(_ data: Data) throws { self.data = data; writes += 1 }
        func saveIfMissing(_ data: Data) throws -> Bool {
            if let concurrentRecord { self.data = concurrentRecord }
            guard self.data == nil else { return false }
            try save(data)
            return true
        }
    }

    private let settings = PersistentSettings(
        apiEndpoint: "https://example.invalid/v1/chat/completions", apiKey: "test-only-key",
        iosOcrEndpoint: "", macosVisionHostName: "com.translect.macos_vision_ocr",
        model: "model-id", targetLanguage: "Traditional Chinese", alwaysAutoDetect: true,
        triggerUsesAutoMode: false, useAppleIntelligence: false, useIosOcrServer: false,
        useMacosVisionOcr: true
    )

    private func request(_ operation: String, settings: PersistentSettings? = nil) throws -> Data {
        struct Request: Encodable { let operation: String; let settings: PersistentSettings? }
        return try JSONEncoder().encode(Request(operation: operation, settings: settings))
    }

    func testEmptyStoreIsExplicitNull() throws {
        let result = handleSettingsPersistenceMessage(try request("settings-load"), store: MemoryStore())
        XCTAssertTrue(result.ok)
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(result)) as! [String: Any]
        XCTAssertTrue(json["settings"] is NSNull)
    }

    func testEncodingExpansionCannotWriteAnUnreadableRecord() throws {
        var profile = try JSONSerialization.jsonObject(with: JSONEncoder().encode(settings)) as! [String: Any]
        for field in ["apiEndpoint", "apiKey", "iosOcrEndpoint", "macosVisionHostName", "model", "targetLanguage"] {
            profile[field] = String(repeating: "/", count: 16_384)
        }
        let data = try JSONSerialization.data(withJSONObject: ["operation": "settings-save", "settings": profile], options: [.withoutEscapingSlashes])
        XCTAssertLessThan(data.count, 131_072)
        let store = MemoryStore()
        let response = handleSettingsPersistenceMessage(data, store: store)
        XCTAssertFalse(response.ok)
        XCTAssertEqual(store.writes, 0)
    }

    func testCompleteConfigurationSurvivesNewRequest() throws {
        let store = MemoryStore()
        let saved = handleSettingsPersistenceMessage(try request("settings-save", settings: settings), store: store)
        XCTAssertTrue(saved.ok)
        let restored = handleSettingsPersistenceMessage(try request("settings-load"), store: store)
        XCTAssertEqual(restored.settings, settings)
        XCTAssertEqual(store.writes, 1)
    }

    func testMalformedSettingsNeverOverwriteExistingRecord() throws {
        let store = MemoryStore()
        _ = handleSettingsPersistenceMessage(try request("settings-save", settings: settings), store: store)
        let before = store.data
        let result = handleSettingsPersistenceMessage(Data(#"{"operation":"settings-save","settings":{"apiKey":"PRIVATE-SENTINEL"}}"#.utf8), store: store)
        XCTAssertFalse(result.ok)
        XCTAssertFalse(result.error!.contains("PRIVATE-SENTINEL"))
        XCTAssertEqual(store.data, before)
        XCTAssertEqual(store.writes, 1)
    }

    func testNewerVersionCannotBeOverwritten() throws {
        let store = MemoryStore()
        store.data = Data(#"{"version":2,"newField":"unknown"}"#.utf8)
        let result = handleSettingsPersistenceMessage(try request("settings-save", settings: settings), store: store)
        XCTAssertFalse(result.ok)
        XCTAssertTrue(result.error!.contains("newer version"))
        XCTAssertEqual(store.writes, 0)
    }

    func testCorruptStoredRecordIsVisibleAndPreserved() throws {
        let store = MemoryStore()
        store.data = Data("not JSON PRIVATE-SENTINEL".utf8)
        let result = handleSettingsPersistenceMessage(try request("settings-save", settings: settings), store: store)
        XCTAssertFalse(result.ok)
        XCTAssertTrue(result.error!.contains("damaged"))
        XCTAssertFalse(result.error!.contains("PRIVATE-SENTINEL"))
        XCTAssertEqual(store.writes, 0)
    }

    func testKeychainDenialDoesNotLookLikeMissingSettings() throws {
        let store = MemoryStore()
        store.fails = true
        let result = handleSettingsPersistenceMessage(try request("settings-load"), store: store)
        XCTAssertFalse(result.ok)
        XCTAssertTrue(result.error!.contains("-25293"))
    }

    func testRejectsConflictingModesAndOversizedSettings() throws {
        let store = MemoryStore()
        var object = try JSONSerialization.jsonObject(with: request("settings-save", settings: settings)) as! [String: Any]
        var config = object["settings"] as! [String: Any]
        config["useAppleIntelligence"] = true
        object["settings"] = config
        XCTAssertFalse(handleSettingsPersistenceMessage(try JSONSerialization.data(withJSONObject: object), store: store).ok)
        config["useAppleIntelligence"] = false
        config["apiKey"] = String(repeating: "x", count: 16_385)
        object["settings"] = config
        XCTAssertFalse(handleSettingsPersistenceMessage(try JSONSerialization.data(withJSONObject: object), store: store).ok)
        XCTAssertEqual(store.writes, 0)
    }

    func testRoutesOnlySettingsOperations() throws {
        XCTAssertTrue(isSettingsPersistenceRequest(try request("settings-save", settings: settings)))
        XCTAssertTrue(isSettingsPersistenceRequest(try request("settings-load")))
        XCTAssertFalse(isSettingsPersistenceRequest(try request("ocr")))
        XCTAssertFalse(isSettingsPersistenceRequest(Data("invalid".utf8)))
    }

    func testMigrationNeverReplacesConcurrentSettings() throws {
        let store = MemoryStore()
        var object = try JSONSerialization.jsonObject(with: request("settings-save", settings: settings)) as! [String: Any]
        object["onlyIfMissing"] = true
        var other = object["settings"] as! [String: Any]
        other["model"] = "newer-model"
        store.concurrentRecord = try JSONSerialization.data(withJSONObject: ["version": 1, "settings": other])
        let result = handleSettingsPersistenceMessage(try JSONSerialization.data(withJSONObject: object), store: store)
        XCTAssertTrue(result.ok)
        XCTAssertEqual(result.settings?.model, "newer-model")
        XCTAssertEqual(store.writes, 0)
    }

    func testMigrationCreatesOnlyMissingSettings() throws {
        let store = MemoryStore()
        var object = try JSONSerialization.jsonObject(with: request("settings-save", settings: settings)) as! [String: Any]
        object["onlyIfMissing"] = true
        let data = try JSONSerialization.data(withJSONObject: object)
        XCTAssertTrue(handleSettingsPersistenceMessage(data, store: store).ok)
        XCTAssertTrue(handleSettingsPersistenceMessage(data, store: store).ok)
        XCTAssertEqual(store.writes, 1)
    }

    func testRealKeychainRoundTripInIsolatedNamespace() throws {
        guard ProcessInfo.processInfo.environment["TRANSLECT_TEST_KEYCHAIN"] == "1" else {
            throw XCTSkip("Set TRANSLECT_TEST_KEYCHAIN=1 for an isolated login Keychain round-trip.")
        }
        let service = "com.translect.tests.settings.\(UUID().uuidString)"
        let store = KeychainSettingsDataStore(service: service, account: "test")
        defer {
            let status = SecItemDelete([
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: "test",
                kSecAttrSynchronizable as String: false
            ] as CFDictionary)
            XCTAssertTrue(status == errSecSuccess || status == errSecItemNotFound)
        }
        XCTAssertNil(try store.load())
        XCTAssertTrue(handleSettingsPersistenceMessage(try request("settings-save", settings: settings), store: store).ok)
        let freshStore = KeychainSettingsDataStore(service: service, account: "test")
        XCTAssertEqual(handleSettingsPersistenceMessage(try request("settings-load"), store: freshStore).settings, settings)
        XCTAssertFalse(try freshStore.saveIfMissing(Data("must-not-replace".utf8)))
        XCTAssertEqual(handleSettingsPersistenceMessage(try request("settings-load"), store: freshStore).settings, settings)
        XCTAssertTrue(handleSettingsPersistenceMessage(try request("settings-save", settings: settings), store: freshStore).ok)
    }
}
