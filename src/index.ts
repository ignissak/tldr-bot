import { Client, Events, GatewayIntentBits, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { commands } from "./commands";
import type { Context } from "./commands/types";
import { Store } from "./db";
import { env } from "./env";

const store = new Store(env.DATABASE_PATH, env.ENCRYPTION_KEY);
const ctx: Context = { env, store };

const client = new Client({
  // MessageContent is privileged: enable it in the Developer Portal.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  // Never ping anyone from bot output (LLM text could contain @everyone etc.).
  allowedMentions: { parse: [] },
});

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  // View Channels (1024) + Read Message History (65536); integration_type=0 = server install.
  console.log(`Add to server: https://discord.com/oauth2/authorize?client_id=${env.DISCORD_CLIENT_ID}&scope=bot+applications.commands&permissions=66560&integration_type=0`);
  console.log(`Add to your account: https://discord.com/oauth2/authorize?client_id=${env.DISCORD_CLIENT_ID}&integration_type=1&scope=applications.commands`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    await commands.get(interaction.commandName)?.autocomplete?.(interaction, ctx).catch(() => {});
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const command = commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, ctx);
  } catch (err) {
    // Log name/message only: option values (API keys) must never reach logs.
    const e = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`/${interaction.commandName} failed for ${interaction.user.id}: ${e}`);
    await replyError(interaction).catch(() => {});
  }
});

async function replyError(i: ChatInputCommandInteraction) {
  const content = "❌ Something went wrong. Please try again.";
  if (i.deferred || i.replied) await i.followUp({ content, flags: MessageFlags.Ephemeral });
  else await i.reply({ content, flags: MessageFlags.Ephemeral });
}

const shutdown = async () => {
  await client.destroy();
  store.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await client.login(env.DISCORD_TOKEN);
