export function validateOcrResponse(response, collection) {
  const width = response?.image_width ?? response?.imageWidth;
  const height = response?.image_height ?? response?.imageHeight;
  if (![width, height].every((value) => typeof value === "number" && Number.isFinite(value) && value > 0)
      || !Array.isArray(response?.[collection])) {
    throw new Error(`The OCR response must include positive image dimensions and a ${collection} array.`);
  }
}

// Both OCR providers require one translation for every submitted box/group.
export function readOcrTranslations(ocrImages, response, { collection, idKey, sourceId }) {
  let parsed = response;
  if (typeof response === "string") {
    const start = response.indexOf("{");
    const end = response.lastIndexOf("}");
    if (start < 0 || end < start) {
      throw new Error("The translation response did not contain JSON.");
    }
    parsed = JSON.parse(response.slice(start, end + 1));
  }
  if (!Array.isArray(parsed?.images)) {
    throw new Error("The translation response must include an images array.");
  }

  const expected = new Map(ocrImages.map((image) => [
    image.imageId, new Set(image.blocks.map(sourceId))
  ]));
  const translations = new Map();
  const seenImages = new Set();
  for (const image of parsed.images) {
    const ids = expected.get(image?.image_id);
    if (!ids || seenImages.has(image.image_id)) {
      throw new Error("The translation response contains an unknown or duplicate image ID.");
    }
    seenImages.add(image.image_id);
    if (!Array.isArray(image[collection])) {
      throw new Error(`The translation response must include a ${collection} array.`);
    }
    for (const item of image[collection]) {
      const id = item?.[idKey];
      if (!ids.has(id) || translations.has(id)) {
        throw new Error("The translation response contains an unknown or duplicate text ID.");
      }
      if (typeof item.translated_text !== "string" || !item.translated_text.trim()) {
        throw new Error("The translation response contains an empty translation.");
      }
      translations.set(id, item.translated_text.trim());
    }
  }
  for (const ids of expected.values()) {
    for (const id of ids) {
      if (!translations.has(id)) {
        throw new Error("The translation response is incomplete: a requested translation is missing.");
      }
    }
  }
  return translations;
}
