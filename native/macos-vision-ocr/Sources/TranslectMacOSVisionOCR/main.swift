import Foundation

func readNativeMessage() -> Data? {
    let stdin = FileHandle.standardInput
    let lengthData = stdin.readData(ofLength: 4)
    if lengthData.isEmpty {
        return nil
    }
    guard lengthData.count == 4 else {
        return nil
    }

    let length = lengthData.withUnsafeBytes { rawBuffer in
        rawBuffer.load(as: UInt32.self).littleEndian
    }
    if length == 0 {
        return Data()
    }

    return stdin.readData(ofLength: Int(length))
}

func writeNativeMessage<T: Encodable>(_ message: T) throws {
    let data = try JSONEncoder().encode(message)
    var length = UInt32(data.count).littleEndian
    let lengthData = Data(bytes: &length, count: 4)
    FileHandle.standardOutput.write(lengthData)
    FileHandle.standardOutput.write(data)
}

while let messageData = readNativeMessage() {
    let response = handleVisionOCRMessage(messageData)
    do {
        try writeNativeMessage(response)
    } catch {
        FileHandle.standardError.write(Data("Failed to write response: \(error)\n".utf8))
        exit(1)
    }
}
