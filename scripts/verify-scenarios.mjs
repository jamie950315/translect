import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

const useLiveApi = process.env.TRANSLECT_SCENARIO_MODE === "live";
const apiKey = process.env.OPENAI_API_KEY || "";

if (useLiveApi && !apiKey) {
  console.error("Missing OPENAI_API_KEY");
  process.exit(1);
}

const rootDir = process.cwd();
const fixtureDir = path.join(rootDir, "tests", "fixtures");
const outputDir = path.join(rootDir, "output", "playwright", "scenario-suite");
const profileDir = path.join(rootDir, ".tmp", "scenario-suite-profile");
const extensionPath = path.join(rootDir, "dist");
const ROOT_ID = "__translect-root";
const PAGE_ACTIONS = {
  AUTO_TRANSLATE_VISIBLE: "auto-translate-visible",
  START_MANUAL_SELECTION: "start-manual-selection"
};
const uploadedSourceFixtures = [
  "mobile-chatgpt-dark-source.png",
  "imessage-uk-attachments-source.png",
  "imessage-ph-thread-source.png",
  "imessage-recycle-instructions-source.png",
  "tweet-7eleven-source.png",
  "vibecode-table-source.png",
  "map-black-sea-source.png",
  "age-verification-source.png",
  "coding-index-source.png",
  "charger-meme-source.png",
  "japan-people-meme-source.png",
  "stock-chart-source.png",
  "steam-store-source.png",
  "twitter-laptop-source.png",
  "model-benchmark-source.png",
  "ssd-price-source.png",
  "vpn-map-source.png",
  "claude-devs-tweet-source.png",
  "app-age-restriction-source.png",
  "ios-app-listing-source.png",
  "ios-search-source.png",
  "dark-dashboard-source.png",
  "deepseek-pricing-source.png",
  "claude-config-landing-source.png",
  "chatgpt-image-thread-source.png",
  "chatgpt-billing-source.png",
  "tesla-release-notes-source.png"
];
let activeUploadedAssetName = "";

