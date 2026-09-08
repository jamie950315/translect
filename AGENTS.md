# AGENTS.md

## Project Overview

Translect is a Manifest V3 WebExtension for Chromium and macOS Safari that translates text inside webpage images and draws the translated text back over the original image.

The project supports four translation flows:

- Default vision mode: capture an image or viewport region, send it to an OpenAI-compatible vision model, parse translated text blocks, and render canvas overlays.
- iOS OCR Server mode: send images to an iOS OCR Server for text and box coordinates, translate the extracted text with the OpenAI-compatible API, and merge the translated text back onto the OCR boxes.
- macOS Vision OCR mode: use Apple's Vision framework for OCR and text boxes on the Mac, translate the extracted text with the OpenAI-compatible API, and merge the translated text back onto the OCR boxes. Chromium sends requests to a local native messaging host; Safari sends them to the containing app extension.
- Apple Intelligence mode: use Apple Vision for exact local OCR boxes, then use Apple's on-device Foundation Model for semantic labeling and translation. Safari handles requests in its containing app extension; Chromium uses the installed native host. Neither path uses an external API.

## Important Files

- `src/manifest.json`: extension manifest, permissions, commands, popup, and content script registration.
- `src/background/service-worker.js`: settings storage, tab capture, API calls, command handling, and translation routing.
- `src/background/http-request.js`: bounded HTTP requests and original API error reporting; no automatic request-format downgrade.
- `src/content/content-script.js`: page interaction, manual selection, auto image detection, overlay placement, rendering, and Reddit media reuse behavior.
- `src/popup/popup.js`: popup settings form and action buttons.
- `src/shared/api.js`: default vision-mode prompt, payload creation, assistant response parsing, and block normalization.
- `src/shared/ios-ocr.js`: iOS OCR response normalization, text-only translation payloads, and merge logic.
- `src/shared/macos-vision-ocr.js`: macOS Vision native host response normalization.
- `src/shared/flow-text.js`: distributes translated OCR text across provider-supplied line boxes.
- `src/shared/render-utils.js`: text tokenization, wrapping, fitting, and typography grouping helpers.
- `src/shared/settings.js`: settings normalization and validation.
- `src/shared/translation-response.js`: shared OCR response and complete translation validation.
- `src/shared/browser-compat.js`: aliases Safari's `browser` namespace for shared Chromium-style modules.
- `src/shared/safari-manifest.js`: removes Safari-incompatible manifest fields during Safari packaging.
- `scripts/build.mjs`: extension build script.
- `scripts/build-safari.mjs`: builds Safari-targeted resources and synchronizes them into the Xcode project.
- `scripts/verify-scenarios.mjs`: Playwright scenario verification with a local mock API.
- `scripts/install-macos-vision-host.mjs`: builds and registers the macOS native messaging host.
- `native/macos-vision-ocr/`: SwiftPM native host using Apple Vision OCR.
- `native/macos-vision-ocr/Sources/TranslectMacOSVisionOCR/AppleIntelligenceTranslation.swift`: local text grouping, Foundation Models translation, semantic labels, availability errors, and exact Vision-box merging.
- `safari/Translect/Translect/`: macOS-only Safari Web Extension Xcode project and native message handler.

## Development Commands

```bash
npm install
npm test
npm run build
npm run build:safari
npm run test:scenarios
swift build --package-path native/macos-vision-ocr
swift test --package-path native/macos-vision-ocr
xcodebuild -project safari/Translect/Translect/Translect.xcodeproj -scheme Translect -configuration Debug CODE_SIGNING_ALLOWED=NO build
```

## Completion Standard

Before reporting work as complete:

1. Run `npm test`.
2. Run `npm run build`.
3. Run `npm run test:scenarios` when behavior touches extension flow, image detection, overlays, settings, OCR, or translation routing.
4. Run `swift test --package-path native/macos-vision-ocr` and `swift build --package-path native/macos-vision-ocr` when behavior touches the native host or local translation.
5. Run `npm run build:safari` and the Safari Xcode build when behavior touches Safari packaging or the Safari native OCR bridge.
6. Inspect failures and fix them before marking the task complete.

## Repository Hygiene

