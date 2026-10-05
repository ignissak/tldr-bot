import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { formatLlmError, LlmError, verifyApiKey } from "../lib/llm";
import { everywhere } from "./scope";
import type { Command } from "./types";

// Loose sanity check only (printable ASCII, no whitespace, so it is safe as an HTTP header).
// Gemini itself is the real validator: see verifyApiKey below.
const KEY_RE = /^[\x21-\x7E]{20,256}$/;

const builder = everywhere(new SlashCommandBuilder())
  .setName("gemini")
  .setDescription("Manage your Gemini (Google AI Studio) API key");
builder.addSubcommand((s) =>
  s
    .setName("link")
    .setDescription("Link your Gemini API key (only you see this)")
    .addStringOption((o) =>
      o.setName("token").setDescription("API key from aistudio.google.com/apikey").setRequired(true).setMinLength(20).setMaxLength(256),
    ),
);
builder.addSubcommand((s) => s.setName("unlink").setDescription("Delete your stored Gemini API key"));

export const gemini: Command = {
  data: builder.toJSON(),

  async execute(interaction, { store }) {
    // Every reply here is ephemeral: never echo anything key-related publicly.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const userId = interaction.user.id;

    if (interaction.options.getSubcommand() === "unlink") {
      const removed = store.clearApiKey(userId);
      await interaction.editReply(removed ? "🗑️ Your Gemini API key was deleted." : "You have no linked key.");
      return;
    }

    const token = interaction.options.getString("token", true).trim();
    if (!KEY_RE.test(token)) {
      await interaction.editReply("❌ That doesn't look like a Gemini API key.");
      return;
    }

    try {
      await verifyApiKey(token);
    } catch (err) {
      const e = err instanceof LlmError ? err : new LlmError("Couldn't verify the key.");
      console.warn(`[gemini link] user=${userId} status=${e.status ?? "-"}: ${e.message}`);
      await interaction.editReply(`❌ ${formatLlmError(e)}`);
      return;
    }

    store.setApiKey(userId, token);
    await interaction.editReply(
      [
        "✅ Gemini API key linked to your account and stored encrypted.",
        "-# Free of charge: use a key from a Google AI Studio project **without billing enabled** — requests then run on Gemini's free tier (lower rate limits).",
        "-# Note: on the free tier Google may use prompts (i.e. the summarized chat) to improve its products.",
      ].join("\n"),
    );
  },
};
