import type { LogEntry, DGNClientStatus } from "./types";

declare global {
  interface Window {
    electronAPI: {
      startClient: () => void;
      stopClient: () => void;
      onLog: (callback: (log: LogEntry) => void) => void;
      onStatusChange: (callback: (status: DGNClientStatus) => void) => void;
      removeAllListeners: (
        channel: "dgn-client:log" | "dgn-client:status"
      ) => void;
    };
  }
}
