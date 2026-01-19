/**
 * Debug Logger Utility
 *
 * Provides conditional logging that can be enabled/disabled.
 * Use this for verbose debug output that should not appear in production.
 */

// Check if debug mode is enabled (via localStorage or environment)
function isDebugEnabled(): boolean {
  try {
    // Check localStorage for debug flag
    if (typeof window !== 'undefined' && window.localStorage) {
      return localStorage.getItem('IBKR_DEBUG') === 'true';
    }
  } catch {
    // localStorage not available (SSR, tests, etc.)
  }
  return false;
}

// Cache the debug state (evaluated once at module load)
const DEBUG_ENABLED = isDebugEnabled();

/**
 * Debug logger - only logs when IBKR_DEBUG=true in localStorage
 */
export const debug = {
  /**
   * Log debug message (only when debug mode is enabled)
   */
  log: (message: string, ...args: unknown[]): void => {
    if (DEBUG_ENABLED) {
      console.log(message, ...args);
    }
  },

  /**
   * Log warning (always logged - warnings are important)
   */
  warn: (message: string, ...args: unknown[]): void => {
    console.warn(message, ...args);
  },

  /**
   * Log error (always logged - errors are important)
   */
  error: (message: string, ...args: unknown[]): void => {
    console.error(message, ...args);
  },

  /**
   * Log a group of related debug messages
   */
  group: (label: string, fn: () => void): void => {
    if (DEBUG_ENABLED) {
      console.group(label);
      fn();
      console.groupEnd();
    }
  },

  /**
   * Check if debug mode is enabled
   */
  isEnabled: (): boolean => DEBUG_ENABLED,
};
