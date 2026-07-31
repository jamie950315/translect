import Foundation
import SafariServices

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[SFExtensionMessageKey]

        let response = NSExtensionItem()
        response.userInfo = [
            SFExtensionMessageKey: responsePayload(for: message)
        ]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }

    private func responsePayload(for message: Any?) -> [String: Any] {
        guard let message,
              JSONSerialization.isValidJSONObject(message) else {
            return failurePayload("Invalid macOS Vision OCR request.")
        }

        do {
            let requestData = try JSONSerialization.data(withJSONObject: message)
            let visionResponse = handleVisionOCRMessage(requestData)
            let responseData = try JSONEncoder().encode(visionResponse)
            guard let response = try JSONSerialization.jsonObject(with: responseData)
                as? [String: Any] else {
                return failurePayload("Could not encode the macOS Vision OCR response.")
            }
            return response
        } catch {
            return failurePayload(String(describing: error))
        }
    }

    private func failurePayload(_ error: String) -> [String: Any] {
        [
            "ok": false,
            "error": error
        ]
    }
}