function contentTypeForPath(pathname) {
  if (pathname.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (pathname.endsWith(".png")) {
    return "image/png";
  }
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (pathname.endsWith(".webp")) {
    return "image/webp";
  }
  if (pathname.endsWith(".svg")) {
    return "image/svg+xml";
  }
  return "text/plain; charset=utf-8";
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function extractImageDataUrl(payload) {
  const userMessage = Array.isArray(payload?.messages)
    ? payload.messages.find((message) => message?.role === "user")
    : null;
  const contentParts = Array.isArray(userMessage?.content) ? userMessage.content : [];
  const imagePart = contentParts.find((part) => part?.type === "image_url");
  return imagePart?.image_url?.url || "";
}

function pngDimensionsFromDataUrl(imageDataUrl) {
  const match = /^data:image\/png;base64,(.+)$/u.exec(imageDataUrl || "");
  if (!match) {
    throw new Error("Unsupported mock image payload.");
  }

  const buffer = Buffer.from(match[1], "base64");
  if (buffer.length < 24) {
    throw new Error("Incomplete PNG payload.");
  }

  return {
    height: buffer.readUInt32BE(20),
    width: buffer.readUInt32BE(16)
  };
}

function blockForWhiteSurface() {
  return {
    blocks: [
      {
        bounds: { x: 55, y: 140, width: 890, height: 700, rotation: 0 },
        source_text: "Source text",
        style: {
          align: "center",
          background_color: "#ffffff",
          background_opacity: 0.995,
          font_weight: 700,
          stroke_color: "#ffffff",
          stroke_width: 0,
          text_color: "#111111"
        },
        translated_text: "不要在回覆中加入隨意的粗體字。"
      }
    ]
  };
}

function blockForDarkSurface() {
  return {
    blocks: [
      {
        bounds: { x: 70, y: 70, width: 860, height: 860, rotation: 0 },
        source_text: "Source text",
        style: {
          align: "left",
          background_color: "#242520",
          background_opacity: 0.99,
          font_weight: 700,
          stroke_color: "#111111",
          stroke_width: 2,
          text_color: "#ffffff"
        },
        translated_text: "先用工具，再直接給結果。"
      }
    ]
  };
}

function style({
  align = "left",
  background = "#ffffff",
  container = "plain-text",
  opacity = 0.96,
  stroke = "#ffffff",
  strokeWidth = 0,
  text = "#111111",
  vertical = "top",
  weight = 650
} = {}) {
  return {
    align,
    background_color: background,
    background_opacity: opacity,
    container,
    font_weight: weight,
    stroke_color: stroke,
    stroke_width: strokeWidth,
    text_color: text,
    vertical_align: vertical
  };
}

function block({ bounds, group = "", lines = 1, source = "Source text", text, style: blockStyle }) {
  return {
    bounds: { rotation: 0, ...bounds },
    group_id: group,
    source_line_count: lines,
    source_text: source,
    style: blockStyle,
    translated_text: text
  };
}

function uploadedTranslationForDimensions({ assetName = "", width, height }) {
  const assetTranslation = uploadedTranslationForAssetName(assetName, { height, width });
  if (assetTranslation) {
    return assetTranslation;
  }

  if (width === 464 && height === 996) {
    return {
      blocks: [
        block({
          bounds: { x: 211, y: 99, width: 165, height: 43 },
          lines: 1,
          text: "思考中",
          style: style({ align: "center", background: "#1d2429", container: "ui-card", opacity: 0.96, text: "#46a6ff", vertical: "middle", weight: 600 })
        }),
        block({
          bounds: { x: 250, y: 171, width: 690, height: 106 },
          lines: 3,
          text: "我想洗車。洗車場離這裡 50 公尺。該走路還是開車？",
          style: style({ background: "#252525", container: "speech-bubble", opacity: 0.98, text: "#eeeeee" })
        }),
        block({
          bounds: { x: 53, y: 321, width: 120, height: 27 },
          lines: 1,
          text: "走路。",
          style: style({ background: "#000000", container: "plain-text", opacity: 0.02, text: "#ffffff" })
        }),
        block({
          bounds: { x: 53, y: 377, width: 860, height: 130 },
          lines: 5,
          text: "50 公尺的距離，開車比走路更麻煩。你會為很短的路程啟動引擎、移車、找空位，還可能在準備好前又把車弄濕。",
          style: style({ background: "#000000", container: "plain-text", opacity: 0.02, text: "#ffffff" })
        }),
        block({
          bounds: { x: 53, y: 549, width: 850, height: 96 },
          lines: 4,
          text: "只有在洗車方式必須把車開進洗車區時才開車，例如自動洗車或噴射洗車。",
          style: style({ background: "#000000", container: "plain-text", opacity: 0.02, text: "#ffffff" })
        })
      ]
    };
  }

  if (width === 628 && height === 992) {
    return {
      blocks: [
        block({
          bounds: { x: 103, y: 56, width: 565, height: 323 },
          lines: 12,
          text: "+44 7490 832526\n為了我女兒，我很難過。我後悔買了舊 iPhone，因為它綁定了你的 Apple ID，我無法下載 App Store。我去找那家店，但今天沒開。我現在真的很難過。請你幫我移除它好嗎？非常感謝你。",
          style: style({ background: "#e8e8ec", container: "speech-bubble", opacity: 0.98, text: "#111111" })
        }),
        block({
          bounds: { x: 105, y: 568, width: 555, height: 230 },
          lines: 8,
          text: "我很難過，我還是沒移除它。我女兒很生氣，因為她今天沒去上學。我現在想傷害自己，也許我應該把它賣給別人。我不知道該怎麼辦，拜託幫我移除它，好嗎？",
          style: style({ background: "#e8e8ec", container: "speech-bubble", opacity: 0.98, text: "#111111" })
        })
      ]
    };
  }

  if (width === 694 && height === 990) {
    return {
      blocks: [
        block({
          bounds: { x: 95, y: 208, width: 575, height: 200 },
          group: "ios-bubbles",
          lines: 6,
          text: "喲！！我是 Chris\n我買了一支二手 iPhone 17 Pro，為什麼你的電話號碼一直和我同步，還和我的 iPhone 綁在一起？",
          style: style({ background: "#e8e8ec", container: "speech-bubble", opacity: 0.98, text: "#111111" })
        }),
        block({
          bounds: { x: 95, y: 443, width: 575, height: 210 },
          group: "ios-bubbles",
          lines: 7,
          text: "我不知道為什麼。我打給賣家，他們說這支舊 iPhone 綁在你的帳號上。你可以移除嗎？我已升級到最新的 iOS 26。",
          style: style({ background: "#e8e8ec", container: "speech-bubble", opacity: 0.98, text: "#111111" })
        }),
        block({
          bounds: { x: 95, y: 707, width: 575, height: 235 },
          group: "ios-bubbles",
          lines: 8,
          text: "我剛打給 Apple，他們說也許你應該用「尋找」App 把它移除。我保證，等你移除後，我會清除所有資料並恢復原廠設定。",
          style: style({ background: "#e8e8ec", container: "speech-bubble", opacity: 0.98, text: "#111111" })
        })
      ]
    };
  }

  if (width === 588 && height === 1000) {
    return {
      blocks: [
        block({
          bounds: { x: 83, y: 51, width: 600, height: 390 },
          lines: 13,
          text: "你的舊手機被我們回收。我們只是回收商，不是偷你手機的人。如果你不移除它，你的舊手機主機板可能會賣給其他客戶，也許他們會駭進你的手機、偷你的信用卡，或聯絡你的家人。所以建議你盡快移除它，好讓我們恢復原廠設定並清除所有資料。",
          style: style({ background: "#e8e8ec", container: "speech-bubble", opacity: 0.98, text: "#111111" })
        }),
        block({
          bounds: { x: 126, y: 452, width: 365, height: 330 },
          lines: 4,
          text: "步驟 1：打開「尋找」\n步驟 2：點選「裝置」\n步驟 3：點選「移除此裝置」\n步驟 4：點選「移除」",
          style: style({ align: "center", background: "#ffffff", container: "image-text", opacity: 0.14, stroke: "#ffffff", strokeWidth: 3, text: "#d72828", weight: 700 })
        })
      ]
    };
  }

  if (width === 1064 && height === 1012) {
    return {
      blocks: [
        block({
          bounds: { x: 55, y: 190, width: 885, height: 200 },
          lines: 3,
          text: "一直很好奇為什麼 ELEVE 是大寫字母，而 n 是小寫字母",
          style: style({ background: "#ffffff", container: "plain-text", opacity: 0.96, text: "#303030", weight: 500 })
        })
      ]
    };
  }

  if (width === 1006 && height === 990) {
    const rowY = [404, 471, 538, 605, 672, 739, 806, 873, 940];
    const names = ["Claude Opus 4.7", "GPT 5.5", "GPT 5.4", "GPT 5.3 Codex", "Claude Opus 4.6", "GPT 5.2", "Claude Opus 4.6", "Claude Sonnet 4.6", "DeepSeek V4"];
    const scores = ["71.00% ± 4.51", "69.85% ± 4.54", "67.42% ± 4.84", "61.77% ± 4.71", "57.57% ± 4.37", "53.50% ± 5.07", "53.50% ± 4.68", "51.48% ± 4.64", "49.93% ± 4.77"];
    return {
      blocks: [
        block({ bounds: { x: 54, y: 58, width: 360, height: 52 }, lines: 1, text: "Vibe Code 基準 v1.1", style: style({ background: "#ffffff", container: "plain-text", opacity: 0.96, text: "#202020", weight: 700 }) }),
        block({ bounds: { x: 55, y: 124, width: 165, height: 28 }, lines: 1, text: "更新：2026/4/24", style: style({ background: "#ffffff", container: "plain-text", opacity: 0.96, text: "#555555", weight: 500 }) }),
        block({ bounds: { x: 55, y: 171, width: 470, height: 30 }, lines: 1, text: "模型能從零開始建立網頁應用程式嗎？", style: style({ background: "#ffffff", container: "plain-text", opacity: 0.96, text: "#555555", weight: 500 }) }),
        ...names.flatMap((name, index) => [
          block({ bounds: { x: 118, y: rowY[index], width: 245, height: 35 }, group: "table-name", lines: 1, text: name, style: style({ background: "#ffffff", container: "plain-text", opacity: 0.96, text: "#222222", weight: 600 }) }),
          block({ bounds: { x: 423, y: rowY[index], width: 165, height: 35 }, group: "table-score", lines: 1, text: scores[index], style: style({ align: "center", background: "#ffffff", container: "plain-text", opacity: 0.96, text: "#222222", weight: 650 }) })
        ])
      ]
    };
  }

  if (width === 1260 && height === 1002) {
    return {
      blocks: [
        block({ bounds: { x: 320, y: 28, width: 165, height: 55 }, text: "烏克蘭", style: style({ align: "center", background: "#bfe9d4", container: "image-text", opacity: 0.12, stroke: "#ffffff", strokeWidth: 3, text: "#111111", weight: 700 }) }),
        block({ bounds: { x: 560, y: 99, width: 220, height: 100 }, text: "戰爭", style: style({ align: "center", background: "#bfe9d4", container: "image-text", opacity: 0.12, stroke: "#ffffff", strokeWidth: 6, text: "#111111", weight: 800 }) }),
        block({ bounds: { x: 176, y: 137, width: 270, height: 90 }, text: "摩爾多瓦", style: style({ align: "center", background: "#bfe9d4", container: "image-text", opacity: 0.12, stroke: "#ffffff", strokeWidth: 5, text: "#111111", weight: 700 }) }),
        block({ bounds: { x: 0, y: 310, width: 210, height: 155, rotation: -34 }, text: "貧窮", style: style({ align: "center", background: "#bfe9d4", container: "image-text", opacity: 0.12, stroke: "#000000", strokeWidth: 5, text: "#ffffff", weight: 800 }) }),
        block({ bounds: { x: 381, y: 449, width: 360, height: 70 }, text: "黑海", style: style({ align: "center", background: "#5ec6d9", container: "image-text", opacity: 0.1, stroke: "#ffffff", strokeWidth: 2, text: "#0f7281", weight: 500 }) }),
        block({ bounds: { x: 384, y: 620, width: 420, height: 150 }, text: "貧窮且土耳其", style: style({ align: "center", background: "#eee8d8", container: "image-text", opacity: 0.12, stroke: "#000000", strokeWidth: 6, text: "#ffffff", weight: 800 }) }),
        block({ bounds: { x: 820, y: 475, width: 325, height: 100, rotation: 16 }, text: "貧窮", style: style({ align: "center", background: "#bfe9d4", container: "image-text", opacity: 0.12, stroke: "#000000", strokeWidth: 5, text: "#ffffff", weight: 800 }) })
      ]
    };
  }

  if (width === 1252 && height === 744) {
    return {
      blocks: [
        block({ bounds: { x: 66, y: 31, width: 390, height: 52 }, lines: 1, text: "我們需要驗證您的年齡", style: style({ background: "#ffffff", container: "plain-text", opacity: 0.96, text: "#111111", weight: 700 }) }),
        block({ bounds: { x: 67, y: 122, width: 760, height: 32 }, lines: 1, text: "請選擇下方一種驗證方式。您只需要完成其中一種。", style: style({ background: "#ffffff", container: "plain-text", opacity: 0.96, text: "#333333", weight: 500 }) }),
        block({ bounds: { x: 194, y: 314, width: 765, height: 105 }, lines: 3, text: "拍攝自拍照\n透過快速自拍確認您的年齡，並直接在您的裝置上處理以保護隱私。", style: style({ background: "#ffffff", container: "ui-card", opacity: 0.96, text: "#222222", weight: 600 }) }),
        block({ bounds: { x: 194, y: 540, width: 820, height: 132 }, lines: 4, text: "在既有外洩資料中搜尋我的身分證件\n我們會在外洩個資資料庫中搜尋您的身分證件。如果找到，就能自動驗證您的年齡。這很快速又簡單，而且您很可能已經在其中。", style: style({ background: "#ffffff", container: "ui-card", opacity: 0.96, text: "#222222", weight: 600 }) })
      ]
    };
  }

  if (width === 1230 && height === 706) {
    return {
      blocks: [
        block({ bounds: { x: 20, y: 18, width: 170, height: 30 }, text: "人工分析/索引基準", style: style({ background: "#ffffff", container: "plain-text", opacity: 0.98, text: "#111111", weight: 560 }) }),
        block({ bounds: { x: 18, y: 62, width: 260, height: 25 }, text: "程式代理能力索引", style: style({ background: "#ffffff", container: "plain-text", opacity: 0.98, text: "#222222", weight: 540 }) }),
        block({ bounds: { x: 74, y: 606, width: 185, height: 28 }, text: "前沿模型可完成更長任務", style: style({ align: "center", background: "#ffffff", container: "plain-text", opacity: 0.98, text: "#333333", weight: 500 }) }),
        block({ bounds: { x: 470, y: 604, width: 150, height: 28, rotation: -60 }, text: "軟體工程能力", style: style({ align: "center", background: "#ffffff", container: "plain-text", opacity: 0.98, text: "#333333", weight: 500 }) }),
        block({ bounds: { x: 895, y: 606, width: 160, height: 28, rotation: -60 }, text: "代理準確率", style: style({ align: "center", background: "#ffffff", container: "plain-text", opacity: 0.98, text: "#333333", weight: 500 }) })
      ]
    };
  }

  if (width === 1172 && height === 994) {
    return {
      blocks: [
        block({ bounds: { x: 54, y: 112, width: 265, height: 142 }, lines: 4, text: "不，筆電充電器不該通用", style: style({ align: "center", background: "#ffffff", container: "image-text", opacity: 0.1, stroke: "#ffffff", strokeWidth: 2, text: "#111111", weight: 620 }) }),
        block({ bounds: { x: 563, y: 188, width: 170, height: 88 }, lines: 2, text: "我們不在乎", style: style({ align: "center", background: "#ffffff", container: "image-text", opacity: 0.1, stroke: "#ffffff", strokeWidth: 2, text: "#111111", weight: 620 }) }),
        block({ bounds: { x: 54, y: 689, width: 160, height: 90 }, lines: 3, text: "330W\nDC 與 USB-C\nGaN 充電器", style: style({ background: "#ffffff", container: "image-text", opacity: 0.1, stroke: "#ffffff", strokeWidth: 1, text: "#111111", weight: 560 }) }),
        block({ bounds: { x: 808, y: 548, width: 130, height: 95 }, lines: 2, text: "小 50%", style: style({ align: "center", background: "#ffffff", container: "image-text", opacity: 0.1, stroke: "#ffffff", strokeWidth: 1, text: "#111111", weight: 560 }) })
      ]
    };
  }

  if (width === 998 && height === 994) {
    return {
      blocks: [
        block({ bounds: { x: 108, y: 372, width: 120, height: 82 }, lines: 3, text: "四百年前的人", style: style({ align: "center", background: "#ffffff", container: "image-text", opacity: 0.08, stroke: "#ffffff", strokeWidth: 1, text: "#111111", weight: 500 }) }),
        block({ bounds: { x: 306, y: 476, width: 150, height: 76 }, lines: 3, text: "日本真的很怪", style: style({ align: "center", background: "#e9d8c8", container: "image-text", opacity: 0.08, stroke: "#ffffff", strokeWidth: 1, text: "#111111", weight: 500 }) }),
        block({ bounds: { x: 604, y: 372, width: 120, height: 82 }, lines: 3, text: "現在的人們", style: style({ align: "center", background: "#ffffff", container: "image-text", opacity: 0.08, stroke: "#ffffff", strokeWidth: 1, text: "#111111", weight: 500 }) }),
        block({ bounds: { x: 802, y: 477, width: 150, height: 76 }, lines: 3, text: "日本真的很酷", style: style({ align: "center", background: "#e9d8c8", container: "image-text", opacity: 0.08, stroke: "#ffffff", strokeWidth: 1, text: "#111111", weight: 500 }) })
      ]
    };
  }

  if (width === 616 && height === 998) {
    return {
      blocks: [
        block({ bounds: { x: 78, y: 64, width: 235, height: 36 }, text: "盤前總覽", style: style({ background: "#111316", container: "plain-text", opacity: 0.98, text: "#ffffff", weight: 560 }) }),
        block({ bounds: { x: 110, y: 128, width: 115, height: 26 }, text: "日線圖", style: style({ background: "#111316", container: "plain-text", opacity: 0.98, text: "#cccccc", weight: 500 }) }),
        block({ bounds: { x: 102, y: 870, width: 100, height: 25 }, text: "開盤", style: style({ background: "#111316", container: "plain-text", opacity: 0.98, text: "#cccccc", weight: 500 }) }),
        block({ bounds: { x: 250, y: 872, width: 115, height: 25 }, text: "最高", style: style({ background: "#111316", container: "plain-text", opacity: 0.98, text: "#cccccc", weight: 500 }) }),
        block({ bounds: { x: 393, y: 872, width: 120, height: 25 }, text: "成交量", style: style({ background: "#111316", container: "plain-text", opacity: 0.98, text: "#cccccc", weight: 500 }) })
      ]
    };
  }

  if (width === 470 && height === 988) {
    return {
      blocks: [
        block({ bounds: { x: 32, y: 150, width: 170, height: 26 }, text: "私人庫存", style: style({ background: "#1e2a35", container: "plain-text", opacity: 0.98, text: "#dfe8f0", weight: 520 }) }),
        block({ bounds: { x: 92, y: 266, width: 280, height: 36 }, text: "按評價排序", style: style({ background: "#273646", container: "plain-text", opacity: 0.98, text: "#dfe8f0", weight: 520 }) }),
        block({ bounds: { x: 112, y: 468, width: 235, height: 34 }, text: "加入購物車", style: style({ align: "center", background: "#5f8532", container: "ui-card", opacity: 0.98, text: "#ffffff", weight: 560 }) }),
        block({ bounds: { x: 32, y: 735, width: 170, height: 32 }, text: "進階搜尋", style: style({ background: "#17212b", container: "plain-text", opacity: 0.98, text: "#dfe8f0", weight: 520 }) })
      ]
    };
  }

  if (width === 734 && height === 1000) {
    return {
      blocks: [
        block({ bounds: { x: 88, y: 96, width: 130, height: 28 }, text: "漢斯・克利曼", style: style({ background: "#ffffff", container: "plain-text", opacity: 0.98, text: "#111111", weight: 540 }) }),
        block({ bounds: { x: 46, y: 163, width: 610, height: 260 }, lines: 9, text: "這是白宮的 Air Force One 記者團，在途中觀看自己手機上的垃圾新聞。\n這張圖來自白宮發言人本人分享的影片。", style: style({ background: "#ffffff", container: "plain-text", opacity: 0.98, text: "#111111", weight: 520 }) }),
        block({ bounds: { x: 47, y: 488, width: 560, height: 82 }, lines: 3, text: "並不是每個人都在看它，但這很有趣。", style: style({ background: "#ffffff", container: "plain-text", opacity: 0.98, text: "#111111", weight: 520 }) }),
        block({ bounds: { x: 47, y: 605, width: 650, height: 88 }, lines: 3, text: "如果你把這張圖放大，有些筆電上顯示的是更正常的內容。", style: style({ background: "#ffffff", container: "plain-text", opacity: 0.98, text: "#111111", weight: 520 }) })
      ]
    };
  }

  if (width === 1246 && height === 702) {
    return {
      blocks: [
        block({ bounds: { x: 24, y: 22, width: 70, height: 24 }, text: "評測", style: style({ background: "#000000", container: "plain-text", opacity: 0.98, text: "#ffffff", weight: 520 }) }),
        block({ bounds: { x: 31, y: 146, width: 135, height: 24 }, text: "一般基準", style: style({ background: "#000000", container: "plain-text", opacity: 0.98, text: "#ffffff", weight: 520 }) }),
        block({ bounds: { x: 280, y: 146, width: 120, height: 24 }, text: "GPT-5.5", style: style({ align: "center", background: "#000000", container: "plain-text", opacity: 0.98, text: "#ffffff", weight: 520 }) }),
        block({ bounds: { x: 486, y: 146, width: 115, height: 24 }, text: "GPT-5.4", style: style({ align: "center", background: "#000000", container: "plain-text", opacity: 0.98, text: "#ffffff", weight: 520 }) }),
        block({ bounds: { x: 861, y: 580, width: 230, height: 45 }, text: "58.7%", style: style({ align: "center", background: "#000000", container: "plain-text", opacity: 0.2, stroke: "#000000", strokeWidth: 0, text: "#ffffff", weight: 600 }) })
      ]
    };
  }

  if (width === 1262 && height === 408) {
    return {
      blocks: [
        block({ bounds: { x: 24, y: 72, width: 610, height: 58 }, lines: 2, text: "2TB SSD 還不到 500 美元，那真的划算。價格已經降很多。", style: style({ background: "#101010", container: "plain-text", opacity: 0.98, text: "#f2f2f2", weight: 520 }) }),
        block({ bounds: { x: 26, y: 147, width: 300, height: 26 }, text: "2TB 外接 SSD 價格 2026", style: style({ background: "#101010", container: "plain-text", opacity: 0.98, text: "#9b9b9b", weight: 480 }) }),
        block({ bounds: { x: 26, y: 244, width: 585, height: 45 }, lines: 2, text: "其實四年前還不到這個價格。SSD 價格已經變得很便宜。", style: style({ background: "#101010", container: "plain-text", opacity: 0.98, text: "#f2f2f2", weight: 520 }) })
      ]
    };
  }

  if (width === 1250 && height === 988) {
    const labels = [
      [42, 36], [210, 288], [356, 332], [438, 286], [530, 344], [604, 382],
      [692, 438], [804, 500], [902, 558], [1036, 618], [286, 468], [484, 552],
      [610, 644], [742, 732], [900, 812], [1032, 884], [140, 708], [72, 520]
    ];
    return {
      blocks: labels.map(([x, y], index) =>
        block({
          bounds: { x, y, width: 105, height: 48 },
          group: "vpn-map",
          lines: 2,
          text: "VPN\n伺服器",
          style: style({ align: "center", background: "#eef4df", container: "image-text", opacity: 0.08, stroke: "#ffffff", strokeWidth: 1, text: "#111111", weight: 500 })
        })
      )
    };
  }

  if (width === 1248 && height === 658) {
    return {
      blocks: [
        block({ bounds: { x: 75, y: 24, width: 180, height: 28 }, text: "ClaudeDevs", style: style({ background: "#000000", container: "plain-text", opacity: 0.98, text: "#ffffff", weight: 560 }) }),
        block({ bounds: { x: 23, y: 141, width: 760, height: 122 }, lines: 4, text: "過去幾個月，有些人回報 Claude Code 品質下降。我們調查後發布了三個問題的事後報告。", style: style({ background: "#000000", container: "plain-text", opacity: 0.98, text: "#ffffff", weight: 520 }) }),
        block({ bounds: { x: 24, y: 294, width: 840, height: 60 }, lines: 2, text: "所有問題都已在 v2.1.116+ 修復，也重設所有訂閱者的用量限制。", style: style({ background: "#000000", container: "plain-text", opacity: 0.98, text: "#ffffff", weight: 520 }) }),
        block({ bounds: { x: 25, y: 372, width: 275, height: 26 }, text: "下午 1:44 · 2026 年 4 月 23 日", style: style({ background: "#000000", container: "plain-text", opacity: 0.98, text: "#999999", weight: 480 }) })
      ]
    };
  }

  if (width === 1240 && height === 854) {
    return {
      blocks: [
        block({ bounds: { x: 33, y: 31, width: 65, height: 23 }, text: "首頁", style: style({ background: "#1b1c26", container: "plain-text", opacity: 0.98, text: "#d8d9e4", weight: 480 }) }),
        block({ bounds: { x: 113, y: 31, width: 70, height: 23 }, text: "活動", style: style({ background: "#1b1c26", container: "plain-text", opacity: 0.98, text: "#d8d9e4", weight: 480 }) }),
        block({ bounds: { x: 28, y: 111, width: 85, height: 24 }, text: "活動量", style: style({ background: "#1c1d27", container: "plain-text", opacity: 0.98, text: "#cfd1dd", weight: 500 }) }),
        block({ bounds: { x: 31, y: 182, width: 100, height: 30 }, text: "總成本", style: style({ background: "#242634", container: "plain-text", opacity: 0.98, text: "#dfe1ef", weight: 520 }) }),
        block({ bounds: { x: 294, y: 182, width: 100, height: 30 }, text: "資料量", style: style({ background: "#242634", container: "plain-text", opacity: 0.98, text: "#dfe1ef", weight: 520 }) }),
        block({ bounds: { x: 559, y: 182, width: 110, height: 30 }, text: "輸入量", style: style({ background: "#242634", container: "plain-text", opacity: 0.98, text: "#dfe1ef", weight: 520 }) }),
        block({ bounds: { x: 827, y: 182, width: 110, height: 30 }, text: "輸出量", style: style({ background: "#242634", container: "plain-text", opacity: 0.98, text: "#dfe1ef", weight: 520 }) }),
        block({ bounds: { x: 22, y: 653, width: 100, height: 24 }, text: "供應商", style: style({ background: "#1c1d27", container: "plain-text", opacity: 0.98, text: "#cfd1dd", weight: 500 }) }),
        block({ bounds: { x: 678, y: 653, width: 90, height: 24 }, text: "快取", style: style({ background: "#1c1d27", container: "plain-text", opacity: 0.98, text: "#cfd1dd", weight: 500 }) }),
        block({ bounds: { x: 781, y: 653, width: 90, height: 24 }, text: "成本", style: style({ background: "#1c1d27", container: "plain-text", opacity: 0.98, text: "#cfd1dd", weight: 500 }) })
      ]
    };
  }

  if (width === 696 && height === 986) {
    return {
      blocks: [
        block({ bounds: { x: 20, y: 30, width: 650, height: 135 }, lines: 5, text: "這是 DeepSeek 的定價頁面。他們對 1400 萬 token 輸入和 20 億 token 輸出只收 0.14 美元，總共 1.74 美元。", style: style({ background: "#0f0f19", container: "plain-text", opacity: 0.98, text: "#f0f0f5", weight: 500 }) }),
        block({ bounds: { x: 20, y: 183, width: 640, height: 118 }, lines: 4, text: "這裡是其他前沿模型的比較。Gemini、OpenAI 和 Anthropic 都明顯更貴。", style: style({ background: "#0f0f19", container: "plain-text", opacity: 0.98, text: "#f0f0f5", weight: 500 }) }),
        block({ bounds: { x: 96, y: 336, width: 110, height: 30 }, text: "模型", style: style({ align: "center", background: "#0f0f19", container: "plain-text", opacity: 0.98, text: "#ffffff", weight: 540 }) }),
        block({ bounds: { x: 265, y: 336, width: 110, height: 30 }, text: "輸入", style: style({ align: "center", background: "#0f0f19", container: "plain-text", opacity: 0.98, text: "#ffffff", weight: 540 }) }),
        block({ bounds: { x: 404, y: 336, width: 110, height: 30 }, text: "輸出", style: style({ align: "center", background: "#0f0f19", container: "plain-text", opacity: 0.98, text: "#ffffff", weight: 540 }) }),
        block({ bounds: { x: 28, y: 904, width: 640, height: 62 }, lines: 3, text: "DeepSeek-V4-Flash 是最便宜的小型模型，擊敗 OpenAI GPT-5.4 Nano。", style: style({ background: "#0f0f19", container: "plain-text", opacity: 0.98, text: "#f0f0f5", weight: 500 }) })
      ]
    };
  }

  if (width === 1238 && height === 948) {
    return {
      blocks: [
        block({ bounds: { x: 48, y: 186, width: 440, height: 100 }, lines: 2, text: "所有 Claude 設定。\n一處管理。", style: style({ background: "#07070b", container: "plain-text", opacity: 0.98, text: "#ffffff", weight: 560 }) }),
        block({ bounds: { x: 49, y: 328, width: 555, height: 58 }, lines: 3, text: "CCM 是一套原生桌面應用程式，可在每個專案中管理 Claude Code 代理、指令、技能、記憶、規則、hooks、MCP 伺服器等。", style: style({ background: "#07070b", container: "plain-text", opacity: 0.98, text: "#f2f2f2", weight: 500 }) }),
        block({ bounds: { x: 58, y: 492, width: 150, height: 30 }, text: "管理設定檔", style: style({ align: "center", background: "#11131a", container: "ui-card", opacity: 0.98, text: "#ffffff", weight: 500 }) }),
        block({ bounds: { x: 247, y: 492, width: 150, height: 30 }, text: "工作區整合", style: style({ align: "center", background: "#11131a", container: "ui-card", opacity: 0.98, text: "#ffffff", weight: 500 }) }),
        block({ bounds: { x: 438, y: 492, width: 150, height: 30 }, text: "安全匯出", style: style({ align: "center", background: "#11131a", container: "ui-card", opacity: 0.98, text: "#ffffff", weight: 500 }) })
      ]
    };
  }

  if (width === 502 && height === 976) {
    return {
      blocks: [
        block({ bounds: { x: 108, y: 94, width: 108, height: 30 }, text: "思考中？", style: style({ background: "#000000", container: "plain-text", opacity: 0.98, text: "#7ab7ff", weight: 500 }) }),
        block({ bounds: { x: 150, y: 360, width: 245, height: 64 }, lines: 2, text: "顯示肩膀上的反角度鏡頭", style: style({ align: "center", background: "#2a2a2a", container: "speech-bubble", opacity: 0.98, text: "#ffffff", weight: 500 }) }),
        block({ bounds: { x: 52, y: 472, width: 310, height: 40 }, lines: 2, text: "思考了幾秒鐘", style: style({ background: "#000000", container: "plain-text", opacity: 0.98, text: "#d6d6d6", weight: 480 }) }),
        block({ bounds: { x: 52, y: 520, width: 140, height: 32 }, text: "已產生圖片", style: style({ background: "#000000", container: "plain-text", opacity: 0.98, text: "#d6d6d6", weight: 480 }) })
      ]
    };
  }

  if (width === 1242 && height === 930) {
    return {
      blocks: [
        block({ bounds: { x: 23, y: 23, width: 90, height: 30 }, text: "一般", style: style({ align: "center", background: "#20211e", container: "plain-text", opacity: 0.98, text: "#ffffff", weight: 500 }) }),
        block({ bounds: { x: 151, y: 23, width: 120, height: 30 }, text: "帳戶", style: style({ align: "center", background: "#20211e", container: "plain-text", opacity: 0.98, text: "#ffffff", weight: 500 }) }),
        block({ bounds: { x: 295, y: 23, width: 120, height: 30 }, text: "隱私", style: style({ align: "center", background: "#20211e", container: "plain-text", opacity: 0.98, text: "#ffffff", weight: 500 }) }),
        block({ bounds: { x: 441, y: 23, width: 120, height: 30 }, text: "帳單", style: style({ align: "center", background: "#0d0d0c", container: "ui-card", opacity: 0.98, text: "#ffffff", weight: 500 }) }),
        block({ bounds: { x: 486, y: 153, width: 155, height: 40 }, text: "Max 方案", style: style({ background: "#20211e", container: "plain-text", opacity: 0.98, text: "#ffffff", weight: 560 }) }),
        block({ bounds: { x: 487, y: 212, width: 255, height: 62 }, lines: 2, text: "使用量是 Pro 的 5 倍", style: style({ background: "#20211e", container: "plain-text", opacity: 0.98, text: "#ffffff", weight: 500 }) }),
        block({ bounds: { x: 935, y: 167, width: 155, height: 48 }, text: "調整方案", style: style({ align: "center", background: "#272823", container: "ui-card", opacity: 0.98, text: "#ffffff", weight: 500 }) }),
        block({ bounds: { x: 486, y: 598, width: 520, height: 58 }, lines: 2, text: "您的訂閱將於 2026 年 4 月 25 日取消。", style: style({ background: "#20211e", container: "plain-text", opacity: 0.98, text: "#ffffff", weight: 500 }) }),
        block({ bounds: { x: 581, y: 718, width: 162, height: 48 }, text: "重新訂閱", style: style({ align: "center", background: "#272823", container: "ui-card", opacity: 0.98, text: "#ffffff", weight: 500 }) })
      ]
    };
  }

  if (width === 744 && height === 988) {
    return {
      blocks: [
        block({ bounds: { x: 254, y: 30, width: 250, height: 48 }, text: "2026.2.9.8", style: style({ align: "center", background: "#777e74", container: "image-text", opacity: 0.16, stroke: "#ffffff", strokeWidth: 1, text: "#ffffff", weight: 500 }) }),
        block({ bounds: { x: 232, y: 92, width: 300, height: 86 }, lines: 3, text: "FSD（監督版）v14.3.2", style: style({ align: "center", background: "#777e74", container: "image-text", opacity: 0.16, stroke: "#ffffff", strokeWidth: 1, text: "#ffffff", weight: 500 }) }),
        block({ bounds: { x: 240, y: 210, width: 245, height: 68 }, lines: 2, text: "自動泊車命名更新", style: style({ align: "center", background: "#777e74", container: "image-text", opacity: 0.16, stroke: "#ffffff", strokeWidth: 1, text: "#ffffff", weight: 500 }) }),
        block({ bounds: { x: 223, y: 330, width: 285, height: 68 }, lines: 2, text: "解鎖充電線", style: style({ align: "center", background: "#777e74", container: "image-text", opacity: 0.16, stroke: "#ffffff", strokeWidth: 1, text: "#ffffff", weight: 500 }) }),
        block({ bounds: { x: 226, y: 456, width: 284, height: 68 }, lines: 2, text: "交通號誌與停車標誌控制", style: style({ align: "center", background: "#777e74", container: "image-text", opacity: 0.16, stroke: "#ffffff", strokeWidth: 1, text: "#ffffff", weight: 500 }) })
      ]
    };
  }

  return null;
}

function uploadedTranslationForAssetName(assetName, { height, width }) {
  if (!assetName) {
    return null;
  }

  if (assetName === "app-age-restriction-source.png") {
    return uploadedTranslationForAppAgeRestriction({ height, width });
  }

  if (assetName === "ios-app-listing-source.png") {
    return uploadedTranslationForIosAppListing({ height, width });
  }

  if (assetName === "ios-search-source.png") {
    return uploadedTranslationForIosSearch({ height, width });
  }

  return null;
}

function uploadedTranslationForAppAgeRestriction({ height, width }) {
  if (width !== 1080 || height !== 2348) {
    return null;
  }

  return {
    blocks: [
      block({ bounds: { x: 252, y: 424, width: 410, height: 80 }, lines: 2, text: "確認您已年滿 18 歲", style: style({ align: "center", background: "#111216", container: "plain-text", opacity: 0.98, text: "#ffffff", weight: 540 }) }),
      block({ bounds: { x: 250, y: 525, width: 590, height: 138 }, lines: 4, text: "英國法律要求您確認年齡，並設定內容限制。", style: style({ background: "#111216", container: "plain-text", opacity: 0.98, text: "#c8c8c8", weight: 480 }) }),
      block({ bounds: { x: 250, y: 784, width: 620, height: 92 }, lines: 3, text: "繼續後，您的 ID 或信用卡可能會被用來確認年齡。", style: style({ background: "#111216", container: "plain-text", opacity: 0.98, text: "#c8c8c8", weight: 480 }) }),
      block({ bounds: { x: 188, y: 1620, width: 704, height: 82 }, text: "繼續", style: style({ align: "center", background: "#0a84ff", container: "ui-card", opacity: 0.98, text: "#ffffff", weight: 520 }) }),
      block({ bounds: { x: 420, y: 1753, width: 250, height: 48 }, text: "稍後確認", style: style({ align: "center", background: "#111216", container: "plain-text", opacity: 0.98, text: "#ffffff", weight: 500 }) })
    ]
  };
}

function uploadedTranslationForIosAppListing({ height, width }) {
  if (width !== 1080 || height !== 2348) {
    return null;
  }

  return {
    blocks: [
      block({ bounds: { x: 124, y: 335, width: 250, height: 42 }, text: "Camera", style: style({ background: "#06070a", container: "plain-text", opacity: 0.98, text: "#ffffff", weight: 540 }) }),
      block({ bounds: { x: 124, y: 395, width: 160, height: 34 }, text: "Apple", style: style({ background: "#06070a", container: "plain-text", opacity: 0.98, text: "#9f9f9f", weight: 480 }) }),
      block({ bounds: { x: 123, y: 478, width: 105, height: 42 }, text: "3.6", style: style({ align: "center", background: "#06070a", container: "plain-text", opacity: 0.98, text: "#ffffff", weight: 500 }) }),
      block({ bounds: { x: 275, y: 478, width: 115, height: 42 }, text: "年齡", style: style({ align: "center", background: "#06070a", container: "plain-text", opacity: 0.98, text: "#ffffff", weight: 500 }) }),
      block({ bounds: { x: 120, y: 790, width: 260, height: 40 }, text: "限制已啟用", style: style({ background: "#1f1f24", container: "ui-card", opacity: 0.98, text: "#ffffff", weight: 520 }) }),
      block({ bounds: { x: 121, y: 845, width: 700, height: 92 }, lines: 3, text: "部分 App、功能或內容可能因您的內容與隱私限制而無法使用。", style: style({ background: "#1f1f24", container: "ui-card", opacity: 0.98, text: "#d8d8d8", weight: 480 }) }),
      block({ bounds: { x: 190, y: 1195, width: 690, height: 80 }, text: "好", style: style({ align: "center", background: "#0a84ff", container: "ui-card", opacity: 0.98, text: "#ffffff", weight: 520 }) })
    ]
  };
}

function uploadedTranslationForIosSearch({ height, width }) {
  if (width !== 1080 || height !== 2348) {
    return null;
  }

  return {
    blocks: [
      block({ bounds: { x: 128, y: 173, width: 160, height: 40 }, text: "搜尋", style: style({ background: "#1d1f1d", container: "plain-text", opacity: 0.98, text: "#cfcfcf", weight: 500 }) }),
      block({ bounds: { x: 840, y: 176, width: 120, height: 40 }, text: "取消", style: style({ background: "#1d1f1d", container: "plain-text", opacity: 0.98, text: "#f3f3f3", weight: 500 }) }),
      block({ bounds: { x: 131, y: 316, width: 150, height: 40 }, text: "Amazon", style: style({ background: "#1d1f1d", container: "plain-text", opacity: 0.98, text: "#f3f3f3", weight: 500 }) }),
      block({ bounds: { x: 130, y: 446, width: 160, height: 40 }, text: "Compass", style: style({ background: "#1d1f1d", container: "plain-text", opacity: 0.98, text: "#f3f3f3", weight: 500 }) }),
      block({ bounds: { x: 130, y: 578, width: 170, height: 40 }, text: "Instagram", style: style({ background: "#1d1f1d", container: "plain-text", opacity: 0.98, text: "#f3f3f3", weight: 500 }) })
    ]
  };
}

function mockTranslationForDimensions({ assetName = "", width, height }) {
  const uploadedTranslation = uploadedTranslationForDimensions({ assetName, width, height });
  if (uploadedTranslation) {
    return uploadedTranslation;
  }

  if (width <= 340 && height >= 320) {
    return { blocks: [] };
  }

  if (height >= 420) {
    return blockForDarkSurface();
  }

  return blockForWhiteSurface();
}

function buildMockChatCompletion(imageDataUrl) {
  const translation = mockTranslationForDimensions({
    ...pngDimensionsFromDataUrl(imageDataUrl),
    assetName: activeUploadedAssetName
  });
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(translation)
        }
      }
    ]
  };
}

