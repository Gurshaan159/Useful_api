import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createClient } from "../sdk/src/index";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

const requestBody = {
  sport: "nba" as const,
  player: { name: "Austin Reaves", team: "LAL" },
  filters: {
    nba: {
      quarter: 4 as const,
      timeRemainingSeconds: { gte: 0, lte: 720 },
      scoreDiff: { gte: -15, lte: -1 },
    },
  },
  season: { year: 2025, type: "REG" as const },
};

describe("SDK situations.create retry behavior", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("retries transient errors and returns success", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(502, { error: { message: "upstream", code: "UPSTREAM_ERROR" } }))
      .mockResolvedValueOnce(jsonResponse(201, { id: "sit_123", gamesScanned: 5, gamesUsed: 2 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const api = createClient({ baseUrl: "https://example.com" });
    const resultPromise = api.situations.create(requestBody);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.id).toBe("sit_123");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable errors", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValue(jsonResponse(422, { error: { message: "bad input", code: "INVALID_REQUEST" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const api = createClient({ baseUrl: "https://example.com" });
    await expect(api.situations.create(requestBody)).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("exhausts retry budget for persistent 502 responses", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValue(jsonResponse(502, { error: { message: "upstream", code: "UPSTREAM_ERROR" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const api = createClient({ baseUrl: "https://example.com" });
    const resultPromise = api.situations.create(requestBody);
    const rejection = expect(resultPromise).rejects.toMatchObject({ status: 502 });
    await vi.runAllTimersAsync();
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
