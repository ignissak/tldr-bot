import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { open, seal } from "./lib/crypto";
import { DEFAULT_MODEL, isGeminiModel, type GeminiModel } from "./models";

interface UserRow {
  key_iv: Uint8Array | null;
  key_tag: Uint8Array | null;
  key_data: Uint8Array | null;
  model: string;
  timezone: string | null;
}

export interface UserSettings {
  apiKey: string | null;
  model: GeminiModel;
  /** IANA zone, null = not set. */
  timeZone: string | null;
}

export class Store {
  private readonly db: Database;
  private readonly q;

  constructor(path: string, private readonly encKey: Buffer) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path, { create: true, strict: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        user_id    TEXT PRIMARY KEY,
        key_iv     BLOB,
        key_tag    BLOB,
        key_data   BLOB,
        model      TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT
    `);
    // Migration: timezone column added after first release.
    const cols = this.db.query<{ name: string }, []>("PRAGMA table_info(users)").all();
    if (!cols.some((c) => c.name === "timezone")) this.db.run("ALTER TABLE users ADD COLUMN timezone TEXT");

    this.q = {
      get: this.db.query<UserRow, { id: string }>(
        "SELECT key_iv, key_tag, key_data, model, timezone FROM users WHERE user_id = $id",
      ),
      setKey: this.db.query<void, { id: string; iv: Uint8Array; tag: Uint8Array; data: Uint8Array; model: string; now: number }>(`
        INSERT INTO users (user_id, key_iv, key_tag, key_data, model, updated_at)
        VALUES ($id, $iv, $tag, $data, $model, $now)
        ON CONFLICT(user_id) DO UPDATE SET
          key_iv = excluded.key_iv, key_tag = excluded.key_tag,
          key_data = excluded.key_data, updated_at = excluded.updated_at
      `),
      clearKey: this.db.query<void, { id: string; now: number }>(
        "UPDATE users SET key_iv = NULL, key_tag = NULL, key_data = NULL, updated_at = $now WHERE user_id = $id",
      ),
      setModel: this.db.query<void, { id: string; model: string; now: number }>(`
        INSERT INTO users (user_id, model, updated_at) VALUES ($id, $model, $now)
        ON CONFLICT(user_id) DO UPDATE SET model = excluded.model, updated_at = excluded.updated_at
      `),
      setTimeZone: this.db.query<void, { id: string; tz: string | null; model: string; now: number }>(`
        INSERT INTO users (user_id, model, timezone, updated_at) VALUES ($id, $model, $tz, $now)
        ON CONFLICT(user_id) DO UPDATE SET timezone = excluded.timezone, updated_at = excluded.updated_at
      `),
    };
  }

  get(userId: string): UserSettings {
    const row = this.q.get.get({ id: userId });
    if (!row) return { apiKey: null, model: DEFAULT_MODEL, timeZone: null };
    const model = isGeminiModel(row.model) ? row.model : DEFAULT_MODEL;
    const timeZone = row.timezone;
    if (!row.key_iv || !row.key_tag || !row.key_data) return { apiKey: null, model, timeZone };
    try {
      const apiKey = open(this.encKey, { iv: row.key_iv, tag: row.key_tag, data: row.key_data }, userId);
      return { apiKey, model, timeZone };
    } catch {
      // Wrong ENCRYPTION_KEY or tampered row: treat as unlinked.
      return { apiKey: null, model, timeZone };
    }
  }

  setApiKey(userId: string, apiKey: string): void {
    const { iv, tag, data } = seal(this.encKey, apiKey, userId);
    const model = this.q.get.get({ id: userId })?.model ?? DEFAULT_MODEL;
    this.q.setKey.run({ id: userId, iv, tag, data, model, now: Date.now() });
  }

  clearApiKey(userId: string): boolean {
    return this.q.clearKey.run({ id: userId, now: Date.now() }).changes > 0;
  }

  setModel(userId: string, model: GeminiModel): void {
    this.q.setModel.run({ id: userId, model, now: Date.now() });
  }

  setTimeZone(userId: string, tz: string | null): void {
    this.q.setTimeZone.run({ id: userId, tz, model: DEFAULT_MODEL, now: Date.now() });
  }

  close(): void {
    this.db.close();
  }
}
