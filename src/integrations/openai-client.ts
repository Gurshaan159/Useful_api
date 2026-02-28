import { UpstreamError, UpstreamTimeoutError } from "../lib/errors";

export interface OpenAiClientConfig {
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export interface NarrationPayload {
  narration: string;
  bullets: string[];
  callouts: Array<{ type: string; text: string }>;
}

export class OpenAiClient {
  private readonly timeoutMs: number;

  constructor(private readonly config: OpenAiClientConfig) {
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  async createNarration(input: {
    focusPlayer: string;
    context: string;
    verbosity: "short" | "medium" | "high";
  }): Promise<NarrationPayload> {
    if (!this.config.apiKey) {
      return {
        narration: "Narration disabled: missing OPENAI_API_KEY.",
        bullets: [],
        callouts: [],
      };
    }

    const signal = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        signal,
        body: JSON.stringify({
          model: this.config.model,
          input: [
            {
              role: "system",
              content:
                "You are a live soccer analyst. Return strict JSON only with keys: narration, bullets, callouts.",
            },
            {
              role: "user",
              content: `Focus player: ${input.focusPlayer}\nVerbosity: ${input.verbosity}\nContext:\n${input.context}`,
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "live_narration",
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["narration", "bullets", "callouts"],
                properties: {
                  narration: { type: "string" },
                  bullets: { type: "array", items: { type: "string" } },
                  callouts: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["type", "text"],
                      properties: {
                        type: { type: "string" },
                        text: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new UpstreamTimeoutError("OpenAI narration request timed out.", {
          provider: "openai",
          operation: "responses.create",
        });
      }
      throw new UpstreamError("Failed to reach OpenAI.", {
        provider: "openai",
        operation: "responses.create",
      });
    }

    if (!response.ok) {
      throw new UpstreamError("OpenAI responses API returned non-success status.", {
        provider: "openai",
        operation: "responses.create",
        status: response.status,
      });
    }
    const payload = await response.json();
    const parsed = extractNarrationJson(payload);
    return {
      narration: parsed.narration ?? "",
      bullets: Array.isArray(parsed.bullets) ? parsed.bullets.filter((x: unknown): x is string => typeof x === "string") : [],
      callouts: Array.isArray(parsed.callouts)
        ? parsed.callouts
          .map((x: any) => ({ type: asString(x?.type), text: asString(x?.text) }))
          .filter((x: { type: string | null; text: string | null }): x is { type: string; text: string } => !!x.type && !!x.text)
        : [],
    };
  }
}

function extractNarrationJson(payload: any): any {
  const outputText = payload?.output_text;
  if (typeof outputText === "string" && outputText.trim()) {
    try {
      return JSON.parse(outputText);
    } catch {
      return { narration: outputText, bullets: [], callouts: [] };
    }
  }
  const messageText = payload?.output?.[0]?.content?.[0]?.text;
  if (typeof messageText === "string" && messageText.trim()) {
    try {
      return JSON.parse(messageText);
    } catch {
      return { narration: messageText, bullets: [], callouts: [] };
    }
  }
  return { narration: "", bullets: [], callouts: [] };
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  return "name" in error && (error as { name: string }).name === "AbortError";
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
