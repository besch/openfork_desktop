export type DGNClientStatus = 'running' | 'stopped' | 'error' | 'starting';

export interface LogEntry {
  type: 'stdout' | 'stderr';
  message: string;
  timestamp: string;
}

export interface JobStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}
