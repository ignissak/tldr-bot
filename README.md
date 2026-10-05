# tldr-discord-bot

Discord bot that summarizes channel history with Google Gemini. Each user brings their own AI Studio API key.
Built with TypeScript, Bun, discord.js, and SQLite (`bun:sqlite`).

## Commands

| Command | Description |
|---|---|
| `/gemini link token:<key>` | Link your Gemini API key. The key is verified first and stored encrypted. Replies are ephemeral. |
| `/gemini unlink` | Delete your stored key. |
| `/model gemini_model:<model>` | Choose `gemini-3.1-flash-lite` (default), `gemini-3.5-flash-lite` or `gemini-3.8-flash`. |
| `/timezone [zone]` | Set the IANA timezone used to read your `/tldr` dates, e.g. `Europe/Bratislava` (autocompletes). Leave `zone` empty to show your current setting. |
| `/tldr start_date:<date> [end_date] [users] [private]` | Summarize this channel between two dates. `users` takes one or more @mentions. `end_date` defaults to now. |

Dates are read in your `/timezone`. If you haven't set one, `DEFAULT_TIMEZONE` is used (default UTC). Formats: `2026-10-05`, `2026-10-05 14:30`, `2026-10-05T14:30+02:00`, `05.10.2026 14:30`, `6h`, `2d`, `1w`, `today`, `yesterday`, `<t:unix>`.
If `end_date` is a date with no time, it means the end of that day.

Settings belong to the **user**, not the server: your key and model follow you everywhere.

## Setup

1. Create an app at https://discord.com/developers/applications
   - **Bot** → enable the **Message Content Intent** (privileged).
   - **Installation** → enable **User Install** and **Guild Install**.
     - Guild Install scopes: `applications.commands`, `bot`. Permissions: View Channels, Read Message History.
     - User Install scope: `applications.commands`.
2. Run `cp .env.example .env` and fill it in. Generate `ENCRYPTION_KEY` with `bun run keygen`.
3. Run `bun install`, then `bun run deploy` to register the commands, then `bun start`.
4. Add the bot. On startup it prints two links (replace `CLIENT_ID` below with your Application ID):
   - **To a server** (lets `/tldr` read that server's channels). You need *Manage Server* there:
     `https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot+applications.commands&permissions=66560&integration_type=0`
   - **To your account** (commands follow you everywhere):
     `https://discord.com/oauth2/authorize?client_id=CLIENT_ID&integration_type=1&scope=applications.commands`

> User-install commands only exist when commands are registered **globally**, so leave `DEV_GUILD_ID` empty.
> A guild-scoped registration is only for quick testing in one server.

### Docker

```sh
docker compose build
docker compose run --rm bot bun run deploy   # register slash commands once
docker compose up -d
```

The SQLite DB lives in the `bot-data` volume. The container runs as a non-root user with a read-only root filesystem, no Linux capabilities, and `no-new-privileges`.

### Where `/tldr` works

Discord only lets a bot read message history in channels where the **bot itself is a member**. With a user install, you can run `/tldr` anywhere. It can only read history in servers that also have the bot added, and in your DMs with the bot. Anywhere else it replies with an explanation.

## Free-of-charge Gemini usage

The Gemini API has no per-request "free" switch. The **API key's Google Cloud project** decides whether you are billed:

- Create the key at https://aistudio.google.com/apikey in a project **without billing enabled**. All calls then run on the **free tier**, with no charges and lower rate limits.
- The bot is built to stay inside free-tier limits. It makes one `generateContent` call per `/tldr`, uses the default service tier, and uses no paid-only features (no context caching, batch, or priority tier). Thinking is set to `MINIMAL`. If you hit a rate limit (HTTP 429), the bot shows a friendly message instead of retrying in a loop.
- ⚠️ On the free tier, Google may use prompts to improve its products. Those prompts are the chat messages being summarized. Tell your community, or use a billed key if that is a concern.

## Keeping LLM input small

Messages are turned into a compact transcript before they are sent:

```
#2026-10-05
14:03 alice: deploy is broken | rolling back
bob>alice: what broke? [img]
14:41 carol: fixed, see [github.com]
```

- The date header appears only when the day changes. `HH:MM` appears only after a gap of 20 minutes or more.
- Consecutive messages from the same author are merged into one line.
- A reply is shown as `a>b`.
- Mentions, emoji, and timestamps become short text. A URL becomes just its domain. Markdown markup is stripped.
- Bot and system messages are skipped. Long messages (600 characters) and code blocks (200 characters) are truncated.
- Two hard caps apply: `TLDR_MAX_MESSAGES` (default 3000) and `TLDR_MAX_INPUT_CHARS` (default 200k). When a cap is hit, the newest messages are kept.
- The system prompt is short, and the output is capped at 1024 tokens.

## Security

- **API keys are encrypted at rest** with AES-256-GCM. The Discord user ID is used as AAD, so a database row copied to another user fails to decrypt.
- Keys are checked against Gemini (`models.list`, which uses no tokens) before they are stored. Key-related replies are always ephemeral.
- Raw Gemini error bodies are never shown to users, and option values are never logged.
- `/tldr` checks that the **invoker** has View Channel and Read Message History, so it can't be used to read hidden history.
- Bot output disables all mentions (`allowedMentions: { parse: [] }`), so LLM output can't ping `@everyone`.
- Each user can run one `/tldr` at a time, with a 30 s cooldown. At most 5 summaries run at once across the whole bot.
- Errors go only to the invoker, as ephemeral messages.
- Environment variables are checked with zod at startup.
- The SQLite tables are `STRICT`, and all queries use prepared statements.

## Development

```sh
bun run dev        # watch mode
bun test           # unit tests
bun run typecheck
```
