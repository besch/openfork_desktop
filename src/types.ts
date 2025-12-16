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

export type JobPolicy = "all" | "mine" | "project" | "users";

export interface DockerPullProgress {
  image: string;
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