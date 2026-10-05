import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { GEMINI_MODELS, isGeminiModel } from "../models";
import { everywhere } from "./scope";
import type { Command } from "./types";

const builder = everywhere(new SlashCommandBuilder())
  .setName("model")
  .setDescription("Choose which Gemini model /tldr uses for you");
builder.addStringOption((o) =>
  o
    .setName("gemini_model")
    .setDescription("Gemini model")
    .setRequired(true)
    .addChoices(...GEMINI_MODELS.map((m) => ({ name: m, value: m }))),
);

export const model: Command = {
  data: builder.toJSON(),

  async execute(interaction, { store }) {
    const choice = interaction.options.getString("gemini_model", true);
    // Choices are enforced by Discord, but never trust client input.
    if (!isGeminiModel(choice)) {
      await interaction.reply({ content: "❌ Unknown model.", flags: MessageFlags.Ephemeral });
      return;
    }
    store.setModel(interaction.user.id, choice);
    await interaction.reply({ content: `✅ /tldr will now use \`${choice}\`.`, flags: MessageFlags.Ephemeral });
  },
};
