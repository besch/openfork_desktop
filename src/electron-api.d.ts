import type { LogEntry, DGNClientStatus } from "./types";
import type { Session, AuthError } from '@supabase/supabase-js';

declare global {
  interface Window {
    electronAPI: {
      startClient: (service: string) => void;
      stopClient: () => void;
      onLog: (callback: (log: LogEntry) => void) => void;
      onStatusChange: (callback: (status: DGNClientStatus) => void) => void;
      loginWithGoogle: () => void;
      logout: () => void;
      onSession: (callback: (session: Session | null) => void) => void;
      onAuthCallback: (callback: (url: string) => void) => void;
      setSessionFromTokens: (accessToken: string, refreshToken: string) => Promise<{ session: Session | null; error: AuthError | null; }>;
      setWindowClosable: (closable: boolean) => void;
      getOrchestratorApiUrl: () => Promise<string>;
      removeAllListeners: (
        channel: "dgn-client:log" | "dgn-client:status" | "auth:session" | "auth:callback"
      ) => void;
    };
  }
}