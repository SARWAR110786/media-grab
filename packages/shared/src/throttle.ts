/**
 * Token-bucket bandwidth limiter shared by every connection of every download, so the limit applies
 * to MediaGrab's total speed. A rate of 0 (or less) means unlimited.
 */
export class BandwidthLimiter {
  private tokens = 0;
  private last: number;

  constructor(
    private bytesPerSecond: number,
    private now: () => number = () => Date.now(),
  ) {
    this.last = this.now();
    this.tokens = this.burst();
  }

  get rate(): number {
    return this.bytesPerSecond;
  }

  setRate(bytesPerSecond: number): void {
    this.refill();
    this.bytesPerSecond = bytesPerSecond;
    this.tokens = Math.min(this.tokens, this.burst());
  }

  /** At most ~250 ms worth of data may go through at once, which keeps the speed smooth. */
  private burst(): number {
    return Math.max(16 * 1024, this.bytesPerSecond / 4);
  }

  private refill(): void {
    const t = this.now();
    const dt = Math.max(0, t - this.last) / 1000;
    this.last = t;
    if (this.bytesPerSecond > 0) this.tokens = Math.min(this.burst(), this.tokens + dt * this.bytesPerSecond);
  }

  /** How long to wait (ms) before `bytes` more may be used. Records the use immediately. */
  reserve(bytes: number): number {
    if (this.bytesPerSecond <= 0) return 0;
    this.refill();
    this.tokens -= bytes;
    return this.tokens >= 0 ? 0 : Math.ceil((-this.tokens / this.bytesPerSecond) * 1000);
  }

  /** Wait until `bytes` may be used (resolves at once when unlimited). Rejects with AbortError on abort. */
  async take(bytes: number, signal?: AbortSignal): Promise<void> {
    const wait = this.reserve(bytes);
    if (wait <= 0) return;
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
      const t = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, wait);
      const onAbort = () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}
