import { describe, expect, test } from "vitest";

import {
  buildRedditTranslationCacheKey,
  extractRedditMediaKeyFromUrl,
  extractRedditPostIdFromUrl,
  makeRedditTranslationCache
} from "../src/content/reddit-media-cache.js";

describe("reddit media translation cache", () => {
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
