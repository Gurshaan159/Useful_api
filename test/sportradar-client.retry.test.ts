import { afterEach, describe, expect, it, vi } from "vitest";
import { SportradarClient } from "../src/integrations/sportradar-client";
import { UpstreamError } from "../src/lib/errors";

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
  });
}

describe("SportradarClient retry behavior", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("retries on 429 and eventually succeeds", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: "rate limited" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "g1", events: [] }));
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const client = new SportradarClient({
      apiKey: "k",
      baseUrl: "https://example.com/nba",
      retryMaxAttempts: 3,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 1,
    });

    const payloadPromise = client.getGamePlayByPlay("sr:game:1");
    await vi.runAllTimersAsync();
    const payload = await payloadPromise;
    expect(payload).toEqual({ id: "g1", events: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("prefers Retry-After header delay over exponential delay", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: "rate limited" }, { "retry-after": "1" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "g2", events: [] }));
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const client = new SportradarClient({
      apiKey: "k",
      baseUrl: "https://example.com/nba",
      retryMaxAttempts: 3,
      retryBaseDelayMs: 50,
      retryMaxDelayMs: 50,
    });

    const payloadPromise = client.getGamePlayByPlay("sr:game:2");
    await vi.runAllTimersAsync();
    await payloadPromise;

    const delays = timeoutSpy.mock.calls.map((call) => call[1]);
    expect(delays).toContain(1000);
  });

  it("throws after retries are exhausted", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValue(jsonResponse(429, { error: "rate limited" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const client = new SportradarClient({
      apiKey: "k",
      baseUrl: "https://example.com/nba",
      retryMaxAttempts: 2,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 1,
    });

    const payloadPromise = client.getGamePlayByPlay("sr:game:3");
    const rejection = expect(payloadPromise).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
      statusCode: 502,
    } satisfies Partial<UpstreamError>);
    await vi.runAllTimersAsync();
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
