import { AsyncLocalStorage } from "node:async_hooks";

// Carries the MCP request's cancellation signal from the tool registration
// wrapper to the browser runtime without threading it through every handler.
// Read it synchronously at the start of an operation and pass the signal on
// explicitly: Playwright event and route callbacks inherit the context of the
// request that launched the browser, not the request currently being served.
const requestSignal = new AsyncLocalStorage<AbortSignal | undefined>();

export function runWithRequestSignal<T>(signal: AbortSignal | undefined, callback: () => T): T {
  return requestSignal.run(signal, callback);
}

export function currentRequestSignal(): AbortSignal | undefined {
  return requestSignal.getStore();
}

export class RequestCancelledError extends Error {
  constructor(options?: ErrorOptions) {
    super("Request was cancelled by the client.", options);
    this.name = "RequestCancelledError";
  }
}

export function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new RequestCancelledError();
  }
}
