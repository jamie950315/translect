import {
  MESSAGE_TYPES,
  PAGE_ACTIONS
} from "../shared/defaults.js";
import {
  expandRect,
  normalizeBoundsToPixels,
  rectIsLargeEnough
} from "../shared/geometry.js";
import { configureOverlayCanvas } from "./overlay-canvas.js";
import {
  getCanvasContext2d,
  getReadableCanvasContext2d
} from "./canvas-context.js";
import {
  analyzeRectTextureFromImageData,
  analyzeRegionTextureFromImageData,
  classifyTextSurface,
  chooseCoverMode,
  detectTextInkBoundsFromImageData,
  resolveCoverGeometry,
  resolveCoverOpacity,
  resolveRenderedContainerKind,
  resolveTextAreaBackgroundColor,
  resolveTextVerticalAlign,
  sampleBackgroundColorFromImageData,
  sampleRectEdgeColorFromImageData
} from "./text-cover.js";
import {
  dedupeImageElementsByVisualRect,
  isAutoTranslateCandidate
} from "./image-candidate.js";
import { shouldReplaceOverlayRect } from "./overlay-dedupe.js";
import { makeRedditTranslationCache } from "./reddit-media-cache.js";
import {
  planTextLayouts,
  resolveReadableFontWeight,
  resolveReadableStrokeWidth
} from "../shared/render-utils.js";
import { distributeTextAcrossBoxes } from "../shared/flow-text.js";
import { normalizeSettings } from "../shared/settings.js";

const ROOT_ID = "__translect-root";
const STYLE_ID = "__translect-styles";

const state = {
  autoEventsBound: false,
  autoMutationObserver: null,
  autoScanHandle: null,
  emptyTranslationFingerprints: new WeakMap(),
  initialized: false,
  inFlightElements: new WeakSet(),
  overlayEntries: new Set(),
  overlayMap: new WeakMap(),
  redditReuseEventsBound: false,
  redditReuseMutationObserver: null,
  redditReuseScanHandle: null,
  selectionCleanup: null,
  settings: null,
  translatedFingerprints: new WeakMap(),
  translatedVisualFingerprints: new Set(),
  visibleTranslationInFlight: false,
  visualInFlightFingerprints: new Set()
};

