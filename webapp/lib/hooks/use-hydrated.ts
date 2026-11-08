import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * Returns `false` during SSR and the hydration pass, `true` afterwards.
 * Use it to defer output that depends on the client clock, timezone or
 * locale (e.g. "5min ago"), which would otherwise cause a hydration
 * text mismatch (React error #418).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
