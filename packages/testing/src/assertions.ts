import type { StormEventBus } from "@stormstack/core";

export function expectEventEmitted(events: StormEventBus, eventName: string): void {
  const history = events.getHistory(200);
  const found = history.some((e) => e.name === eventName);
  if (!found) {
    const names = history.map((e) => e.name).join(", ");
    throw new Error(
      `Expected event "${eventName}" to have been emitted. Events seen: [${names || "none"}]`,
    );
  }
}

export function expectEventNotEmitted(events: StormEventBus, eventName: string): void {
  const history = events.getHistory(200);
  const found = history.some((e) => e.name === eventName);
  if (found) {
    throw new Error(`Expected event "${eventName}" NOT to have been emitted, but it was.`);
  }
}

export function getEmittedEvents(events: StormEventBus, eventName?: string) {
  const history = events.getHistory(200);
  if (!eventName) return history;
  return history.filter((e) => e.name === eventName);
}
