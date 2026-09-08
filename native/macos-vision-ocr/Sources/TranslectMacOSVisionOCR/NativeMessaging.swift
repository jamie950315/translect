import Foundation

enum NativeMessagingError: Error, CustomStringConvertible {
    case truncatedMessage
    case invalidLength(Int)
    case responseTooLarge(Int)

    var description: String {
        switch self {
        case .truncatedMessage:
            return "Native message ended before its declared length."
        case .invalidLength(let length):
            return "Invalid native message length: \(length)."
        case .responseTooLarge(let length):
            return "Native response exceeds the browser's 1 MiB limit (\(length) bytes)."
        }
    }
}

func readNativeMessage(read: (Int) throws -> Data) throws -> Data? {
    func readExactly(_ count: Int, allowEOF: Bool = false) throws -> Data? {
        var data = Data()
        while data.count < count {
            let chunk = try read(count - data.count)
            if chunk.isEmpty {
                if allowEOF && data.isEmpty { return nil }
                throw NativeMessagingError.truncatedMessage
            }
            data.append(chunk)
        }
        return data
    }

    guard let header = try readExactly(4, allowEOF: true) else { return nil }
    // Decode bytes directly: Data does not guarantee UInt32 alignment.
    let length = header.enumerated().reduce(0) { $0 | (Int($1.element) << ($1.offset * 8)) }
    guard length > 0 && length <= 64 * 1024 * 1024 else {
        throw NativeMessagingError.invalidLength(length)
    }
    return try readExactly(length)
}

func encodeNativeMessage<T: Encodable>(_ message: T) throws -> Data {
    let data = try JSONEncoder().encode(message)
    guard data.count <= 1024 * 1024 else {
        throw NativeMessagingError.responseTooLarge(data.count)
    }
    var length = UInt32(data.count).littleEndian
    var framed = Data(bytes: &length, count: 4)
    framed.append(data)
    return framed
}
