import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

struct AppleIntelligenceRequest: Decodable {
    let id: String?
    let imageDataUrl: String
    let operation: String?
    let targetLanguage: String
}

private struct NativeOperationEnvelope: Decodable {
    let operation: String?
}

func isAppleIntelligenceTranslationRequest(_ data: Data) -> Bool {
    let envelope = try? JSONDecoder().decode(NativeOperationEnvelope.self, from: data)
    return envelope?.operation == "apple-intelligence-translate"
}

struct AppleIntelligenceResponse: Encodable {
    let ok: Bool
    let id: String?
    let image_width: Int?
    let image_height: Int?
    let observations: [AppleIntelligenceObservation]?
    let error: String?
}

struct AppleIntelligenceObservation: Encodable {
    let text: String
    let confidence: Float
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    let rotation: Double
    let flow_group_id: String
    let flow_box_index: Int
    let semantic_label: String
    let translated_text: String
}

struct AppleIntelligenceTextGroup {
    let index: Int
    let observationIndexes: [Int]
    let text: String
}

struct AppleIntelligenceGroupTranslation {
    let groupIndex: Int
    let semanticLabel: String
    let translatedText: String
}

enum AppleIntelligenceTranslationError: Error, CustomStringConvertible {
    case unavailable(String)
    case incompleteResponse
    case invalidTargetLanguage

    var description: String {
        switch self {
        case .unavailable(let reason):
            return reason
        case .incompleteResponse:
            return "Apple Intelligence must return exactly one non-empty translation for every requested text group."
        case .invalidTargetLanguage:
            return "Target language is required."
        }
    }
}

func validateAppleIntelligenceTranslations(
    _ translations: [AppleIntelligenceGroupTranslation],
    for groups: [AppleIntelligenceTextGroup]
) throws {
    guard translations.count == groups.count,
          translations.allSatisfy({ !$0.translatedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }),
          Set(translations.map(\.groupIndex)) == Set(groups.map(\.index)) else {
        throw AppleIntelligenceTranslationError.incompleteResponse
    }
}

private func horizontalOverlapRatio(
    _ first: VisionOCRObservation,
    _ second: VisionOCRObservation
) -> Double {
    let left = max(first.x, second.x)
    let right = min(first.x + first.width, second.x + second.width)
    let overlap = max(0, right - left)
    return overlap / max(1, min(first.width, second.width))
}

private func shouldJoinAppleIntelligenceLine(
    _ previous: VisionOCRObservation,
    _ next: VisionOCRObservation
) -> Bool {
    guard abs(previous.rotation - next.rotation) <= 4 else {
        return false
    }

    let verticalGap = next.y - (previous.y + previous.height)
    let averageHeight = (next.height + previous.height) / 2
    let leftDelta = abs(next.x - previous.x)
    let overlap = horizontalOverlapRatio(previous, next)
    let heightRatio = max(next.height, previous.height) / max(1, min(next.height, previous.height))

    return verticalGap >= -averageHeight * 0.35
        && verticalGap <= max(4, averageHeight * 0.75)
        && heightRatio <= 1.8
        && (overlap >= 0.25 || leftDelta <= max(54, averageHeight * 2.4))
}

func groupAppleIntelligenceObservations(
    _ observations: [VisionOCRObservation]
) -> [AppleIntelligenceTextGroup] {
    let maximumLinesPerGroup = 8
    let sorted = observations.enumerated().sorted { first, second in
        if first.element.y == second.element.y {
            return first.element.x < second.element.x
        }
        return first.element.y < second.element.y
    }

    var groupedIndexes: [[Int]] = []
    for item in sorted {
        if let currentGroup = groupedIndexes.last,
           currentGroup.count < maximumLinesPerGroup,
           let previousIndex = currentGroup.last,
           shouldJoinAppleIntelligenceLine(observations[previousIndex], item.element) {
            groupedIndexes[groupedIndexes.count - 1].append(item.offset)
        } else {
            groupedIndexes.append([item.offset])
        }
    }

    return groupedIndexes.enumerated().map { groupIndex, indexes in
        AppleIntelligenceTextGroup(
            index: groupIndex,
            observationIndexes: indexes,
            text: indexes.map { observations[$0].text }.joined(separator: "\n")
        )
    }
}

func filterAppleIntelligenceTranslationGroups(
    _ groups: [AppleIntelligenceTextGroup]
) -> [AppleIntelligenceTextGroup] {
    groups.filter { group in
        group.text.unicodeScalars.contains { scalar in
            CharacterSet.alphanumerics.contains(scalar)
        }
    }
}

