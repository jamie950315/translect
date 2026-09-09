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
- `src/background/retained-settings.js`: serialized Safari Keychain restoration/migration/save and browser cache synchronization.
- `src/content/content-script.js`: page interaction, manual selection, auto image detection, overlay placement, rendering, and Reddit media reuse behavior.
- `src/popup/popup.js`: popup settings form and action buttons.
- `src/popup/popup.css`: self-contained macOS material/control styles calibrated against native AppKit controls and Tahoe Control Center/Safari references.
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
- `native/macos-vision-ocr/Sources/TranslectMacOSVisionOCR/PersistentSettings.swift`: versioned, atomic login Keychain settings storage shared with Safari; no settings in app-bundle files.
- `native/macos-vision-ocr/Sources/TranslectMacOSVisionOCR/AppleIntelligenceTranslation.swift`: local text grouping, Foundation Models translation, semantic labels, availability errors, and exact Vision-box merging.
- `safari/Translect/Translect/`: macOS-only Safari Web Extension Xcode project and native message handler.

## Development Commands

```bash
npm install
npm test
npm run build
npm run build:safari
npm run test:scenarios
# Optional: verify popup/vertical text with isolated WebKit instead of Chromium.
PLAYWRIGHT_SKIP_BROWSER_GC=1 npx playwright install webkit
TRANSLECT_POPUP_ENGINE=webkit npm run test:scenarios
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

- Safari automatically retains the complete settings profile in the current user's login Keychain (`com.translect.settings` / `default`, label `Translect settings`), without iCloud synchronization. Reinstallation and same-signing-identity builds read the same profile. Chromium remains browser-only unless its native protocol is explicitly used.
- The Mac profile is authoritative. Existing browser settings migrate with `onlyIfMissing` (atomic Keychain add; a concurrent writer wins over stale migration), and an empty installation never publishes defaults. Saving updates Keychain before the browser cache; failures are visible and corrupt/newer records are not overwritten.
- Safari caches non-key settings for content scripts with `apiKey` blank; popup/background requests read the full profile through the native bridge. Content scripts react to storage changes, including automatic restores. All settings operations in one worker are serialized.
- Native `settings-load` returns an explicit null when no profile exists; `settings-save` returns the actual retained settings, including when `onlyIfMissing` preserves another instance's profile. Errors never contain setting values. Schema version 1 requires known string/boolean fields and mutually exclusive providers.
- Removing the app intentionally leaves this profile behind. Permanent removal requires clearing browser settings and deleting the Keychain item. A different Mac user, a cleared Keychain, unsigned builds, or a different signing identity may not recover it automatically.

- The Safari build targets macOS 13+ and Safari 17+, with its own Xcode project at `safari/Translect/Translect/Translect.xcodeproj`.
- Safari resources are rebuilt from the shared `src/` tree before every Xcode build.
- `VisionOCR.swift` is shared by the Chromium native host and Safari's `SafariWebExtensionHandler`, so both return the same Apple Vision OCR response format.
- Safari Apple Intelligence mode requires macOS 26+, uses Apple Vision for local OCR coordinates, and uses Foundation Models for local semantic labeling and translation.
- Apple Intelligence mode bypasses remote API credential validation and preserves every Apple Vision frame as the rendering boundary.
- Decoration-only Vision groups such as standalone arrows are not sent to Foundation Models and do not create overlays; this prevents an omitted symbol translation from failing the whole image.
- Apple Intelligence groups are capped at 8 Vision lines and translated in batches of at most 8 groups or 1500 source bytes, with a 2048-token output budget. Required schema properties map directly to OCR group IDs; the model does not generate IDs or an unconstrained result array. Keep the schema in the prompt and use the explicit source-text end delimiter: omitting the schema produced incomplete results on real dense fixtures.
- Pure numeric/score groups and decoration are not sent to the local model; their original pixels are preserved. Traditional Chinese requests specify standard written Taiwan Mandarin, while explicitly requested Cantonese remains unchanged.
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
- Content scripts read settings directly from extension storage, avoiding a nested background-message round-trip during page-action handling. The 360x440 popup groups translation actions into Control Center-style tiles beneath a compact toolbar. Content scrolls independently of status/save controls; the less-used shortcut preference lives in Settings.
- Popup styling is self-contained rather than driven by Puppertino. It uses system typography, restrained top-edge highlights, shared translucent surfaces, native select menus, blue switches, and visible keyboard focus. Light/dark, reduced-motion/transparency and increased-contrast preferences are supported. No runtime framework, CDN, downloaded font, image-text control, refraction shader, or continuous idle animation is used.
- Dark colors are coordinated with SafAI: a near-opaque `#232426` shell, `#1e1e1e` inset fields and restrained white highlights, based on locally resolved AppKit Dark Aqua colors. Reduced-transparency controls use `#343434`; light colors and layouts are unchanged.
- One native method selector maps to the same three stored provider booleans, preserving the Keychain schema and hidden API credentials. The selection button always starts manual selection; `triggerUsesAutoMode` controls the keyboard shortcut. Busy actions prevent duplicate submissions and do not erase errors.
- Page controls/toasts use shared neutral material; translated images have no extra decorative outline. Translation placement/geometry, hit targets and 25% eye toggle are unchanged. Native AppKit renders and the real Tahoe screenshot library are visual references, not pasted UI assets or proof of native Liquid Glass compositing.
- Verification builds may be registered automatically by macOS. Inspect `pluginkit -m -A -D -v -i com.translect.safari.Extension` and unregister exact build-copy paths before installed-app tests, keeping `/Applications/Translect.app`. Multiple registered build copies can expose stale Safari extension contexts. Retain recoverable app backups before replacement, verify signing, and restart Safari after an app update.

