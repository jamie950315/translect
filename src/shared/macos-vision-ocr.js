import { buildChatCompletionSamplingOptions } from "./api.js";
import { readOcrTranslations, validateOcrResponse } from "./translation-response.js";

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function horizontalOverlapRatio(first, second) {
  const left = Math.max(first.x, second.x);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const overlap = Math.max(0, right - left);
  return overlap / Math.max(1, Math.min(first.width, second.width));
}

function shouldJoinLine(group, line) {
  const last = group.lines.at(-1);
  if (Math.abs(line.rotation - last.rotation) > 4) {
    return false;
  }

  const verticalGap = line.y - (last.y + last.height);
  const averageHeight = (line.height + last.height) / 2;
  const leftDelta = Math.abs(line.x - last.x);
  const overlap = horizontalOverlapRatio(last, line);
  const similarHeight =
    Math.max(line.height, last.height) / Math.max(1, Math.min(line.height, last.height)) <= 1.8;

  return (
    verticalGap >= -averageHeight * 0.35 &&
    verticalGap <= Math.max(4, averageHeight * 0.75) &&
    similarHeight &&
    (overlap >= 0.25 || leftDelta <= Math.max(54, averageHeight * 2.4))
  );
}

function defaultStyle(rotation = 0) {
  const normalizedRotation = Math.abs(Number(rotation) || 0) % 180;
  const isVertical = normalizedRotation >= 78 && normalizedRotation <= 102;
  return {
    textColor: "#111111",
    backgroundColor: "#f5f1e8",
    backgroundOpacity: 0.7,
    align: isVertical ? "center" : "left",
    container: "image-text",
    fontWeight: 540,
    strokeColor: "#ffffff",
    strokeWidth: 0,
    verticalAlign: "middle"
  };
}

function boxFromObservation(observation, imageWidth, imageHeight) {
  const source = observation?.bounding_box || observation?.boundingBox || observation || {};
  return {
    x: clampNumber(source.x, 0, imageWidth, 0),
    y: clampNumber(source.y, 0, imageHeight, 0),
    width: clampNumber(source.width, 0, imageWidth, 0),
    height: clampNumber(source.height, 0, imageHeight, 0),
    rotation: clampNumber(source.rotation ?? observation?.rotation, -180, 180, 0)
  };
}

function normalizePixelBounds(rect, imageWidth, imageHeight, rotation = 0) {
  return {
    x: clampNumber((rect.x / imageWidth) * 1000, 0, 1000, 0),
    y: clampNumber((rect.y / imageHeight) * 1000, 0, 1000, 0),
    width: clampNumber((rect.width / imageWidth) * 1000, 0, 1000, 0),
    height: clampNumber((rect.height / imageHeight) * 1000, 0, 1000, 0),
    rotation: clampNumber(rotation, -180, 180, 0)
  };
}

function groupVisionLines(lines) {
  const groups = [];
  const sortedLines = [...lines].sort((first, second) => first.y - second.y || first.x - second.x);

  for (const line of sortedLines) {
    const lastGroup = groups.at(-1);
    if (lastGroup && shouldJoinLine(lastGroup, line)) {
      lastGroup.lines.push(line);
    } else {
      groups.push({ lines: [line] });
    }
  }

  return groups;
}

export function normalizeMacosVisionOcrResult(imageId, responseJson) {
  validateOcrResponse(responseJson, "observations");
  const imageWidth = clampNumber(responseJson?.image_width ?? responseJson?.imageWidth, 1, 100000, 1);
  const imageHeight = clampNumber(responseJson?.image_height ?? responseJson?.imageHeight, 1, 100000, 1);
  const observations = Array.isArray(responseJson?.observations) ? responseJson.observations : [];
  const lines = observations
    .map((observation, index) => {
      const box = boxFromObservation(observation, imageWidth, imageHeight);
      return {
        ...box,
        index,
        sourceText: normalizeText(observation?.text || observation?.rawValue)
      };
    })
    .filter((line) => line.sourceText && line.width > 0 && line.height > 0);

  return {
    imageId,
    imageWidth,
    imageHeight,
    blocks: groupVisionLines(lines)
      .flatMap((group, groupIndex) =>
        group.lines.map((line, flowBoxIndex) => ({
          flowBoxIndex,
          flowGroupId: `${imageId}:flow:${groupIndex}`,
          line
        }))
      )
      .map(({ flowBoxIndex, flowGroupId, line }, index) => ({
        id: `${imageId}:${index}`,
        flowBoxIndex,
        flowGroupId,
        provider: "macos-vision",
        sourceLineCount: 1,
        sourceText: line.sourceText,
        bounds: normalizePixelBounds(line, imageWidth, imageHeight, line.rotation),
        style: defaultStyle(line.rotation)
      }))
      .filter((block) => block.sourceText && block.bounds.width > 0 && block.bounds.height > 0)
  };
}