const redditTranslationCache = makeRedditTranslationCache(
  typeof window !== "undefined" ? window.sessionStorage : null
);

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${ROOT_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      pointer-events: none;
      font-family: Georgia, "Times New Roman", serif;
    }

    #${ROOT_ID} .translect-overlay {
      position: fixed;
      overflow: hidden;
      border-radius: 12px;
      box-shadow: none;
      outline: 1px solid rgba(161, 63, 44, 0.65);
      background: transparent;
      pointer-events: none;
    }

    #${ROOT_ID} .translect-toast-stack {
      position: fixed;
      top: 14px;
      right: 14px;
      display: grid;
      gap: 10px;
      width: min(320px, calc(100vw - 28px));
      pointer-events: none;
    }

    #${ROOT_ID} .translect-toast {
      padding: 12px 14px;
      border-radius: 14px;
      background: rgba(22, 20, 18, 0.88);
      color: #fffaf3;
      font-size: 13px;
      line-height: 1.45;
      box-shadow: 0 12px 24px rgba(0, 0, 0, 0.2);
    }

    #${ROOT_ID} .translect-selection-layer {
      position: fixed;
      inset: 0;
      background:
        linear-gradient(180deg, rgba(12, 18, 22, 0.08), rgba(12, 18, 22, 0.18)),
        repeating-linear-gradient(
          90deg,
          rgba(255, 255, 255, 0.05) 0,
          rgba(255, 255, 255, 0.05) 1px,
          transparent 1px,
          transparent 36px
        );
      cursor: crosshair;
      pointer-events: auto;
    }

    #${ROOT_ID} .translect-selection-hud {
      position: fixed;
      left: 50%;
      bottom: 18px;
      transform: translateX(-50%);
      padding: 10px 14px;
      border-radius: 999px;
      background: rgba(18, 17, 16, 0.85);
      color: #fffaf3;
      font-size: 13px;
      backdrop-filter: blur(12px);
      box-shadow: 0 12px 24px rgba(0, 0, 0, 0.2);
      pointer-events: none;
      white-space: nowrap;
    }

    #${ROOT_ID} .translect-selection-box,
    #${ROOT_ID} .translect-hover-box {
      position: fixed;
      border: 2px solid rgba(70, 130, 160, 0.9);
      border-radius: 14px;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.65);
      pointer-events: none;
    }

    #${ROOT_ID} .translect-selection-box {
      background: rgba(255, 247, 240, 0.12);
    }

    #${ROOT_ID} .translect-hover-box {
      border-style: dashed;
      background: rgba(70, 130, 160, 0.08);
    }
  `;

  document.documentElement.append(style);
}

function ensureRoot() {
  ensureStyles();
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = `<div class="translect-toast-stack"></div>`;
    document.documentElement.append(root);
  }
  return root;
}

function toastStack() {
  return ensureRoot().querySelector(".translect-toast-stack");
}

function showToast(message, timeout = 2600) {
  const toast = document.createElement("div");
  toast.className = "translect-toast";
  toast.textContent = message;
  toastStack().append(toast);
  window.setTimeout(() => toast.remove(), timeout);
}

function getViewportSize() {
  return {
    height: window.visualViewport?.height || window.innerHeight,
    width: window.visualViewport?.width || window.innerWidth
  };
}

function makeRect(startX, startY, endX, endY) {
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY)
  };
}

function roundRectPath(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
  ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
  ctx.arcTo(x, y + height, x, y, safeRadius);
  ctx.arcTo(x, y, x + width, y, safeRadius);
  ctx.closePath();
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  const value =
    normalized.length === 3
      ? normalized
          .split("")
          .map((part) => part + part)
          .join("")
      : normalized;

  return {
    b: Number.parseInt(value.slice(4, 6), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    r: Number.parseInt(value.slice(0, 2), 16)
  };
}

function rgbaString(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function contrastTextColor(backgroundHex) {
  return luminance(backgroundHex) > 0.58 ? "#111111" : "#ffffff";
}

function readableTextColor(preferredColor, backgroundColor) {
  const preferredLuminance = luminance(preferredColor);
  const backgroundLuminance = luminance(backgroundColor);
  if (Math.abs(preferredLuminance - backgroundLuminance) >= 0.42) {
    return preferredColor;
  }

  return contrastTextColor(backgroundColor);
}

function measureImageFingerprint(imageElement, settings) {
  const rect = imageElement.getBoundingClientRect();
  return [
    imageElement.currentSrc || imageElement.src || "inline",
    Math.round(rect.width),
    Math.round(rect.height),
    settings.targetLanguage,
    settings.model,
    translationProviderKey(settings)
  ].join("|");
}

function translationProviderKey(settings) {
  if (settings.useMacosVisionOcr) {
    return `macos-vision:${settings.macosVisionHostName || ""}`;
  }

  return settings.useIosOcrServer
    ? `ios-ocr:${settings.iosOcrEndpoint || ""}`
    : "vision";
}

function measureImageVisualFingerprint(imageElement, settings) {
  const rect = imageElement.getBoundingClientRect();
  const source = imageElement.currentSrc || imageElement.src || "inline";
  const compactSource =
    source.length > 420
      ? `${source.slice(0, 210)}:${source.length}:${source.slice(-120)}`
      : source;

  return [
    compactSource,
    Math.round(rect.x / 6),
    Math.round(rect.y / 6),
    Math.round(rect.width / 6),
    Math.round(rect.height / 6),
    settings.targetLanguage,
    settings.model,
    translationProviderKey(settings)
  ].join("|");
}

function currentPageUrl() {
  return window.location.href;
}

function isRedditPage() {
  return /(^|\.)reddit\.com$/i.test(window.location.hostname);
}

function redditPostIdFromElement(imageElement) {
  const postContainer = imageElement.closest(
    "[post-id], [data-post-id], [thingid], shreddit-post"
  );
  const rawId =
    postContainer?.getAttribute("post-id") ||
    postContainer?.getAttribute("data-post-id") ||
    postContainer?.getAttribute("thingid") ||
    postContainer?.id ||
    "";
  const match = rawId.match(/(?:t3_)?([a-z0-9]{5,})/i);
  return match?.[1]?.toLowerCase() || null;
}

function redditPostUrlFromElement(imageElement) {
  const directLink = imageElement.closest("a[href*='/comments/']");
  if (directLink?.href) {
    return directLink.href;
  }

  const postContainer = imageElement.closest(
    "[post-id], [data-post-id], [thingid], shreddit-post, article"
  );
  const nestedLink = postContainer?.querySelector?.("a[href*='/comments/']");
  return nestedLink?.href || currentPageUrl();
}

function redditImageUrl(imageElement) {
  return imageElement.currentSrc || imageElement.src || "";
}

function imageMetrics(imageElement) {
  const rect = imageElement.getBoundingClientRect();
  return {
    height: rect.height,
    width: rect.width
  };
}

function rememberRedditTranslation(imageElement, settings, translation) {
  if (!isRedditPage()) {
    return;
  }

  redditTranslationCache.remember({
    imageMetrics: imageMetrics(imageElement),
    imageUrl: redditImageUrl(imageElement),
    pageUrl: currentPageUrl(),
    postId: redditPostIdFromElement(imageElement),
    postUrl: redditPostUrlFromElement(imageElement),
    settings,
    translation
  });
}

function findCachedRedditTranslation(imageElement, settings) {
  if (!isRedditPage()) {
    return null;
  }

  return redditTranslationCache.find({
    imageMetrics: imageMetrics(imageElement),
    imageUrl: redditImageUrl(imageElement),
    pageUrl: currentPageUrl(),
    postId: redditPostIdFromElement(imageElement),
    settings
  });
}

function imageHasCurrentTranslation(imageElement, settings) {
  return state.translatedFingerprints.get(imageElement) ===
    measureImageFingerprint(imageElement, settings) ||
    state.translatedVisualFingerprints.has(
      measureImageVisualFingerprint(imageElement, settings)
    );
}

function elementIsVisible(rect) {
  const viewport = getViewportSize();
  return (
    rect.width > 40 &&
    rect.height > 40 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < viewport.height &&
    rect.left < viewport.width
  );
}

function candidateImages() {
  const viewport = getViewportSize();
  const candidates = Array.from(document.images).filter((image) => {
    const rect = image.getBoundingClientRect();
    return (
      image.complete &&
      isAutoTranslateCandidate({
        naturalHeight: image.naturalHeight,
        naturalWidth: image.naturalWidth,
        rect,
        viewport
      }) &&
      elementIsVisible(rect)
    );
  });
  return dedupeImageElementsByVisualRect(candidates);
}

function refreshOverlayPositions() {
  for (const entry of state.overlayEntries) {
    const rect = entry.getRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      entry.node.style.display = "none";
      continue;
    }

    entry.node.style.display = "block";
    entry.node.style.left = `${rect.x}px`;
    entry.node.style.top = `${rect.y}px`;
    entry.node.style.width = `${rect.width}px`;
    entry.node.style.height = `${rect.height}px`;
  }
}

function scheduleOverlayRefresh() {
  window.requestAnimationFrame(refreshOverlayPositions);
}

function currentOverlayEntriesForRect(rect) {
  return [...state.overlayEntries].filter((entry) => {
    const existingRect = entry.getRect();
    return existingRect && shouldReplaceOverlayRect(existingRect, rect);
  });
}

function removeOverlayEntry(entry) {
  entry.node.remove();
  state.overlayEntries.delete(entry);
}

function waitForNextPaint() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(resolve);
    });
  });
}

function clearOverlays() {
  for (const entry of [...state.overlayEntries]) {
    removeOverlayEntry(entry);
  }
  state.translatedVisualFingerprints.clear();
}

function attachOverlay({ anchorElement, canvas, fixedRect }) {
  ensureRoot();

  if (anchorElement) {
    const existing = state.overlayMap.get(anchorElement);
    if (existing) {
      removeOverlayEntry(existing);
    }
  }

  const incomingRect = fixedRect || anchorElement?.getBoundingClientRect();
  if (incomingRect) {
    for (const entry of currentOverlayEntriesForRect(incomingRect)) {
      removeOverlayEntry(entry);
    }
  }

  const node = document.createElement("div");
  node.className = "translect-overlay";
  node.append(configureOverlayCanvas(canvas));
  ensureRoot().append(node);

  const entry = {
    getRect: fixedRect
      ? () => fixedRect
      : () => anchorElement?.getBoundingClientRect(),
    node
  };

  state.overlayEntries.add(entry);
  if (anchorElement) {
    state.overlayMap.set(anchorElement, entry);
  }

  scheduleOverlayRefresh();
}

async function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load image data."));
    image.src = source;
  });
}

async function captureSnapshot() {
  const overlayNodes = [...state.overlayEntries].map((entry) => entry.node);
  const previousVisibility = overlayNodes.map((node) => node.style.visibility);

  try {
    for (const node of overlayNodes) {
      node.style.visibility = "hidden";
    }
    await waitForNextPaint();

    const response = await sendMessage({ type: MESSAGE_TYPES.CAPTURE_VISIBLE_TAB });
    if (!response?.ok) {
      throw new Error(response?.error || "Could not capture the current tab.");
    }

    const image = await loadImage(response.dataUrl);
    const viewport = getViewportSize();

    return {
      dataUrl: response.dataUrl,
      image,
      scaleX: image.width / viewport.width,
      scaleY: image.height / viewport.height
    };
  } finally {
    overlayNodes.forEach((node, index) => {
      node.style.visibility = previousVisibility[index] || "";
    });
  }
}

function cropRectFromSnapshot(snapshot, rect) {
  const cropWidth = Math.max(1, Math.round(rect.width * snapshot.scaleX));
  const cropHeight = Math.max(1, Math.round(rect.height * snapshot.scaleY));
  const sourceX = Math.max(0, Math.round(rect.x * snapshot.scaleX));
  const sourceY = Math.max(0, Math.round(rect.y * snapshot.scaleY));

  const canvas = document.createElement("canvas");
  canvas.width = cropWidth;
  canvas.height = cropHeight;
  const ctx = getCanvasContext2d(canvas);
  ctx.drawImage(
    snapshot.image,
    sourceX,
    sourceY,
    cropWidth,
    cropHeight,
    0,
    0,
    cropWidth,
    cropHeight
  );

  return {
    canvas,
    dataUrl: canvas.toDataURL("image/png")
  };
}

async function requestTranslation(imageDataUrl) {
  const response = await sendMessage({
    type: MESSAGE_TYPES.TRANSLATE_REGION,
    imageDataUrl
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Translation failed.");
  }

  return response.translation;
}

async function requestTranslationBatch(imageRequests) {
  const response = await sendMessage({
    type: MESSAGE_TYPES.TRANSLATE_REGIONS,
    requests: imageRequests
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Translation failed.");
  }

  return Array.isArray(response.translations) ? response.translations : [];
}

function sampleRegionColor(sourceCtx, rect) {
  const samplingPadding = Math.max(6, Math.round(Math.min(rect.width, rect.height) * 0.2));
  const expanded = expandRect(
    rect,
    samplingPadding,
    sourceCtx.canvas.width,
    sourceCtx.canvas.height
  );
  const imageData = sourceCtx.getImageData(
    expanded.x,
    expanded.y,
    expanded.width,
    expanded.height
  ).data;
  return sampleBackgroundColorFromImageData(imageData, expanded.width, expanded.height, {
    x: Math.max(0, Math.round(rect.x - expanded.x)),
    y: Math.max(0, Math.round(rect.y - expanded.y)),
    width: Math.min(expanded.width, Math.round(rect.width)),
    height: Math.min(expanded.height, Math.round(rect.height))
  });
}

function inspectTextArea(sourceCtx, rect, expectedTextColor) {
  const samplingPadding = Math.max(6, Math.round(Math.min(rect.width, rect.height) * 0.2));
  const expanded = expandRect(
    rect,
    samplingPadding,
    sourceCtx.canvas.width,
    sourceCtx.canvas.height
  );
  const imageData = sourceCtx.getImageData(
    expanded.x,
    expanded.y,
    expanded.width,
    expanded.height
  ).data;
  const localRect = {
    x: Math.max(0, Math.round(rect.x - expanded.x)),
    y: Math.max(0, Math.round(rect.y - expanded.y)),
    width: Math.min(expanded.width, Math.round(rect.width)),
    height: Math.min(expanded.height, Math.round(rect.height))
  };
  const outerBackgroundColor = sampleBackgroundColorFromImageData(
    imageData,
    expanded.width,
    expanded.height,
    localRect
  );
  const innerBackgroundColor =
    sampleRectEdgeColorFromImageData(imageData, expanded.width, expanded.height, localRect) ||
    outerBackgroundColor;
  const outerAnalysis = analyzeRegionTextureFromImageData(
    imageData,
    expanded.width,
    expanded.height,
    localRect
  );
  const innerAnalysis = analyzeRectTextureFromImageData(
    imageData,
    expanded.width,
    expanded.height,
    localRect
  );
  const localInkRect = detectTextInkBoundsFromImageData(
    imageData,
    expanded.width,
    expanded.height,
    localRect,
    { textColor: expectedTextColor }
  );
  const inkRect = localInkRect
    ? {
        x: expanded.x + localInkRect.x,
        y: expanded.y + localInkRect.y,
        width: localInkRect.width,
        height: localInkRect.height
      }
    : null;
  const containerKind = classifyTextSurface(
    {
      ...innerAnalysis,
      backgroundColor: innerBackgroundColor
    },
    {
      ...outerAnalysis,
      backgroundColor: outerBackgroundColor
    },
    rect
  );

  return {
    backgroundColor: resolveTextAreaBackgroundColor(
      containerKind,
      innerBackgroundColor,
      outerBackgroundColor
    ),
    containerKind,
    coverMode:
      containerKind === "image-text"
        ? chooseCoverMode(outerAnalysis)
        : "ui",
    inkRect
  };
}

function expandRectWithin(rect, padding, bounds) {
  const x = Math.max(bounds.x, rect.x - padding.left);
  const y = Math.max(bounds.y, rect.y - padding.top);
  const right = Math.min(bounds.x + bounds.width, rect.x + rect.width + padding.right);
  const bottom = Math.min(bounds.y + bounds.height, rect.y + rect.height + padding.bottom);

  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
    rotation: rect.rotation || bounds.rotation || 0
  };
}

function resolvePlacementRect(originalRect, textArea, containerKind) {
  if (!textArea.inkRect) {
    return originalRect;
  }

  if (originalRect.height < 64 || originalRect.width < 120) {
    return originalRect;
  }

  if (containerKind === "speech-bubble") {
    return originalRect;
  }

  const inkArea = textArea.inkRect.width * textArea.inkRect.height;
  const originalArea = Math.max(1, originalRect.width * originalRect.height);
  const shouldTighten =
    containerKind === "plain-text" ||
    containerKind === "image-text" ||
    (containerKind === "ui-card" && originalArea / Math.max(1, inkArea) >= 2.15) ||
    originalArea / Math.max(1, inkArea) >= 1.65 ||
    originalRect.height > textArea.inkRect.height * 1.8;

  if (!shouldTighten) {
    return originalRect;
  }

  const padX = Math.max(4, Math.round(textArea.inkRect.width * 0.05));
  const padY = Math.max(3, Math.round(textArea.inkRect.height * 0.12));
  return expandRectWithin(
    textArea.inkRect,
    {
      bottom: padY,
      left: padX,
      right: padX,
      top: padY
    },
    originalRect
  );
}

function expandRectByPadding(rect, padding, maxWidth, maxHeight) {
  const x = Math.max(0, rect.x - padding.left);
  const y = Math.max(0, rect.y - padding.top);
  const right = Math.min(maxWidth, rect.x + rect.width + padding.right);
  const bottom = Math.min(maxHeight, rect.y + rect.height + padding.bottom);

  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y)
  };
}

function localizeRect(rect, centerX, centerY) {
  return {
    x: rect.x - centerX,
    y: rect.y - centerY,
    width: rect.width,
    height: rect.height
  };
}

function drawSolidCover(outputCtx, rect, backgroundColor, backgroundOpacity, containerKind) {
  const geometry = resolveCoverGeometry(rect, containerKind);
  const coverRect = {
    x: -rect.width / 2 - geometry.padding.left,
    y: -rect.height / 2 - geometry.padding.top,
    width: rect.width + geometry.padding.left + geometry.padding.right,
    height: rect.height + geometry.padding.top + geometry.padding.bottom
  };
  const radius = geometry.radius;
  const opacity =
    containerKind === "plain-text"
      ? 0.995
      : containerKind === "speech-bubble" || containerKind === "ui-card"
        ? 1
      : Math.max(resolveCoverOpacity(backgroundOpacity), 0.985);

  outputCtx.fillStyle = rgbaString(backgroundColor, opacity);
  if (radius <= 0) {
    outputCtx.fillRect(coverRect.x, coverRect.y, coverRect.width, coverRect.height);
  } else {
    roundRectPath(
      outputCtx,
      coverRect.x,
      coverRect.y,
      coverRect.width,
      coverRect.height,
      radius
    );
    outputCtx.fill();
  }
}

function drawCompactOcrCover(outputCtx, rect, backgroundColor) {
  const padX = Math.max(3, Math.round(rect.width * 0.018));
  const padY = Math.max(2, Math.round(rect.height * 0.06));
  outputCtx.fillStyle = rgbaString(backgroundColor, 0.82);
  roundRectPath(
    outputCtx,
    -rect.width / 2 - padX,
    -rect.height / 2 - padY,
    rect.width + padX * 2,
    rect.height + padY * 2,
    3
  );
  outputCtx.fill();
}

function drawBlurCover(outputCtx, sourceCanvas, rect, backgroundColor, backgroundOpacity, containerKind) {
  const geometry = resolveCoverGeometry(rect, containerKind);
  const feather = Math.max(
    6,
    Math.round(
      Math.max(
        geometry.padding.left,
        geometry.padding.right,
        geometry.padding.top,
        geometry.padding.bottom
      ) * 0.8
    )
  );
  const blurRadius = Math.max(8, Math.round(Math.min(rect.width, rect.height) * 0.18));
  const blurPadding = Math.max(14, blurRadius * 3);
  const coverRect = expandRectByPadding(
    rect,
    {
      bottom: geometry.padding.bottom + feather,
      left: geometry.padding.left + feather,
      right: geometry.padding.right + feather,
      top: geometry.padding.top + feather
    },
    sourceCanvas.width,
    sourceCanvas.height
  );
  const blurSampleRect = expandRect(
    coverRect,
    blurPadding,
    sourceCanvas.width,
    sourceCanvas.height
  );

  const localCenterX = rect.x + rect.width / 2;
  const localCenterY = rect.y + rect.height / 2;
  const localCoverRect = localizeRect(coverRect, localCenterX, localCenterY);
  const localSampleRect = localizeRect(blurSampleRect, localCenterX, localCenterY);

  const patchCanvas = document.createElement("canvas");
  patchCanvas.width = Math.max(1, Math.ceil(blurSampleRect.width));
  patchCanvas.height = Math.max(1, Math.ceil(blurSampleRect.height));
  const patchCtx = getCanvasContext2d(patchCanvas);

  patchCtx.drawImage(
    sourceCanvas,
    blurSampleRect.x,
    blurSampleRect.y,
    blurSampleRect.width,
    blurSampleRect.height,
    0,
    0,
    blurSampleRect.width,
    blurSampleRect.height
  );
  patchCtx.filter = `blur(${blurRadius}px)`;
  patchCtx.drawImage(
    sourceCanvas,
    blurSampleRect.x,
    blurSampleRect.y,
    blurSampleRect.width,
    blurSampleRect.height,
    0,
    0,
    blurSampleRect.width,
    blurSampleRect.height
  );

  outputCtx.save();
  roundRectPath(
    outputCtx,
    localCoverRect.x,
    localCoverRect.y,
    localCoverRect.width,
    localCoverRect.height,
    geometry.radius
  );
  outputCtx.clip();
  outputCtx.drawImage(
    patchCanvas,
    localSampleRect.x,
    localSampleRect.y,
    localSampleRect.width,
    localSampleRect.height
  );
  outputCtx.restore();

  const numericOpacity = Number(backgroundOpacity);
  const tintOpacity = Number.isFinite(numericOpacity)
    ? Math.min(0.34, Math.max(0.18, numericOpacity * 0.45))
    : 0.22;
  outputCtx.fillStyle = rgbaString(backgroundColor, tintOpacity);
  roundRectPath(
    outputCtx,
    localCoverRect.x,
    localCoverRect.y,
    localCoverRect.width,
    localCoverRect.height,
    geometry.radius
  );
  outputCtx.fill();
}

function drawTightOcrBlurCover(outputCtx, sourceCanvas, rect, backgroundColor, backgroundOpacity) {
  const padX = Math.max(2, Math.round(rect.width * 0.01));
  const padY = Math.max(1, Math.round(rect.height * 0.035));
  const blurRadius = Math.max(10, Math.round(Math.min(rect.width, rect.height) * 0.34));
  const coverRect = expandRectByPadding(
    rect,
    {
      bottom: padY,
      left: padX,
      right: padX,
      top: padY
    },
    sourceCanvas.width,
    sourceCanvas.height
  );
  const blurSampleRect = expandRect(
    coverRect,
    Math.max(4, blurRadius * 2),
    sourceCanvas.width,
    sourceCanvas.height
  );
  const localCenterX = rect.x + rect.width / 2;
  const localCenterY = rect.y + rect.height / 2;
  const localCoverRect = localizeRect(coverRect, localCenterX, localCenterY);
  const localSampleRect = localizeRect(blurSampleRect, localCenterX, localCenterY);
  const patchCanvas = document.createElement("canvas");
  patchCanvas.width = Math.max(1, Math.ceil(blurSampleRect.width));
  patchCanvas.height = Math.max(1, Math.ceil(blurSampleRect.height));
  const patchCtx = getCanvasContext2d(patchCanvas);

  patchCtx.drawImage(
    sourceCanvas,
    blurSampleRect.x,
    blurSampleRect.y,
    blurSampleRect.width,
    blurSampleRect.height,
    0,
    0,
    blurSampleRect.width,
    blurSampleRect.height
  );
  patchCtx.filter = `blur(${blurRadius}px)`;
  patchCtx.drawImage(
    sourceCanvas,
    blurSampleRect.x,
    blurSampleRect.y,
    blurSampleRect.width,
    blurSampleRect.height,
    0,
    0,
    blurSampleRect.width,
    blurSampleRect.height
  );

  outputCtx.save();
  roundRectPath(
    outputCtx,
    localCoverRect.x,
    localCoverRect.y,
    localCoverRect.width,
    localCoverRect.height,
    2
  );
  outputCtx.clip();
  outputCtx.drawImage(
    patchCanvas,
    localSampleRect.x,
    localSampleRect.y,
    localSampleRect.width,
    localSampleRect.height
  );
  outputCtx.restore();

  const numericOpacity = Number(backgroundOpacity);
  const tintOpacity = Number.isFinite(numericOpacity)
    ? Math.min(0.22, Math.max(0.08, numericOpacity * 0.22))
    : 0.14;
  outputCtx.fillStyle = rgbaString(backgroundColor, tintOpacity);
  roundRectPath(
    outputCtx,
    localCoverRect.x,
    localCoverRect.y,
    localCoverRect.width,
    localCoverRect.height,
    2
  );
  outputCtx.fill();
}

function drawWrappedText(ctx, rect, style, layout) {
  const fontFamily =
    style.container === "image-text"
      ? 'Arial, "Helvetica Neue", Helvetica, sans-serif'
      : '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Noto Sans TC", "PingFang TC", sans-serif';
  const fontWeight = resolveReadableFontWeight(
    style.fontWeight,
    layout.lines.join(""),
    style.container
  );
  const strokeWidth = resolveReadableStrokeWidth(
    style.strokeWidth || 0,
    layout.lines.join(""),
    layout.fontSize,
    style.container
  );

  ctx.font = `${fontWeight} ${layout.fontSize}px ${fontFamily}`;
  ctx.fillStyle = style.textColor;
  ctx.strokeStyle = style.strokeColor || contrastTextColor(style.textColor);
  ctx.lineWidth = strokeWidth;
  ctx.lineJoin = "round";
  ctx.textBaseline = "middle";

  if (style.align === "left") {
    ctx.textAlign = "left";
  } else if (style.align === "right") {
    ctx.textAlign = "right";
  } else {
    ctx.textAlign = "center";
  }

  const x =
    style.align === "left"
      ? -rect.width / 2 + layout.paddingX
      : style.align === "right"
        ? rect.width / 2 - layout.paddingX
        : 0;
  let y;

  if (style.verticalAlign === "top") {
    y = -rect.height / 2 + layout.paddingY + layout.lineHeight / 2;
  } else if (style.verticalAlign === "bottom") {
    y =
      rect.height / 2 -
      layout.paddingY -
      layout.lineHeight / 2 -
      (layout.lines.length - 1) * layout.lineHeight;
  } else {
    y = -((layout.lines.length - 1) * layout.lineHeight) / 2;
  }

  for (const line of layout.lines) {
    if (ctx.lineWidth > 0) {
      ctx.strokeText(line, x, y);
    }
    ctx.fillText(line, x, y);
    y += layout.lineHeight;
  }
}

function macosVisionLineFontSize(rect) {
  return Math.max(18, Math.floor(rect.height * 0.86));
}

function macosVisionFlowPackingFontSize(rect) {
  return Math.max(16, Math.floor(rect.height * 0.7));
}

function macosVisionFlowTextBox(rect) {
  const paddingX = Math.max(2, rect.width * 0.02);
  return {
    width: Math.max(18, rect.width - paddingX * 2)
  };
}

function applyMacosVisionTextFlow(renderBlocks, outputCtx) {
  const groups = new Map();

  for (const [index, item] of renderBlocks.entries()) {
    const groupId = item.block.flowGroupId;
    if (item.block.provider !== "macos-vision" || !groupId || !item.block.flowText) {
      continue;
    }

    if (!groups.has(groupId)) {
      groups.set(groupId, []);
    }
    groups.get(groupId).push({ index, item });
  }

  if (!groups.size) {
    return renderBlocks;
  }

  const nextBlocks = renderBlocks.slice();

  for (const groupItems of groups.values()) {
    const ordered = groupItems
      .slice()
      .sort((first, second) => {
        const firstIndex = Number(first.item.block.flowBoxIndex);
        const secondIndex = Number(second.item.block.flowBoxIndex);
        if (Number.isFinite(firstIndex) && Number.isFinite(secondIndex)) {
          return firstIndex - secondIndex;
        }
        return first.item.rect.y - second.item.rect.y || first.item.rect.x - second.item.rect.x;
      });
    const flowText = ordered[0].item.block.flowText;
    const boxes = ordered.map(({ item }) => ({
      ...macosVisionFlowTextBox(item.rect),
      item
    }));
    const assignments = distributeTextAcrossBoxes(flowText, boxes, {
      measureWidth(value, box) {
        const item = box.item;
        const fontSize = macosVisionFlowPackingFontSize(item.rect);
        const fontWeight = resolveReadableFontWeight(
          item.resolvedStyle.fontWeight,
          value,
          item.resolvedStyle.container
        );
        outputCtx.font = `${fontWeight} ${fontSize}px Arial, "Helvetica Neue", Helvetica, sans-serif`;
        return outputCtx.measureText(value).width;
      }
    });

    for (const [assignmentIndex, assignment] of assignments.entries()) {
      const target = ordered[assignmentIndex];
      nextBlocks[target.index] = {
        ...target.item,
        coverRect: target.item.coverRect || target.item.rect,
        block: {
          ...target.item.block,
          translatedText: assignment
        }
      };
    }
  }

  return nextBlocks;
}

async function renderTranslatedCanvas(imageDataUrl, translation) {
  const image = await loadImage(imageDataUrl);
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = image.width;
  sourceCanvas.height = image.height;
  const sourceCtx = getReadableCanvasContext2d(sourceCanvas);
  sourceCtx.drawImage(image, 0, 0);

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = image.width;
  outputCanvas.height = image.height;
  const outputCtx = getCanvasContext2d(outputCanvas);
  outputCtx.drawImage(image, 0, 0);

  let renderBlocks = translation.blocks
    .map((block) => ({
      block,
      rect: normalizeBoundsToPixels(block.bounds, outputCanvas.width, outputCanvas.height)
    }))
    .filter(({ rect }) => rectIsLargeEnough(rect, 12))
    .map(({ block, rect }) => {
      const usesProviderOcr = block.provider === "ios-ocr" || block.provider === "macos-vision";
      const textArea = inspectTextArea(sourceCtx, rect, block.style.textColor);
      const containerKind = usesProviderOcr
        ? "image-text"
        : resolveRenderedContainerKind(
            block.style.container,
            textArea.containerKind
          );
      const placementRect = usesProviderOcr
        ? rect
        : resolvePlacementRect(rect, textArea, containerKind);
      const backgroundColor =
        textArea.backgroundColor || block.style.backgroundColor || sampleRegionColor(sourceCtx, placementRect);
      const textColor = readableTextColor(
        block.style.textColor || contrastTextColor(backgroundColor),
        backgroundColor
      );

      return {
        backgroundColor,
        block,
        coverRect: placementRect,
        rect: placementRect,
        resolvedStyle: {
          ...block.style,
          backgroundColor,
          container: containerKind,
          textColor,
          verticalAlign: resolveTextVerticalAlign(containerKind, block.style.verticalAlign)
        },
        textArea
      };
    });
  renderBlocks = applyMacosVisionTextFlow(renderBlocks, outputCtx);

  const textLayouts = planTextLayouts(
    renderBlocks.map(({ block, rect, resolvedStyle }) => ({
      bounds: rect,
      groupId: block.groupId,
      provider: block.provider,
      sourceLineCount: block.sourceLineCount,
      sourceText: block.sourceText,
      style: resolvedStyle,
      translatedText: block.translatedText
    })),
    {
      measureWidth(value, fontSize, block) {
        const fontFamily =
          block.style.container === "image-text"
            ? 'Arial, "Helvetica Neue", Helvetica, sans-serif'
            : '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Noto Sans TC", "PingFang TC", sans-serif';
        const fontWeight = resolveReadableFontWeight(
          block.style.fontWeight,
          block.translatedText,
          block.style.container
        );
        outputCtx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
        return outputCtx.measureText(value).width;
      },
      maxFontSize(block) {
        return block.provider === "macos-vision"
          ? macosVisionLineFontSize(block.bounds)
          : undefined;
      },
      minFontSize(block) {
        return block.provider === "macos-vision" ? 16 : 10;
      }
    }
  );

  for (const [index, { block, coverRect, rect, resolvedStyle }] of renderBlocks.entries()) {
    const layout = textLayouts[index];
    const providerCoverRect = coverRect || rect;

    outputCtx.save();

    if (block.provider === "macos-vision" && !block.translatedText) {
      outputCtx.translate(
        providerCoverRect.x + providerCoverRect.width / 2,
        providerCoverRect.y + providerCoverRect.height / 2
      );
      outputCtx.rotate((providerCoverRect.rotation * Math.PI) / 180);
      drawTightOcrBlurCover(
        outputCtx,
        sourceCanvas,
        providerCoverRect,
        resolvedStyle.backgroundColor,
        block.style.backgroundOpacity ?? 0.7
      );
    } else if (block.provider === "ios-ocr" || block.provider === "macos-vision") {
      outputCtx.translate(
        providerCoverRect.x + providerCoverRect.width / 2,
        providerCoverRect.y + providerCoverRect.height / 2
      );
      outputCtx.rotate((providerCoverRect.rotation * Math.PI) / 180);
      drawCompactOcrCover(
        outputCtx,
        providerCoverRect,
        resolvedStyle.backgroundColor
      );
    } else if (resolvedStyle.container === "image-text") {
      outputCtx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
      outputCtx.rotate((rect.rotation * Math.PI) / 180);
      drawBlurCover(
        outputCtx,
        sourceCanvas,
        rect,
        resolvedStyle.backgroundColor,
        block.style.backgroundOpacity ?? 0.88,
        resolvedStyle.container
      );
    } else {
      outputCtx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
      outputCtx.rotate((rect.rotation * Math.PI) / 180);
      drawSolidCover(
        outputCtx,
        rect,
        resolvedStyle.backgroundColor,
        block.style.backgroundOpacity ?? 0.98,
        resolvedStyle.container
      );
    }
    outputCtx.restore();

    outputCtx.save();
    outputCtx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
    outputCtx.rotate((rect.rotation * Math.PI) / 180);
    if (block.provider === "ios-ocr" || block.provider === "macos-vision") {
      outputCtx.beginPath();
      outputCtx.rect(-rect.width / 2, -rect.height / 2, rect.width, rect.height);
      outputCtx.clip();
    }
    drawWrappedText(outputCtx, rect, {
      align: resolvedStyle.align,
      container: resolvedStyle.container,
      fontWeight: resolvedStyle.fontWeight,
      strokeColor:
        resolvedStyle.strokeColor ||
        (luminance(resolvedStyle.textColor) > 0.55 ? "#111111" : "#ffffff"),
      strokeWidth: resolvedStyle.strokeWidth,
      textColor: resolvedStyle.textColor,
      verticalAlign: resolvedStyle.verticalAlign
    }, layout);
    outputCtx.restore();
  }

  return outputCanvas;
}

async function translateViewportRect(rect) {
  showToast("Translating selected area...");
  const snapshot = await captureSnapshot();
  const crop = cropRectFromSnapshot(snapshot, rect);
  const translation = await requestTranslation(crop.dataUrl);

  if (!translation.blocks.length) {
    showToast("No translatable text was detected in that area.");
    return;
  }

  const canvas = await renderTranslatedCanvas(crop.dataUrl, translation);
  attachOverlay({
    canvas,
    fixedRect: rect
  });
  showToast("Translated area overlay ready.");
}

async function translateImageElement(imageElement, options = {}) {
  const settings = await getSettings();
  const fingerprint = measureImageFingerprint(imageElement, settings);
  const visualFingerprint = measureImageVisualFingerprint(imageElement, settings);
  const emptyRecord = state.emptyTranslationFingerprints.get(imageElement);

  if (
    state.translatedVisualFingerprints.has(visualFingerprint) ||
    (!options.force && state.translatedFingerprints.get(imageElement) === fingerprint)
  ) {
    return;
  }

  if (
    !options.force &&
    emptyRecord?.fingerprint === fingerprint &&
    emptyRecord.count >= 2
  ) {
    return;
  }

  if (state.inFlightElements.has(imageElement)) {
    return;
  }

  if (state.visualInFlightFingerprints.has(visualFingerprint)) {
    return;
  }

  const rect = imageElement.getBoundingClientRect();
  if (!elementIsVisible(rect)) {
    return;
  }

  state.inFlightElements.add(imageElement);
  state.visualInFlightFingerprints.add(visualFingerprint);

  try {
    const snapshot = options.snapshot || (await captureSnapshot());
    const crop = cropRectFromSnapshot(snapshot, rect);
    const cachedTranslation = !options.force
      ? findCachedRedditTranslation(imageElement, settings)
      : null;

    if (cachedTranslation?.blocks?.length) {
      const canvas = await renderTranslatedCanvas(crop.dataUrl, cachedTranslation);
      attachOverlay({
        anchorElement: imageElement,
        canvas
      });
      state.translatedFingerprints.set(imageElement, fingerprint);
      state.translatedVisualFingerprints.add(visualFingerprint);
      return;
    }

    const translation = await requestTranslation(crop.dataUrl);

    if (!translation.blocks.length) {
      state.emptyTranslationFingerprints.set(imageElement, {
        count:
          emptyRecord?.fingerprint === fingerprint
            ? emptyRecord.count + 1
            : 1,
        fingerprint
      });
      return;
    }

    const canvas = await renderTranslatedCanvas(crop.dataUrl, translation);
    attachOverlay({
      anchorElement: imageElement,
      canvas
    });
    rememberRedditTranslation(imageElement, settings, translation);
    state.emptyTranslationFingerprints.delete(imageElement);
    state.translatedFingerprints.set(imageElement, fingerprint);
    state.translatedVisualFingerprints.add(visualFingerprint);
  } finally {
    state.inFlightElements.delete(imageElement);
    state.visualInFlightFingerprints.delete(visualFingerprint);
  }
}

function chunkItems(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function prepareImageBatchJob(imageElement, settings, snapshot, force) {
  const fingerprint = measureImageFingerprint(imageElement, settings);
  const visualFingerprint = measureImageVisualFingerprint(imageElement, settings);
  const emptyRecord = state.emptyTranslationFingerprints.get(imageElement);

  if (
    state.translatedVisualFingerprints.has(visualFingerprint) ||
    (!force && state.translatedFingerprints.get(imageElement) === fingerprint)
  ) {
    return null;
  }

  if (
    !force &&
    emptyRecord?.fingerprint === fingerprint &&
    emptyRecord.count >= 2
  ) {
    return null;
  }

  if (
    state.inFlightElements.has(imageElement) ||
    state.visualInFlightFingerprints.has(visualFingerprint)
  ) {
    return null;
  }

  const rect = imageElement.getBoundingClientRect();
  if (!elementIsVisible(rect)) {
    return null;
  }

  const cachedTranslation = !force
    ? findCachedRedditTranslation(imageElement, settings)
    : null;

  if (cachedTranslation?.blocks?.length) {
    const crop = cropRectFromSnapshot(snapshot, rect);
    const canvas = await renderTranslatedCanvas(crop.dataUrl, cachedTranslation);
    attachOverlay({
      anchorElement: imageElement,
      canvas
    });
    state.translatedFingerprints.set(imageElement, fingerprint);
    state.translatedVisualFingerprints.add(visualFingerprint);
    return null;
  }

  state.inFlightElements.add(imageElement);
  state.visualInFlightFingerprints.add(visualFingerprint);
  const crop = cropRectFromSnapshot(snapshot, rect);

  return {
    crop,
    emptyRecord,
    fingerprint,
    id: `image-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    imageElement,
    visualFingerprint
  };
}

