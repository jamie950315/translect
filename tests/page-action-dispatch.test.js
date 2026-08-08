import { describe, expect, test, vi } from "vitest";

import { dispatchPageAction } from "../src/background/page-action-dispatch.js";

describe("page action dispatch", () => {
  test("uses an already registered content script without reinjecting it", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    const injectContentScript = vi.fn();

    await expect(
      dispatchPageAction({
        action: "start-manual-selection",
        injectContentScript,
        sendMessage,
        tabId: 42
      })
    ).resolves.toEqual({ ok: true });

    expect(injectContentScript).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(42, {
      action: "start-manual-selection",
      type: "translect-page-action-v2"
    });
  });

  test("injects and retries when the current tab has no responding content script", async () => {
    const sendMessage = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ ok: true });
    const injectContentScript = vi.fn().mockResolvedValue(undefined);

    await expect(
      dispatchPageAction({
        action: "auto-translate-visible",
        injectContentScript,
        sendMessage,
        tabId: 91
      })
    ).resolves.toEqual({ ok: true });

    expect(injectContentScript).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});