async function startFixtureServer() {
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
      if (
        !useLiveApi &&
        requestUrl.pathname === "/mock/v1/chat/completions"
      ) {
        const corsHeaders = {
          "Access-Control-Allow-Headers": "authorization, content-type",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Origin": "*"
        };

        if (request.method === "OPTIONS") {
          response.writeHead(204, corsHeaders);
          response.end();
          return;
        }

        if (request.method !== "POST") {
          response.writeHead(405, corsHeaders);
          response.end("Method Not Allowed");
          return;
        }

        const bodyText = await readRequestBody(request);
        const payload = JSON.parse(bodyText);
        const imageDataUrl = extractImageDataUrl(payload);
        const mockResponse = buildMockChatCompletion(imageDataUrl);
        response.writeHead(200, {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8"
        });
        response.end(JSON.stringify(mockResponse));
        return;
      }

      const pathname = requestUrl.pathname === "/" ? "/scenario-page.html" : requestUrl.pathname;
      if (pathname === "/uploaded-fixture.html") {
        activeUploadedAssetName = requestUrl.searchParams.get("asset") || "";
      } else if (pathname.endsWith(".html")) {
        activeUploadedAssetName = "";
      }
      const filePath = path.join(fixtureDir, pathname.replace(/^\/+/, ""));

      if (!filePath.startsWith(fixtureDir)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }

      const body = await readFile(filePath);
      const contentType = contentTypeForPath(pathname);
      response.writeHead(200, { "Content-Type": contentType });
      response.end(body);
    } catch (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  return {
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
    origin: `http://127.0.0.1:${address.port}`
  };
}

