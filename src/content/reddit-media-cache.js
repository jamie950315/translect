const STORAGE_KEY = "__translect_reddit_translation_cache_v1";
const MAX_ENTRIES = 36;
const MAX_ASPECT_RATIO_DELTA = 0.08;

function normalizeUrl(value) {
  try {
    return new URL(value, "https://www.reddit.com/");
  } catch {
    return null;
  }
}

function normalizeSettingsKey(settings = {}) {
  const provider = settings.useIosOcrServer
    ? `ios-ocr:${String(settings.iosOcrEndpoint || "").trim().toLowerCase()}`
    : "vision";
  return [
    String(settings.targetLanguage || "").trim().toLowerCase(),
    String(settings.model || "").trim().toLowerCase(),
    provider
  ].join("|");
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

  const filename = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) || "");
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
      normalizeSettingsKey(settings)
    ].join(":"),
    mediaKey,
    postId: resolvedPostId,
    settingsKey: normalizeSettingsKey(settings)
  };
}

function readEntries(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeEntries(storage, entries) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // Browsers can deny sessionStorage in strict privacy modes.
  }
}

export function makeRedditTranslationCache(storage) {
  let memoryEntries = readEntries(storage || {
    getItem: () => null,
    setItem: () => {}
  });

  function persist() {
    if (storage) {
      writeEntries(storage, memoryEntries);
    }
  }

  return {
    find({ imageMetrics, imageUrl, pageUrl, postId, settings }) {
      const settingsKey = normalizeSettingsKey(settings);
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
