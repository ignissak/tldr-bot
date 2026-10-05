import {
  DiscordAPIError,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type TextBasedChannel,
} from "discord.js";
import { discordTs, linkChannelId, parseDate } from "../lib/dates";
import { fetchRange } from "../lib/fetch-messages";
import { Limiter } from "../lib/limits";
import { formatLlmError, LlmError, summarize } from "../lib/llm";
import { buildTranscript } from "../lib/transcript";
import { everywhere } from "./scope";
import type { Command, Context } from "./types";

const DATE_HELP =
  "2026-10-05, 2026-10-05 14:30, 05.10.2026, 6h, 2d, yesterday (in your /timezone), a message ID or a message link";
const OPTION_HELP = "date/time, 6h, 2d, message ID or link";
const MAX_AUTHORS = 25;
const PROGRESS_INTERVAL_MS = 2000;
const REQUIRED_PERMS = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory;

const limiter = new Limiter(30_000, 5);

const builder = everywhere(new SlashCommandBuilder())
  .setName("tldr")
  .setDescription("Summarize this channel's messages in a time range");
builder
  .addStringOption((o) => o.setName("start_date").setDescription(`From: ${OPTION_HELP}`).setRequired(true).setMaxLength(120))
  .addStringOption((o) => o.setName("end_date").setDescription(`To, default now: ${OPTION_HELP}`).setMaxLength(120))
  .addStringOption((o) => o.setName("users").setDescription("Only these users: @mention one or more").setMaxLength(1500))
  .addBooleanOption((o) => o.setName("private").setDescription("Only you see the summary (default: false)"));

/** Extracts unique user ids from "<@123> <@!456> 789". */
export function parseUserIds(input: string | null): Set<string> {
  const ids = new Set<string>();
  if (!input) return ids;
  for (const m of input.matchAll(/<@!?(\d{17,20})>|\b(\d{17,20})\b/g)) ids.add((m[1] ?? m[2])!);
  return ids;
}

async function resolveChannel(i: ChatInputCommandInteraction): Promise<TextBasedChannel | string> {
  const cantRead =
    "I can't read this channel's history. Discord only lets me read messages where the bot is a member — " +
    "add the bot to this server (or use it in a server where it is installed).";
  try {
    const channel = await i.client.channels.fetch(i.channelId);
    if (!channel?.isTextBased()) return "This channel type isn't supported.";
    if (!channel.isDMBased()) {
      const perms = channel.permissionsFor(i.client.user);
      if (!perms?.has(REQUIRED_PERMS)) return "I need **View Channel** and **Read Message History** here.";
    }
    return channel;
  } catch (err) {
    if (err instanceof DiscordAPIError && [10003, 50001, 50013].includes(Number(err.code))) return cantRead;
    throw err;
  }
}

export const tldr: Command = {
  data: builder.toJSON(),

  async execute(interaction, ctx) {
    const isPrivate = interaction.options.getBoolean("private") ?? false;

    // The invoker must be allowed to read history here, otherwise /tldr would leak it.
    if (interaction.memberPermissions && !interaction.memberPermissions.has(REQUIRED_PERMS)) {
      await interaction.reply({ content: "❌ You need Read Message History in this channel.", flags: MessageFlags.Ephemeral });
      return;
    }

    const { apiKey, model, timeZone: userTz } = ctx.store.get(interaction.user.id);
    const timeZone = userTz ?? ctx.env.DEFAULT_TIMEZONE;
    const now = Date.now();
    const startRaw = interaction.options.getString("start_date", true);
    const endRaw = interaction.options.getString("end_date");
    const foreign = [startRaw, endRaw].find((r) => r && (linkChannelId(r) ?? interaction.channelId) !== interaction.channelId);
    if (foreign) {
      return void (await interaction.reply({
        content: "❌ That message link points to a different channel. Run /tldr in the linked message's channel.",
        flags: MessageFlags.Ephemeral,
      }));
    }
    const start = parseDate(startRaw, { now, timeZone });
    const parsedEnd = endRaw ? parseDate(endRaw, { now, timeZone, endOfDay: true }) : new Date(now);
    const fail = (content: string) => interaction.reply({ content: `❌ ${content}`, flags: MessageFlags.Ephemeral });

    if (!start) return void (await fail(`Can't parse \`start_date\`. Formats: ${DATE_HELP}.`));
    if (!parsedEnd) return void (await fail(`Can't parse \`end_date\`. Formats: ${DATE_HELP}.`));
    const end = new Date(Math.min(parsedEnd.getTime(), now));
    if (start.getTime() >= end.getTime()) {
      const tzHint = userTz ? "" : ` Dates are read as \`${timeZone}\` — set yours with \`/timezone\`.`;
      return void (await fail(`\`start_date\` (${discordTs(start)}) must be before \`end_date\` (${discordTs(end)}).${tzHint}`));
    }

    const authors = parseUserIds(interaction.options.getString("users"));
    if (authors.size > MAX_AUTHORS) return void (await fail(`At most ${MAX_AUTHORS} users.`));

    if (!apiKey) return void (await fail("Link your Gemini API key first: `/gemini link`."));

    const release = limiter.acquire(interaction.user.id);
    if (typeof release === "string") return void (await fail(release));

    try {
      await interaction.deferReply(isPrivate ? { flags: MessageFlags.Ephemeral } : {});
      await run(interaction, ctx, { apiKey, model, start, end, authors, isPrivate });
    } finally {
      release();
    }
  },
};

