import type { ServerResponse } from 'node:http';

/**
 * A hint that something changed. It carries no content: the browser fetches the data through
 * the normal, access-checked endpoints.
 */
export type LiveEvent =
  | { type: 'chat'; groupId: string | null }
  | { type: 'posts'; groupId: string | null }
  | { type: 'read' };

type Audience = {
  organizationId: string;
  /** Channel the change belongs to; undefined for events addressed to one account. */
  groupId?: string | null;
  /** Deliver to this account only (its other tabs and devices). */
  onlyUserId?: string;
  needsChat?: boolean;
};
export type LiveClient = {
  organizationId: string;
  userId: string;
  /** Groups the account belongs to; moderators see every group. */
  groups: ReadonlySet<string>;
  moderator: boolean;
  chat: boolean;
};

export const MAX_STREAMS_PER_USER = 6;
export const MAX_STREAMS = 2000;
const HEARTBEAT_MS = 25_000;
/** Streams end after this long; the browser reconnects and access is checked again. */
const LIFETIME_MS = 10 * 60_000;

/**
 * Open event streams of this API process. Events reach only the browsers connected to the same
 * process; with several API instances this needs a shared channel (e.g. PostgreSQL NOTIFY).
 */
export class LiveHub {
  private streams = new Map<ServerResponse, LiveClient & { timers: NodeJS.Timeout[] }>();
  get size() {
    return this.streams.size;
  }
  private count(userId: string) {
    let n = 0;
    for (const client of this.streams.values()) if (client.userId === userId) n++;
    return n;
  }
  /** False when the account or the server already has too many streams open. */
  open(response: ServerResponse, client: LiveClient, lifetimeMs = LIFETIME_MS) {
    if (this.streams.size >= MAX_STREAMS || this.count(client.userId) >= MAX_STREAMS_PER_USER)
      return false;
    const heartbeat = setInterval(() => response.write(': keep-alive\n\n'), HEARTBEAT_MS);
    const end = setTimeout(() => this.close(response), lifetimeMs);
    heartbeat.unref();
    end.unref();
    this.streams.set(response, { ...client, timers: [heartbeat, end] });
    response.on('close', () => this.close(response));
    response.write('retry: 3000\n\n');
    return true;
  }
  close(response: ServerResponse) {
    const client = this.streams.get(response);
    if (!client) return;
    this.streams.delete(response);
    clearInterval(client.timers[0]);
    clearTimeout(client.timers[1]);
    if (!response.writableEnded) response.end();
  }
  closeAll() {
    for (const response of [...this.streams.keys()]) this.close(response);
  }
  publish(event: LiveEvent, to: Audience) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const [response, client] of this.streams) {
      if (client.organizationId !== to.organizationId) continue;
      if (to.onlyUserId && client.userId !== to.onlyUserId) continue;
      if (to.needsChat && !client.chat) continue;
      if (to.groupId && !client.moderator && !client.groups.has(to.groupId)) continue;
      response.write(data);
    }
  }
}
