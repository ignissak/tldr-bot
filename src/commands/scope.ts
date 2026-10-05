import { ApplicationIntegrationType, InteractionContextType, type SlashCommandBuilder } from "discord.js";

/** Installable per user (follows them everywhere) or per server, usable in servers, bot DM and group DMs. */
export function everywhere<T extends Pick<SlashCommandBuilder, "setContexts" | "setIntegrationTypes">>(b: T): T {
  b.setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall);
  b.setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel);
  return b;
}
