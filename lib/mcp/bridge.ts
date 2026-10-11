import { randomUUID } from 'node:crypto';

export type BridgeCommand = { id: string; operation: string; payload: unknown };
type PendingCommand = BridgeCommand & { deliver: (command: BridgeCommand) => void; resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> };
type BridgeClient = { id: string; lastSeen: number; queue: PendingCommand[]; waiter?: (command: BridgeCommand) => void };
type BridgeState = { clients: Map<string, BridgeClient>; pending: Map<string, PendingCommand> };

const runtime = globalThis as typeof globalThis & { __screenshotStudioMcpBridge?: BridgeState };
const bridge = runtime.__screenshotStudioMcpBridge ??= { clients: new Map(), pending: new Map() };
// The browser uses a 20 second long poll, so allow multiple poll intervals
// before considering a tab disconnected.
const CLIENT_TTL_MS = 60_000;

export function registerEditorClient(id: string) {
  const client = { id, lastSeen: Date.now(), queue: [] } satisfies BridgeClient;
  bridge.clients.set(id, client);
  return client;
}

export function unregisterEditorClient(id: string) {
  const client = bridge.clients.get(id);
  if (client?.waiter) client.waiter({ id: '', operation: 'close', payload: null });
  bridge.clients.delete(id);
}

export function touchEditorClient(id: string) {
  const client = bridge.clients.get(id);
  if (client) client.lastSeen = Date.now();
  return client;
}

export function onlineEditorClients() {
  const cutoff = Date.now() - CLIENT_TTL_MS;
  for (const [id, client] of bridge.clients) if (client.lastSeen < cutoff) unregisterEditorClient(id);
  return bridge.clients.size;
}

export function requestFromEditor(id: string, operation: string, payload: unknown, timeoutMs = 300_000): Promise<unknown> {
  onlineEditorClients();
  const client = [...bridge.clients.values()].sort((a, b) => b.lastSeen - a.lastSeen)[0];
  if (!client) throw new Error('Open Screenshot Studio’s editor page first; no live editor is connected.');

  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const pending = {
      id: requestId, operation, payload, resolve,
      deliver: (command: BridgeCommand) => client.waiter?.(command),
      timer: setTimeout(() => {
        client.queue = client.queue.filter((item: PendingCommand) => item.id !== requestId);
        bridge.pending.delete(requestId);
        reject(new Error(`Editor did not finish ${operation} before the ${timeoutMs / 1000}s timeout.`));
      }, timeoutMs),
    } satisfies PendingCommand;
    bridge.pending.set(requestId, pending);
    if (client.waiter) { const waiter = client.waiter; client.waiter = undefined; waiter(pending); }
    else client.queue.push(pending);
  });
}

export function waitForEditorCommand(id: string, timeoutMs = 20_000): Promise<BridgeCommand | null> {
  const client = touchEditorClient(id);
  if (!client) return Promise.resolve(null);
  const next = client.queue.shift();
  if (next) return Promise.resolve({ id: next.id, operation: next.operation, payload: next.payload });
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      if (client.waiter === deliver) client.waiter = undefined;
      resolve(null);
    }, timeoutMs);
    const deliver = (command: BridgeCommand) => {
      clearTimeout(timer);
      client.waiter = undefined;
      // PendingCommand carries Promise callbacks and a Node timer. Return only
      // its JSON-safe command envelope to the browser poll route.
      resolve({ id: command.id, operation: command.operation, payload: command.payload });
    };
    client.waiter = deliver;
  });
}

export function resolveEditorCommand(requestId: string, result: unknown, error?: string) {
  const pending = bridge.pending.get(requestId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  bridge.pending.delete(requestId);
  pending.resolve(error ? { __studioMcpError: error } : result);
  return true;
}
