const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 } as const;
const DAY_MS = UNIT_MS.d;

export interface ParseOptions {
  /** Date-only inputs resolve to 23:59:59.999 instead of 00:00. */
  endOfDay?: boolean;
  now?: number;
  /** IANA zone for wall-clock inputs without an explicit offset. Default UTC. */
  timeZone?: string;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Offset of `tz` from UTC at instant `ts`, in ms (e.g. +2h for CEST). */
export function zoneOffset(tz: string, ts: number): number {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(ts).map((x) => [x.type, Number(x.value)]));
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** Wall-clock time in `tz` (given as a UTC-encoded ms value) → real UTC instant. */
function fromWallClock(wall: number, tz: string): number {
  let ts = wall - zoneOffset(tz, wall);
  // Second pass corrects instants near DST transitions.
  ts = wall - zoneOffset(tz, ts);
  return ts;
}

/**
 * Accepts (wall-clock inputs use `timeZone`, default UTC):
 *   now | today | yesterday
 *   30m | 6h | 2d | 1w            (relative, "ago")
 *   2026-10-05 [14:30[:00]]       ISO-ish, also with T and Z/±hh:mm
 *   05.10.2026 [14:30]            European
 *   1759622400 | <t:1759622400:f> unix seconds / Discord timestamp
 */
export function parseDate(raw: string, opts: ParseOptions = {}): Date | null {
  const now = opts.now ?? Date.now();
  const tz = opts.timeZone ?? "UTC";
  const input = raw.trim().toLowerCase();

  const todayWall = Math.floor((now + zoneOffset(tz, now)) / DAY_MS) * DAY_MS;
  const dayEdge = (wallStart: number) =>
    new Date(fromWallClock(opts.endOfDay ? wallStart + DAY_MS - 1 : wallStart, tz));

  if (input === "now") return new Date(now);
  if (input === "today") return dayEdge(todayWall);
  if (input === "yesterday") return dayEdge(todayWall - DAY_MS);

  let m = /^(\d{1,4})\s*([mhdw])$/.exec(input);
  if (m) return new Date(now - Number(m[1]) * UNIT_MS[m[2] as keyof typeof UNIT_MS]);

  m = /^(?:<t:)?(\d{9,11})(?::[a-z])?>?$/i.exec(input);
  if (m) return new Date(Number(m[1]) * 1000);

  // ISO-ish
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{2}):(\d{2})(?::(\d{2}))?(z|[+-]\d{2}:?\d{2})?)?$/.exec(input);
  if (m) return build(m[1], m[2], m[3], m[4], m[5], m[6], m[7], tz, opts.endOfDay);

  // DD.MM.YYYY [HH:mm]
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(input);
  if (m) return build(m[3], m[2], m[1], m[4], m[5], undefined, undefined, tz, opts.endOfDay);

  return null;
}

function build(
  y: string | undefined, mo: string | undefined, d: string | undefined,
  h: string | undefined, mi: string | undefined, s: string | undefined,
  offset: string | undefined, tz: string, endOfDay = false,
): Date | null {
  const year = Number(y), month = Number(mo), day = Number(d);
  const hasTime = h !== undefined;
  const hour = Number(h ?? 0), min = Number(mi ?? 0), sec = Number(s ?? 0);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || min > 59 || sec > 59) return null;

  let wall = Date.UTC(year, month - 1, day, hour, min, sec);
  // Reject rollovers like 2026-02-31.
  if (new Date(wall).getUTCDate() !== day) return null;
  if (!hasTime && endOfDay) wall += DAY_MS - 1;

  // Explicit offset in the input wins over the user's zone.
  if (offset === "z") return new Date(wall);
  if (offset) {
    const t = /^([+-])(\d{2}):?(\d{2})$/.exec(offset)!;
    const off = (Number(t[2]) * 60 + Number(t[3])) * 60_000;
    return new Date(t[1] === "+" ? wall - off : wall + off);
  }
  return new Date(fromWallClock(wall, tz));
}

/** Discord renders this in each viewer's local timezone. */
export const discordTs = (d: Date, style: "f" | "R" | "d" = "f") =>
  `<t:${Math.floor(d.getTime() / 1000)}:${style}>`;
