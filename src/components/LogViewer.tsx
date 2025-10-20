import { useRef, useEffect } from "react";
import { useClientStore } from "@/store";
import { Button } from "@/components/ui/button";

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
    <div className="h-full flex flex-col bg-secondary rounded-lg p-4">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold">Client Logs</h2>
        <Button
          variant="destructive"
          size="sm"
          onClick={clearLogs}
        >
          Clear Logs
        </Button>
      </div>
      <div
        ref={logContainerRef}
        className="flex-grow overflow-y-auto bg-card rounded p-2 font-mono text-sm h-[calc(100vh-300px)]"
      >
        {logs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>No logs yet. Start the client to see output.</p>
          </div>
        ) : (
          logs
            .slice()
            .reverse()
            .map((log, index) => (
              <div
                key={index}
                className={`whitespace-pre-wrap ${
                  log.type === "stderr" ? "text-destructive" : "text-foreground"
                }`}
              >
                <span className="text-muted-foreground mr-4">[{log.timestamp}]</span>
                {log.message}
              </div>
            ))
        )}
      </div>
    </div>
  );
};