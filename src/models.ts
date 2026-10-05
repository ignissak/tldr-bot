export const GEMINI_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
] as const;

export type GeminiModel = (typeof GEMINI_MODELS)[number];

export const DEFAULT_MODEL: GeminiModel = "gemini-3.1-flash-lite";

export function isGeminiModel(value: unknown): value is GeminiModel {
  return typeof value === "string" && (GEMINI_MODELS as readonly string[]).includes(value);
}

interface Price {
  /** USD per 1M tokens. Output includes thinking tokens. */
  input: number;
  output: number;
  /** Effective from (UTC ms); entries sorted newest first. */
  from: number;
}

/**
 * Standard paid-tier text prices, https://ai.google.dev/gemini-api/docs/pricing (checked 2026-10-05).
 * The API returns only token counts, never a cost, so we compute it here.
 * Keys on the free tier (project without billing) pay nothing.
 */
const PRICES: Record<GeminiModel, Price[]> = {
  "gemini-3.1-flash-lite": [{ input: 0.25, output: 1.5, from: 0 }],
  "gemini-3.5-flash-lite": [{ input: 0.3, output: 2.5, from: 0 }],
  "gemini-3.8-flash": [
    { input: 1.5, output: 7.5, from: Date.UTC(2027, 0, 1) },
    { input: 0.75, output: 3.75, from: 0 },
  ],
};

/** USD cost at the paid-tier rate. */
export function estimateCost(model: GeminiModel, inputTokens: number, outputTokens: number, at = Date.now()): number {
  const p = PRICES[model].find((x) => at >= x.from)!;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.000001) return "<$0.000001";
  return `$${usd < 0.01 ? usd.toPrecision(2) : usd.toFixed(4)}`;
}
