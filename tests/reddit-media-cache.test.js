import { afterEach, describe, expect, test, vi } from "vitest";

import {
  buildRedditTranslationCacheKey,
  extractRedditMediaKeyFromUrl,
  extractRedditPostIdFromUrl,
  makeRedditTranslationCache
} from "../src/content/reddit-media-cache.js";

afterEach(() => vi.restoreAllMocks());

describe("reddit media translation cache", () => {
  test("ignores malformed percent encoding without exposing the image URL", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(extractRedditMediaKeyFromUrl("https://i.redd.it/%E0%A4%A.png?secret=private")).toBe(null);
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/private|%E0/);
  });

  test("discards malformed persisted entries while preserving valid translations", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const query = {
      imageUrl: "https://i.redd.it/media77.png",
      pageUrl: "https://www.reddit.com/comments/1abcxyz/title/",
      settings: { model: "test-model", targetLanguage: "Traditional Chinese" }
    };
    const translation = { blocks: [{ translatedText: "測試", bounds: { x: 10, y: 10, width: 100, height: 100 }, style: { textColor: "#111111" } }] };
    const entry = { ...buildRedditTranslationCacheKey(query), translation, imageMetrics: { width: 200, height: 100, aspectRatio: 999 } };
    const malformed = [null, 42, {}, { ...entry, translation: { blocks: [null] } },
      { ...entry, translation: { blocks: "not-an-array" } },
      { ...entry, translation: { blocks: [{ translatedText: "missing bounds" }] } },
      { ...entry, translation: { blocks: [{ ...translation.blocks[0], style: { textColor: 42 } }] } }];
    const cache = makeRedditTranslationCache({
      getItem: () => JSON.stringify([...malformed, entry]), setItem() {}
    });
    expect(cache.find({ ...query, imageMetrics: { width: 400, height: 200 } })).toEqual(translation);
    expect(warn).toHaveBeenCalledOnce();
  });

  test.each(["not-json-private", "null", "{}", "[null]"])("treats invalid stored data as a cache miss: %s", (stored) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache = makeRedditTranslationCache({ getItem: () => stored, setItem() {} });
    expect(cache.find({ imageUrl: "https://i.redd.it/media77.png", postId: "1abcxyz" })).toBe(null);
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("not-json-private");
  });

  test("storage failures are diagnosed without losing the current page translation", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache = makeRedditTranslationCache({
      getItem() { throw new Error("private read error"); },
      setItem() { throw new Error("private write error"); }
    });
    const query = { imageUrl: "https://i.redd.it/media77.png", postId: "1abcxyz" };
    const translation = { blocks: [{ translatedText: "測試" }] };
    expect(cache.remember({ ...query, translation })).toBe(true);
    expect(cache.find(query)).toEqual(translation);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private");
  });

  test("ignores translations saved by the previous rendering version", () => {
    const legacyTranslation = { blocks: [{ translatedText: "P8181189" }] };
    const storage = new Map([
      [
        "__translect_reddit_translation_cache_v1",
        JSON.stringify([
          {
            imageMetrics: { aspectRatio: 2, height: 600, width: 1200 },
            mediaKey: "media77",
            postId: "1abcxyz",
            settingsKey:
              "traditional chinese|gpt-5.4-mini|apple-intelligence:local",
            translation: legacyTranslation
          }
        ])
      ]
    ]);
    const cache = makeRedditTranslationCache({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    });

    expect(
      cache.find({
        imageMetrics: { height: 600, width: 1200 },
        imageUrl: "https://i.redd.it/media77.png",
        pageUrl: "https://www.reddit.com/r/pics/comments/1abcxyz/title/",
        settings: {
          model: "gpt-5.4-mini",
          targetLanguage: "Traditional Chinese",
          useAppleIntelligence: true
        }
      })
    ).toBe(null);
  });

  test("uses the same media key for Reddit preview thumbnails and article images", () => {
    expect(
      extractRedditMediaKeyFromUrl(
        "https://preview.redd.it/abc123def4561.jpg?width=640&crop=smart&auto=webp"
      )
    ).toBe("abc123def4561");

    expect(extractRedditMediaKeyFromUrl("https://i.redd.it/abc123def4561.jpg")).toBe(
      "abc123def4561"
    );
  });

  test("builds matching cache keys from homepage thumbnail and post page image", () => {
    const settings = {
      model: "gpt-5.4-mini",
      targetLanguage: "Traditional Chinese"
    };

    const homepageKey = buildRedditTranslationCacheKey({
      imageUrl: "https://preview.redd.it/media77.png?width=320&crop=smart",
      pageUrl: "https://www.reddit.com/r/pics/",
      postUrl: "https://www.reddit.com/r/pics/comments/1abcxyz/title/",
      settings
    });
    const articleKey = buildRedditTranslationCacheKey({
      imageUrl: "https://i.redd.it/media77.png",
      pageUrl: "https://www.reddit.com/r/pics/comments/1abcxyz/title/",
      settings
    });

    expect(homepageKey).toEqual(articleKey);
  });

  test("does not reuse a translation by post alone when the image key is different", () => {
    const cache = makeRedditTranslationCache({
      getItem: () => null,
      setItem: () => {}
    });
    const settings = {
      model: "gpt-5.4-mini",
      targetLanguage: "Traditional Chinese"
    };
    const translation = { blocks: [{ translatedText: "測試" }] };

    cache.remember({
      imageUrl: "https://preview.redd.it/media77.png?width=320",
      pageUrl: "https://www.reddit.com/r/pics/",
      postUrl: "https://www.reddit.com/r/pics/comments/1abcxyz/title/",
      settings,
      translation
    });

    expect(
      cache.find({
        imageUrl: "https://styles.redditmedia.com/t5_unknown/styles/image_widget.png",
        pageUrl: "https://www.reddit.com/r/pics/comments/1abcxyz/title/",
        settings
      })
    ).toBe(null);
  });

  test("does not reuse a thumbnail translation when the article image has a different crop ratio", () => {
    const cache = makeRedditTranslationCache({
      getItem: () => null,
      setItem: () => {}
    });
    const settings = {
      model: "gpt-5.4-mini",
      targetLanguage: "Traditional Chinese"
    };
    const translation = { blocks: [{ translatedText: "測試" }] };

    cache.remember({
      imageMetrics: {
        height: 300,
        width: 300
      },
      imageUrl: "https://preview.redd.it/media77.png?width=300&crop=smart",
      pageUrl: "https://www.reddit.com/r/pics/",
      postUrl: "https://www.reddit.com/r/pics/comments/1abcxyz/title/",
      settings,
      translation
    });

    expect(
      cache.find({
        imageMetrics: {
          height: 600,
          width: 1200
        },
        imageUrl: "https://i.redd.it/media77.png",
        pageUrl: "https://www.reddit.com/r/pics/comments/1abcxyz/title/",
        settings
      })
    ).toBe(null);
  });

  test("does not reuse translations across OCR providers", () => {
    const cache = makeRedditTranslationCache({
      getItem: () => null,
      setItem: () => {}
    });
    const translation = { blocks: [{ translatedText: "測試" }] };

    cache.remember({
      imageUrl: "https://preview.redd.it/media77.png?width=640",
      pageUrl: "https://www.reddit.com/r/pics/",
      postUrl: "https://www.reddit.com/r/pics/comments/1abcxyz/title/",
      settings: {
        model: "gpt-5.4-mini",
        targetLanguage: "Traditional Chinese",
        useIosOcrServer: false
      },
      translation
    });

    expect(
      cache.find({
        imageUrl: "https://i.redd.it/media77.png",
        pageUrl: "https://www.reddit.com/r/pics/comments/1abcxyz/title/",
        settings: {
          iosOcrEndpoint: "http://127.0.0.1:8000/upload",
          model: "gpt-5.4-mini",
          targetLanguage: "Traditional Chinese",
          useIosOcrServer: true
        }
      })
    ).toBe(null);
  });
});

describe("reddit post id extraction", () => {
  test("extracts post ids from canonical post URLs", () => {
    expect(
      extractRedditPostIdFromUrl("https://www.reddit.com/r/pics/comments/1abcxyz/title/")
    ).toBe("1abcxyz");
  });
});
