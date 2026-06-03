export class SlidingWindowRateLimiter {
  constructor(maxRequests = 50, windowMs = 60_000) {
    this.timestamps = [];
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  async waitForSlot() {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);
    if (this.timestamps.length < this.maxRequests) return;
    const oldest = Math.min(...this.timestamps);
    const waitMs = this.windowMs - (now - oldest) + 1;
    await new Promise(r => setTimeout(r, waitMs));
    return this.waitForSlot();
  }

  record() {
    this.timestamps.push(Date.now());
  }
}
