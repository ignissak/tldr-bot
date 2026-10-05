import { describe, expect, test } from "bun:test";
import { parseDate } from "../src/lib/dates";

const now = Date.UTC(2026, 9, 5, 12, 0, 0);
const iso = (s: string, o = {}) => parseDate(s, { now, ...o })?.toISOString();

describe("parseDate", () => {
  test("ISO date + time, UTC by default", () => {
    expect(iso("2026-10-01")).toBe("2026-10-01T00:00:00.000Z");
    expect(iso("2026-10-01", { endOfDay: true })).toBe("2026-10-01T23:59:59.999Z");
    expect(iso("2026-10-01 14:30")).toBe("2026-10-01T14:30:00.000Z");
    expect(iso("2026-10-01T14:30:00+02:00")).toBe("2026-10-01T12:30:00.000Z");
  });
  test("European format", () => {
    expect(iso("5.10.2026 08:15")).toBe("2026-10-05T08:15:00.000Z");
  });
  test("relative + keywords", () => {
    expect(iso("6h")).toBe("2026-10-05T06:00:00.000Z");
    expect(iso("2d")).toBe("2026-10-03T12:00:00.000Z");
    expect(iso("yesterday")).toBe("2026-10-04T00:00:00.000Z");
    expect(iso("today", { endOfDay: true })).toBe("2026-10-05T23:59:59.999Z");
  });
  test("discord timestamp", () => {
    expect(iso("<t:1759622400:f>")).toBe("2025-10-05T00:00:00.000Z");
  });
  test("rejects garbage + invalid dates", () => {
    expect(iso("tomorrow-ish")).toBeUndefined();
    expect(iso("2026-02-31")).toBeUndefined();
    expect(iso("2026-13-01")).toBeUndefined();
  });
});

describe("parseDate with timeZone", () => {
  const tz = { timeZone: "Europe/Bratislava" };
  test("wall-clock input uses the user's zone (CEST = UTC+2)", () => {
    expect(iso("2026-10-05 16:00", tz)).toBe("2026-10-05T14:00:00.000Z");
    expect(iso("05.10.2026 16:00", tz)).toBe("2026-10-05T14:00:00.000Z");
  });
  test("winter time (CET = UTC+1)", () => {
    expect(iso("2026-12-01 10:00", tz)).toBe("2026-12-01T09:00:00.000Z");
  });
  test("date-only + keywords respect the zone", () => {
    expect(iso("2026-10-05", tz)).toBe("2026-10-04T22:00:00.000Z");
    expect(iso("2026-10-05", { ...tz, endOfDay: true })).toBe("2026-10-05T21:59:59.999Z");
    expect(iso("today", tz)).toBe("2026-10-04T22:00:00.000Z");
  });
  test("explicit offset and relative inputs ignore the zone", () => {
    expect(iso("2026-10-05T16:00Z", tz)).toBe("2026-10-05T16:00:00.000Z");
    expect(iso("6h", tz)).toBe("2026-10-05T06:00:00.000Z");
  });
  test("validates zones", async () => {
    const { isValidTimeZone } = await import("../src/lib/dates");
    expect(isValidTimeZone("Europe/Bratislava")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
  });
});

describe("message ids and links", () => {
  // id 1424599010423279648 → (id >> 22) + discord epoch
  const id = "1424599010423279648";
  const expected = new Date(Number(BigInt(id) >> 22n) + 1_420_070_400_000).toISOString();
  test("bare message id resolves to its creation time (zone-independent)", () => {
    expect(iso(id)).toBe(expected);
    expect(iso(id, { timeZone: "Europe/Bratislava", endOfDay: true })).toBe(expected);
  });
  test("guild + DM message links", () => {
    expect(iso(`https://discord.com/channels/111111111111111111/222222222222222222/${id}`)).toBe(expected);
    expect(iso(`https://ptb.discord.com/channels/@me/222222222222222222/${id}`)).toBe(expected);
  });
  test("channel id is extracted from links only", async () => {
    const { linkChannelId } = await import("../src/lib/dates");
    expect(linkChannelId(`https://discord.com/channels/111111111111111111/222222222222222222/${id}`)).toBe("222222222222222222");
    expect(linkChannelId(id)).toBeUndefined();
    expect(linkChannelId("2026-10-05")).toBeUndefined();
  });
  test("future ids are rejected", () => {
    const future = ((BigInt(now + 86_400_000 - 1_420_070_400_000)) << 22n).toString();
    expect(iso(future)).toBeUndefined();
  });
});