## Current Verification Boundary

- The deeper-dark revision is signed and installed in `/Applications/Translect.app`, with the previous app preserved in `.tmp/Translect-before-deeper-dark.app`. Installed popup CSS matches source and only the installed extension is registered. Safari was restarted and its popup accessibility tree loaded; CUA screenshots did not include the popover, so this is not native visual confirmation. WebKit popup tests cover dark colors, appearance, keyboard navigation, all method mappings, hidden-key preservation, scrolling and errors; the remaining extension/image scenarios run in Chromium. No live model API calls or settings changes are part of this visual verification.

- Retention is installed in `/Applications/Translect.app`. Verification included moving the app out of Applications, confirming the Keychain item survived, reinstalling/restarting Safari, and observing the retained model/provider settings and retention notice. Browser-profile deletion was not performed; empty-cache recovery and concurrent migration are regression-tested. Real Keychain round trips use an isolated UUID test item, never production credentials.
- Run `TRANSLECT_TEST_KEYCHAIN=1 swift test --package-path native/macos-vision-ocr --filter PersistentSettingsTests` for the isolated real-Keychain test. It removes only its own temporary UUID item. Normal Swift tests skip this and the opt-in model integration test.

- Review regression coverage includes Chromium interaction/screenshot scenarios, network failure and manual recovery, overlapping covers, popup load failures, and native framing tests. Network scenarios use a local mock API; they do not establish remote model translation quality or real iOS OCR Server interoperability.
- Real on-device validation covers 27 source fixtures: the latest full run completed 23 and Apple refused 4 for sensitive/unsafe content; no incomplete-schema or context-overflow failures remained. Successful image requests took about 1.8-23.4 seconds (median 7.5 seconds) on this Mac. Refusals are errors, not successful translations; the opt-in integration suite intentionally fails on them. Model quality and refusal decisions remain variable.
- The installed Safari extension was exercised on two logged-in Reddit images, with visible translated overlays via the actual native bridge. This is distinct from the 27-image native fixture run; no claim is made that 27 Reddit pages were tested. Test mode must be restored afterward, and no posting/voting/account changes are part of verification.
- To rerun real model tests, set `TRANSLECT_AI_FIXTURE` to one image or the fixtures/assets directory and run `swift test --package-path native/macos-vision-ocr --filter AppleIntelligenceIntegrationTests`. Without the variable this test is skipped. Raw translations print only with explicit `TRANSLECT_AI_PRINT_TRANSLATIONS=1`; do not commit raw model output or private images.