export function normalizeAppleIntelligenceResult(imageId, responseJson) {
  validateOcrResponse(responseJson, "observations");
  const imageWidth = clampNumber(
    responseJson?.image_width ?? responseJson?.imageWidth,
    1,
    100000,
    1
  );
  const imageHeight = clampNumber(
    responseJson?.image_height ?? responseJson?.imageHeight,
    1,
    100000,
    1
  );
  const observations = Array.isArray(responseJson?.observations)
    ? responseJson.observations
    : [];

  const blocks = observations
    .map((observation, index) => {
      const sourceText = normalizeText(observation?.text || observation?.rawValue);
      const flowText = normalizeText(
        observation?.translated_text ?? observation?.translatedText
      );
      const flowGroupId = normalizeText(
        observation?.flow_group_id ?? observation?.flowGroupId
      );
      const semanticLabel = normalizeText(
        observation?.semantic_label ?? observation?.semanticLabel
      );
      const box = boxFromObservation(observation, imageWidth, imageHeight);

      return {
        bounds: normalizePixelBounds(box, imageWidth, imageHeight, box.rotation),
        flowBoxIndex: clampNumber(
          observation?.flow_box_index ?? observation?.flowBoxIndex,
          0,
          observations.length,
          index
        ),
        flowGroupId: flowGroupId || `${imageId}:flow:${index}`,
        flowText,
        groupId: flowGroupId || `${imageId}:flow:${index}`,
        provider: "macos-vision",
        semanticLabel,
        sourceLineCount: 1,
        sourceText,
        style: defaultStyle(box.rotation),
        translatedText: ""
      };
    })
    .filter(
      (block) =>
        block.sourceText &&
        block.flowText &&
        block.bounds.width > 0 &&
        block.bounds.height > 0
    );

  return {
    imageId,
    translation: { blocks }
  };
}

export function buildMacosVisionTextTranslationPayload({ model, ocrImages, targetLanguage }) {
  const compactImages = ocrImages.map((image) => {
    const groupsById = new Map();

    for (const block of image.blocks) {
      const groupId = block.flowGroupId || block.id;
      if (!groupsById.has(groupId)) {
        groupsById.set(groupId, []);
      }
      groupsById.get(groupId).push(block);
    }

    return {
      image_id: image.imageId,
      groups: Array.from(groupsById.entries()).map(([groupId, blocks]) => ({
        box_ids: blocks.map((block) => block.id),
        group_id: groupId,
        text: blocks.map((block) => block.sourceText).join("\n")
      }))
    };
  });

  return {
    model,
    ...buildChatCompletionSamplingOptions(model),
    response_format: {
      type: "json_object"
    },
    messages: [
      {
        role: "system",
        content: [
          "You are a text translation engine.",
          "Do not perform OCR and do not invent, split, or reposition boxes.",
          `Translate each provided text group into ${targetLanguage}.`,
          "Return only valid JSON with this shape:",
          "{\"images\":[{\"image_id\":\"image-a\",\"groups\":[{\"group_id\":\"image-a:flow:0\",\"translated_text\":\"...\"}]}]}",
          "Preserve image_id and group_id exactly. Keep translations concise and natural."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          target_language: targetLanguage,
          images: compactImages
        })
      }
    ]
  };
}

export function mergeMacosVisionTranslationResults(ocrImages, translationResponse) {
  const translatedByGroup = readOcrTranslations(ocrImages, translationResponse, {
    collection: "groups", idKey: "group_id", sourceId: (block) => block.flowGroupId || block.id
  });

  return ocrImages.map((image) => ({
    imageId: image.imageId,
    translation: {
      blocks: image.blocks
        .map((block) => {
          const flowText = translatedByGroup.get(block.flowGroupId || block.id);
          return {
            flowBoxIndex: block.flowBoxIndex,
            flowGroupId: block.flowGroupId,
            flowText,
            groupId: block.flowGroupId || "",
            provider: block.provider,
            sourceLineCount: block.sourceLineCount,
            sourceText: block.sourceText,
            translatedText: "",
            bounds: block.bounds,
            style: block.style
          };
        })
    }
  }));
}
