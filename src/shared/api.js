function escapeJsonExample(text) {
  return text.replaceAll("\n", "\\n");
}

export function buildSystemPrompt(targetLanguage) {
  return [
    "You are an OCR, translation, and image typesetting engine.",
    `Translate every meaningful source-language text block in the image into ${targetLanguage}.`,
    "Return only valid JSON with this shape:",
    escapeJsonExample(`{
  "blocks": [
    {
      "source_text": "Original text",
      "translated_text": "Translated text\\nwith matching line breaks",
      "group_id": "chat-right",
      "source_line_count": 2,
      "bounds": { "x": 120, "y": 180, "width": 250, "height": 120, "rotation": 0 },
      "style": {
        "text_color": "#111111",
        "background_color": "#f5f1e8",
        "background_opacity": 0.92,
        "align": "center",
        "font_weight": 600,
        "stroke_color": "#ffffff",
        "stroke_width": 2,
        "container": "speech-bubble",
        "vertical_align": "top"
      }
    }
  ]
}`),
    "Rules:",
    "1. Coordinates use a 0..1000 grid relative to the submitted image width and height.",
    "2. Merge nearby words into one block only when they belong to the same visual item: one chat bubble, one table cell, one title, one menu item, one map label, or one paragraph.",
    "3. If the image has no translatable text, return {\"blocks\":[]}.",
    "4. Keep translated text concise enough to fit the original area.",
    "5. Estimate background and text colors that best hide the original text while preserving the image style.",
    "6. Bounds must be tight around the original visible text, including every source line and only a small safety margin. Never cover a whole screen, whole image, whole table, or multiple chat bubbles with one block.",
    "7. Preserve approximate original line breaks in translated_text whenever the source text spans multiple visible lines.",
    "8. Set source_line_count to the original visible line count for that block.",
    "9. Use the same group_id for repeated items that should share the same font size and style, such as table rows, legend values, repeated chat bubbles, or map labels. Leave it empty only when no sharing is needed.",
    "10. Use font_weight 450..620 for CJK translations unless the original text is extremely heavy. Avoid bold CJK strokes that make Chinese characters hard to read.",
    "11. Set container to one of: speech-bubble, ui-card, caption-strip, plain-text, image-text.",
    "12. Set vertical_align to top, middle, or bottom based on the original layout.",
    "13. Split complicated layouts into many small blocks. Tables need one block per cell or header. Message screenshots need one block per bubble or UI label. Maps and memes need one block per label, preserving rotation.",
    "14. Do not translate or block out icons, avatars, reaction buttons, download buttons, phone status bars, or purely decorative marks."
  ].join("\n");
}

export function buildChatCompletionsPayload({ imageDataUrl, model, targetLanguage }) {
  return {
    model,
    temperature: 0.1,
    response_format: {
      type: "json_object"
    },
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(targetLanguage)
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Translate the image into ${targetLanguage} and return JSON only.`
          },
          {
            type: "image_url",
            image_url: {
              url: imageDataUrl
            }
          }
        ]
      }
    ]
  };
}

export function extractAssistantText(responseJson) {
  if (typeof responseJson?.output_text === "string") {
    return responseJson.output_text;
  }

  const messageContent = responseJson?.choices?.[0]?.message?.content;
  if (typeof messageContent === "string") {
    return messageContent;
  }

  if (Array.isArray(messageContent)) {
    return messageContent
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (typeof part?.text === "string") {
          return part.text;
        }
        return "";
      })
      .join("");
  }

  const responsesContent = responseJson?.output?.[0]?.content;
  if (Array.isArray(responsesContent)) {
    return responsesContent
      .map((part) => part?.text || part?.content || "")
      .join("");
  }

  throw new Error("The API response did not include assistant text.");
}

function findJsonSlice(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("The model response did not contain JSON.");
  }
  return text.slice(start, end + 1);
}

function normalizeColor(value, fallback) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value || "") ? value : fallback;
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function normalizeContainer(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .replaceAll("_", "-");
  const aliases = {
    bubble: "speech-bubble",
    caption: "caption-strip",
    "chat-bubble": "speech-bubble",
    image: "image-text",
    plain: "plain-text",
    strip: "caption-strip",
    subtitle: "caption-strip",
    ui: "ui-card"
  };
  const candidate = aliases[normalized] || normalized;

  return [
    "speech-bubble",
    "ui-card",
    "caption-strip",
    "plain-text",
    "image-text"
  ].includes(candidate)
    ? candidate
    : "auto";
}

function normalizeVerticalAlign(value) {
  const normalized = String(value || "").toLowerCase();
  return ["top", "middle", "bottom"].includes(normalized) ? normalized : "auto";
}

function countVisibleLines(text) {
  const lines = String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length;
}

function normalizeBlock(block) {
  const sourceText = typeof block?.source_text === "string" ? block.source_text.trim() : "";
  const translatedText =
    typeof block?.translated_text === "string" ? block.translated_text.trim() : "";

  return {
    groupId: typeof block?.group_id === "string" ? block.group_id.trim() : "",
    sourceLineCount: clampNumber(
      block?.source_line_count,
      1,
      12,
      Math.max(countVisibleLines(sourceText), countVisibleLines(translatedText), 1)
    ),
    sourceText,
    translatedText,
    bounds: {
      x: clampNumber(block?.bounds?.x, 0, 1000, 0),
      y: clampNumber(block?.bounds?.y, 0, 1000, 0),
      width: clampNumber(block?.bounds?.width, 0, 1000, 0),
      height: clampNumber(block?.bounds?.height, 0, 1000, 0),
      rotation: clampNumber(block?.bounds?.rotation, -180, 180, 0)
    },
    style: {
      textColor: normalizeColor(block?.style?.text_color, "#111111"),
      backgroundColor: normalizeColor(block?.style?.background_color, "#f5f1e8"),
      backgroundOpacity: clampNumber(block?.style?.background_opacity, 0, 1, 0.92),
      align: ["left", "center", "right"].includes(block?.style?.align)
        ? block.style.align
        : "center",
      container: normalizeContainer(block?.style?.container),
      fontWeight: clampNumber(block?.style?.font_weight, 300, 900, 600),
      strokeColor: normalizeColor(block?.style?.stroke_color, "#ffffff"),
      strokeWidth: clampNumber(block?.style?.stroke_width, 0, 12, 2),
      verticalAlign: normalizeVerticalAlign(block?.style?.vertical_align)
    }
  };
}

export function parseTranslationResponse(text) {
  const parsed = JSON.parse(findJsonSlice(text));
  const blocks = Array.isArray(parsed?.blocks) ? parsed.blocks.map(normalizeBlock) : [];

  return {
    blocks: blocks.filter(
      (block) =>
        block.translatedText &&
        block.bounds.width > 0 &&
        block.bounds.height > 0
    )
  };
}