function releaseImageBatchJob(job) {
  state.inFlightElements.delete(job.imageElement);
  state.visualInFlightFingerprints.delete(job.visualFingerprint);
}

async function finishImageBatchJob(job, settings, translation) {
  if (!translation?.blocks?.length) {
    state.emptyTranslationFingerprints.set(job.imageElement, {
      count:
        job.emptyRecord?.fingerprint === job.fingerprint
          ? job.emptyRecord.count + 1
          : 1,
      fingerprint: job.fingerprint
    });
    return;
  }

  const canvas = await renderTranslatedCanvas(job.crop.dataUrl, translation);
  attachOverlay({
    anchorElement: job.imageElement,
    canvas
  });
  rememberRedditTranslation(job.imageElement, settings, translation);
  state.emptyTranslationFingerprints.delete(job.imageElement);
  state.translatedFingerprints.set(job.imageElement, job.fingerprint);
  state.translatedVisualFingerprints.add(job.visualFingerprint);
}

async function translateVisibleImagesWithIosOcr(images, settings, snapshot, force) {
  const jobs = [];

  for (const image of images) {
    try {
      const job = await prepareImageBatchJob(image, settings, snapshot, force);
      if (job) {
        jobs.push(job);
      }
    } catch (error) {
      console.warn("Image preparation failed for one image.", error);
    }
  }

  for (const chunk of chunkItems(jobs, 3)) {
    try {
      const translations = await requestTranslationBatch(
        chunk.map((job) => ({
          id: job.id,
          imageDataUrl: job.crop.dataUrl
        }))
      );
      const translationById = new Map(
        translations.map((item) => [item.id, item.translation])
      );

      for (const job of chunk) {
        await finishImageBatchJob(job, settings, translationById.get(job.id));
      }
    } catch (error) {
      console.warn("iOS OCR batch translation failed.", error);
    } finally {
      for (const job of chunk) {
        releaseImageBatchJob(job);
      }
    }
  }
}

