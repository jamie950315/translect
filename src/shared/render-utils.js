export function tokenizeText(text) {
  if (!text) {
    return [];
  }

  const tokens = [];
  const parts = String(text).split(/(\s+)/u).filter(Boolean);
  const cjkPattern = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u;

  for (const part of parts) {
    if (/^\s+$/u.test(part)) {
      continue;
    }

    if (cjkPattern.test(part)) {
      tokens.push(...Array.from(part));
    } else {
      tokens.push(part);
    }
  }

  return tokens;
}

export function wrapTextToWidth(text, maxWidth, measureFn) {
  const paragraphs = String(text).split(/\n+/).filter(Boolean);
  if (!paragraphs.length) {
    return [];
  }

  const lines = [];

  for (const paragraph of paragraphs) {
    const tokens = tokenizeText(paragraph);
    if (!tokens.length) {
      continue;
    }

    let currentLine = "";
    for (const token of tokens) {
      const candidate = currentLine
        ? shouldInsertSpace(currentLine, token)
          ? `${currentLine} ${token}`
          : `${currentLine}${token}`
        : token;

      if (measureFn(candidate) <= maxWidth || !currentLine) {
        currentLine = candidate;
      } else {
        lines.push(currentLine);
        currentLine = token;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines;
}

function shouldInsertSpace(previousText, nextToken) {
  const previous = Array.from(previousText).at(-1) || "";
  const cjkPattern = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u;

  return !cjkPattern.test(previous) && !cjkPattern.test(nextToken);
}

export function fitFontSize(text, box, options) {
  const {
    maxFontSize = 64,
    measureWidth,
    minFontSize = 10,
    lineHeightRatio = 1.18,
    targetLineCount = 0
  } = options;

  let best = {
    fontSize: minFontSize,
    lineDelta: Number.POSITIVE_INFINITY,
    lines: wrapTextToWidth(text, box.width, (value) => measureWidth(value, minFontSize))
  };

  for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= 1) {
    const lines = wrapTextToWidth(text, box.width, (value) => measureWidth(value, fontSize));
    const requiredHeight = lines.length * fontSize * lineHeightRatio;
    const widestLine = Math.max(...lines.map((line) => measureWidth(line, fontSize)), 0);

    if (widestLine > box.width || requiredHeight > box.height) {
      continue;
    }

    const lineDelta = targetLineCount
      ? Math.abs(lines.length - targetLineCount)
      : 0;

    if (
      lineDelta < best.lineDelta ||
      (lineDelta === best.lineDelta && fontSize > best.fontSize)
    ) {
      best = {
        fontSize,
        lineDelta,
        lines
      };
    }
  }

  return {
    fontSize: best.fontSize,
    lineHeight: best.fontSize * lineHeightRatio,
    lines: best.lines
  };
}

export function textContainsCjk(text) {
  return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u.test(String(text || ""));
}

export function resolveReadableFontWeight(fontWeight, text, container = "auto") {
  const numericWeight = Number.isFinite(Number(fontWeight)) ? Number(fontWeight) : 600;

  if (!textContainsCjk(text)) {
    return numericWeight;
  }

  if (container === "image-text") {
    return Math.min(numericWeight, 580);
  }

  if (container === "caption-strip") {
    return Math.min(numericWeight, 560);
  }

  return Math.min(numericWeight, 560);
}

export function resolveReadableStrokeWidth(strokeWidth, text, fontSize, container = "auto") {
  const numericStroke = Number.isFinite(Number(strokeWidth)) ? Number(strokeWidth) : 0;

  if (!textContainsCjk(text)) {
    return numericStroke;
  }

  if (container === "image-text") {
    return Math.min(numericStroke, Math.max(0, Math.round(fontSize * 0.055)));
  }

  return Math.min(numericStroke, Math.max(0, Math.round(fontSize * 0.025)));
}

function countVisibleLines(text) {
  return String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function resolveSourceLineCount(block) {
  return Math.max(
    1,
    Number(block?.sourceLineCount) || 0,
    countVisibleLines(block?.sourceText),
    countVisibleLines(block?.translatedText)
  );
}

function normalizeColorKey(color) {
  const match = /^#?([0-9a-f]{6})$/i.exec(color || "");
  if (!match) {
    return "na";
  }

  const hex = match[1];
  const channels = [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16)
  ];

  return channels.map((value) => Math.round(value / 32)).join("-");
}

function getTextPadding(rect, block) {
  switch (block?.style?.container) {
    case "caption-strip":
      return {
        x: Math.max(4, rect.width * 0.025),
        y: Math.max(3, rect.height * 0.045)
      };
    case "plain-text":
      return {
        x: Math.max(3, rect.width * 0.02),
        y: Math.max(2, rect.height * 0.02)
      };
    case "speech-bubble":
    case "ui-card":
      return {
        x: Math.max(5, rect.width * 0.04),
        y: Math.max(4, rect.height * 0.045)
      };
    default:
      return {
        x: Math.max(4, rect.width * 0.035),
        y: Math.max(4, rect.height * 0.04)
      };
  }
}

function getTextBox(rect, block) {
  const padding = getTextPadding(rect, block);

  return {
    height: Math.max(18, rect.height - padding.y * 2),
    paddingX: padding.x,
    paddingY: padding.y,
    width: Math.max(18, rect.width - padding.x * 2)
  };
}

function estimateOriginalFontSize(block, lineHeightRatio = 1.18) {
  const lineCount = resolveSourceLineCount(block);
  const textBox = getTextBox(block.bounds, block);
  return textBox.height / Math.max(1, lineCount * lineHeightRatio);
}

function resolveTypographyGroupKey(block, lineHeightRatio = 1.18) {
  if (block?.groupId) {
    return `group:${block.groupId}`;
  }

  const estimatedFontSize = estimateOriginalFontSize(block, lineHeightRatio);

  return [
    "auto",
    block?.style?.container || "auto",
    block?.style?.align || "center",
    Math.round((block?.style?.fontWeight || 700) / 100),
    normalizeColorKey(block?.style?.backgroundColor),
    normalizeColorKey(block?.style?.textColor),
    Math.max(1, Math.round(estimatedFontSize / 2))
  ].join("|");
}

function resolveBlockRotation(block) {
  return Number(block?.bounds?.rotation ?? block?.style?.rotation ?? 0);
}

function resolveHorizontalAnchor(block) {
  const rect = block.bounds;
  const align = block?.style?.align || "center";

  if (align === "left") {
    return rect.x;
  }

  if (align === "right") {
    return rect.x + rect.width;
  }

  return rect.x + rect.width / 2;
}

function horizontalOverlapRatio(firstRect, secondRect) {
  const overlap = Math.max(
    0,
    Math.min(firstRect.x + firstRect.width, secondRect.x + secondRect.width) -
      Math.max(firstRect.x, secondRect.x)
  );
  const narrowestWidth = Math.max(1, Math.min(firstRect.width, secondRect.width));
  return overlap / narrowestWidth;
}

function canShareTypography(firstBlock, secondBlock) {
  const firstRect = firstBlock.bounds;
  const secondRect = secondBlock.bounds;
  const firstAlign = firstBlock?.style?.align || "center";
  const secondAlign = secondBlock?.style?.align || "center";

  if (firstAlign !== secondAlign) {
    return false;
  }

  if (Math.abs(resolveBlockRotation(firstBlock) - resolveBlockRotation(secondBlock)) > 4) {
    return false;
  }

  if (
    Math.abs((firstBlock?.style?.fontWeight || 700) - (secondBlock?.style?.fontWeight || 700)) > 200
  ) {
    return false;
  }

  const widthRatio =
    Math.min(firstRect.width, secondRect.width) / Math.max(firstRect.width, secondRect.width);
  if (widthRatio < 0.68) {
    return false;
  }

  const anchorGap = Math.abs(
    resolveHorizontalAnchor(firstBlock) - resolveHorizontalAnchor(secondBlock)
  );
  if (anchorGap > Math.max(18, Math.min(firstRect.width, secondRect.width) * 0.12)) {
    return false;
  }

  if (horizontalOverlapRatio(firstRect, secondRect) < 0.72) {
    return false;
  }

  const verticalGap = secondRect.y - (firstRect.y + firstRect.height);
  const averageHeight = (firstRect.height + secondRect.height) / 2;

  return verticalGap <= Math.max(20, averageHeight * 0.42);
}

function collectTypographyGroups(blocks) {
  if (blocks.length < 2) {
    return [];
  }

  const groups = [];
  const assigned = new Set();
  const keyedGroups = new Map();

  for (const [index, block] of blocks.entries()) {
    const key = resolveTypographyGroupKey(block);
    if (!keyedGroups.has(key)) {
      keyedGroups.set(key, []);
    }
    keyedGroups.get(key).push(index);
  }

  for (const indexes of keyedGroups.values()) {
    if (indexes.length < 2) {
      continue;
    }

    const sorted = indexes.slice().sort((firstIndex, secondIndex) => {
      const firstRect = blocks[firstIndex].bounds;
      const secondRect = blocks[secondIndex].bounds;
      return firstRect.y - secondRect.y || firstRect.x - secondRect.x;
    });

    groups.push(sorted);
    for (const index of sorted) {
      assigned.add(index);
    }
  }

  const indexes = blocks
    .map((_, index) => index)
    .filter((index) => !assigned.has(index))
    .sort((firstIndex, secondIndex) => {
      const firstRect = blocks[firstIndex].bounds;
      const secondRect = blocks[secondIndex].bounds;
      return firstRect.y - secondRect.y || firstRect.x - secondRect.x;
    });

  if (!indexes.length) {
    return groups;
  }

  let currentGroup = [indexes[0]];

  for (let index = 1; index < indexes.length; index += 1) {
    const nextIndex = indexes[index];
    const previousIndex = currentGroup[currentGroup.length - 1];

    if (canShareTypography(blocks[previousIndex], blocks[nextIndex])) {
      currentGroup.push(nextIndex);
    } else {
      if (currentGroup.length > 1) {
        groups.push(currentGroup);
      }
      currentGroup = [nextIndex];
    }
  }

  if (currentGroup.length > 1) {
    groups.push(currentGroup);
  }

  return groups;
}

function resolveBlockMaxFontSize(block, maxFontSize) {
  if (typeof maxFontSize === "function") {
    return maxFontSize(block);
  }

  if (Number.isFinite(maxFontSize)) {
    return maxFontSize;
  }

  const container = block?.style?.container || "auto";
  const heightScale =
    container === "image-text"
      ? 0.42
      : container === "caption-strip"
        ? 0.36
        : container === "speech-bubble" || container === "ui-card"
          ? 0.32
          : 0.3;
  const defaultMax = Math.max(12, Math.floor(block.bounds.height * heightScale));
  const estimatedFontSize = estimateOriginalFontSize(block);

  if (!Number.isFinite(estimatedFontSize) || estimatedFontSize <= 0) {
    return defaultMax;
  }

  const sourceLineCount = resolveSourceLineCount(block);
  const cjkScale = textContainsCjk(block?.translatedText) ? 0.92 : 1.02;
  const lineCountScale = sourceLineCount >= 3 ? 0.9 : 1;

  return Math.max(11, Math.min(defaultMax, Math.round(estimatedFontSize * cjkScale * lineCountScale)));
}

function createTextLayout(block, options, fixedFontSize) {
  const {
    lineHeightRatio = 1.18,
    maxFontSize,
    measureWidth,
    minFontSize = 10
  } = options;
  const textBox = getTextBox(block.bounds, block);
  const measure = (value, fontSize) => measureWidth(value, fontSize, block);

  if (fixedFontSize) {
    return {
      fontSize: fixedFontSize,
      lineHeight: fixedFontSize * lineHeightRatio,
      lines: wrapTextToWidth(block.translatedText, textBox.width, (value) => measure(value, fixedFontSize)),
      paddingX: textBox.paddingX,
      paddingY: textBox.paddingY
    };
  }

  const fit = fitFontSize(block.translatedText, textBox, {
    lineHeightRatio,
    maxFontSize: resolveBlockMaxFontSize(block, maxFontSize),
    measureWidth: measure,
    minFontSize,
    targetLineCount: resolveSourceLineCount(block)
  });

  return {
    ...fit,
    paddingX: textBox.paddingX,
    paddingY: textBox.paddingY
  };
}

export function planTextLayouts(blocks, options) {
  const layouts = blocks.map((block) => createTextLayout(block, options));
  const groups = collectTypographyGroups(blocks);

  for (const group of groups) {
    const sharedFontSize = Math.min(...group.map((index) => layouts[index].fontSize));

    for (const index of group) {
      layouts[index] = createTextLayout(blocks[index], options, sharedFontSize);
    }
  }

  return layouts;
}
