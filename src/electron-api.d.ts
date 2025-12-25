import type { LogEntry, DGNClientStatus, Profile, Project, DockerPullProgress, ScheduleConfig, ScheduleStatus } from "./types";
import type { Session, AuthError } from "@supabase/supabase-js";

interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  created: string;
}

declare global {
  interface Window {
    electronAPI: {
      startClient: (
        service: string,
        policy: string,
        allowedIds: string
      ) => void;
      stopClient: () => void;
      cleanupProcesses: () => Promise<{ success: boolean; error?: string }>;
      onLog: (callback: (log: LogEntry) => void) => void;
      onStatusChange: (callback: (status: DGNClientStatus) => void) => void;
      onDockerProgress: (
        callback: (progress: DockerPullProgress | null) => void
      ) => void;
      loginWithGoogle: () => void;
      logout: () => void;
      onSession: (callback: (session: Session | null) => void) => void;
      onAuthCallback: (callback: (url: string) => void) => void;
      setSessionFromTokens: (
        accessToken: string,
        refreshToken: string
      ) => Promise<{ session: Session | null; error: AuthError | null }>;
      getSession: () => Promise<Session | null>;
      onForceRefresh: (callback: () => void) => void;
      setWindowClosable: (closable: boolean) => void;
      getOrchestratorApiUrl: () => Promise<string>;
      removeAllListeners: (
        channel:
          | "openfork_client:log"
          | "openfork_client:status"
          | "openfork_client:docker-progress"
          | "auth:session"
          | "auth:callback"
          | "schedule:status"
      ) => void;
      // New search methods
      searchUsers: (
        term: string
      ) => Promise<{ success: boolean; data: Profile[]; error?: string }>;
      searchProjects: (
        term: string
      ) => Promise<{ success: boolean; data: Project[]; error?: string }>;
      fetchConfig: () => Promise<
        Record<string, { service_name: string; label: string }>
      >;
      searchGeneral: (query: string) => Promise<Project[]>;
      loadSettings: () => Promise<{
        jobPolicy?: string;
        theme?: string;
      } | null>;
      saveSettings: (settings: {
        jobPolicy: string;
        theme?: string;
      }) => Promise<void>;
      // Docker Management
      listDockerImages: () => Promise<{
        success: boolean;
        data?: DockerImage[];
        error?: string;
      }>;
      listDockerContainers: () => Promise<{
        success: boolean;
        data?: DockerContainer[];
        error?: string;
      }>;
      removeDockerImage: (imageId: string) => Promise<{
        success: boolean;
        error?: string;
      }>;
      removeAllDockerImages: () => Promise<{
        success: boolean;
        removedCount?: number;
        error?: string;
      }>;
      stopContainer: (containerId: string) => Promise<{
        success: boolean;
        error?: string;
      }>;
      stopAllContainers: () => Promise<{
        success: boolean;
        stoppedCount?: number;
        error?: string;
      }>;
      cleanupDocker: () => Promise<{
        success: boolean;
        stoppedCount?: number;
        removedCount?: number;
        error?: string;
      }>;
      // Dependency Detection
      checkDocker: () => Promise<{ installed: boolean; running: boolean }>;
      checkNvidia: () => Promise<{ available: boolean; gpu: string | null }>;
      openDockerDownload: () => Promise<{ success: boolean }>;
      
      // Auto Update
      onUpdateAvailable: (callback: (info: unknown) => void) => void;
      onUpdateProgress: (callback: (progress: unknown) => void) => void;
      onUpdateDownloaded: (callback: (info: unknown) => void) => void;
      downloadUpdate: () => void;
      installUpdate: () => void;
      
      // Schedule Management
      getScheduleConfig: () => Promise<ScheduleConfig>;
      setScheduleConfig: (config: ScheduleConfig) => Promise<{ success: boolean; error?: string }>;
      getScheduleStatus: () => Promise<ScheduleStatus>;
      getSchedulePresets: () => Promise<Record<string, Partial<ScheduleConfig>>>;
      getSystemIdleTime: () => Promise<number>;
      onScheduleStatus: (callback: (status: ScheduleStatus) => void) => void;
    };
  }
}