async function applyCachedRedditTranslation(imageElement, settings, snapshot) {
  if (imageHasCurrentTranslation(imageElement, settings)) {
    return true;
  }

  if (state.inFlightElements.has(imageElement)) {
    return false;
  }

  const visualFingerprint = measureImageVisualFingerprint(imageElement, settings);
  if (state.visualInFlightFingerprints.has(visualFingerprint)) {
    return false;
  }

  const cachedTranslation = findCachedRedditTranslation(imageElement, settings);
  if (!cachedTranslation?.blocks?.length) {
    return false;
  }

  const rect = imageElement.getBoundingClientRect();
  if (!elementIsVisible(rect)) {
    return false;
  }

  state.inFlightElements.add(imageElement);
  state.visualInFlightFingerprints.add(visualFingerprint);
  try {
    const fingerprint = measureImageFingerprint(imageElement, settings);
    const crop = cropRectFromSnapshot(snapshot, rect);
    const canvas = await renderTranslatedCanvas(crop.dataUrl, cachedTranslation);
    attachOverlay({
      anchorElement: imageElement,
      canvas
    });
    state.translatedFingerprints.set(imageElement, fingerprint);
    state.translatedVisualFingerprints.add(visualFingerprint);
    return true;
  } finally {
    state.inFlightElements.delete(imageElement);
    state.visualInFlightFingerprints.delete(visualFingerprint);
  }
}

