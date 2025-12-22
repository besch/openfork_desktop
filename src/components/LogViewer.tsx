import { useRef, useEffect, useState } from "react";
import { useClientStore } from "@/store";
import { Button } from "@/components/ui/button";
import { ArrowUp, ArrowDown } from "lucide-react";

export const LogViewer = () => {
  const logs = useClientStore((state) => state.logs);
  const clearLogs = useClientStore((state) => state.clearLogs);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [newestOnTop, setNewestOnTop] = useState(true);

  useEffect(() => {
    if (logContainerRef.current) {
      if (newestOnTop) {
        logContainerRef.current.scrollTop = 0; // Scroll to the top to see newest logs
      } else {
        logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight; // Scroll to bottom for chronological
      }
    }
  }, [logs, newestOnTop]);

  const displayedLogs = newestOnTop ? logs : logs.slice().reverse();

  return (
    <div className="h-full flex flex-col bg-card/50 backdrop-blur-sm border border-white/10 rounded-lg p-4">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold">Client Logs</h2>
        <div className="flex gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => setNewestOnTop(!newestOnTop)}
          >
            {newestOnTop ? (
              <ArrowDown className="h-4 w-4 mr-2" />
            ) : (
              <ArrowUp className="h-4 w-4 mr-2" />
            )}
            {newestOnTop ? "Newest First" : "Oldest First"}
          </Button>
          <Button variant="destructive" size="sm" onClick={clearLogs}>
            Clear Logs
          </Button>
        </div>
      </div>
      <div
        ref={logContainerRef}
        className="flex-grow overflow-y-auto bg-background/50 rounded p-2 font-mono text-sm h-[calc(100vh-300px)] border border-white/5"
      >
        {displayedLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>No logs yet. Start the client to see output.</p>
          </div>
        ) : (
          displayedLogs.map((log, index) => (
            <div
              key={index}
              className={`whitespace-pre-wrap ${
                log.type === "stderr" ? "text-destructive" : "text-foreground"
              }`}
            >
              <span className="text-muted-foreground mr-4">
                [{log.timestamp}]
              </span>
              {log.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
