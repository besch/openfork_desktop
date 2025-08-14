import { useRef, useEffect } from "react";
import { useClientStore } from "@/store";
import { Button } from "@/components/ui/Button";

export const LogViewer = () => {
  const logs = useClientStore((state) => state.logs);
  const clearLogs = useClientStore((state) => state.clearLogs);
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = 0; // Scroll to the top to see newest logs
    }
  }, [logs]);

  return (
    <div className="h-[600px] flex flex-col bg-secondary rounded-lg p-4">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-xl font-bold">Client Logs</h2>
        <Button variant="destructive" size="sm" onClick={clearLogs}>
          Clear Logs
        </Button>
      </div>
      <div
        ref={logContainerRef}
        className="flex-grow overflow-y-auto bg-gray-900 rounded p-2 font-mono text-sm"
      >
        {logs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>No logs yet. Start the client to see output.</p>
          </div>
        ) : (
          logs.map((log, index) => (
            <div
              key={index}
              className={`whitespace-pre-wrap ${
                log.type === "stderr" ? "text-red-400" : "text-gray-300"
              }`}
            >
              <span className="text-gray-500 mr-4">[{log.timestamp}]</span>
              {log.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