async function applyCachedRedditTranslationsToVisibleImages() {
  if (!isRedditPage()) {
    return;
  }

  const settings = await getSettings();
  const images = candidateImages().filter((image) =>
    !imageHasCurrentTranslation(image, settings) &&
    Boolean(findCachedRedditTranslation(image, settings)?.blocks?.length)
  );
  if (!images.length) {
    return;
  }

  const snapshot = await captureSnapshot();
  for (const image of images) {
    try {
      await applyCachedRedditTranslation(image, settings, snapshot);
    } catch (error) {
      console.warn("Cached Reddit image translation failed for one image.", error);
    }
  }
}

async function translateVisibleImages(force = false) {
  if (state.visibleTranslationInFlight) {
    return;
  }

  state.visibleTranslationInFlight = true;
  try {
  const settings = await getSettings();
  const images = candidateImages().filter((image) =>
    force || !imageHasCurrentTranslation(image, settings)
  );
  if (!images.length) {
    if (force) {
      showToast("No visible images were found on this page.");
    }
    return;
  }

  showToast(`Translating ${images.length} visible image${images.length > 1 ? "s" : ""}...`);
  const snapshot = await captureSnapshot();

  if (settings.useIosOcrServer) {
    await translateVisibleImagesWithIosOcr(images, settings, snapshot, force);
    showToast("Visible image translation finished.");
    return;
  }

  for (const image of images) {
    try {
      await translateImageElement(image, { force, snapshot });
    } catch (error) {
      console.warn("Image translation failed for one image.", error);
    }
  }

  showToast("Visible image translation finished.");
  } finally {
    state.visibleTranslationInFlight = false;
  }
}