- Keep `README.md` in English unless the user explicitly asks for another language.
- Do not commit generated output: `dist/`, `.tmp/`, `output/`, `node_modules/`, or `.DS_Store`.
- Keep the default OpenAI-compatible flow working when adding optional providers.
- Treat iOS OCR Server as an OCR and box-position provider, not as a translation engine.
- Treat macOS Vision OCR as an OCR and box-position provider, not as a translation engine.
- Keep Apple Intelligence, iOS OCR Server, and macOS Vision OCR modes mutually exclusive in settings and UI.
- Preserve provider OCR box positions. Do not enlarge macOS Vision blur covers to accommodate translated text; adjust text fitting or distribution instead.
- Keep translated macOS Vision OCR text inside the OCR frame box. If text must be clipped, prefer clipping over drawing outside Apple Vision coordinates.
- When changing OCR text flow or overlay layout, verify with real Playwright screenshots against the iMessage fixtures in the manual gallery.
- Keep API keys, tokens, cookies, and private browser data out of commits and logs.
- Do not commit generated Safari Web Extension resources under `safari/Translect/Translect/Translect Extension/Resources/`; `npm run build:safari` and the Xcode build phase create them.

## Current Implementation Status

- The Safari build targets macOS 13+ and Safari 17+, with its own Xcode project at `safari/Translect/Translect/Translect.xcodeproj`.
- Safari resources are rebuilt from the shared `src/` tree before every Xcode build.
- `VisionOCR.swift` is shared by the Chromium native host and Safari's `SafariWebExtensionHandler`, so both return the same Apple Vision OCR response format.
- Safari Apple Intelligence mode requires macOS 26+, uses Apple Vision for local OCR coordinates, and uses Foundation Models for local semantic labeling and translation.
- Apple Intelligence mode bypasses remote API credential validation and preserves every Apple Vision frame as the rendering boundary.
- Decoration-only Vision groups such as standalone arrows are not sent to Foundation Models and do not create overlays; this prevents an omitted symbol translation from failing the whole image.
- Apple Intelligence groups are capped at 8 Vision lines and translated in batches of at most 32 groups or 6000 source bytes so dense images stay below the on-device model's 8192-token context limit.
- Unchanged text, numeric-only rewrites, and ASCII-only metadata/code/other rewrites do not create overlays; this prevents rotated chart labels and OCR noise from being redrawn as oversized horizontal text.
- Reddit translation cache version 3 separates API origins/paths and case-sensitive model IDs, excludes URL credentials/query parameters, validates restored entries, and ignores older caches. Optional storage failures are logged and retain an in-page cache.
- The Swift native messaging executable and Safari handler both recognize `apple-intelligence-translate` requests and return the same local translation response shape.
- Every translated overlay has click-operated remove and visibility controls; the eye toggle dims only the translated canvas to 25% and keeps the controls available for restoring it.
- Apple Vision OCR preserves horizontal and vertical reading direction. Vertical translations use the original axis-aligned OCR cover while rotating and fitting translated text inside the same detected frame.
- Apple Intelligence failures remain local and are surfaced unchanged; there is no remote text fallback. Every generated batch must contain exactly one non-empty translation for each requested group.
- Malformed, truncated, duplicate, and missing translation results are errors, not successful empty results. Explicit empty OCR/block arrays remain valid no-text results.
- Translation/OCR HTTP requests have a 120-second deadline; image downloads have a 30-second deadline. Unsupported API response formats are reported without silently retrying a modified request.
- Screenshot capture checks the requesting tab before and after capture. Failed image preparation releases its in-flight lock; failed translation is reported without a completion toast. Explicit retranslation bypasses prior successful fingerprints.
- Automatic image scanning ignores extension-owned DOM changes to avoid self-triggered retry loops. All covers are drawn before any translated text so overlapping covers do not erase translations.
- Native messaging validates complete frames, caps input at 64 MiB and output at the browser's 1 MiB limit, and exits with an explicit error for malformed framing.
- `npm run dev` watches static resources as well as JavaScript. Invalid static resources stop the watcher visibly. Build/install scripts resolve the project relative to their own file, not the caller's directory.

## Current Verification Boundary

- Review regression coverage includes Chromium interaction/screenshot scenarios, network failure and manual recovery, overlapping covers, popup load failures, and native framing tests. Network scenarios use a local mock API; they do not establish remote model translation quality or real iOS OCR Server interoperability.
- Real Apple Vision OCR works on the iMessage fixture. A real Foundation Models attempt returned an incomplete batch and was correctly rejected; successful on-device translation is not established by that run.
- Safari can be built and signed with the current local developer identity. Repository builds do not replace `/Applications/Translect.app`; an installed Safari extension must be tested separately before claiming installed-app delivery.
