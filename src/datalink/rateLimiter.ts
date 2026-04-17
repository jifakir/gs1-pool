export async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export class MinuteRateLimiter {
  private readonly timestamps: number[] = [];

  constructor(private readonly maxPerMinute: number) {}

  async throttle(): Promise<void> {
    const now = Date.now();
    const windowStart = now - 60_000;
    while (this.timestamps.length > 0 && this.timestamps[0]! < windowStart) {
      this.timestamps.shift();
    }

    if (this.timestamps.length < this.maxPerMinute) {
      this.timestamps.push(now);
      return;
    }

    const oldest = this.timestamps[0]!;
    const waitMs = oldest + 60_000 - now + 25;
    await sleep(Math.max(0, waitMs));
    return this.throttle();
  }
}

export class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(() => fn());
    this.tail = next
      .then(() => undefined)
      .catch(() => undefined);
    return next;
  }
}
