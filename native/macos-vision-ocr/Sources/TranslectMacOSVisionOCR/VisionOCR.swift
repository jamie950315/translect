import CoreGraphics
import Foundation
import ImageIO
import Vision

struct VisionOCRRequest: Decodable {
    let id: String?
    let imageDataUrl: String
    let languages: [String]?
    let recognitionLevel: String?
}

struct VisionOCRResponse: Encodable {
    let ok: Bool
    let id: String?
    let image_width: Int?
    let image_height: Int?
    let observations: [VisionOCRObservation]?
    let error: String?
}

struct VisionOCRObservation: Encodable {
    let text: String
    let confidence: Float
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

enum VisionOCRError: Error, CustomStringConvertible {
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

func decodeImageDataUrl(_ dataUrl: String) throws -> Data {
    let components = dataUrl.split(separator: ",", maxSplits: 1, omittingEmptySubsequences: false)
    guard components.count == 2 else {
        throw VisionOCRError.invalidImageDataUrl
    }
    guard let data = Data(base64Encoded: String(components[1])) else {
        throw VisionOCRError.invalidImageData
    }
    return data
}

func makeCGImage(from data: Data) throws -> CGImage {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw VisionOCRError.unsupportedImage
    }
    return image
}

func pixelRect(from normalizedRect: CGRect, imageWidth: Int, imageHeight: Int) -> CGRect {
    let width = normalizedRect.width * CGFloat(imageWidth)
    let height = normalizedRect.height * CGFloat(imageHeight)
    let x = normalizedRect.minX * CGFloat(imageWidth)
    let y = (1.0 - normalizedRect.maxY) * CGFloat(imageHeight)
    return CGRect(x: x, y: y, width: width, height: height)
}

func recognizeText(request: VisionOCRRequest) throws -> VisionOCRResponse {
    let imageData = try decodeImageDataUrl(request.imageDataUrl)
    let image = try makeCGImage(from: imageData)
    let imageWidth = image.width
    let imageHeight = image.height

    var recognizedObservations: [VisionOCRObservation] = []
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

            return VisionOCRObservation(
                text: candidate.string,
                confidence: candidate.confidence,
                x: Double(rect.origin.x),
                y: Double(rect.origin.y),
                width: Double(rect.width),
                height: Double(rect.height)
            )
        }
    }

    textRequest.recognitionLevel = request.recognitionLevel == "fast" ? .fast : .accurate
    textRequest.usesLanguageCorrection = true
    textRequest.recognitionLanguages = request.languages ?? ["zh-Hant", "zh-Hans", "en-US"]

    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([textRequest])

    if let visionError {
        throw VisionOCRError.visionFailed(visionError.localizedDescription)
    }

    return VisionOCRResponse(
        ok: true,
        id: request.id,
        image_width: imageWidth,
        image_height: imageHeight,
        observations: recognizedObservations,
        error: nil
    )
}

func handleVisionOCRMessage(_ data: Data) -> VisionOCRResponse {
    do {
        let request = try JSONDecoder().decode(VisionOCRRequest.self, from: data)
        do {
            return try recognizeText(request: request)
        } catch {
            return VisionOCRResponse(
                ok: false,
                id: request.id,
                image_width: nil,
                image_height: nil,
                observations: nil,
                error: String(describing: error)
            )
        }
    } catch {
        return VisionOCRResponse(
            ok: false,
            id: nil,
            image_width: nil,
            image_height: nil,
            observations: nil,
            error: String(describing: error)
        )
    }
}
