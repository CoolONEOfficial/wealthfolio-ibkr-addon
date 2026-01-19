import { debug } from "./debug-logger";

/**
 * A simple async mutex/lock for preventing concurrent execution.
 *
 * This ensures that only one async operation can run at a time,
 * with subsequent calls queued and executed in order.
 */
export class AsyncLock {
  private locked = false;
  private queue: (() => void)[] = [];

  /**
   * Acquire the lock. If already locked, waits until it becomes available.
   * @returns A release function that must be called when done.
   */
  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }

    // Wait for lock to be released
    return new Promise((resolve) => {
      this.queue.push(() => resolve(() => this.release()));
    });
  }

  /**
   * Try to acquire the lock without waiting.
   * @returns A release function if acquired, null if lock is held.
   */
  tryAcquire(): (() => void) | null {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }
    return null;
  }

  /**
   * Check if the lock is currently held.
   */
  isLocked(): boolean {
    return this.locked;
  }

  private release(): void {
    // Use iterative approach to prevent stack overflow if multiple callbacks throw
    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        try {
          next();
          return; // Successfully handed off lock to next waiter
        } catch (error) {
          // If the callback throws, log and continue to next item to prevent deadlock
          debug.error("[AsyncLock] Queue callback error:", error);
          // Loop continues to process next item (iterative, not recursive)
        }
      }
    }
    // No more items in queue, release lock
    this.locked = false;
  }
}

/**
 * Execute a function with exclusive access using the provided lock.
 * Ensures the lock is always released, even if the function throws.
 */
export async function withLock<T>(
  lock: AsyncLock,
  fn: () => Promise<T>
): Promise<T> {
  const release = await lock.acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}
