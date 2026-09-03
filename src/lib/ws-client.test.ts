import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_REQUIRED_CLOSE_CODE, WsClient, WsDisconnected } from './ws-client';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: ((e: { code?: number }) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  readyState = 0;
  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  triggerOpen() {
    this.readyState = 1;
    this.onopen?.();
  }
  triggerMessage(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  // Deterministic backoff jitter for timer-advancement assertions.
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('WsClient', () => {
  it('resolves request() when a matching rpc response arrives', async () => {
    const client = new WsClient('ws://test');
    client.connect();
    const sock = MockWebSocket.instances[0];
    sock.triggerOpen();

    const promise = client.request('ping', {});
    const sent = JSON.parse(sock.sent[0]);
    expect(sent.type).toBe('rpc');
    expect(sent.method).toBe('ping');

    sock.triggerMessage({ type: 'rpc', id: sent.id, ok: true, result: 'pong' });
    await expect(promise).resolves.toBe('pong');
  });

  it('rejects request() when the rpc response has ok:false', async () => {
    const client = new WsClient('ws://test');
    client.connect();
    const sock = MockWebSocket.instances[0];
    sock.triggerOpen();

    const promise = client.request('setCredentials', {});
    const sent = JSON.parse(sock.sent[0]);
    sock.triggerMessage({ type: 'rpc', id: sent.id, ok: false, error: 'not available yet' });
    await expect(promise).rejects.toThrow('not available yet');
  });

  it('dispatches push events to subscribers', () => {
    const client = new WsClient('ws://test');
    client.connect();
    const sock = MockWebSocket.instances[0];
    sock.triggerOpen();

    const handler = vi.fn();
    client.on('account:update', handler);
    sock.triggerMessage({ type: 'event', event: 'account:update', data: { equity: 100 } });
    expect(handler).toHaveBeenCalledWith({ equity: 100 });
  });

  it('contract: consumes the "event" field, not "name" (regression guard)', () => {
    const client = new WsClient('ws://test');
    client.connect();
    const sock = MockWebSocket.instances[0];
    sock.triggerOpen();

    const handler = vi.fn();
    client.on('backend:startError', handler);
    // Old/wrong backend shape — must NOT dispatch.
    sock.triggerMessage({ type: 'event', name: 'backend:startError', data: { error: 'boom' } });
    expect(handler).not.toHaveBeenCalled();
    // Correct shape — must dispatch.
    sock.triggerMessage({ type: 'event', event: 'backend:startError', data: { error: 'boom' } });
    expect(handler).toHaveBeenCalledWith({ error: 'boom' });
  });

  it('ignores malformed/unparseable JSON frames', () => {
    const client = new WsClient('ws://test');
    client.connect();
    const sock = MockWebSocket.instances[0];
    sock.triggerOpen();
    const handler = vi.fn();
    client.on('account:update', handler);
    expect(() => sock.onmessage?.({ data: '{not json' })).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribe stops delivering events', () => {
    const client = new WsClient('ws://test');
    client.connect();
    const sock = MockWebSocket.instances[0];
    sock.triggerOpen();

    const handler = vi.fn();
    const off = client.on('account:update', handler);
    off();
    sock.triggerMessage({ type: 'event', event: 'account:update', data: {} });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects in-flight requests with WsDisconnected on close', async () => {
    const client = new WsClient('ws://test');
    client.connect();
    const sock = MockWebSocket.instances[0];
    sock.triggerOpen();

    const promise = client.request('ping', {});
    sock.close();
    await expect(promise).rejects.toBeInstanceOf(WsDisconnected);
  });

  it('rejects request() with a timeout when no reply ever arrives', async () => {
    vi.useFakeTimers();
    const client = new WsClient('ws://test');
    client.connect();
    const sock = MockWebSocket.instances[0];
    sock.triggerOpen();

    const promise = client.request('ping', {}, 1000);
    const assertion = expect(promise).rejects.toThrow('rpc timeout: ping');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    vi.useRealTimers();
  });

  it('reconnects after close and reports connected state', () => {
    vi.useFakeTimers();
    const client = new WsClient('ws://test');
    client.connect();
    const first = MockWebSocket.instances[0];
    first.triggerOpen();
    expect(client.connected).toBe(true);

    first.close();
    expect(client.connected).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(MockWebSocket.instances.length).toBe(2);
    MockWebSocket.instances[1].triggerOpen();
    expect(client.connected).toBe(true);
    vi.useRealTimers();
  });

  it('does not create a second socket when connect() is called while already open', () => {
    const client = new WsClient('ws://test');
    client.connect();
    MockWebSocket.instances[0].triggerOpen();
    client.connect();
    client.connect();
    expect(MockWebSocket.instances.length).toBe(1);
  });

  it('does not create a second socket when connect() is called while still connecting', () => {
    const client = new WsClient('ws://test');
    client.connect();
    client.connect();
    expect(MockWebSocket.instances.length).toBe(1);
  });

  it('close() prevents a scheduled reconnect', () => {
    vi.useFakeTimers();
    const client = new WsClient('ws://test');
    client.connect();
    const sock = MockWebSocket.instances[0];
    sock.triggerOpen();

    client.close();
    vi.advanceTimersByTime(30000);
    expect(MockWebSocket.instances.length).toBe(1);
    expect(client.getState()).toBe('closed');
    vi.useRealTimers();
  });

  it('close code 4401 surfaces auth-required and does not reconnect', () => {
    vi.useFakeTimers();
    const client = new WsClient('ws://test');
    const states: string[] = [];
    client.onStateChange((s) => states.push(s));
    client.connect();
    const sock = MockWebSocket.instances[0];
    sock.triggerOpen();

    sock.close(AUTH_REQUIRED_CLOSE_CODE);
    expect(client.getState()).toBe('auth-required');
    vi.advanceTimersByTime(30000);
    expect(MockWebSocket.instances.length).toBe(1);
    expect(states).toContain('auth-required');
    vi.useRealTimers();
  });

  it('a pending rpc rejects immediately if the auth-required close happens mid-flight', async () => {
    const client = new WsClient('ws://test');
    client.connect();
    const sock = MockWebSocket.instances[0];
    sock.triggerOpen();
    const promise = client.request('ping', {});
    sock.close(AUTH_REQUIRED_CLOSE_CODE);
    await expect(promise).rejects.toBeInstanceOf(WsDisconnected);
  });

  it('backoff grows across consecutive reconnect failures up to the 15s cap', () => {
    vi.useFakeTimers();
    const client = new WsClient('ws://test');
    client.connect();
    MockWebSocket.instances[0].triggerOpen();
    MockWebSocket.instances[0].close(); // -> schedules ~1000ms (attempt 0)

    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances.length).toBe(2);
    MockWebSocket.instances[1].close(); // socket never opened, still schedules ~2000ms (attempt 1)

    vi.advanceTimersByTime(2000);
    expect(MockWebSocket.instances.length).toBe(3);
    vi.useRealTimers();
  });

  it('reports connection state transitions via onStateChange', () => {
    const client = new WsClient('ws://test');
    const states: string[] = [];
    client.onStateChange((s) => states.push(s));
    client.connect();
    MockWebSocket.instances[0].triggerOpen();
    expect(states).toEqual(['connecting', 'open']);
  });
});
