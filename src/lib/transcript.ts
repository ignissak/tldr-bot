/**
 * Turns Discord messages into the most token-frugal transcript that still
 * reads naturally to an LLM:
 *
 *   #2026-10-05
 *   14:03 alice: deploy is broken | rolling back now
 *   bob>alice: what broke? [img]
 *   14:41 carol: fixed [github.com]
 *
 * - day header only when the date changes, HH:MM only after a >=20min gap
 * - consecutive messages by the same author (<5min apart) merged with " | "
 * - "a>b:" marks a reply from a to b
 * - mentions/emoji/timestamps resolved to short text, URLs reduced to domain
 * - long messages and code blocks truncated
 */

export interface SourceMessage {
  id: string;
  authorId: string;
  authorName: string;
  createdAt: number;
  content: string;
  /** Resolved names for <@id>, <@&id>, <#id> tokens in content. */
  users: ReadonlyMap<string, string>;
  roles: ReadonlyMap<string, string>;
  channels: ReadonlyMap<string, string>;
  attachments: readonly ("img" | "vid" | "audio" | "file")[];
  stickers: number;
  replyToAuthorId?: string;
}

export interface TranscriptOptions {
  maxChars: number;
  maxMessageChars?: number;
}

export interface Transcript {
  text: string;
  /** Messages represented in text. */
  included: number;
  /** Older messages dropped to fit maxChars. */
  dropped: number;
  participants: number;
}

const TIME_GAP_MS = 20 * 60_000;
const MERGE_GAP_MS = 5 * 60_000;
const MAX_CODE_CHARS = 200;

export function sanitizeName(name: string): string {
  const clean = name.replace(/[\s:>|#@`*_~]+/g, " ").trim().slice(0, 24).trim();
  return clean || "user";
}

/** Unique, sanitized short name per author id. */
function buildAliases(messages: readonly SourceMessage[]): Map<string, string> {
  const aliases = new Map<string, string>();
  const taken = new Set<string>();
  for (const m of messages) {
    if (aliases.has(m.authorId)) continue;
    const base = sanitizeName(m.authorName);
    let alias = base;
    for (let n = 2; taken.has(alias.toLowerCase()); n++) alias = `${base}${n}`;
    taken.add(alias.toLowerCase());
    aliases.set(m.authorId, alias);
  }
  return aliases;
}

export function cleanContent(m: SourceMessage, aliases: ReadonlyMap<string, string>, maxChars: number): string {
  let s = m.content
    .replace(/```[a-z0-9+-]*\n?([\s\S]*?)```/gi, (_, code: string) => {
      const c = code.trim();
      return `\`${c.length > MAX_CODE_CHARS ? `${c.slice(0, MAX_CODE_CHARS)}…` : c}\``;
    })
    .replace(/<@!?(\d+)>/g, (_, id: string) => `@${aliases.get(id) ?? sanitizeName(m.users.get(id) ?? "user")}`)
    .replace(/<@&(\d+)>/g, (_, id: string) => `@${sanitizeName(m.roles.get(id) ?? "role")}`)
    .replace(/<#(\d+)>/g, (_, id: string) => `#${m.channels.get(id) ?? "channel"}`)
    .replace(/<a?:(\w+):\d+>/g, ":$1:")
    .replace(/<t:(\d+)(?::\w)?>/g, (_, t: string) => new Date(Number(t) * 1000).toISOString().slice(0, 16).replace("T", " "))
    .replace(/<?https?:\/\/(?:www\.)?([^/\s>?#]+)[^\s>]*>?/gi, "[$1]")
    .replace(/\|\|([\s\S]*?)\|\|/g, "$1") // spoilers
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2") // bold/underline/strike markup
    .replace(/^\s*>+ ?/gm, "") // quote markers
    .replace(/\s*\n+\s*/g, " / ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (s.length > maxChars) s = `${s.slice(0, maxChars)}…`;

  const extras = [...m.attachments.map((a) => `[${a}]`), ...(m.stickers ? ["[sticker]"] : [])];
  return [s, ...extras].filter(Boolean).join(" ");
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const hhmm = (t: number) => new Date(t).toISOString().slice(11, 16);

/** `messages` may be in any order; output is chronological. */
export function buildTranscript(messages: readonly SourceMessage[], opts: TranscriptOptions): Transcript {
  const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt);
  const aliases = buildAliases(sorted);
  const maxMsg = opts.maxMessageChars ?? 600;

  // Each entry is one output line plus how many messages it represents.
  const lines: { text: string; count: number; dayHeader?: string }[] = [];
  let prev: { authorId: string; at: number; reply?: string } | undefined;
  let lastStamp = -Infinity;
  let lastDay = "";

  for (const m of sorted) {
    const body = cleanContent(m, aliases, maxMsg);
    if (!body) continue;

    const author = aliases.get(m.authorId)!;
    const reply = m.replyToAuthorId && m.replyToAuthorId !== m.authorId ? aliases.get(m.replyToAuthorId) ?? "user" : undefined;
    const d = day(m.createdAt);
    const last = lines.at(-1);

    if (last && prev && d === lastDay && prev.authorId === m.authorId && !reply && m.createdAt - prev.at < MERGE_GAP_MS) {
      last.text += ` | ${body}`;
      last.count++;
      prev.at = m.createdAt;
      continue;
    }

    const newDay = d !== lastDay;
    const stamp = newDay || m.createdAt - lastStamp >= TIME_GAP_MS ? `${hhmm(m.createdAt)} ` : "";
    if (stamp) lastStamp = m.createdAt;
    lastDay = d;

    lines.push({
      text: `${stamp}${author}${reply ? `>${reply}` : ""}: ${body}`,
      count: 1,
      dayHeader: newDay ? `#${d}` : undefined,
    });
    prev = { authorId: m.authorId, at: m.createdAt };
  }

  // Keep the newest lines that fit the budget.
  let size = 0;
  let start = lines.length;
  while (start > 0) {
    const l = lines[start - 1]!;
    const cost = l.text.length + 1 + (l.dayHeader ? l.dayHeader.length + 1 : 0);
    if (size + cost > opts.maxChars) break;
    size += cost;
    start--;
  }

  const kept = lines.slice(start);
  const out: string[] = [];
  let curDay = "";
  for (const [i, l] of kept.entries()) {
    // First kept line always needs its date, even if it wasn't a new day originally.
    const lineDay = l.dayHeader ?? (i === 0 ? findDay(lines, start) : undefined);
    if (lineDay && lineDay !== curDay) {
      out.push(lineDay);
      curDay = lineDay;
    }
    out.push(l.text);
  }

  const included = kept.reduce((n, l) => n + l.count, 0);
  const total = lines.reduce((n, l) => n + l.count, 0);
  const participants = new Set(sorted.map((m) => m.authorId)).size;
  return { text: out.join("\n"), included, dropped: total - included, participants };
}

function findDay(lines: readonly { dayHeader?: string }[], idx: number): string | undefined {
  for (let i = idx; i >= 0; i--) if (lines[i]?.dayHeader) return lines[i]!.dayHeader;
  return undefined;
}
