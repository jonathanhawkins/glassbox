"use client";

// useState that survives a page refresh: hydrates from localStorage after mount and writes
// back on every set. This is the persist behavior zustand's middleware provides, without the
// dependency (zustand's install aborts on a pre-existing workspace issue, see
// lib/fleet/swarm-cache.ts) and without rewiring scattered useStates into a store: the
// returned tuple is a drop-in replacement, functional updates included.
//
// SSR-safe by construction: the server (and the client's hydration pass) render `initial`,
// then a mount effect swaps in the stored value, so markup never mismatches.

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

export function usePersistentState<T>(
  // Pass null to opt out of persistence entirely (plain useState behavior). This keeps the
  // rules-of-hooks satisfied for components whose persistence is an OPTIONAL prop (e.g. the
  // rail sections persist on /swarm but not where the same component renders elsewhere).
  key: string | null,
  initial: T,
  // Optional validator/merger for the parsed stored value (e.g. merge a saved config over
  // current defaults so a shape change never resurrects stale or partial state).
  revive?: (raw: unknown) => T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    if (key === null) return;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return;
      const parsed = JSON.parse(raw) as unknown;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot localStorage hydration after mount (avoids an SSR hydration mismatch)
      setValue(revive ? revive(parsed) : (parsed as T));
    } catch {
      /* corrupted or unavailable storage: keep the initial */
    }
    // Hydrate once per key; `revive` is intentionally not a dep (it would re-hydrate on
    // every render for inline functions, clobbering newer state).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (action) => {
      setValue((prev) => {
        const next =
          typeof action === "function" ? (action as (p: T) => T)(prev) : action;
        // Persisting inside the updater keeps write-after-read ordering exact for
        // functional updates. React may re-run updaters (StrictMode dev), which just
        // rewrites the same value: idempotent and harmless.
        if (key !== null) {
          try {
            window.localStorage.setItem(key, JSON.stringify(next));
          } catch {
            /* storage full or disabled: state still works for this session */
          }
        }
        return next;
      });
    },
    [key],
  );

  return [value, set];
}
