import { tokenizeText } from "./render-utils.js";

function shouldInsertSpace(previousText, nextToken) {
  const previous = Array.from(previousText).at(-1) || "";
  const cjkPattern = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u;

  return !cjkPattern.test(previous) && !cjkPattern.test(nextToken);
}

function appendToken(text, token) {
  if (!text) {
    return token;
  }

  return shouldInsertSpace(text, token) ? `${text} ${token}` : `${text}${token}`;
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
