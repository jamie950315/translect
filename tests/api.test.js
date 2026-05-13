import { describe, expect, test } from "vitest";

import {
  buildChatCompletionsPayload,
  extractAssistantText,
  parseTranslationResponse
} from "../src/shared/api.js";

describe("api helpers", () => {
  test("builds a chat completions payload with image input", () => {
    const payload = buildChatCompletionsPayload({
      imageDataUrl: "data:image/png;base64,abc",
      model: "gpt-5.4-mini",
      targetLanguage: "Traditional Chinese"
    });

    expect(payload.model).toBe("gpt-5.4-mini");
    expect(payload.messages[1].content[1].image_url.url).toBe("data:image/png;base64,abc");
    expect(payload.messages[0].content).toContain("Bounds must be tight");
    expect(payload.messages[0].content).toContain("one chat bubble, one table cell");
    expect(payload.messages[0].content).toContain("Avoid bold CJK strokes");
    expect(payload.messages[0].content).toContain("group_id");
    expect(payload.messages[0].content).toContain("source_line_count");
  });

  test("extracts string content from a chat completion response", () => {
    expect(
      extractAssistantText({
        choices: [
          {
            message: {
              content: "{\"blocks\":[]}"
            }
          }
        ]
      })
    ).toBe("{\"blocks\":[]}");
  });

  test("parses and normalizes translation blocks", () => {
    const result = parseTranslationResponse(`prefix {"blocks":[{"group_id":"chat-right","source_line_count":2,"source_text":"A","translated_text":"B","bounds":{"x":100,"y":200,"width":300,"height":120},"style":{"text_color":"#222222","background_color":"#fefefe","align":"left","container":"speech-bubble","vertical_align":"top"}}]} suffix`);

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].translatedText).toBe("B");
    expect(result.blocks[0].groupId).toBe("chat-right");
    expect(result.blocks[0].sourceLineCount).toBe(2);
    expect(result.blocks[0].style.align).toBe("left");
    expect(result.blocks[0].style.container).toBe("speech-bubble");
    expect(result.blocks[0].style.fontWeight).toBe(600);
    expect(result.blocks[0].style.verticalAlign).toBe("top");
  });
});
