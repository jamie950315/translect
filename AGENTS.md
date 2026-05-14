# AGENTS.md

## Project Overview

Translect is a Chromium Manifest V3 extension for translating text inside webpage images and drawing the translated text back over the original image.

The project supports two translation flows:

- Default vision mode: capture an image or viewport region, send it to an OpenAI-compatible vision model, parse translated text blocks, and render canvas overlays.
- iOS OCR Server mode: send images to an iOS OCR Server for text and box coordinates, translate the extracted text with the OpenAI-compatible API, and merge the translated text back onto the OCR boxes.
- macOS Vision OCR mode: send images to a local native messaging host, use Apple's Vision framework for OCR and text boxes on the Mac, translate the extracted text with the OpenAI-compatible API, and merge the translated text back onto the OCR boxes.

## Important Files

- `src/manifest.json`: extension manifest, permissions, commands, popup, and content script registration.
- `src/background/service-worker.js`: settings storage, tab capture, API calls, command handling, and translation routing.
- `src/content/content-script.js`: page interaction, manual selection, auto image detection, overlay placement, rendering, and Reddit media reuse behavior.
- `src/popup/popup.js`: popup settings form and action buttons.
- `src/shared/api.js`: default vision-mode prompt, payload creation, assistant response parsing, and block normalization.
- `src/shared/ios-ocr.js`: iOS OCR response normalization, text-only translation payloads, and merge logic.
- `src/shared/macos-vision-ocr.js`: macOS Vision native host response normalization.
- `src/shared/flow-text.js`: distributes translated OCR text across provider-supplied line boxes.
- `src/shared/render-utils.js`: text tokenization, wrapping, fitting, and typography grouping helpers.
- `src/shared/settings.js`: settings normalization and validation.
- `scripts/build.mjs`: extension build script.
- `scripts/verify-scenarios.mjs`: Playwright scenario verification with a local mock API.
- `scripts/install-macos-vision-host.mjs`: builds and registers the macOS native messaging host.
- `native/macos-vision-ocr/`: SwiftPM native host using Apple Vision OCR.

## Development Commands

```bash
npm install
npm test
npm run build
npm run test:scenarios
swift build --package-path native/macos-vision-ocr
```

## Completion Standard

Before reporting work as complete:

1. Run `npm test`.
2. Run `npm run build`.
3. Run `npm run test:scenarios` when behavior touches extension flow, image detection, overlays, settings, OCR, or translation routing.
4. Run `swift build --package-path native/macos-vision-ocr` when behavior touches macOS Vision OCR.
5. Inspect failures and fix them before marking the task complete.

## Repository Hygiene

- Keep `README.md` in English unless the user explicitly asks for another language.
- Do not commit generated output: `dist/`, `.tmp/`, `output/`, `node_modules/`, or `.DS_Store`.
- Keep the default OpenAI-compatible flow working when adding optional providers.
- Treat iOS OCR Server as an OCR and box-position provider, not as a translation engine.
- Treat macOS Vision OCR as an OCR and box-position provider, not as a translation engine.
- Keep iOS OCR Server mode and macOS Vision OCR mode mutually exclusive in settings and UI.
- Preserve provider OCR box positions. Do not enlarge macOS Vision blur covers to accommodate translated text; adjust text fitting or distribution instead.
- Keep translated macOS Vision OCR text inside the OCR frame box. If text must be clipped, prefer clipping over drawing outside Apple Vision coordinates.
- When changing OCR text flow or overlay layout, verify with real Playwright screenshots against the iMessage fixtures in the manual gallery.
- Keep API keys, tokens, cookies, and private browser data out of commits and logs.
