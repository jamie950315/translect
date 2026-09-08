import { afterEach, describe, expect, test, vi } from "vitest";
import { requestChatCompletion, requestJson } from "../src/background/http-request.js";

afterEach(() => vi.unstubAllGlobals());

describe("HTTP failures remain visible", () => {
  test("does not retry an incompatible response_format", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { message: "Unsupported response_format" } }), { status: 400 }
    ));
    vi.stubGlobal("fetch", fetch);
    await expect(requestChatCompletion("https://example.test", "test", {
      response_format: { type: "json_object" }
    })).rejects.toThrow("HTTP 400): Unsupported response_format");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("preserves plain text proxy errors and structured errors", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("upstream unavailable", { status: 502 }))
      .mockResolvedValueOnce(new Response('{"error":{"code":"bad_model"}}', { status: 422 })));
    await expect(requestJson("https://example.test", {})).rejects.toThrow("HTTP 502): upstream unavailable");
    await expect(requestJson("https://example.test", {})).rejects.toThrow('HTTP 422): {"code":"bad_model"}');
  });

  test("rejects malformed successful responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not JSON")));
    await expect(requestJson("https://example.test", {})).rejects.toThrow();
  });

  test("applies a deadline and propagates cancellation", async () => {
    vi.stubGlobal("fetch", vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })));
    await expect(requestJson("https://example.test", {}, "Test", 10)).rejects.toMatchObject({ name: "TimeoutError" });
  });
});
