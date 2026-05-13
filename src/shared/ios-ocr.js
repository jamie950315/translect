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

function mostlyNumericText(text) {
  const compact = text.replace(/\s+/g, "");
  if (!compact) {
    return false;
  }
  const numericChars = compact.replace(/[^\d.,:$%/-]/g, "").length;
  return numericChars / compact.length >= 0.82;
}

function boundsFromOcrBox(box, imageWidth, imageHeight) {
  return {
    x: clampNumber((Number(box?.x) / imageWidth) * 1000, 0, 1000, 0),
    y: clampNumber((Number(box?.y) / imageHeight) * 1000, 0, 1000, 0),
    width: clampNumber((Number(box?.w) / imageWidth) * 1000, 0, 1000, 0),
    height: clampNumber((Number(box?.h) / imageHeight) * 1000, 0, 1000, 0),
    rotation: rotationFromRect(box?.rect)
  };
}

function rotationFromRect(rect) {
  const leftX = Number(rect?.topLeft_x);
  const leftY = Number(rect?.topLeft_y);
  const rightX = Number(rect?.topRight_x);
  const rightY = Number(rect?.topRight_y);

  if (
    !Number.isFinite(leftX) ||
    !Number.isFinite(leftY) ||
    !Number.isFinite(rightX) ||
    !Number.isFinite(rightY)
  ) {
    return 0;
  }

  const degrees = Math.atan2(rightY - leftY, rightX - leftX) * (180 / Math.PI);
  return clampNumber(degrees, -180, 180, 0);
}

function defaultStyle() {
  return {
    textColor: "#111111",
    backgroundColor: "#f5f1e8",
    backgroundOpacity: 0.7,
    align: "center",
    container: "image-text",
    fontWeight: 540,
    strokeColor: "#ffffff",
    strokeWidth: 0,
    verticalAlign: "middle"
  };
}

function boxToLine(box, index, imageWidth, imageHeight) {
  const sourceText = normalizeText(box?.text);
  const x = clampNumber(box?.x, 0, imageWidth, 0);
  const y = clampNumber(box?.y, 0, imageHeight, 0);
  const width = clampNumber(box?.w, 0, imageWidth, 0);
  const height = clampNumber(box?.h, 0, imageHeight, 0);

  return {
    bounds: boundsFromOcrBox(box, imageWidth, imageHeight),
    height,
    index,
    sourceText,
    width,
    x,
    y
  };
}

function lineIsWorthTranslating(line, imageHeight) {
  if (!line.sourceText || line.width <= 0 || line.height <= 0) {
    return false;
  }

  const compact = line.sourceText.replace(/\s+/g, "");
  const isTiny = line.height <= Math.max(16, imageHeight * 0.028);
  if (isTiny && (compact.length <= 2 || mostlyNumericText(compact))) {
    return false;
  }

  if (compact.length <= 1 && line.height <= Math.max(22, imageHeight * 0.04)) {
    return false;
  }

  return true;
}

function horizontalOverlapRatio(first, second) {
  const left = Math.max(first.x, second.x);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const overlap = Math.max(0, right - left);
  return overlap / Math.max(1, Math.min(first.width, second.width));
}

function shouldJoinLine(group, line) {
  const last = group.lines.at(-1);
  const verticalGap = line.y - (last.y + last.height);
  const averageHeight = (line.height + last.height) / 2;
  const leftDelta = Math.abs(line.x - last.x);
  const overlap = horizontalOverlapRatio(last, line);
  const similarHeight =
    Math.max(line.height, last.height) / Math.max(1, Math.min(line.height, last.height)) <= 1.8;

  return (
    verticalGap >= -averageHeight * 0.35 &&
    verticalGap <= Math.max(14, averageHeight * 0.9) &&
    similarHeight &&
    (overlap >= 0.25 || leftDelta <= Math.max(48, averageHeight * 2.2))
  );
}

function unionLineBounds(lines) {
  const left = Math.min(...lines.map((line) => line.x));
  const top = Math.min(...lines.map((line) => line.y));
  const right = Math.max(...lines.map((line) => line.x + line.width));
  const bottom = Math.max(...lines.map((line) => line.y + line.height));

  return {
    height: bottom - top,
    width: right - left,
    x: left,
    y: top
  };
}

