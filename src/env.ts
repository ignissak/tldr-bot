import { z } from "zod";
import { isValidTimeZone } from "./lib/dates";

const snowflake = z.string().regex(/^\d{17,20}$/, "must be a Discord snowflake");

const schema = z.object({
  DISCORD_TOKEN: z.string().min(50),
  DISCORD_CLIENT_ID: snowflake,
  DEV_GUILD_ID: snowflake.optional().or(z.literal("").transform(() => undefined)),
  ENCRYPTION_KEY: z
    .string()
    .transform((v) => Buffer.from(v, "base64"))
    .refine((b) => b.length === 32, "must be 32 bytes, base64-encoded (bun run keygen)"),
  /** Used for /tldr dates when a user hasn't set /timezone. */
  DEFAULT_TIMEZONE: z.string().default("UTC").refine(isValidTimeZone, "must be an IANA zone, e.g. Europe/Bratislava"),
  DATABASE_PATH: z.string().default("./data/bot.db"),
  TLDR_MAX_MESSAGES: z.coerce.number().int().min(1).max(20_000).default(3000),
  TLDR_MAX_INPUT_CHARS: z.coerce.number().int().min(1000).max(2_000_000).default(200_000),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Only print field names + reasons, never values.
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    console.error(`Invalid environment:\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = load();
