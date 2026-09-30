import Foundation

func writeNativeMessage<T: Encodable>(_ message: T) throws {
    try FileHandle.standardOutput.write(contentsOf: encodeNativeMessage(message))
}

do {
    while let messageData = try readNativeMessage(read: {
        try FileHandle.standardInput.read(upToCount: $0) ?? Data()
    }) {
        switch nativeMessageOperation(messageData) {
        case "settings-load", "settings-save":
            try writeNativeMessage(handleSettingsPersistenceMessage(messageData))
        case "apple-intelligence-translate":
            try await writeNativeMessage(
                handleAppleIntelligenceMessage(messageData)
            )
        default:
            try writeNativeMessage(handleVisionOCRMessage(messageData))
        }
    }
} catch {
    FileHandle.standardError.write(Data("Native messaging failed: \(error)\n".utf8))
    exit(1)
}
