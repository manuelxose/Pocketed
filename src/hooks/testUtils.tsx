import { createContext, useContext } from 'react';

const FakeWsContext = createContext<{ request: (m: string, p?: unknown) => Promise<unknown> } | null>(
  null,
);

export function WsContextForTest({
  request,
  children,
}: {
  request: (method: string, params?: unknown) => Promise<unknown>;
  children: React.ReactNode;
}) {
  return <FakeWsContext.Provider value={{ request }}>{children}</FakeWsContext.Provider>;
}

export function useFakeWsClient() {
  const ctx = useContext(FakeWsContext);
  if (!ctx) throw new Error('wrap with WsContextForTest');
  return ctx;
}