async function dispatchToActiveTab(serviceWorker, mode, action) {
  return serviceWorker.evaluate(async ({ action, mode }) => {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    });

    if (!tab?.id) {
      return { ok: false, error: "no-active-tab" };
    }

    if (mode === "probe") {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: "page-action",
          action
        });
        return { ok: true, response };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }

    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "page-action",
        action
      });
      return { ok: true, response };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }, { action, mode });
}

async function setSettings(serviceWorker, serverOrigin, overrides = {}) {
  return serviceWorker.evaluate(async ({ apiKey, overrides, serverOrigin, useLiveApi }) => {
    await chrome.storage.local.set({
      "translect.settings": {
        apiEndpoint: useLiveApi
          ? "https://api.openai.com/v1/chat/completions"
          : `${serverOrigin}/mock/v1/chat/completions`,
        apiKey: useLiveApi ? apiKey : "test-key",
        model: "gpt-5.4-mini",
        targetLanguage: "Traditional Chinese",
        alwaysAutoDetect: false,
        triggerUsesAutoMode: true,
        ...overrides
      }
    });
    return true;
  }, { apiKey, overrides, serverOrigin, useLiveApi });
}

async function pageState(page) {
  return page.evaluate(({ ROOT_ID }) => {
    const root = document.getElementById(ROOT_ID);
    const overlays = root ? Array.from(root.querySelectorAll(".translect-overlay")) : [];
    const toasts = root ? Array.from(root.querySelectorAll(".translect-toast")) : [];

    return {
      labelCount: root ? root.querySelectorAll(".translect-label").length : 0,
      overlayCount: overlays.length,
      overlayStyles: overlays.map((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return {
          background: style.backgroundColor,
          boxShadow: style.boxShadow,
          height: Math.round(rect.height),
          outline: style.outlineColor,
          width: Math.round(rect.width)
        };
      }),
      selectionLayer: !!(root && root.querySelector(".translect-selection-layer")),
      toastTexts: toasts.map((node) => node.textContent?.trim() || "")
    };
  }, { ROOT_ID });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(page, predicate, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await predicate();
    if (result) {
      return result;
    }
    await page.waitForTimeout(400);
  }

  throw new Error(`timeout:${label}`);
}

