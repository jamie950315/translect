# Translect

Translect is a Chromium extension that translates text inside webpage images with an OpenAI-compatible vision endpoint, then redraws the translated text directly over the original image.

## Features

- Manual translation by toolbar popup button
- Manual translation by custom keyboard shortcut
- Drag-to-select any visible area or click a visible image
- Automatic translation for visible `<img>` elements on a page
- Persistent always-on auto-detect mode
- One-shot auto mode for toolbar button and shortcut triggers
- Configurable target language, API key, API endpoint URL, and model ID
- Optional iOS OCR Server mode for OCR and text-box positioning
- Optional macOS Vision OCR mode through a local native messaging host
- Batched text-only translation when an OCR provider mode is enabled
- Default model: `gpt-5.4-mini`

## Requirements

- A Chromium-based browser that supports Manifest V3 extensions.
- An OpenAI-compatible `/chat/completions` endpoint and API key.
- Node.js for development, builds, and Playwright scenario tests.
- Swift toolchain on macOS when using the macOS Vision OCR native host.

The extension stores settings in Chromium extension storage. API keys are not committed by this repository and should not be checked into source control.

## How It Works

### Default Vision Mode

1. The extension captures the visible tab.
2. For manual mode, you drag a rectangle or click a visible image.
3. The selected crop is sent to your OpenAI-compatible vision endpoint.
4. The model returns translated text blocks and approximate style hints.
5. The extension redraws the translated text on top of the image using canvas.

To make the translated text cover the original text more naturally, the renderer uses a browser-side approximation of common image translation pipelines:

- Detect text blocks and their bounds
- Blur and recolor the original text region
- Fit translated text back into the same area
- Reapply text color, outline, alignment, and rotation hints

### iOS OCR Server Mode

When iOS OCR Server mode is enabled, Translect separates OCR from translation:

1. The selected image or crop is sent to the configured iOS OCR Server upload endpoint.
2. The OCR server returns source text and text-box coordinates.
3. Translect sends only the OCR text to the OpenAI-compatible translation endpoint.
4. The translated text is merged back onto the original OCR box coordinates.

This mode keeps text detection and positioning on the OCR server while preserving the existing translation and overlay pipeline.

The configured iOS OCR endpoint can be either the base server URL or the upload URL. Translect normalizes it to `/upload`.

### macOS Vision OCR Mode

When macOS Vision OCR mode is enabled, Translect uses Chrome Native Messaging to call a local Swift helper. The helper runs Apple's Vision framework on the Mac, returns text and bounding boxes, and Translect sends only the detected text to the translation endpoint.

This mode does not require another iOS device and keeps OCR on the local Mac.

macOS Vision OCR boxes are treated as the source of truth for text placement. The renderer keeps translated text inside those OCR frames, uses tight OCR-region covers, and does not enlarge blur masks to fit translated text. Longer translations are distributed across the available OCR line boxes and clipped to the original OCR frame when necessary.

OCR provider modes are mutually exclusive. Enabling macOS Vision OCR disables iOS OCR Server mode.

## Settings

The popup stores settings in Chromium extension storage:

- API endpoint URL
- API key
- Model ID
- Target language
- Auto-detect behavior
- iOS OCR Server toggle
- iOS OCR Server endpoint
- macOS Vision OCR toggle
- macOS native host name

The macOS native host name defaults to `com.translect.ocr`.

Endpoint normalization is handled automatically:

- API endpoints are normalized to `/chat/completions`.
- iOS OCR endpoints are normalized to `/upload`.

## Development

```bash
npm install
npm test
npm run build
npm run test:scenarios
swift build --package-path native/macos-vision-ocr
```

The unpacked extension output is written to `dist/`.

`npm run test:scenarios` builds and loads the extension in Playwright with a local mock API, then verifies manual selection, auto-detect, always-on mode, scrolling, inserted images, no-image pages, and fixture-based image overlays.

## macOS Vision Native Host

Build the Swift helper directly:

```bash
swift build --package-path native/macos-vision-ocr
```

Install the native messaging host manifest after loading the unpacked extension and copying its extension ID from `chrome://extensions`:

```bash
npm run install:macos-ocr-host -- --extension-id <extension-id>
```

Use `--browser chromium` or `--browser chrome-for-testing` when installing for those browsers instead of regular Google Chrome.

The host name used by the extension is `com.translect.ocr`.

The installer builds the native host in release mode and writes a Native Messaging manifest under the selected browser profile support directory:

- Chrome: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.translect.ocr.json`
- Chromium: `~/Library/Application Support/Chromium/NativeMessagingHosts/com.translect.ocr.json`
- Chrome for Testing: `~/Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts/com.translect.ocr.json`

If Chrome reports that the native messaging host is missing, reinstall with the extension ID shown in the currently loaded unpacked extension. Extension IDs change when the extension is loaded from a different path.

## Load In Chromium

1. Run `npm run build`
2. Open `chrome://extensions`
3. Enable Developer Mode
4. Click `Load unpacked`
5. Select the `dist/` directory

## Shortcut

The extension ships with:

- `Ctrl+Shift+L` on Windows/Linux
- `Command+Shift+L` on macOS

You can customize shortcuts at `chrome://extensions/shortcuts`.

The always-on auto-detect toggle also has a default shortcut:

- `Ctrl+Shift+K` on Windows/Linux
- `Command+Shift+K` on macOS

## Notes

- Auto-detect mode translates visible images on the page.
- Manual selection mode can translate any visible screen region, including text embedded in complex layouts.
- The extension currently targets standard webpage images and visible page regions, not browser-internal pages such as `chrome://`.
- The extension requires an OpenAI-compatible endpoint and API key for real translations.
- macOS Vision OCR requires the native host to be installed for the active extension ID.
- macOS Vision OCR uses Apple Vision only for OCR and text-box coordinates. Translation still goes through the configured OpenAI-compatible endpoint.
- iOS OCR Server mode uses the iOS server only for OCR and text-box coordinates. Translation still goes through the configured OpenAI-compatible endpoint.
- Generated files such as `dist/`, `.tmp/`, and Playwright output are not committed.
