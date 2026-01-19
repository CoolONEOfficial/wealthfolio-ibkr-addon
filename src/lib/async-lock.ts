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
    if (this.queue.length > 0) {
      // Give lock to next waiter
      const next = this.queue.shift();
      if (next) {
        try {
          next();
        } catch (error) {
          // If the callback throws, still release the lock to prevent deadlock
          console.error("[AsyncLock] Queue callback error:", error);
          this.locked = false;
        }
      } else {
        // Shouldn't happen but handle defensively
        this.locked = false;
      }
    } else {
      this.locked = false;
    }
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
