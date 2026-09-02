import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WsClient, WsDisconnected } from './ws-client';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
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
  close() {
    this.readyState = 3;
    this.onclose?.();
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
});

afterEach(() => {
  vi.unstubAllGlobals();
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
});
