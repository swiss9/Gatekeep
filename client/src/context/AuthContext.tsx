import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setToken, type Profile } from '../lib/api';
import { getInitData, getStartParam } from '../lib/telegram';

export type AuthState =
  | { status: 'loading' }
  | { status: 'ready'; profile: Profile }
  | { status: 'error'; message: string };

const AuthCtx = createContext<AuthState>({ status: 'loading' });

export function useAuth(): AuthState {
  return useContext(AuthCtx);
}

export function useProfile(): Profile | null {
  const s = useAuth();
  return s.status === 'ready' ? s.profile : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    const initData = getInitData();
    if (!initData) {
      setState({ status: 'error', message: 'Open this app from inside Telegram.' });
      return;
    }

    let cancelled = false;
    api
      .validate(initData, getStartParam())
      .then(({ token, profile }) => {
        if (cancelled) return;
        setToken(token);
        setState({ status: 'ready', profile });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Authentication failed.',
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return <AuthCtx.Provider value={state}>{children}</AuthCtx.Provider>;
}
