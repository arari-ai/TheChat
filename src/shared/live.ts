export function retryDelay(attempt: number): number {
  return Math.min(30000, 1000 * 2 ** Math.max(0, attempt));
}
export function eventsAfter<T extends { id: string }>(events: T[], cursor: string): T[] {
  return events.filter(event => event.id > cursor);
}
