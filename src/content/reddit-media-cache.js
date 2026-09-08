import { translationSettingsKey } from "./translation-settings-key.js";

const STORAGE_KEY = "__translect_reddit_translation_cache_v3";
const MAX_ENTRIES = 36;
const MAX_ASPECT_RATIO_DELTA = 0.08;

function normalizeUrl(value) {
  try {
    return new URL(value, "https://www.reddit.com/");
  } catch {
    return null;
  }
}

function normalizeImageMetrics(metrics) {
  const width = Number(metrics?.width);
  const height = Number(metrics?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return {
    aspectRatio: width / height,
    height,
    width
  };
}

function metricsAreCompatible(sourceMetrics, targetMetrics) {
  if (!sourceMetrics || !targetMetrics) {
    return true;
  }

  const delta = Math.abs(sourceMetrics.aspectRatio - targetMetrics.aspectRatio);
  return delta <= MAX_ASPECT_RATIO_DELTA;
}

export function extractRedditPostIdFromUrl(value) {
  const url = normalizeUrl(value);
  if (!url) {
    return null;
  }

  const match = url.pathname.match(/\/comments\/([a-z0-9]+)/i);
  return match?.[1]?.toLowerCase() || null;
}

export function extractRedditMediaKeyFromUrl(value) {
  const url = normalizeUrl(value);
  if (!url) {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  if (
    ![
      "i.redd.it",
      "preview.redd.it",
      "external-preview.redd.it",
      "styles.redditmedia.com"
    ].some((host) => hostname === host || hostname.endsWith(`.${host}`))
  ) {
    return null;
  }

  let filename;
  try {
    filename = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) || "");
  } catch {
    console.warn("Ignoring a Reddit image cache key with malformed URL encoding.");
    return null;
  }
  const basename = filename.replace(/\.(avif|gif|jpe?g|png|webp)$/i, "");
  return basename || null;
}

export function buildRedditTranslationCacheKey({
  imageUrl,
  pageUrl,
  postId,
  postUrl,
  settings
}) {
  const resolvedPostId =
    postId || extractRedditPostIdFromUrl(postUrl) || extractRedditPostIdFromUrl(pageUrl);
  const mediaKey = extractRedditMediaKeyFromUrl(imageUrl);

  if (!resolvedPostId || !mediaKey) {
    return null;
  }

  return {
    key: [
      "reddit",
      resolvedPostId,
      mediaKey,
      translationSettingsKey(settings)
    ].join(":"),
    mediaKey,
    postId: resolvedPostId,
    settingsKey: translationSettingsKey(settings)
  };
}

function validCachedBlock(block) {
  if (!block || typeof block.translatedText !== "string" ||
      !block.bounds || !block.style || typeof block.style !== "object" || Array.isArray(block.style)) {
    return false;
  }
  if (!["x", "y", "width", "height"].every((key) =>
    Number.isFinite(block.bounds[key]) && block.bounds[key] >= 0 && block.bounds[key] <= 1000
  ) || block.bounds.width <= 0 || block.bounds.height <= 0 ||
      (block.bounds.rotation !== undefined && !Number.isFinite(block.bounds.rotation))) return false;
  if (!["sourceText", "groupId", "flowGroupId", "flowText", "provider"].every((key) =>
    block[key] === undefined || typeof block[key] === "string"
  )) return false;
  return ["textColor", "backgroundColor", "strokeColor"].every((key) =>
    block.style[key] === undefined || (typeof block.style[key] === "string" &&
      /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(block.style[key]))
  ) && ["backgroundOpacity", "fontWeight", "strokeWidth"].every((key) =>
    block.style[key] === undefined || Number.isFinite(block.style[key])
  );
}

function validCachedEntry(entry) {
  return entry && ["key", "postId", "mediaKey", "settingsKey"].every((key) =>
    typeof entry[key] === "string" && entry[key].length > 0
  ) && entry.key === ["reddit", entry.postId, entry.mediaKey, entry.settingsKey].join(":") &&
    (entry.imageMetrics == null || normalizeImageMetrics(entry.imageMetrics) !== null) &&
    Array.isArray(entry.translation?.blocks) && entry.translation.blocks.length > 0 &&
    entry.translation.blocks.every(validCachedBlock);
}

function readEntries(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) {
      console.warn("Ignoring malformed Reddit translation cache data.");
      return [];
    }
    const validEntries = parsed.filter(validCachedEntry);
    if (validEntries.length !== parsed.length) {
      console.warn("Ignoring malformed entries in the Reddit translation cache.");
    }
    return validEntries.slice(0, MAX_ENTRIES).map((entry) => ({
      ...entry,
      imageMetrics: normalizeImageMetrics(entry.imageMetrics)
    }));
  } catch {
    // Do not log exception messages or page-owned data, which can contain secrets.
    console.warn("Could not read the Reddit translation cache; using an empty page cache.");
    return [];
  }
}

function writeEntries(storage, entries) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    console.warn("Could not save the Reddit translation cache; keeping translations on this page only.");
  }
}

export function makeRedditTranslationCache(storage) {
  let memoryEntries = storage ? readEntries(storage) : [];

  function persist() {
    if (storage) {
      writeEntries(storage, memoryEntries);
    }
  }

  return {
    find({ imageMetrics, imageUrl, pageUrl, postId, settings }) {
      const settingsKey = translationSettingsKey(settings);
      const mediaKey = extractRedditMediaKeyFromUrl(imageUrl);
      const resolvedPostId = postId || extractRedditPostIdFromUrl(pageUrl);
      const targetMetrics = normalizeImageMetrics(imageMetrics);
      if (!resolvedPostId) {
        return null;
      }

      if (mediaKey) {
        const exact = memoryEntries.find(
          (entry) =>
            entry.postId === resolvedPostId &&
            entry.mediaKey === mediaKey &&
            entry.settingsKey === settingsKey &&
            metricsAreCompatible(entry.imageMetrics, targetMetrics)
        );
        if (exact) {
          return exact.translation;
        }
      }

      return null;
    },

    remember({ imageMetrics, imageUrl, pageUrl, postId, postUrl, settings, translation }) {
      const cacheKey = buildRedditTranslationCacheKey({
        imageUrl,
        pageUrl,
        postId,
        postUrl,
        settings
      });
      if (!cacheKey || !translation?.blocks?.length) {
        return false;
      }

      memoryEntries = [
        {
          key: cacheKey.key,
          imageMetrics: normalizeImageMetrics(imageMetrics),
          mediaKey: cacheKey.mediaKey,
          postId: cacheKey.postId,
          settingsKey: cacheKey.settingsKey,
          translation
        },
        ...memoryEntries.filter((entry) => entry.key !== cacheKey.key)
      ].slice(0, MAX_ENTRIES);
      persist();
      return true;
    }
  };
}
