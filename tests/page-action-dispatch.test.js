import { describe, expect, test, vi } from "vitest";

import { dispatchPageAction } from "../src/background/page-action-dispatch.js";

describe("page action dispatch", () => {
  test("propagates transport failures instead of injecting and masking them", async () => {
    const error = new Error("The tab was closed.");
    const sendMessage = vi.fn().mockRejectedValue(error);
    const injectContentScript = vi.fn();
    await expect(dispatchPageAction({ action: "test", injectContentScript, sendMessage, tabId: 42 })).rejects.toBe(error);
    expect(injectContentScript).not.toHaveBeenCalled();
  });

  test("injects only for a missing receiver and preserves injection failures", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("Could not establish connection. Receiving end does not exist."));
    const error = new Error("Cannot access contents of this page.");
    const injectContentScript = vi.fn().mockRejectedValue(error);
    await expect(dispatchPageAction({ action: "test", injectContentScript, sendMessage, tabId: 42 })).rejects.toBe(error);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  test("does not send a legacy action after the injected script fails to acknowledge", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    await expect(dispatchPageAction({ action: "test", injectContentScript: vi.fn(), sendMessage, tabId: 42 })).rejects.toThrow("not acknowledged");
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

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
