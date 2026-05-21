// ─── Storm Event Bus — typed async pub/sub for inter-plugin communication ────

import type { StormContext } from "./types";

// ─── Event payload map — plugins extend this via declaration merging ──────────

/**
 * Central event map. Plugins extend this interface to register typed events:
 *
 * ```ts
 * declare module "@stormstack/core" {
 *   interface StormEvents {
 *     "ticket.created": { ticketId: string; title: string; reporterId: string };
 *   }
 * }
 * ```
 */
export interface StormEvents {
  // Built-in lifecycle events (always available)
  "plugin.booted": { pluginId: string };
  "plugin.config.updated": { pluginId: string; config: Record<string, unknown> };
}

/** Any event name from the event map, or a custom string for untyped events */
export type StormEventName = keyof StormEvents | (string & {});

/** Payload for a given event name */
export type StormEventPayload<E extends StormEventName> =
  E extends keyof StormEvents ? StormEvents[E] : Record<string, unknown>;

/** Full event envelope passed to handlers */
export interface StormEvent<E extends StormEventName = StormEventName> {
  /** Event name (e.g. "ticket.created") */
  name: E;
  /** Typed payload */
  payload: StormEventPayload<E>;
  /** ISO timestamp of emission */
  timestamp: string;
  /** Plugin ID that emitted the event (set by the bus) */
  source?: string;
}

/** Handler function signature */
export type StormEventHandler<E extends StormEventName = StormEventName> = (
  event: StormEvent<E>,
  ctx: StormContext,
) => void | Promise<void>;

/** Handler registration returned by on() — call to unsubscribe */
export interface StormEventSubscription {
  unsubscribe(): void;
}

// ─── Event Bus implementation ────────────────────────────────────────────────

export class StormEventBus {
  private handlers = new Map<string, Set<StormEventHandler<any>>>();
  private wildcardHandlers = new Set<StormEventHandler<any>>();
  private ctx: StormContext | null = null;
  private history: StormEvent[] = [];
  private maxHistory = 100;

  /** Bind the Storm context — called once at bootstrap */
  setContext(ctx: StormContext): void {
    this.ctx = ctx;
  }

  /**
   * Subscribe to an event. Returns a subscription object with unsubscribe().
   *
   * @param event - Event name, or "*" for all events
   * @param handler - Async handler function
   */
  on<E extends StormEventName>(
    event: E | "*",
    handler: StormEventHandler<E>,
  ): StormEventSubscription {
    if (event === "*") {
      this.wildcardHandlers.add(handler as StormEventHandler<any>);
      return {
        unsubscribe: () => this.wildcardHandlers.delete(handler as StormEventHandler<any>),
      };
    }

    if (!this.handlers.has(event as string)) {
      this.handlers.set(event as string, new Set());
    }
    this.handlers.get(event as string)!.add(handler as StormEventHandler<any>);

    return {
      unsubscribe: () => {
        const set = this.handlers.get(event as string);
        if (set) {
          set.delete(handler as StormEventHandler<any>);
          if (set.size === 0) this.handlers.delete(event as string);
        }
      },
    };
  }

  /**
   * Emit an event. All matching handlers run concurrently.
   * Errors in individual handlers are logged but don't propagate or block others.
   *
   * @param event - Event name
   * @param payload - Event payload
   * @param source - Emitting plugin ID (optional)
   */
  async emit<E extends StormEventName>(
    event: E,
    payload: StormEventPayload<E>,
    source?: string,
  ): Promise<void> {
    if (!this.ctx) {
      throw new Error("[storm-events] Cannot emit before context is set. Call setContext() first.");
    }

    const envelope: StormEvent<E> = {
      name: event,
      payload,
      timestamp: new Date().toISOString(),
      source,
    };

    // Track in history ring buffer
    this.history.push(envelope as StormEvent);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // Collect all matching handlers
    const targeted = this.handlers.get(event as string);
    const handlers: StormEventHandler<any>[] = [
      ...(targeted ?? []),
      ...this.wildcardHandlers,
    ];

    if (handlers.length === 0) return;

    this.ctx.logger.info(`[storm-events] ${event}`, {
      source,
      handlers: handlers.length,
    });

    // Run all handlers concurrently — isolate failures
    const results = await Promise.allSettled(
      handlers.map((handler) => handler(envelope, this.ctx!)),
    );

    for (const result of results) {
      if (result.status === "rejected") {
        this.ctx.logger.error(`[storm-events] Handler error on "${event}"`, {
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          source,
        });
      }
    }
  }

  /**
   * Check if any handlers are registered for an event.
   */
  hasListeners(event: StormEventName): boolean {
    const targeted = this.handlers.get(event as string);
    return (targeted != null && targeted.size > 0) || this.wildcardHandlers.size > 0;
  }

  /**
   * Get count of registered handlers for an event (excluding wildcards).
   */
  listenerCount(event: StormEventName): number {
    return (this.handlers.get(event as string)?.size ?? 0) + this.wildcardHandlers.size;
  }

  /**
   * Get recent event history (for debugging / admin UI).
   */
  getHistory(limit = 50): StormEvent[] {
    return this.history.slice(-limit);
  }

  /**
   * Remove all handlers. Used in tests.
   */
  clear(): void {
    this.handlers.clear();
    this.wildcardHandlers.clear();
    this.history = [];
  }
}

// ─── Singleton event bus ─────────────────────────────────────────────────────

export const eventBus = new StormEventBus();