function imageFromPoint(layer, x, y) {
  layer.style.pointerEvents = "none";
  const found = document
    .elementsFromPoint(x, y)
    .find((element) => element instanceof HTMLImageElement);
  layer.style.pointerEvents = "auto";
  return found || null;
}

function destroySelectionLayer() {
  if (state.selectionCleanup) {
    state.selectionCleanup();
    state.selectionCleanup = null;
  }
}

function startManualSelection() {
  destroySelectionLayer();
  ensureRoot();

  const layer = document.createElement("div");
  layer.className = "translect-selection-layer";

  const hud = document.createElement("div");
  hud.className = "translect-selection-hud";
  hud.textContent = "Click an image or drag a rectangle. Press Escape to cancel.";

  const selectionBox = document.createElement("div");
  selectionBox.className = "translect-selection-box";
  selectionBox.hidden = true;

  const hoverBox = document.createElement("div");
  hoverBox.className = "translect-hover-box";
  hoverBox.hidden = true;

  layer.append(hud, selectionBox, hoverBox);
  ensureRoot().append(layer);

  let drag = null;

  function positionBox(node, rect) {
    node.hidden = false;
    node.style.left = `${rect.x}px`;
    node.style.top = `${rect.y}px`;
    node.style.width = `${rect.width}px`;
    node.style.height = `${rect.height}px`;
  }

  function cancelSelection() {
    destroySelectionLayer();
    showToast("Selection cancelled.");
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelSelection();
    }
  }

  function updateHover(event) {
    if (drag) {
      return;
    }

    const image = imageFromPoint(layer, event.clientX, event.clientY);
    if (!image) {
      hoverBox.hidden = true;
      return;
    }

    const rect = image.getBoundingClientRect();
    if (!elementIsVisible(rect)) {
      hoverBox.hidden = true;
      return;
    }
    positionBox(hoverBox, rect);
  }

  async function finalizeSelection(event) {
    const activeDrag = drag;
    drag = null;
    selectionBox.hidden = true;
    hoverBox.hidden = true;
    destroySelectionLayer();
    await waitForNextPaint();

    const rect = makeRect(
      activeDrag.startX,
      activeDrag.startY,
      event.clientX,
      event.clientY
    );

    try {
      if (rectIsLargeEnough(rect, 32)) {
        await translateViewportRect(rect);
        return;
      }

      if (activeDrag.image) {
        showToast("Translating selected image...");
        await translateImageElement(activeDrag.image, { force: true });
        showToast("Image translation finished.");
        return;
      }

      showToast("Selection was too small.");
    } catch (error) {
      showToast(error.message || "Translation failed.");
    }
  }

  layer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }

    drag = {
      image: imageFromPoint(layer, event.clientX, event.clientY),
      startX: event.clientX,
      startY: event.clientY
    };
    positionBox(selectionBox, makeRect(event.clientX, event.clientY, event.clientX, event.clientY));
  });

  layer.addEventListener("pointermove", (event) => {
    if (!drag) {
      updateHover(event);
      return;
    }
    positionBox(
      selectionBox,
      makeRect(drag.startX, drag.startY, event.clientX, event.clientY)
    );
  });

  layer.addEventListener("pointerup", (event) => {
    if (!drag) {
      return;
    }
    finalizeSelection(event);
  });

  layer.addEventListener("pointercancel", () => {
    destroySelectionLayer();
  });

  document.addEventListener("keydown", onKeyDown, true);

  state.selectionCleanup = () => {
    document.removeEventListener("keydown", onKeyDown, true);
    layer.remove();
  };
}

