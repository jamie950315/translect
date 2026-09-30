import Foundation
import Security

// Store the entire configuration atomically, outside Safari's disposable web storage.
// The login Keychain keeps access tied to the signed executable across app updates.
struct PersistentSettings: Codable, Equatable {
    let apiEndpoint: String
    let apiKey: String
    let iosOcrEndpoint: String
    let macosVisionHostName: String
    let model: String
    let targetLanguage: String
    let alwaysAutoDetect: Bool
    let triggerUsesAutoMode: Bool
    let useAppleIntelligence: Bool
    let useIosOcrServer: Bool
    let useMacosVisionOcr: Bool

    func validate() throws {
        let strings = [apiEndpoint, apiKey, iosOcrEndpoint, macosVisionHostName, model, targetLanguage]
        guard strings.allSatisfy({ $0.utf8.count <= 16_384 }),
              [useAppleIntelligence, useIosOcrServer, useMacosVisionOcr].filter({ $0 }).count <= 1 else {
            throw SettingsPersistenceError.invalidSettings
        }
    }
}

enum SettingsPersistenceError: Error, LocalizedError {
    case invalidSettings
    case invalidRecord
    case unsupportedVersion
    case keychain(OSStatus)

    var errorDescription: String? {
        switch self {
        case .invalidSettings: return "The settings are invalid; the saved Mac settings were not changed."
        case .invalidRecord: return "The saved Mac settings are damaged; they were not replaced."
        case .unsupportedVersion: return "The saved Mac settings require a newer version of Translect."
        case .keychain(let status): return "Mac settings could not be accessed in Keychain (status \(status)). Unlock your login Keychain and allow Translect access."
        }
    }
}

protocol SettingsDataStore {
    func load() throws -> Data?
    func save(_ data: Data) throws
    // Returns false if another instance has already stored a configuration.
    func saveIfMissing(_ data: Data) throws -> Bool
}

struct KeychainSettingsDataStore: SettingsDataStore {
    let service: String
    let account: String

    init(service: String = "com.translect.settings", account: String = "default") {
        self.service = service
        self.account = account
    }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account,
         kSecAttrSynchronizable as String: false]
    }

    func load() throws -> Data? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw SettingsPersistenceError.keychain(status) }
        guard let data = result as? Data else { throw SettingsPersistenceError.invalidRecord }
        return data
    }

    func save(_ data: Data) throws {
        let attributes = [kSecValueData as String: data]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var request = query
            request[kSecValueData as String] = data
            request[kSecAttrLabel as String] = "Translect settings"
            status = SecItemAdd(request as CFDictionary, nil)
            // Another signed instance may create the item between update and add.
            if status == errSecDuplicateItem {
                status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
            }
        }
        guard status == errSecSuccess else { throw SettingsPersistenceError.keychain(status) }
    }

    func saveIfMissing(_ data: Data) throws -> Bool {
        var request = query
        request[kSecValueData as String] = data
        request[kSecAttrLabel as String] = "Translect settings"
        let status = SecItemAdd(request as CFDictionary, nil)
        if status == errSecDuplicateItem { return false }
        guard status == errSecSuccess else { throw SettingsPersistenceError.keychain(status) }
        return true
    }
}

struct PersistentSettingsRecord: Codable {
    let version: Int
    let settings: PersistentSettings
}

struct SettingsPersistenceResponse: Encodable {
    let ok: Bool
    let settings: PersistentSettings?
    let error: String?

    // Keep an explicit null for an empty Keychain, distinct from malformed responses.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(ok, forKey: .ok)
        try container.encode(settings, forKey: .settings)
        try container.encodeIfPresent(error, forKey: .error)
    }
    private enum CodingKeys: String, CodingKey { case ok, settings, error }
}

private struct SettingsPersistenceRequest: Decodable {
    let operation: String
    let settings: PersistentSettings?
    let onlyIfMissing: Bool?
}

private func loadPersistentSettings(from store: any SettingsDataStore) throws -> PersistentSettings? {
    guard let stored = try store.load() else { return nil }
    guard stored.count <= 131_072 else { throw SettingsPersistenceError.invalidRecord }
    let version: Int
    do {
        struct Version: Decodable { let version: Int }
        version = try JSONDecoder().decode(Version.self, from: stored).version
    } catch { throw SettingsPersistenceError.invalidRecord }
    guard version == 1 else { throw SettingsPersistenceError.unsupportedVersion }
    do {
        let settings = try JSONDecoder().decode(PersistentSettingsRecord.self, from: stored).settings
        try settings.validate()
        return settings
    } catch { throw SettingsPersistenceError.invalidRecord }
}

func isSettingsPersistenceRequest(_ data: Data) -> Bool {
    let operation = nativeMessageOperation(data)
    return operation == "settings-load" || operation == "settings-save"
}

func handleSettingsPersistenceMessage(
    _ data: Data,
    store: any SettingsDataStore = KeychainSettingsDataStore()
) -> SettingsPersistenceResponse {
    do {
        guard data.count <= 131_072 else { throw SettingsPersistenceError.invalidSettings }
        let request: SettingsPersistenceRequest
        do { request = try JSONDecoder().decode(SettingsPersistenceRequest.self, from: data) }
        catch { throw SettingsPersistenceError.invalidSettings }

        // Validate existing data before writes, so an older app cannot overwrite a
        // newer schema or silently replace damaged data with browser defaults.
        let saved = try loadPersistentSettings(from: store)
        switch request.operation {
        case "settings-load":
            return SettingsPersistenceResponse(ok: true, settings: saved, error: nil)
        case "settings-save":
            guard let settings = request.settings else { throw SettingsPersistenceError.invalidSettings }
            try settings.validate()
            let encoded = try JSONEncoder().encode(PersistentSettingsRecord(version: 1, settings: settings))
            guard encoded.count <= 131_072 else { throw SettingsPersistenceError.invalidSettings }
            if request.onlyIfMissing == true {
                if let saved {
                    return SettingsPersistenceResponse(ok: true, settings: saved, error: nil)
                }
                if try !store.saveIfMissing(encoded) {
                    // A different app build won the migration race. Return its
                    // configuration rather than publishing this stale cache.
                    guard let current = try loadPersistentSettings(from: store) else {
                        throw SettingsPersistenceError.invalidRecord
                    }
                    return SettingsPersistenceResponse(ok: true, settings: current, error: nil)
                }
            } else {
                try store.save(encoded)
            }
            return SettingsPersistenceResponse(ok: true, settings: settings, error: nil)
        default:
            throw SettingsPersistenceError.invalidSettings
        }
    } catch {
        // Decoder errors can include input values; never forward them or secrets.
        let message = (error as? SettingsPersistenceError)?.errorDescription
            ?? "Mac settings could not be saved or restored."
        return SettingsPersistenceResponse(ok: false, settings: nil, error: message)
    }
}