async function waitForOverlayCount(page, expected, label) {
  return waitFor(page, async () => {
    const state = await pageState(page);
    return state.overlayCount === expected ? state : null;
  }, 50000, label);
}

async function waitForToast(page, expectedText, label) {
  return waitFor(page, async () => {
    const state = await pageState(page);
    return state.toastTexts.some((text) => text.includes(expectedText)) ? state : null;
  }, 12000, label);
}

async function waitForBootstrapDefaults(serviceWorker) {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    const result = await serviceWorker.evaluate(async () =>
      chrome.storage.local.get("translect.settings")
    );
    const settings = result["translect.settings"] || {};
    if (
      settings.apiKey === "" &&
      settings.model === "gpt-5.4-mini" &&
      settings.triggerUsesAutoMode === false
    ) {
      return settings;
    }
    await sleep(200);
  }

  throw new Error("timeout:bootstrap-defaults");
}

function assertOverlayStyle(state, expectedCount) {
  assert.equal(state.overlayCount, expectedCount);
  assert.equal(state.labelCount, 0);
  for (const overlay of state.overlayStyles) {
    assert.equal(overlay.background, "rgba(0, 0, 0, 0)");
    assert.equal(overlay.boxShadow, "none");
    assert.equal(overlay.outline, "rgba(161, 63, 44, 0.65)");
  }
}

