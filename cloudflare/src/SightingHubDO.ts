import type {
  StreamEventPayload,
  StreamEventType,
} from '../../backend/src/types.ts';

interface BufferedSseEvent {
  id: number;
  type: StreamEventType;
  frame: string;
}

interface SseClient {
  id: string;
  writer: WritableStreamDefaultWriter<Uint8Array>;
}

const MAX_REPLAY_BUFFER = 50;
const HEARTBEAT_INTERVAL_MS = 25_000;

/**
 * Regional Durable Object (`SIGHTING_HUB`) maintaining spike-proof Server-Sent Event
 * (SSE) fanout for Puget Sound clients with heartbeat keep-alive and a 50-event
 * `Last-Event-ID` replay buffer.
 */
export class SightingHubDO implements DurableObject {
  private readonly state: DurableObjectState;
  private readonly clients = new Map<string, SseClient>();
  private readonly replayBuffer: BufferedSseEvent[] = [];
  private readonly encoder = new TextEncoder();
  private eventSeq = 1;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  private ensureHeartbeat(): void {
    if (this.heartbeatTimer !== null || this.clients.size === 0) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.clients.size === 0) {
        if (this.heartbeatTimer !== null) {
          clearInterval(this.heartbeatTimer);
          this.heartbeatTimer = null;
        }
        return;
      }
      const chunk = this.encoder.encode(
        `: heartbeat ${new Date().toISOString()}\n\n`,
      );
      void this.writeToAll(chunk);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private async writeToAll(chunk: Uint8Array): Promise<void> {
    const staleIds: string[] = [];
    await Promise.all(
      Array.from(this.clients.values()).map(async (client) => {
        try {
          await client.writer.write(chunk);
        } catch {
          staleIds.push(client.id);
        }
      }),
    );
    for (const id of staleIds) {
      const stale = this.clients.get(id);
      this.clients.delete(id);
      try {
        await stale?.writer.close();
      } catch {
        // Ignore already-closed stream errors
      }
    }
  }

  private pushReplayEvent(type: StreamEventType, data: unknown): BufferedSseEvent {
    const id = this.eventSeq++;
    const payload: StreamEventPayload = {
      type,
      timestamp: new Date().toISOString(),
      data,
    };
    const frame = `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
    const entry: BufferedSseEvent = { id, type, frame };
    this.replayBuffer.push(entry);
    if (this.replayBuffer.length > MAX_REPLAY_BUFFER) {
      this.replayBuffer.splice(0, this.replayBuffer.length - MAX_REPLAY_BUFFER);
    }
    return entry;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 1. GET /status — Hub diagnostics
    if (request.method === 'GET' && url.pathname === '/status') {
      return new Response(
        JSON.stringify({
          hubId: this.state.id.toString(),
          activeClients: this.clients.size,
          bufferedEvents: this.replayBuffer.length,
          lastEventId: this.eventSeq - 1,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        },
      );
    }

    // 2. POST /broadcast — Fan out normalized event to all connected SSE clients
    if (request.method === 'POST' && url.pathname === '/broadcast') {
      const body = (await request.json()) as {
        type?: StreamEventType;
        data?: unknown;
      };
      const eventType: StreamEventType = body.type ?? 'sighting:new';
      const entry = this.pushReplayEvent(eventType, body.data);
      await this.writeToAll(this.encoder.encode(entry.frame));

      return new Response(
        JSON.stringify({
          broadcasted: true,
          eventId: entry.id,
          recipients: this.clients.size,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        },
      );
    }

    // 3. GET /stream (or /api/stream) — Long-lived SSE connection with replay
    if (request.method === 'GET') {
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();
      const clientId = crypto.randomUUID();
      this.clients.set(clientId, { id: clientId, writer });
      this.ensureHeartbeat();

      // Parse Last-Event-ID from header or query string
      const lastIdRaw =
        request.headers.get('Last-Event-ID') ?? url.searchParams.get('lastEventId');
      const lastEventId = lastIdRaw ? Number.parseInt(lastIdRaw, 10) : NaN;

      const connectedPayload: StreamEventPayload = {
        type: 'connected',
        timestamp: new Date().toISOString(),
        data: {
          activeClients: this.clients.size,
          replayed: Number.isFinite(lastEventId),
        },
      };

      const initialFrames: string[] = [
        `id: ${this.eventSeq++}\nevent: connected\ndata: ${JSON.stringify(connectedPayload)}\n\n`,
      ];

      if (Number.isFinite(lastEventId)) {
        for (const buffered of this.replayBuffer) {
          if (buffered.id > lastEventId) {
            initialFrames.push(buffered.frame);
          }
        }
      }

      this.state.waitUntil(
        (async () => {
          try {
            await writer.write(this.encoder.encode(initialFrames.join('')));
            await writer.closed;
          } catch {
            // Client disconnected
          } finally {
            this.clients.delete(clientId);
          }
        })(),
      );

      return new Response(readable, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, Last-Event-ID',
        },
      });
    }

    return new Response('Method Not Allowed', { status: 405 });
  }
}
