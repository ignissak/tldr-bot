import { SnowflakeUtil, type Message, type TextBasedChannel } from "discord.js";
import type { SourceMessage } from "./transcript";

export interface FetchOptions {
  start: Date;
  end: Date;
  /** Only keep messages by these user ids (empty = everyone). */
  authors: ReadonlySet<string>;
  /** Stop after this many matching messages (newest kept). */
  maxMessages: number;
  /** Stop after scanning this many messages regardless of matches. */
  maxScanned: number;
  onProgress?: (scanned: number, matched: number) => void;
}

export interface FetchResult {
  messages: SourceMessage[];
  scanned: number;
  /** True if a cap stopped us before reaching `start`. */
  capped: boolean;
}

const PAGE = 100;

/** Pages backwards from `end` to `start`, 100 per request, without caching. */
export async function fetchRange(
  channel: TextBasedChannel,
  opts: FetchOptions,
): Promise<FetchResult> {
  const startMs = opts.start.getTime();
  let before = SnowflakeUtil.generate({ timestamp: opts.end.getTime() + 1 }).toString();
  const messages: SourceMessage[] = [];
  let scanned = 0;

  while (true) {
    const page = await channel.messages.fetch({ limit: PAGE, before, cache: false });
    if (page.size === 0) return { messages, scanned, capped: false };

    for (const m of page.values()) {
      if (m.createdTimestamp < startMs) return { messages, scanned, capped: false };
      scanned++;
      if (!keep(m, opts.authors)) continue;
      messages.push(toSource(m));
      if (messages.length >= opts.maxMessages) return { messages, scanned, capped: true };
    }

    opts.onProgress?.(scanned, messages.length);
    if (scanned >= opts.maxScanned) return { messages, scanned, capped: true };
    if (page.size < PAGE) return { messages, scanned, capped: false };
    before = page.lastKey()!;
  }
}

function keep(m: Message, authors: ReadonlySet<string>): boolean {
  if (m.system || m.author.bot) return false;
  if (authors.size > 0 && !authors.has(m.author.id)) return false;
  return m.content.length > 0 || m.attachments.size > 0 || m.stickers.size > 0;
}

function toSource(m: Message): SourceMessage {
  return {
    id: m.id,
    authorId: m.author.id,
    authorName: m.member?.displayName ?? m.author.displayName,
    createdAt: m.createdTimestamp,
    content: m.content,
    users: new Map(m.mentions.users.map((u) => [u.id, u.displayName])),
    roles: new Map(m.mentions.roles.map((r) => [r.id, r.name])),
    channels: new Map(
      m.mentions.channels.map((c) => [c.id, "name" in c && typeof c.name === "string" ? c.name : "channel"]),
    ),
    attachments: m.attachments.map((a) => {
      const t = a.contentType ?? "";
      return t.startsWith("image/") ? "img" : t.startsWith("video/") ? "vid" : t.startsWith("audio/") ? "audio" : "file";
    }),
    stickers: m.stickers.size,
    replyToAuthorId: m.reference ? m.mentions.repliedUser?.id : undefined,
  };
}
