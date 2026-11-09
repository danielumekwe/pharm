import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';

type State<T> = { data: T | null; error: string | null; loading: boolean };

/** Loads JSON from the server, with pull-to-refresh support. Skipped while path is null. */
export function useData<T>(path: string | null) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: Boolean(path) });
  const [refreshing, setRefreshing] = useState(false);

  const fetchInto = useCallback(async () => {
    if (!path) return;
    try {
      const data = await api<T>(path);
      setState({ data, error: null, loading: false });
    } catch (cause) {
      setState((current) => ({ ...current, error: cause instanceof Error ? cause.message : 'Could not load.', loading: false }));
    }
  }, [path]);

  useEffect(() => {
    // State is only set when the request finishes, never during the effect itself.
    void fetchInto();
  }, [fetchInto]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await fetchInto();
    setRefreshing(false);
  }, [fetchInto]);

  return { ...state, refreshing, refresh };
}