private func shouldRenderAppleIntelligenceTranslation(
    sourceText: String,
    translation: AppleIntelligenceGroupTranslation
) -> Bool {
    let translatedText = translation.translatedText.trimmingCharacters(
        in: .whitespacesAndNewlines
    )
    guard translatedText != sourceText else {
        return false
    }

    let sourceHasLetters = sourceText.unicodeScalars.contains {
        CharacterSet.letters.contains($0)
    }
    let translationHasLetters = translatedText.unicodeScalars.contains {
        CharacterSet.letters.contains($0)
    }
    guard sourceHasLetters || translationHasLetters else {
        return false
    }

    let protectedLabels = ["metadata", "code", "other"]
    let isProtectedLabel = protectedLabels.contains(translation.semanticLabel.lowercased())
    let isAsciiOnlyRewrite = sourceText.unicodeScalars.allSatisfy(\.isASCII)
        && translatedText.unicodeScalars.allSatisfy(\.isASCII)
    return !isProtectedLabel || !isAsciiOnlyRewrite
}

func mergeAppleIntelligenceTranslations(
    observations: [VisionOCRObservation],
    groups: [AppleIntelligenceTextGroup],
    translations: [AppleIntelligenceGroupTranslation],
    imageID: String
) -> [AppleIntelligenceObservation] {
    let translationsByGroup = Dictionary(
        translations.map { ($0.groupIndex, $0) },
        uniquingKeysWith: { first, _ in first }
    )
    let sourceTextByGroup = Dictionary(
        groups.map { ($0.index, $0.text.trimmingCharacters(in: .whitespacesAndNewlines)) },
        uniquingKeysWith: { first, _ in first }
    )
    var placementByObservation: [Int: (groupIndex: Int, boxIndex: Int)] = [:]

    for group in groups {
        for (boxIndex, observationIndex) in group.observationIndexes.enumerated() {
            placementByObservation[observationIndex] = (group.index, boxIndex)
        }
    }

    return observations.enumerated().compactMap { observationIndex, observation in
        guard let placement = placementByObservation[observationIndex],
              let translation = translationsByGroup[placement.groupIndex],
              let sourceText = sourceTextByGroup[placement.groupIndex],
              shouldRenderAppleIntelligenceTranslation(
                sourceText: sourceText,
                translation: translation
              ) else {
            return nil
        }

        return AppleIntelligenceObservation(
            text: observation.text,
            confidence: observation.confidence,
            x: observation.x,
            y: observation.y,
            width: observation.width,
            height: observation.height,
            rotation: observation.rotation,
            flow_group_id: "\(imageID):flow:\(placement.groupIndex)",
            flow_box_index: placement.boxIndex,
            semantic_label: translation.semanticLabel,
            translated_text: translation.translatedText
        )
    }
}

func buildAppleIntelligenceTranslationPrompt(
    groups: [AppleIntelligenceTextGroup],
    targetLanguage: String
) -> String {
    let source = groups.map { group in
        "GROUP_INDEX \(group.index)\n\(group.text)"
    }.joined(separator: "\n\n")

    return """
    TARGET_LANGUAGE: \(targetLanguage)

    Translate every translatable word and phrase in every group into TARGET_LANGUAGE.
    If a group is already in TARGET_LANGUAGE, preserve it. Preserve product names, numbers, and units.
    Do not copy source-language text into translatedText when it has a natural TARGET_LANGUAGE translation.
    Return exactly one result for every GROUP_INDEX and preserve each index exactly.

    SOURCE_GROUPS:
    \(source)
    """
}

func makeAppleIntelligenceTranslationBatches(
    _ groups: [AppleIntelligenceTextGroup],
    maxGroupCount: Int = 32,
    maxSourceBytes: Int = 6_000
) -> [[AppleIntelligenceTextGroup]] {
    var batches: [[AppleIntelligenceTextGroup]] = []
    var currentBatch: [AppleIntelligenceTextGroup] = []
    var currentSourceBytes = 0

    for group in groups {
        let groupSourceBytes = group.text.lengthOfBytes(using: .utf8)
        let exceedsGroupLimit = currentBatch.count >= maxGroupCount
        let exceedsSourceLimit = currentSourceBytes + groupSourceBytes > maxSourceBytes

        if !currentBatch.isEmpty && (exceedsGroupLimit || exceedsSourceLimit) {
            batches.append(currentBatch)
            currentBatch = []
            currentSourceBytes = 0
        }

        currentBatch.append(group)
        currentSourceBytes += groupSourceBytes
    }

    if !currentBatch.isEmpty {
        batches.append(currentBatch)
    }

    return batches
}

#if canImport(FoundationModels)
@available(macOS 26.0, *)
@Generable
private struct GeneratedAppleIntelligenceGroupTranslation {
    @Guide(description: "The exact zero-based group index from the input")
    var groupIndex: Int

    @Guide(
        description: "The semantic role of this text in the image",
        .anyOf(["heading", "body", "caption", "button", "navigation", "metadata", "code", "other"])
    )
    var semanticLabel: String

    @Guide(description: "A concise, natural translation that fits the original text area")
    var translatedText: String
}

@available(macOS 26.0, *)
@Generable
private struct GeneratedAppleIntelligenceTranslationBatch {
    var groups: [GeneratedAppleIntelligenceGroupTranslation]
}