interface RunArgs {
  apiKey: string;
  model: Parameters<typeof summarize>[1];
  start: Date;
  end: Date;
  authors: Set<string>;
  isPrivate: boolean;
}

async function run(i: ChatInputCommandInteraction, { env }: Context, a: RunArgs): Promise<void> {
  // Errors go to the invoker only: drop the public "thinking…" message and follow up ephemerally.
  const fail = async (msg: string) => {
    if (a.isPrivate) {
      await i.editReply({ content: `❌ ${msg}`, embeds: [] });
    } else {
      await i.deleteReply().catch(() => {});
      await i.followUp({ content: `❌ ${msg}`, flags: MessageFlags.Ephemeral });
    }
  };

  const channel = await resolveChannel(i);
  if (typeof channel === "string") return fail(channel);

  const range = `${discordTs(a.start)} → ${discordTs(a.end)}`;
  let lastProgress = 0;
  const fetched = await fetchRange(channel, {
    start: a.start,
    end: a.end,
    authors: a.authors,
    maxMessages: env.TLDR_MAX_MESSAGES,
    maxScanned: env.TLDR_MAX_MESSAGES * 5,
    onProgress: (scanned, matched) => {
      if (Date.now() - lastProgress < PROGRESS_INTERVAL_MS) return;
      lastProgress = Date.now();
      i.editReply(`⏳ Reading messages… ${scanned} scanned, ${matched} matched`).catch(() => {});
    },
  });

  const transcript = buildTranscript(fetched.messages, { maxChars: env.TLDR_MAX_INPUT_CHARS });
  if (transcript.included === 0) {
    const hint = fetched.scanned > 0 && a.authors.size === 0
      ? " (If the channel has messages, the bot may lack the Message Content intent.)"
      : "";
    return fail(`No messages found in ${range}.${hint}`);
  }

  await i.editReply(`🧠 Summarizing ${transcript.included} messages with \`${a.model}\`…`);

  let summary;
  try {
    summary = await summarize(a.apiKey, a.model, transcript.text);
  } catch (err) {
    const e = err instanceof LlmError ? err : new LlmError("Summarization failed.");
    console.warn(`[tldr] user=${i.user.id} model=${a.model} chars=${transcript.text.length} status=${e.status ?? "-"}: ${e.message}`);
    return fail(formatLlmError(e));
  }

  const omitted = transcript.dropped + (fetched.capped ? 1 : 0) > 0
    ? " · ⚠️ limit reached, only newest messages used"
    : "";
  const tokens = summary.inputTokens ? ` · ${summary.inputTokens}→${summary.outputTokens ?? "?"} tokens` : "";
  const who = a.authors.size ? ` · from ${[...a.authors].map((id) => `<@${id}>`).join(" ")}` : "";

  await i.editReply({
    content: `**TL;DR** ${range}${who}`,
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setDescription(summary.text.length > 4096 ? `${summary.text.slice(0, 4095)}…` : summary.text)
        .setFooter({
          text: `${transcript.included} messages · ${transcript.participants} people · ${a.model}${tokens}${omitted}`.slice(0, 2048),
        }),
    ],
    allowedMentions: { parse: [] },
  });
}