async function getSettings() {
  if (state.settings) {
    return state.settings;
  }

  const response = await sendMessage({ type: MESSAGE_TYPES.GET_SETTINGS });
  state.settings = normalizeSettings(response?.settings || {});
  return state.settings;
}

function stopAutoObservers() {
  state.autoMutationObserver?.disconnect();
  state.autoMutationObserver = null;
  if (state.autoScanHandle) {
    clearTimeout(state.autoScanHandle);
    state.autoScanHandle = null;
  }
  if (state.autoEventsBound) {
    window.removeEventListener("scroll", scheduleAutoScan, true);
    window.removeEventListener("resize", scheduleAutoScan);
    state.autoEventsBound = false;
  }
}

function scheduleAutoScan() {
  if (state.autoScanHandle) {
    clearTimeout(state.autoScanHandle);
  }

  state.autoScanHandle = window.setTimeout(() => {
    translateVisibleImages(false).catch((error) => {
      console.warn("Automatic image translation failed.", error);
    });
  }, 450);
}

function scheduleRedditReuseScan() {
  if (!isRedditPage()) {
    return;
  }

  if (state.redditReuseScanHandle) {
    clearTimeout(state.redditReuseScanHandle);
  }

  state.redditReuseScanHandle = window.setTimeout(() => {
    applyCachedRedditTranslationsToVisibleImages().catch((error) => {
      console.warn("Could not apply cached Reddit translations.", error);
    });
  }, 350);
}

