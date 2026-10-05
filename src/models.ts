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
