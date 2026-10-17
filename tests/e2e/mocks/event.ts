import { makeUnlisten, record } from './state';

type Handler = (event: { event: string; payload: unknown }) => void;
const listeners = new Map<string, Set<Handler>>();

export type UnlistenFn = () => void;

export async function listen<T>(event: string, handler: (event: { event: string; payload: T }) => void): Promise<UnlistenFn> {
  const typedHandler = handler as Handler;
  const set = listeners.get(event) ?? new Set<Handler>();
  set.add(typedHandler);
  listeners.set(event, set);

  return () => {
    set.delete(typedHandler);
  };
}

export async function emit<T>(event: string, payload?: T): Promise<void> {
  record({ type: 'event.emit', event, payload });
  for (const handler of listeners.get(event) ?? []) {
    handler({ event, payload });
  }
}

/** 测试在页面里推一条后端事件（如链接检测的进度）：`window.__PICNEXUS_E2E_EMIT__('link-check://progress', …)` */
(globalThis as { __PICNEXUS_E2E_EMIT__?: typeof emit }).__PICNEXUS_E2E_EMIT__ = emit;

export async function once<T>(event: string, handler: (event: { event: string; payload: T }) => void): Promise<UnlistenFn> {
  const unlisten = await listen<T>(event, (payload) => {
    handler(payload);
    unlisten();
  });
  return unlisten;
}

export async function emitTo<T>(_target: string, event: string, payload?: T): Promise<void> {
  await emit(event, payload);
}

export async function listenAny(): Promise<UnlistenFn> {
  return makeUnlisten();
}
