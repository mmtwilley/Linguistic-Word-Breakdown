import { SlidingWindowRateLimiter } from '../../lib/rate-limiter.js';

describe('SlidingWindowRateLimiter', () => {
  test('waitForSlot resolves immediately when under capacity', async () => {
    const limiter = new SlidingWindowRateLimiter(3, 60_000);
    const start = Date.now();
    await limiter.waitForSlot();
    expect(Date.now() - start).toBeLessThan(50);
  });

  test('record appends a timestamp within the current window', async () => {
    const limiter = new SlidingWindowRateLimiter(3, 60_000);
    await limiter.waitForSlot();
    limiter.record();
    expect(limiter.timestamps.length).toBe(1);
    expect(Date.now() - limiter.timestamps[0]).toBeLessThan(100);
  });

  test('waitForSlot delays resolution when at capacity', async () => {
    const limiter = new SlidingWindowRateLimiter(1, 100);
    limiter.timestamps = [Date.now()];
    const start = Date.now();
    await limiter.waitForSlot();
    expect(Date.now() - start).toBeGreaterThanOrEqual(90);
  }, 500);

  test('stale timestamps are pruned on next waitForSlot call', async () => {
    const limiter = new SlidingWindowRateLimiter(3, 50);
    limiter.timestamps = [Date.now() - 200];
    await limiter.waitForSlot();
    expect(limiter.timestamps.length).toBe(0);
  });
});