async function openPage(context, url, options = {}) {
  const page = await context.newPage();
  if (options.viewport) {
    await page.setViewportSize(options.viewport);
  }
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(async () => {
    await Promise.all(
      Array.from(document.images).map((image) => {
        if (image.complete) {
          return Promise.resolve();
        }

        return new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        });
      })
    );

    await Promise.all(
      Array.from(document.images).map((image) =>
        typeof image.decode === "function"
          ? image.decode().catch(() => {})
          : Promise.resolve()
      )
    );
  });
  await page.waitForTimeout(1800);
  await page.bringToFront();
  return page;
}

async function runSuite() {
  await mkdir(outputDir, { recursive: true });
  await rm(profileDir, { force: true, recursive: true });

  const server = await startFixtureServer();
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: "chromium",
    // Keep visible-tab captures aligned with viewport scale for deterministic crops.
    headless: true,
    viewport: { width: 1280, height: 1400 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    const serviceWorker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    await waitForBootstrapDefaults(serviceWorker);
    const summary = [];

    await setSettings(serviceWorker, server.origin, {
      alwaysAutoDetect: false,
      triggerUsesAutoMode: true
    });

    {
      const page = await openPage(context, `${server.origin}/scenario-page.html`);
      await dispatchToActiveTab(serviceWorker, "fire", PAGE_ACTIONS.AUTO_TRANSLATE_VISIBLE);
      const state = await waitForOverlayCount(page, 2, "auto-scenario-overlays");
      assertOverlayStyle(state, 2);
      await page.screenshot({ path: path.join(outputDir, "auto-after.png") });
      summary.push({ scenario: "auto_visible_images", state });
      await page.close();
    }

    {
      await setSettings(serviceWorker, server.origin, { alwaysAutoDetect: true });
      const page = await openPage(context, `${server.origin}/scenario-page.html`);
      const state = await waitForOverlayCount(page, 2, "always-on-scenario-overlays");
      assertOverlayStyle(state, 2);
      await page.screenshot({ path: path.join(outputDir, "always-on-after.png") });
      summary.push({ scenario: "always_on_auto_detect", state });
      await page.close();
    }

    {
      const page = await openPage(context, `${server.origin}/scroll-reveal.html`);
      await page.waitForTimeout(1200);
      const initialState = await pageState(page);
      assert.equal(initialState.overlayCount, 0);
      await page.evaluate(() => {
        document.getElementById("reveal-image")?.scrollIntoView({
          behavior: "instant",
          block: "center"
        });
      });
      const state = await waitForOverlayCount(page, 1, "always-on-scroll-reveal");
      assertOverlayStyle(state, 1);
      await page.screenshot({ path: path.join(outputDir, "always-on-scroll-reveal-after.png") });
      summary.push({
        scenario: "always_on_translates_image_after_scroll",
        initialState,
        state
      });
      await page.close();
    }

    {
      const page = await openPage(context, `${server.origin}/mutation-insert.html`);
      await page.waitForTimeout(1200);
      const initialState = await pageState(page);
      assert.equal(initialState.overlayCount, 0);
      await page.evaluate(() => window.insertScenarioImage());
      const state = await waitForOverlayCount(page, 1, "always-on-mutation-insert");
      assertOverlayStyle(state, 1);
      await page.screenshot({ path: path.join(outputDir, "always-on-mutation-after.png") });
      summary.push({
        scenario: "always_on_translates_newly_inserted_image",
        initialState,
        state
      });
      await page.close();
      await setSettings(serviceWorker, server.origin, { alwaysAutoDetect: false });
    }

    {
      const page = await openPage(context, `${server.origin}/scenario-page.html`);
      const started = await dispatchToActiveTab(serviceWorker, "probe", PAGE_ACTIONS.START_MANUAL_SELECTION);
      assert.equal(started.ok, true);
      await waitFor(page, async () => {
        const state = await pageState(page);
        return state.selectionLayer ? state : null;
      }, 8000, "manual-click-layer");
      const image = page.locator("#white-ui");
      const box = await image.boundingBox();
      assert.ok(box);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      const state = await waitForOverlayCount(page, 1, "manual-click-overlay");
      assertOverlayStyle(state, 1);
      await page.screenshot({ path: path.join(outputDir, "manual-click-after.png") });
      summary.push({ scenario: "manual_click_translatable_image", state });
      await page.close();
    }

    {
      const page = await openPage(context, `${server.origin}/scenario-page.html`);
      const started = await dispatchToActiveTab(serviceWorker, "probe", PAGE_ACTIONS.START_MANUAL_SELECTION);
      assert.equal(started.ok, true);
      await waitFor(page, async () => {
        const state = await pageState(page);
        return state.selectionLayer ? state : null;
      }, 8000, "manual-photo-layer");
      const image = page.locator("#photo");
      const box = await image.boundingBox();
      assert.ok(box);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(7000);
      const state = await pageState(page);
      assert.equal(state.overlayCount, 0);
      summary.push({ scenario: "manual_click_no_text_photo", state });
      await page.close();
    }

    {
      const page = await openPage(context, `${server.origin}/scenario-page.html`);
      const started = await dispatchToActiveTab(serviceWorker, "probe", PAGE_ACTIONS.START_MANUAL_SELECTION);
      assert.equal(started.ok, true);
      await waitFor(page, async () => {
        const state = await pageState(page);
        return state.selectionLayer ? state : null;
      }, 8000, "manual-drag-layer");
      const target = page.locator("#drag-text");
      const box = await target.boundingBox();
      assert.ok(box);
      await page.mouse.move(box.x + 30, box.y + 36);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 30, box.y + box.height - 36, {
        steps: 10
      });
      await page.mouse.up();
      const state = await waitForOverlayCount(page, 1, "manual-drag-overlay");
      assertOverlayStyle(state, 1);
      await page.screenshot({ path: path.join(outputDir, "manual-drag-after.png") });
      summary.push({ scenario: "manual_drag_text_region", state });
      await page.close();
    }

    {
      const page = await openPage(context, `${server.origin}/partial-visibility.html`);
      await page.evaluate(() => {
        const image = document.getElementById("partial-image");
        const top = (image?.getBoundingClientRect().top || 0) + window.scrollY;
        window.scrollTo(0, top + 48);
      });
      await page.waitForTimeout(500);
      await dispatchToActiveTab(serviceWorker, "fire", PAGE_ACTIONS.AUTO_TRANSLATE_VISIBLE);
      const state = await waitForToast(page, "No visible images were found on this page.", "partial-skip-toast");
      assert.equal(state.overlayCount, 0);
      summary.push({ scenario: "auto_skips_partially_visible_image", state });
      await page.close();
    }

    {
      const page = await openPage(context, `${server.origin}/partial-visibility.html`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(500);
      await dispatchToActiveTab(serviceWorker, "fire", PAGE_ACTIONS.AUTO_TRANSLATE_VISIBLE);
      const state = await waitForOverlayCount(page, 1, "partial-visible-overlay");
      assertOverlayStyle(state, 1);
      summary.push({ scenario: "auto_translates_fully_visible_image", state });
      await page.close();
    }

    {
      const page = await openPage(context, `${server.origin}/no-images.html`);
      await dispatchToActiveTab(serviceWorker, "fire", PAGE_ACTIONS.AUTO_TRANSLATE_VISIBLE);
      const state = await waitForToast(page, "No visible images were found on this page.", "no-images-toast");
      assert.equal(state.overlayCount, 0);
      summary.push({ scenario: "auto_reports_no_visible_images", state });
      await page.close();
    }

    for (const assetName of uploadedSourceFixtures) {
      const page = await openPage(
        context,
        `${server.origin}/uploaded-fixture.html?asset=${encodeURIComponent(assetName)}`,
        { viewport: { width: 1400, height: 2600 } }
      );
      await dispatchToActiveTab(serviceWorker, "fire", PAGE_ACTIONS.AUTO_TRANSLATE_VISIBLE);
      const state = await waitForOverlayCount(page, 1, `uploaded-fixture-${assetName}`);
      assertOverlayStyle(state, 1);
      const outputName = `uploaded-${assetName.replace(/\.png$/u, "")}-after.png`;
      await page.screenshot({ path: path.join(outputDir, outputName), fullPage: true });
      summary.push({ scenario: `uploaded_fixture:${assetName}`, state });
      await page.close();
    }

    const summaryPath = path.join(outputDir, "scenario-summary.json");
    await writeFile(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`Scenario summary written to ${summaryPath}`);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await context.close();
    await server.close();
  }
}

runSuite().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
