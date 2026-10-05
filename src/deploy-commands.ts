import { REST, Routes } from "discord.js";
import { commands } from "./commands";
import { env } from "./env";

const rest = new REST().setToken(env.DISCORD_TOKEN);
const body = [...commands.values()].map((c) => c.data);

const route = env.DEV_GUILD_ID
  ? Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DEV_GUILD_ID)
  : Routes.applicationCommands(env.DISCORD_CLIENT_ID);

await rest.put(route, { body });
console.log(`Registered ${body.length} commands ${env.DEV_GUILD_ID ? `to guild ${env.DEV_GUILD_ID}` : "globally"}.`);
