export type DGNClientStatus =
  | "running"
  | "stopped"
  | "error"
  | "starting"
  | "stopping";

export interface LogEntry {
  type: "stdout" | "stderr";
  message: string;
  timestamp: string;
}

export interface JobStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

// Redefined types for desktop app to avoid coupling with website types
export interface AssetMetadata {
  type?: string;
  [key: string]: unknown;
}

export interface Asset {
  id: string;
  project_id: string | null;
  owner_id: string | null;
  parent_entity_id: string | null;
  asset_type: string;
  storage_path: string;
  metadata: AssetMetadata | null;
  created_by: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  username: string;
  avatar?: Asset;
  avatar_url?: string;
}

export interface Project {
  id: string;
  title: string;
  description?: string;
  prompt?: string;
  style?: string;
  script?: string;
  is_public?: boolean;
  created_by: string;
  created_at: string;
  creator?: Profile;
  logo?: Asset;
  logo_url?: string;
  slug: string;
}

/** Community jobs this provider accepts alongside its own jobs. */
export type CommunityMode = "none" | "trusted_users" | "trusted_projects" | "all";

/**
 * Unified provider routing config.
 * Replaces the single JobPolicy enum with two orthogonal settings:
 *   - processOwnJobs: poll own (mine-policy) jobs first
 *   - communityMode: which community jobs to accept when idle
 *   - monetizeMode: separate paid-job track
 */
export interface ProviderRoutingConfig {
  processOwnJobs: boolean;
  communityMode: CommunityMode;
  trustedIds: string[]; // user IDs (trusted_users) or project IDs (trusted_projects)
  monetizeMode: boolean;
}

export const DEFAULT_ROUTING_CONFIG: ProviderRoutingConfig = {
  processOwnJobs: true,
  communityMode: "none",
  trustedIds: [],
  monetizeMode: false,
};

export interface MonetizeWallet {
  pending_earnings_cents: number;
  available_to_withdraw_cents: number;
  total_earned_lifetime_cents: number;
  total_withdrawn_cents: number;
  prepaid_balance_cents: number;
  total_purchased_cents: number;
  stripe_account_verified: boolean;
  stripe_details_submitted: boolean;
}

export interface MonetizeConfig {
  enabled: boolean;
  idleTimeoutMinutes: number;
}

export interface DockerPullProgress {
  image: string;
  service_type: string | null;
  progress: number;
  status: string;
}

export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  created: string;
}

export interface DockerStatus {
  installed: boolean;
  running: boolean;
  error?: string;
  installDrive?: string;
  isNative?: boolean;
  isStarting?: boolean;
  storagePath?: string;
  activeEngine?: "desktop" | "wsl" | "linux";
  enginePreference?: DockerEnginePreference;
  availableEngines?: {
    desktop: boolean;
    wsl: boolean;
  };
}

export type DockerEnginePreference = "auto" | "desktop" | "wsl";

export interface NvidiaStatus {
  available: boolean;
  gpu: string | null;
  cudaVersion?: string | null;
  isOutdated?: boolean;
}

export interface DependencyStatus {
  docker: DockerStatus;
  nvidia: NvidiaStatus;
  allReady: boolean;
}

// Schedule Types
export interface ScheduleSlot {
  startTime: string;
  endTime: string;
  days: string[];
}

export interface ScheduleConfig {
  mode: "manual" | "scheduled" | "idle";
  schedules: ScheduleSlot[];
  idleThresholdMinutes?: number;
  idleOnlyDuringSchedule?: boolean;
  pauseOnBattery?: boolean;
}

export interface ScheduleStatus {
  mode: string;
  isActive: boolean;
  isRunning?: boolean;
  message: string;
  schedules?: ScheduleSlot[];
}

export interface ProviderRateInfo {
  custom_rate_cents_per_vram_gb_min: number | null;
  platform_rate_cents_per_vram_gb_min: number;
  platform_fee_percent: number;
  floor_rate: number;
  /** Dynamic ceiling: lower when fewer providers online (1.5x–3.0x platform rate). */
  ceiling_rate: number;
  effective_rate: number;
  effective_rate_hourly_dollars: number;
  /** Anti-sybil: only providers priced at/below platform rate contribute to this average. */
  market_avg_rate: number | null;
  market_avg_rate_hourly_dollars: number | null;
  online_monetize_providers_count: number;
  /** Number of pending monetize jobs (used for demand surge signal). */
  pending_jobs_count: number | null;
  /** Surge multiplier applied to suggested rate based on demand/supply ratio. */
  surge_factor: number | null;
  suggested_rate_cents_per_vram_gb_min: number | null;
  suggested_rate_hourly_dollars: number | null;
  display_vram_gb: number;
  /** Seconds remaining in the rate-increase cooldown (0 = can change now). */
  cooldown_remaining_seconds: number;
  error?: string;
}
