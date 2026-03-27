import type { LogEntry, DGNClientStatus, Profile, Project, DockerPullProgress, ScheduleConfig, ScheduleStatus } from "./types";
import type { Session, AuthError } from "@supabase/supabase-js";

interface ProviderRateInfo {
  custom_rate_cents_per_vram_gb_min: number | null;
  platform_rate_cents_per_vram_gb_min: number;
  platform_fee_percent: number;
  floor_rate: number;
  ceiling_rate: number;
  effective_rate: number;
  effective_rate_hourly_dollars: number;
  market_avg_rate: number | null;
  market_avg_rate_hourly_dollars: number | null;
  online_monetize_providers_count: number;
  suggested_rate_cents_per_vram_gb_min: number;
  suggested_rate_hourly_dollars: number;
  display_vram_gb: number;
  error?: string;
}

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
      checkDocker: () => Promise<{ installed: boolean; running: boolean; error?: string; installDrive?: string; isNative?: boolean; isStarting?: boolean }>;
      checkNvidia: () => Promise<{ available: boolean; gpu: string | null }>;
      openDockerDownload: () => Promise<{ success: boolean }>;
      installEngine: (installPath?: string) => Promise<{ success: boolean; error?: string }>;
      onInstallProgress: (callback: (data: { line: string; phase: string; percent: number }) => void) => () => void;
      cancelInstall: () => Promise<{ success: boolean; error?: string }>;
      resetWslDistro: () => Promise<{ success: boolean }>;
      onWslDistroMissing: (callback: (data: { distroName: string }) => void) => () => void;
      
      // Disk Management
      getAvailableDrives: () => Promise<{ name: string; freeGB: number }[]>;
      reclaimDiskSpace: () => Promise<{ success: boolean; error?: string }>;
      relocateStorage: (newDrivePath: string) => Promise<{ success: boolean; error?: string }>;
      
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

      // Monetize / Stripe
      openStripeOnboard: () => Promise<{ success?: boolean; error?: string }>;
      openStripeDashboard: () => Promise<{ success?: boolean; error?: string }>;
      startMonetizeCleanup: () => void;
      stopMonetizeCleanup: () => void;
      setMonetizeIdleTimeout: (minutes: number) => Promise<{ success: boolean }>;
      getMonetizeConfig: () => Promise<{ idleTimeoutMinutes: number; enabled: boolean }>;
      onMonetizeCleanupEvent: (callback: (evt: { service_type: string; image: string; reason: string; timestamp: string }) => void) => () => void;

      // Provider custom pricing
      getProviderRate: () => Promise<ProviderRateInfo>;
      setProviderRate: (rate: number | null) => Promise<ProviderRateInfo>;

      // External Links
      openExternal: (url: string) => void;
    };
  }
}

