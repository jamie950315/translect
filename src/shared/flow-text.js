import { tokenizeText } from "./render-utils.js";

function shouldInsertSpace(previousText, nextToken) {
  const previous = previousText.slice(-1);
  const cjkPattern = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u;

  return !cjkPattern.test(previous) && !cjkPattern.test(nextToken);
}

function appendToken(text, token) {
  if (!text) {
    return token;
  }

  return shouldInsertSpace(text, token) ? `${text} ${token}` : `${text}${token}`;
}

export function resolveSharedFlowWidths(boxes) {
  return boxes.map((box) => Math.max(1, Number(box?.width) || 0));
}

export function resolveMacosVisionFlowTextBox(rect) {
  const width = Math.max(0, Number(rect?.width) || 0);
  const paddingX = Math.max(2, width * 0.02);
  return {
    width: Math.max(1, width - paddingX * 2)
  };
}

export function distributeTextAcrossLineBlocks(blocks, options = {}) {
  const flowText = blocks
    .map((block) => String(block?.text || ""))
    .join("")
    .replace(/\s*\n+\s*/gu, "");

  return distributeTextAcrossBoxes(flowText, blocks, options);
}

export function distributeTextAcrossBoxes(text, boxes, options = {}) {
  const measureWidth = options.measureWidth || (() => 0);
  const tokens = tokenizeText(text);
  const assignments = boxes.map(() => "");
  let tokenIndex = 0;

  for (let boxIndex = 0; boxIndex < boxes.length && tokenIndex < tokens.length; boxIndex += 1) {
    const box = boxes[boxIndex] || {};
    const resolvedWidth =
      typeof options.resolveWidth === "function"
        ? options.resolveWidth(box, boxIndex)
        : box.width;
    const maxWidth = Math.max(1, Number(resolvedWidth) || 0);
    let current = "";

    while (tokenIndex < tokens.length) {
      const candidate = appendToken(current, tokens[tokenIndex]);
      if (measureWidth(candidate, box, boxIndex) <= maxWidth || !current) {
        current = candidate;
        tokenIndex += 1;
      } else {
        break;
      }
    }

    assignments[boxIndex] = current;
  }

  return assignments;
}
