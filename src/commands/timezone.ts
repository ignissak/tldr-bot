import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { isValidTimeZone, zoneOffset } from "../lib/dates";
import { everywhere } from "./scope";
import type { Command } from "./types";

const ZONES = ["UTC", ...Intl.supportedValuesOf("timeZone").filter((z) => z !== "UTC")];

function label(tz: string, now = Date.now()): string {
  const off = zoneOffset(tz, now) / 60_000;
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  return `${tz} (UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")})`;
}

const builder = everywhere(new SlashCommandBuilder())
  .setName("timezone")
  .setDescription("Set the timezone /tldr uses to read your dates");
builder.addStringOption((o) =>
  o.setName("zone").setDescription("e.g. Europe/Bratislava (leave empty to show current)").setAutocomplete(true).setMaxLength(64),
);

export const timezone: Command = {
  data: builder.toJSON(),

  async autocomplete(interaction) {
    const q = interaction.options.getFocused().toLowerCase().replace(/\s+/g, "_");
    const hits = ZONES.filter((z) => z.toLowerCase().includes(q)).slice(0, 25);
    await interaction.respond(hits.map((z) => ({ name: label(z), value: z })));
  },

  async execute(interaction, { store, env }) {
    const zone = interaction.options.getString("zone")?.trim();
    const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

    if (!zone) {
      const current = store.get(interaction.user.id).timeZone;
      return void (await reply(
        current ? `Your timezone: \`${label(current)}\`.` : `No timezone set — using default \`${label(env.DEFAULT_TIMEZONE)}\`.`,
      ));
    }
    if (!isValidTimeZone(zone)) return void (await reply("❌ Unknown timezone. Pick one from the list, e.g. `Europe/Bratislava`."));

    // Store the canonical spelling (input may differ in case).
    const canonical = new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
    store.setTimeZone(interaction.user.id, canonical);
    await reply(`✅ /tldr dates are now read as \`${label(canonical)}\`.`);
  },
};
