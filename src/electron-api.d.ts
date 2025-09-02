import type { LogEntry, DGNClientStatus } from "./types";
import type { Session } from '@supabase/supabase-js';

declare global {
  interface Window {
    electronAPI: {
      startClient: () => void;
      stopClient: () => void;
      onLog: (callback: (log: LogEntry) => void) => void;
      onStatusChange: (callback: (status: DGNClientStatus) => void) => void;
      loginWithGoogle: () => void;
      logout: () => void;
      onSession: (callback: (session: Session | null) => void) => void;
      onAuthCallback: (callback: (url: string) => void) => void;
      removeAllListeners: (
        channel: "dgn-client:log" | "dgn-client:status" | "auth:session" | "auth:callback"
      ) => void;
    };
  }
}
