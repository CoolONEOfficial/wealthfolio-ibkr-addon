import { describe, it, expect, vi, beforeEach } from "vitest";
import { AsyncLock, withLock } from "../lib/async-lock";

describe("AsyncLock", () => {
  let lock: AsyncLock;

  beforeEach(() => {
    lock = new AsyncLock();
  });

  describe("acquire", () => {
    it("should acquire lock when not locked", async () => {
      const release = await lock.acquire();
      expect(lock.isLocked()).toBe(true);
      release();
      expect(lock.isLocked()).toBe(false);
    });

    it("should queue when lock is held", async () => {
      const order: number[] = [];

      const release1 = await lock.acquire();
      order.push(1);

      // Start second acquire (will be queued)
      const promise2 = lock.acquire().then((release) => {
        order.push(2);
        release();
      });

      // Start third acquire (will be queued behind second)
      const promise3 = lock.acquire().then((release) => {
        order.push(3);
        release();
      });

      // Release first lock
      release1();

      // Wait for queued operations to complete
      await Promise.all([promise2, promise3]);

      expect(order).toEqual([1, 2, 3]);
    });

    it("should process queue in FIFO order", async () => {
      const order: string[] = [];
      const release = await lock.acquire();

      const promises = ["a", "b", "c", "d"].map((id) =>
        lock.acquire().then((rel) => {
          order.push(id);
          rel();
        })
      );

      release();
      await Promise.all(promises);

      expect(order).toEqual(["a", "b", "c", "d"]);
    });

    it("should handle concurrent operations correctly", async () => {
      const results: number[] = [];
      let counter = 0;

      const operations = Array(10)
        .fill(0)
        .map(async () => {
          const release = await lock.acquire();
          const current = counter;
          // Simulate async work
          await new Promise((r) => setTimeout(r, 1));
          counter = current + 1;
          results.push(counter);
          release();
        });

      await Promise.all(operations);

      // Without lock, counter would have race conditions
      // With lock, should be sequential 1-10
      expect(results).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(counter).toBe(10);
    });
  });

  describe("tryAcquire", () => {
    it("should acquire lock when not locked", () => {
      const release = lock.tryAcquire();
      expect(release).not.toBeNull();
      expect(lock.isLocked()).toBe(true);
      release!();
      expect(lock.isLocked()).toBe(false);
    });

    it("should return null when lock is held", async () => {
      const release1 = await lock.acquire();
      const release2 = lock.tryAcquire();
      expect(release2).toBeNull();
      release1();
    });

    it("should succeed after lock is released", async () => {
      const release1 = await lock.acquire();
      expect(lock.tryAcquire()).toBeNull();
      release1();
      const release2 = lock.tryAcquire();
      expect(release2).not.toBeNull();
      release2!();
    });
  });

  describe("isLocked", () => {
    it("should return false initially", () => {
      expect(lock.isLocked()).toBe(false);
    });

    it("should return true when locked", async () => {
      const release = await lock.acquire();
      expect(lock.isLocked()).toBe(true);
      release();
    });

    it("should return false after release", async () => {
      const release = await lock.acquire();
      release();
      expect(lock.isLocked()).toBe(false);
    });

    it("should return true while queue is being processed", async () => {
      const release1 = await lock.acquire();

      const promise2 = lock.acquire().then((release) => {
        expect(lock.isLocked()).toBe(true);
        release();
      });

      release1();
      await promise2;
      expect(lock.isLocked()).toBe(false);
    });
  });

  describe("release error handling", () => {
    it("should not deadlock if release is called multiple times", async () => {
      const release = await lock.acquire();
      release();
      // Second release should be safe (no-op behavior expected)
      release();
      expect(lock.isLocked()).toBe(false);

      // Should be able to acquire again
      const release2 = await lock.acquire();
      expect(lock.isLocked()).toBe(true);
      release2();
    });

    it("should remain locked if user code throws before calling release", async () => {
      // Note: The queue callback just calls resolve() with the release function.
      // If user code throws without calling release(), the lock stays locked.
      // This is expected behavior - users should use withLock() for safety.
      const release1 = await lock.acquire();

      // Queue an operation where the handler throws before calling release
      const errorPromise = lock.acquire().then((release) => {
        // Intentionally NOT calling release() before throwing
        throw new Error("Test error");
      });

      release1();

      // The error is in the Promise chain
      await expect(errorPromise).rejects.toThrow("Test error");

      // Lock is still held because release() was never called
      expect(lock.isLocked()).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle rapid acquire/release cycles", async () => {
      for (let i = 0; i < 100; i++) {
        const release = await lock.acquire();
        release();
      }
      expect(lock.isLocked()).toBe(false);
    });

    it("should handle mixed acquire and tryAcquire", async () => {
      const release1 = await lock.acquire();
      expect(lock.tryAcquire()).toBeNull();

      const promise2 = lock.acquire();
      expect(lock.tryAcquire()).toBeNull();

      release1();
      const release2 = await promise2;
      expect(lock.tryAcquire()).toBeNull();

      release2();
      const release3 = lock.tryAcquire();
      expect(release3).not.toBeNull();
      release3!();
    });
  });
});

describe("withLock", () => {
  let lock: AsyncLock;

  beforeEach(() => {
    lock = new AsyncLock();
  });

  it("should execute function with lock held", async () => {
    let wasLocked = false;

    await withLock(lock, async () => {
      wasLocked = lock.isLocked();
      return "result";
    });

    expect(wasLocked).toBe(true);
    expect(lock.isLocked()).toBe(false);
  });

  it("should return function result", async () => {
    const result = await withLock(lock, async () => {
      return "test-result";
    });

    expect(result).toBe("test-result");
  });

  it("should release lock even if function throws", async () => {
    await expect(
      withLock(lock, async () => {
        throw new Error("Test error");
      })
    ).rejects.toThrow("Test error");

    expect(lock.isLocked()).toBe(false);
  });

  it("should serialize concurrent withLock calls", async () => {
    const order: number[] = [];

    await Promise.all([
      withLock(lock, async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push(1);
      }),
      withLock(lock, async () => {
        order.push(2);
      }),
      withLock(lock, async () => {
        order.push(3);
      }),
    ]);

    expect(order).toEqual([1, 2, 3]);
  });

  it("should handle nested withLock on different locks", async () => {
    const lock2 = new AsyncLock();
    let innerExecuted = false;

    await withLock(lock, async () => {
      await withLock(lock2, async () => {
        innerExecuted = true;
      });
    });

    expect(innerExecuted).toBe(true);
    expect(lock.isLocked()).toBe(false);
    expect(lock2.isLocked()).toBe(false);
  });

  it("should work with async functions that return void", async () => {
    let executed = false;

    await withLock(lock, async () => {
      executed = true;
    });

    expect(executed).toBe(true);
  });
});
