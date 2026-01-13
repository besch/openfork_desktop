import type { Session } from "@supabase/supabase-js";
import type {
  DGNClientStatus,
  LogEntry,
  DockerPullProgress,
  DockerImage,
  DockerContainer,
  DockerStatus,
  NvidiaStatus,
  ScheduleConfig,
  ScheduleStatus,
} from "./types";

// Type for cleanup function returned by listeners
type CleanupFn = () => void;

// Search result types
interface SearchUsersResult {
  success: boolean;
  data?: Array<{ id: string; username: string }>;
  error?: string;
}

interface SearchProjectsResult {
  success: boolean;
  data?: Array<{ id: string; title: string }>;
  error?: string;
}

interface DockerImagesResult {
  success: boolean;
  error?: string;
  data?: DockerImage[];
}

interface DockerContainersResult {
  success: boolean;
  error?: string;
  data?: DockerContainer[];
}

interface DockerOperationResult {
  success: boolean;
  error?: string;
  removedCount?: number;
  stoppedCount?: number;
}

interface SessionResult {
  session: Session | null;
  error: { message: string } | null;
}

interface SettingsResult {
  success: boolean;
  error?: string;
}

interface UpdateInfo {
  version: string;
  releaseNotes?: string;
}

interface UpdateProgress {
  percent: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
}

interface ProcessInfo {
  chrome: string;
  electron: string;
  node: string;
  v8: string;
  arch: string;
  platform: string;
  argv: string[];
  isPackaged: boolean;
}

interface ElectronAPI {
  // Orchestrator API URL
  getOrchestratorApiUrl: () => Promise<string>;

  // DGN Client controls
  startClient: (service: string, policy: string, allowedIds: string) => void;
  stopClient: () => void;
  cleanupProcesses: () => Promise<{ success: boolean; error?: string }>;

  onLog: (callback: (log: Omit<LogEntry, "timestamp">) => void) => CleanupFn;
  onStatusChange: (callback: (status: DGNClientStatus) => void) => CleanupFn;
  onDockerProgress: (callback: (progress: DockerPullProgress | null) => void) => CleanupFn;
  onJobStatus: (callback: (payload: any) => void) => CleanupFn;
  onDiskSpaceError: (callback: (data: {
    image_name: string;
    required_gb: number;
    available_gb: number;
    message: string;
  }) => void) => CleanupFn;

  // Authentication
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  onSession: (callback: (session: Session | null) => void) => CleanupFn;
  onAuthCallback: (callback: (url: string) => void) => CleanupFn;
  setSessionFromTokens: (accessToken: string, refreshToken: string) => Promise<SessionResult>;

  // Window controls
  setWindowClosable: (closable: boolean) => void;

  // Force refresh handling
  onForceRefresh: (callback: () => void) => CleanupFn;
  
  // Force logout handling (permanent auth failure)
  onForceLogout: (callback: () => void) => CleanupFn;

  // Session management
  getSession: () => Promise<Session | null>;

  // Utility to remove listeners
  removeAllListeners: (channel: string) => void;

  // Search
  searchUsers: (term: string) => Promise<SearchUsersResult>;
  searchProjects: (term: string) => Promise<SearchProjectsResult>;

  // Config
  fetchConfig: () => Promise<Record<string, { service_name: string; label: string }>>;

  // General Search
  searchGeneral: (query: string) => Promise<Array<{ id: string; title: string }>>;

  // Docker Management
  listDockerImages: () => Promise<DockerImagesResult>;
  listDockerContainers: () => Promise<DockerContainersResult>;
  removeDockerImage: (imageId: string) => Promise<DockerOperationResult>;
  onJobStatus: (callback: (payload: any) => void) => () => void;
  removeAllDockerImages: () => Promise<DockerOperationResult>;
  stopContainer: (containerId: string) => Promise<DockerOperationResult>;
  stopAllContainers: () => Promise<DockerOperationResult>;
  cleanupDocker: () => Promise<DockerOperationResult>;
  getDiskSpace: () => Promise<{
    success: boolean;
    error?: string;
    data: {
      total_gb: string;
      used_gb: string;
      free_gb: string;
      path: string;
    };
  }>;

  // Dependency Detection
  checkDocker: () => Promise<DockerStatus>;
  checkNvidia: () => Promise<NvidiaStatus>;
  openDockerDownload: () => Promise<{ success: boolean }>;
  
  // Auto Updater - return cleanup functions
  onUpdateAvailable: (callback: (info: UpdateInfo) => void) => CleanupFn;
  onUpdateProgress: (callback: (progress: UpdateProgress) => void) => CleanupFn;
  onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => CleanupFn;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;

  // Settings persistence
  loadSettings: () => Promise<Record<string, unknown> | null>;
  saveSettings: (settings: Record<string, unknown>) => Promise<SettingsResult>;

  // Schedule Management
  getScheduleConfig: () => Promise<ScheduleConfig>;
  setScheduleConfig: (config: ScheduleConfig) => Promise<SettingsResult>;
  getScheduleStatus: () => Promise<ScheduleStatus>;
  getSchedulePresets: () => Promise<Array<{ id: string; label: string; config: ScheduleConfig }>>;
  getSystemIdleTime: () => Promise<number>;
  onScheduleStatus: (callback: (status: ScheduleStatus) => void) => CleanupFn;
  
  // Versions and Environment
  getProcessInfo: () => Promise<ProcessInfo>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export type { ElectronAPI };
