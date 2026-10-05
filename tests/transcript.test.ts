import { expect, test } from "bun:test";
import { buildTranscript, type SourceMessage } from "../src/lib/transcript";

const base = Date.UTC(2026, 9, 5, 14, 0);
let n = 0;
const msg = (authorId: string, authorName: string, minute: number, content: string, extra: Partial<SourceMessage> = {}): SourceMessage => ({
  id: String(n++), authorId, authorName, createdAt: base + minute * 60_000, content,
  users: new Map(), roles: new Map(), channels: new Map(), attachments: [], stickers: 0, ...extra,
});

test("compacts, merges, resolves and marks replies", () => {
  const t = buildTranscript(
    [
      msg("2", "Bob", 2, "hey <@1> see https://github.com/x/y/pull/1", { users: new Map([["1", "Alice"]]) }),
      msg("1", "Alice", 0, "deploy\nis broken"),
      msg("1", "Alice", 1, "rolling back <:pepe:123>"),
      msg("1", "Alice", 3, "ok", { replyToAuthorId: "2" }),
      msg("3", "Carol: the **great**", 40, "", { attachments: ["img"] }),
    ],
    { maxChars: 10_000 },
  );
  expect(t.text).toBe(
    [
      "#2026-10-05",
      "14:00 Alice: deploy / is broken | rolling back :pepe:",
      "Bob: hey @Alice see [github.com]",
      "Alice>Bob: ok",
      "14:40 Carol the great: [img]",
    ].join("\n"),
  );
  expect(t.included).toBe(5);
  expect(t.participants).toBe(3);
});

test("budget keeps newest lines and still emits a day header", () => {
  const msgs = Array.from({ length: 50 }, (_, i) => msg(String(i % 2), i % 2 ? "B" : "A", i * 30, `message number ${i}`));
  const t = buildTranscript(msgs, { maxChars: 200 });
  expect(t.text.length).toBeLessThanOrEqual(200 + 12);
  expect(t.text.startsWith("#")).toBe(true);
  expect(t.text).toContain("message number 49");
  expect(t.dropped).toBeGreaterThan(0);
  expect(t.included + t.dropped).toBe(50);
});

test("duplicate display names get unique aliases", () => {
  const t = buildTranscript([msg("1", "Sam", 0, "a"), msg("2", "sam", 30, "b")], { maxChars: 1000 });
  expect(t.text).toContain("Sam: a");
  expect(t.text).toContain("sam2: b");
});
