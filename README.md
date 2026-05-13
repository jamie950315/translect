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
- Batched text-only translation when iOS OCR Server mode is enabled
- Default model: `gpt-5.4-mini`

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

## Settings

The popup stores settings in Chromium extension storage:

- API endpoint URL
- API key
- Model ID
- Target language
- Auto-detect behavior
- iOS OCR Server toggle
- iOS OCR Server endpoint

Endpoint normalization is handled automatically:

- API endpoints are normalized to `/chat/completions`.
- iOS OCR endpoints are normalized to `/upload`.

## Development

```bash
npm install
npm test
npm run build
npm run test:scenarios
```

The unpacked extension output is written to `dist/`.

`npm run test:scenarios` builds and loads the extension in Playwright with a local mock API, then verifies manual selection, auto-detect, always-on mode, scrolling, inserted images, no-image pages, and fixture-based image overlays.

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
- Generated files such as `dist/`, `.tmp/`, and Playwright output are not committed.