@available(macOS 26.0, *)
private func appleIntelligenceUnavailableMessage(
    _ reason: SystemLanguageModel.Availability.UnavailableReason
) -> String {
    switch reason {
    case .deviceNotEligible:
        return "Apple Intelligence is not supported on this Mac."
    case .appleIntelligenceNotEnabled:
        return "Apple Intelligence is turned off. Enable it in System Settings and try again."
    case .modelNotReady:
        return "The Apple Intelligence on-device model is not ready yet. Wait for its download to finish and try again."
    @unknown default:
        return "Apple Intelligence is currently unavailable."
    }
}

@available(macOS 26.0, *)
private func translateWithAppleIntelligence(
    groups: [AppleIntelligenceTextGroup],
    targetLanguage: String
) async throws -> [AppleIntelligenceGroupTranslation] {
    let model = SystemLanguageModel(
        useCase: .general,
        guardrails: .permissiveContentTransformations
    )
    if case .unavailable(let reason) = model.availability {
        throw AppleIntelligenceTranslationError.unavailable(
            appleIntelligenceUnavailableMessage(reason)
        )
    }

    var translations: [AppleIntelligenceGroupTranslation] = []

    for batch in makeAppleIntelligenceTranslationBatches(groups) {
        let prompt = buildAppleIntelligenceTranslationPrompt(
            groups: batch,
            targetLanguage: targetLanguage
        )

        let session = LanguageModelSession(
            model: model,
            instructions: """
            You label and translate OCR text found in webpage images.
            Return one result for every GROUP_INDEX and preserve each index exactly.
            Obey the TARGET_LANGUAGE in each prompt. Preserve names, numbers, and intentional line meaning.
            Keep each translation concise enough to fit the original text area.
            Choose the closest semantic label from the provided schema.
            Never add explanations or text that is not present in the source groups.
            """
        )
        let response = try await session.respond(
            to: prompt,
            generating: GeneratedAppleIntelligenceTranslationBatch.self,
            options: GenerationOptions(sampling: .greedy)
        )
        let batchTranslations = response.content.groups.map {
            AppleIntelligenceGroupTranslation(
                groupIndex: $0.groupIndex,
                semanticLabel: $0.semanticLabel,
                translatedText: $0.translatedText.trimmingCharacters(in: .whitespacesAndNewlines)
            )
        }
        try validateAppleIntelligenceTranslations(batchTranslations, for: batch)
        translations.append(contentsOf: batchTranslations)
    }

    return translations
}
#endif

func handleAppleIntelligenceMessage(_ data: Data) async -> AppleIntelligenceResponse {
    var requestID: String?

    do {
        let request = try JSONDecoder().decode(AppleIntelligenceRequest.self, from: data)
        requestID = request.id
        let targetLanguage = request.targetLanguage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !targetLanguage.isEmpty else {
            throw AppleIntelligenceTranslationError.invalidTargetLanguage
        }

        let visionResponse = try recognizeText(
            request: VisionOCRRequest(
                id: request.id,
                imageDataUrl: request.imageDataUrl,
                languages: nil,
                recognitionLevel: "accurate"
            )
        )
        let observations = visionResponse.observations ?? []
        guard !observations.isEmpty else {
            return AppleIntelligenceResponse(
                ok: true,
                id: request.id,
                image_width: visionResponse.image_width,
                image_height: visionResponse.image_height,
                observations: [],
                error: nil
            )
        }

        let groups = filterAppleIntelligenceTranslationGroups(
            groupAppleIntelligenceObservations(observations)
        )
        guard !groups.isEmpty else {
            return AppleIntelligenceResponse(
                ok: true,
                id: request.id,
                image_width: visionResponse.image_width,
                image_height: visionResponse.image_height,
                observations: [],
                error: nil
            )
        }
        let translations: [AppleIntelligenceGroupTranslation]

        #if canImport(FoundationModels)
        if #available(macOS 26.0, *) {
            translations = try await translateWithAppleIntelligence(
                groups: groups,
                targetLanguage: targetLanguage
            )
        } else {
            throw AppleIntelligenceTranslationError.unavailable(
                "Apple Intelligence translation requires macOS 26 or later."
            )
        }
        #else
        throw AppleIntelligenceTranslationError.unavailable(
            "This build does not include the Apple Foundation Models framework."
        )
        #endif

        let merged = mergeAppleIntelligenceTranslations(
            observations: observations,
            groups: groups,
            translations: translations,
            imageID: request.id ?? "image-0"
        )

        return AppleIntelligenceResponse(
            ok: true,
            id: request.id,
            image_width: visionResponse.image_width,
            image_height: visionResponse.image_height,
            observations: merged,
            error: nil
        )
    } catch {
        return AppleIntelligenceResponse(
            ok: false,
            id: requestID,
            image_width: nil,
            image_height: nil,
            observations: nil,
            error: String(describing: error)
        )
    }
}
