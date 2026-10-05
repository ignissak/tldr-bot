import { gemini } from "./gemini";
import { model } from "./model";
import { timezone } from "./timezone";
import { tldr } from "./tldr";
import type { Command } from "./types";

export const commands: ReadonlyMap<string, Command> = new Map(
  [gemini, model, timezone, tldr].map((c) => [c.data.name, c]),
);
