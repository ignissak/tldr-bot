import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import type { Env } from "../env";
import type { Store } from "../db";

export interface Context {
  env: Env;
  store: Store;
}

export interface Command {
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute(interaction: ChatInputCommandInteraction, ctx: Context): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction, ctx: Context): Promise<void>;
}
