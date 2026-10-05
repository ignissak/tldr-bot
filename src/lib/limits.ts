/** In-memory per-user cooldown + single-flight, plus a global concurrency cap. */
export class Limiter {
  private readonly lastRun = new Map<string, number>();
  private readonly running = new Set<string>();

  constructor(private readonly cooldownMs: number, private readonly maxConcurrent: number) {}

  /** Returns a release fn, or a reason string if the user must wait. */
  acquire(userId: string, now = Date.now()): (() => void) | string {
    if (this.running.has(userId)) return "You already have a summary in progress.";
    const last = this.lastRun.get(userId);
    const wait = last === undefined ? 0 : last + this.cooldownMs - now;
    if (wait > 0) return `Slow down — try again in ${Math.ceil(wait / 1000)}s.`;
    if (this.running.size >= this.maxConcurrent) return "The bot is busy right now. Try again in a moment.";

    this.running.add(userId);
    this.lastRun.set(userId, now);
    return () => this.running.delete(userId);
  }
}
