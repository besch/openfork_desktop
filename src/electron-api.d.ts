import type { LogEntry, DGNClientStatus, Profile, Project } from "./types";
import type { Session, AuthError } from "@supabase/supabase-js";

declare global {
  interface Window {
    electronAPI: {
      startClient: (
        service: string,
        policy: string,
        allowedIds: string
      ) => void;
      stopClient: () => void;
      onLog: (callback: (log: LogEntry) => void) => void;
      onStatusChange: (callback: (status: DGNClientStatus) => void) => void;
      loginWithGoogle: () => void;
      logout: () => void;
      onSession: (callback: (session: Session | null) => void) => void;
      onAuthCallback: (callback: (url: string) => void) => void;
      setSessionFromTokens: (
        accessToken: string,
        refreshToken: string
      ) => Promise<{ session: Session | null; error: AuthError | null }>;
      setWindowClosable: (closable: boolean) => void;
      getOrchestratorApiUrl: () => Promise<string>;
      removeAllListeners: (
        channel:
          | "openfork_client:log"
          | "openfork_client:status"
          | "auth:session"
          | "auth:callback"
      ) => void;
      // New search methods
      searchUsers: (term: string) => Promise<{ success: boolean; data: Profile[]; error?: string; }>;
      searchProjects: (term: string) => Promise<{ success: boolean; data: Project[]; error?: string; }>;
      fetchConfig: () => Promise<Record<string, { service_name: string; label: string }>>;
      searchGeneral: (query: string) => Promise<Project[]>;
    };
  }
}