function startRedditReuseObserver() {
  if (!isRedditPage() || state.redditReuseMutationObserver) {
    return;
  }

  state.redditReuseMutationObserver = new MutationObserver(scheduleRedditReuseScan);
  state.redditReuseMutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  if (!state.redditReuseEventsBound) {
    window.addEventListener("popstate", scheduleRedditReuseScan);
    window.addEventListener("scroll", scheduleRedditReuseScan, true);
    window.addEventListener("resize", scheduleRedditReuseScan);
    state.redditReuseEventsBound = true;
  }

  scheduleRedditReuseScan();
}

async function applySettings() {
  state.settings = null;
  const settings = await getSettings();

  if (settings.alwaysAutoDetect) {
    if (!state.autoMutationObserver) {
      state.autoMutationObserver = new MutationObserver(scheduleAutoScan);
      state.autoMutationObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
      if (!state.autoEventsBound) {
        window.addEventListener("scroll", scheduleAutoScan, true);
        window.addEventListener("resize", scheduleAutoScan);
        state.autoEventsBound = true;
      }
    }
    scheduleAutoScan();
  } else {
    stopAutoObservers();
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "page-action") {
    return false;
  }

  async function handlePageAction() {
    switch (message.action) {
      case PAGE_ACTIONS.AUTO_TRANSLATE_VISIBLE:
        if (state.autoScanHandle) {
          clearTimeout(state.autoScanHandle);
          state.autoScanHandle = null;
        }
        await translateVisibleImages(true);
        return;
      case PAGE_ACTIONS.CLEAR_OVERLAYS:
        clearOverlays();
        return;
      case PAGE_ACTIONS.SETTINGS_UPDATED:
        await applySettings();
        return;
      case PAGE_ACTIONS.START_MANUAL_SELECTION:
        startManualSelection();
        return;
      default:
        throw new Error("Unknown page action.");
    }
  }

  handlePageAction()
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });

  return true;
});

if (!state.initialized) {
  state.initialized = true;
  window.addEventListener("scroll", scheduleOverlayRefresh, true);
  window.addEventListener("resize", scheduleOverlayRefresh);
  startRedditReuseObserver();
  window.addEventListener("load", () => {
    startRedditReuseObserver();
    applySettings().catch((error) => {
      console.warn("Could not apply Translect settings on page load.", error);
    });
  });

  if (document.readyState === "complete") {
    applySettings().catch((error) => {
      console.warn("Could not apply Translect settings immediately.", error);
    });
  }
}