function normalizePixelBounds(rect, imageWidth, imageHeight, rotation = 0) {
  return {
    x: clampNumber((rect.x / imageWidth) * 1000, 0, 1000, 0),
    y: clampNumber((rect.y / imageHeight) * 1000, 0, 1000, 0),
    width: clampNumber((rect.width / imageWidth) * 1000, 0, 1000, 0),
    height: clampNumber((rect.height / imageHeight) * 1000, 0, 1000, 0),
    rotation
  };
}

function groupOcrLines(lines) {
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

export function normalizeIosOcrResult(imageId, responseJson) {
  const imageWidth = clampNumber(responseJson?.image_width, 1, 100000, 1);
  const imageHeight = clampNumber(responseJson?.image_height, 1, 100000, 1);
  const ocrBoxes = Array.isArray(responseJson?.ocr_boxes) ? responseJson.ocr_boxes : [];
  const lines = ocrBoxes
    .map((box, index) => boxToLine(box, index, imageWidth, imageHeight))
    .filter((line) => lineIsWorthTranslating(line, imageHeight));

  return {
    imageId,
    imageWidth,
    imageHeight,
    blocks: groupOcrLines(lines)
      .map((group, index) => {
        const pixelBounds = unionLineBounds(group.lines);
        return {
          id: `${imageId}:${index}`,
          provider: "ios-ocr",
          sourceLineCount: group.lines.length,
          sourceText: group.lines.map((line) => line.sourceText).join("\n"),
          bounds: normalizePixelBounds(
            pixelBounds,
            imageWidth,
            imageHeight,
            group.lines.length === 1 ? group.lines[0].bounds.rotation : 0
          ),
          style: defaultStyle()
        };
      })
      .filter(
        (block) =>
          block.sourceText &&
          block.bounds.width > 0 &&
          block.bounds.height > 0
      )
  };
}

export function buildTextTranslationPayload({ model, ocrImages, targetLanguage }) {
  const compactImages = ocrImages.map((image) => ({
    image_id: image.imageId,
    blocks: image.blocks.map((block) => ({
      box_id: block.id,
      text: block.sourceText
    }))
  }));

  return {
    model,
    temperature: 0.1,
    response_format: {
      type: "json_object"
    },
    messages: [
      {
        role: "system",
        content: [
          "You are a text translation engine.",
          "Do not perform OCR and do not invent, merge, split, or reposition boxes.",
          `Translate each provided text value into ${targetLanguage}.`,
          "Return only valid JSON with this shape:",
          "{\"images\":[{\"image_id\":\"image-a\",\"blocks\":[{\"box_id\":\"image-a:0\",\"translated_text\":\"...\"}]}]}",
          "Preserve image_id and box_id exactly. Keep translations concise enough to fit the original text boxes."
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

function parseTranslationJson(value) {
  if (typeof value === "string") {
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start === -1 || end === -1 || end < start) {
      throw new Error("The translation response did not contain JSON.");
    }
    return JSON.parse(value.slice(start, end + 1));
  }

  return value || {};
}

export function mergeOcrAndTranslationResults(ocrImages, translationResponse) {
  const parsed = parseTranslationJson(translationResponse);
  const images = Array.isArray(parsed?.images) ? parsed.images : [];
  const translatedByBox = new Map();

  for (const image of images) {
    const blocks = Array.isArray(image?.blocks) ? image.blocks : [];
    for (const block of blocks) {
      const boxId = normalizeText(block?.box_id);
      const translatedText = normalizeText(block?.translated_text);
      if (boxId && translatedText) {
        translatedByBox.set(boxId, translatedText);
      }
    }
  }

  return ocrImages.map((image) => ({
    imageId: image.imageId,
    translation: {
      blocks: image.blocks
        .map((block) => ({
          groupId: "",
          provider: block.provider,
          sourceLineCount: block.sourceLineCount,
          sourceText: block.sourceText,
          translatedText: translatedByBox.get(block.id) || "",
          bounds: block.bounds,
          style: block.style
        }))
        .filter((block) => block.translatedText)
    }
  }));
}
