import Foundation
import OSLog
import SafariServices

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    private let logger = Logger(
        subsystem: "com.translect.safari.Extension",
        category: "NativeBridge"
    )

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[SFExtensionMessageKey]
        logger.info("Received native translation request.")

        Task {
            let payload = await responsePayload(for: message)
            if payload["ok"] as? Bool == true {
                logger.info("Native translation request completed successfully.")
            } else {
                logger.error(
                    "Native translation request failed: \(String(describing: payload["error"]), privacy: .public)"
                )
            }
            let response = NSExtensionItem()
            response.userInfo = [
                SFExtensionMessageKey: payload
            ]
            context.completeRequest(returningItems: [response], completionHandler: nil)
        }
    }

    private func responsePayload(for message: Any?) async -> [String: Any] {
        guard let message,
              JSONSerialization.isValidJSONObject(message) else {
            return failurePayload("Invalid local image translation request.")
        }

        do {
            let requestData = try JSONSerialization.data(withJSONObject: message)
            if let request = message as? [String: Any],
               request["operation"] as? String == "apple-intelligence-translate" {
                logger.info("Routing request to Apple Intelligence translation.")
                return try encodeResponse(
                    await handleAppleIntelligenceMessage(requestData)
                )
            }

            let visionResponse = handleVisionOCRMessage(requestData)
            return try encodeResponse(visionResponse)
        } catch {
            return failurePayload(String(describing: error))
        }
    }

    private func encodeResponse<Response: Encodable>(
        _ response: Response
    ) throws -> [String: Any] {
        let responseData = try JSONEncoder().encode(response)
        guard let payload = try JSONSerialization.jsonObject(with: responseData)
            as? [String: Any] else {
            throw NSError(
                domain: "Translect.NativeResponse",
                code: 1,
                userInfo: [
                    NSLocalizedDescriptionKey: "Could not encode the local image translation response."
                ]
            )
        }
        return payload
    }

    private func failurePayload(_ error: String) -> [String: Any] {
        [
            "ok": false,
            "error": error
        ]
    }
}
