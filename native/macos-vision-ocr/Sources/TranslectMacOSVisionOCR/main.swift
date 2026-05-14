import Foundation
import CoreGraphics
import ImageIO
import Vision

struct NativeRequest: Decodable {
    let id: String?
    let imageDataUrl: String
    let languages: [String]?
    let recognitionLevel: String?
}

struct NativeResponse: Encodable {
    let ok: Bool
    let id: String?
    let image_width: Int?
    let image_height: Int?
    let observations: [Observation]?
    let error: String?
}

struct Observation: Encodable {
    let text: String
    let confidence: Float
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

enum HostError: Error, CustomStringConvertible {
    case invalidImageDataUrl
    case invalidImageData
    case unsupportedImage
    case visionFailed(String)

    var description: String {
        switch self {
        case .invalidImageDataUrl:
            return "Invalid image data URL."
        case .invalidImageData:
            return "Invalid image data."
        case .unsupportedImage:
            return "Unsupported image format."
        case .visionFailed(let message):
            return "Vision OCR failed: \(message)"
        }
    }
}

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

func decodeImageDataUrl(_ dataUrl: String) throws -> Data {
    let components = dataUrl.split(separator: ",", maxSplits: 1, omittingEmptySubsequences: false)
    guard components.count == 2 else {
        throw HostError.invalidImageDataUrl
    }
    guard let data = Data(base64Encoded: String(components[1])) else {
        throw HostError.invalidImageData
    }
    return data
}

func makeCGImage(from data: Data) throws -> CGImage {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw HostError.unsupportedImage
    }
    return image
}

func pixelRect(from normalizedRect: CGRect, imageWidth: Int, imageHeight: Int) -> CGRect {
    let width = normalizedRect.width * Double(imageWidth)
    let height = normalizedRect.height * Double(imageHeight)
    let x = normalizedRect.minX * Double(imageWidth)
    let y = (1.0 - normalizedRect.maxY) * Double(imageHeight)
    return CGRect(x: x, y: y, width: width, height: height)
}

func recognizeText(request: NativeRequest) throws -> NativeResponse {
    let imageData = try decodeImageDataUrl(request.imageDataUrl)
    let image = try makeCGImage(from: imageData)
    let imageWidth = image.width
    let imageHeight = image.height

    var recognizedObservations: [Observation] = []
    var visionError: Error?

    let textRequest = VNRecognizeTextRequest { request, error in
        if let error {
            visionError = error
            return
        }

        let observations = request.results as? [VNRecognizedTextObservation] ?? []
        recognizedObservations = observations.compactMap { observation in
            guard let candidate = observation.topCandidates(1).first else {
                return nil
            }

            let rect = pixelRect(
                from: observation.boundingBox,
                imageWidth: imageWidth,
                imageHeight: imageHeight
            )

            return Observation(
                text: candidate.string,
                confidence: candidate.confidence,
                x: rect.origin.x,
                y: rect.origin.y,
                width: rect.width,
                height: rect.height
            )
        }
    }

    textRequest.recognitionLevel =
        request.recognitionLevel == "fast" ? .fast : .accurate
    textRequest.usesLanguageCorrection = true
    textRequest.recognitionLanguages = request.languages ?? ["zh-Hant", "zh-Hans", "en-US"]

    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([textRequest])

    if let visionError {
        throw HostError.visionFailed(visionError.localizedDescription)
    }

    return NativeResponse(
        ok: true,
        id: request.id,
        image_width: imageWidth,
        image_height: imageHeight,
        observations: recognizedObservations,
        error: nil
    )
}

func handleMessage(_ data: Data) -> NativeResponse {
    do {
        let request = try JSONDecoder().decode(NativeRequest.self, from: data)
        return try recognizeText(request: request)
    } catch {
        return NativeResponse(
            ok: false,
            id: nil,
            image_width: nil,
            image_height: nil,
            observations: nil,
            error: String(describing: error)
        )
    }
}

while let messageData = readNativeMessage() {
    let response = handleMessage(messageData)
    do {
        try writeNativeMessage(response)
    } catch {
        FileHandle.standardError.write(Data("Failed to write response: \(error)\n".utf8))
        exit(1)
    }
}
