import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { ApiError } from "@google/genai";
import { parseUserIds } from "../src/commands/tldr";
import { Store } from "../src/db";
import { open, seal } from "../src/lib/crypto";
import { Limiter } from "../src/lib/limits";
import { toLlmError } from "../src/lib/llm";

const key = randomBytes(32);

test("ciphertext is bound to its user (AAD)", () => {
  const s = seal(key, "AIza-secret", "111");
  expect(open(key, s, "111")).toBe("AIza-secret");
  expect(() => open(key, s, "222")).toThrow();
  expect(() => open(randomBytes(32), s, "111")).toThrow();
});

test("store round-trips keys/models, wrong encryption key reads as unlinked", () => {
  const store = new Store(":memory:", key);
  expect(store.get("1")).toEqual({ apiKey: null, model: "gemini-3.1-flash-lite", timeZone: null });
  store.setModel("1", "gemini-3.8-flash");
  store.setApiKey("1", "secret-key");
  expect(store.get("1")).toEqual({ apiKey: "secret-key", model: "gemini-3.8-flash", timeZone: null });
  expect(store.clearApiKey("1")).toBe(true);
  expect(store.get("1").apiKey).toBeNull();
  expect(store.get("1").model).toBe("gemini-3.8-flash");
});

test("timezone persists independently of key/model", () => {
  const store = new Store(":memory:", key);
  store.setTimeZone("1", "Europe/Bratislava");
  store.setApiKey("1", "k");
  expect(store.get("1")).toEqual({ apiKey: "k", model: "gemini-3.1-flash-lite", timeZone: "Europe/Bratislava" });
});

test("migrates a pre-timezone database", () => {
  const path = `${tmpdir()}/tldr-migrate-${Date.now()}.db`;
  const old = new Database(path);
  old.run("CREATE TABLE users (user_id TEXT PRIMARY KEY, key_iv BLOB, key_tag BLOB, key_data BLOB, model TEXT NOT NULL, updated_at INTEGER NOT NULL) STRICT");
  old.run("INSERT INTO users VALUES ('1', NULL, NULL, NULL, 'gemini-3.8-flash', 0)");
  old.close();
  const store = new Store(path, key);
  expect(store.get("1")).toEqual({ apiKey: null, model: "gemini-3.8-flash", timeZone: null });
  store.close();
  rmSync(path, { force: true });
});

test("parseUserIds handles mentions and raw ids, dedupes", () => {
  expect([...parseUserIds("<@123456789012345678> <@!123456789012345678> 987654321098765432 junk")]).toEqual([
    "123456789012345678",
    "987654321098765432",
  ]);
});

test("limiter enforces single-flight and cooldown", () => {
  const l = new Limiter(30_000, 5);
  const release = l.acquire("u", 0);
  expect(typeof release).toBe("function");
  expect(l.acquire("u", 1)).toContain("in progress");
  (release as () => void)();
  expect(l.acquire("u", 1000)).toContain("try again");
  expect(typeof l.acquire("u", 31_000)).toBe("function");
});

test("LLM errors expose Google's message but redact the key", () => {
  const body = JSON.stringify({
    error: { code: 400, status: "INVALID_ARGUMENT", message: "Thinking level MINIMAL is not supported for this model.", details: [] },
  });
  const e = toLlmError(new ApiError({ message: body, status: 400 }), "my-secret-key-123");
  expect(e.userMessage).toBe("Gemini rejected the request (400).");
  expect(e.detail).toBe("INVALID_ARGUMENT: Thinking level MINIMAL is not supported for this model.");

  const leaky = JSON.stringify({ error: { message: "bad key my-secret-key-123 at ?key=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXX", status: "INVALID_ARGUMENT" } });
  const l = toLlmError(new ApiError({ message: leaky, status: 400 }), "my-secret-key-123");
  expect(l.detail).not.toContain("my-secret-key-123");
  expect(l.detail).not.toContain("AIzaSy");

  const invalid = JSON.stringify({ error: { message: "API key not valid.", status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } });
  expect(toLlmError(new ApiError({ message: invalid, status: 400 })).userMessage).toContain("invalid");
  expect(toLlmError(new ApiError({ message: "x", status: 429 })).userMessage).toContain("quota");
});
