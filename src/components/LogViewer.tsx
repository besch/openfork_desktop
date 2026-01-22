import { useRef, useEffect, useState, useLayoutEffect } from "react";
import { useClientStore } from "@/store";
import { Button } from "@/components/ui/button";
import { ArrowUp, ArrowDown } from "lucide-react";

export const LogViewer = () => {
  const logs = useClientStore((state) => state.logs);
  const clearLogs = useClientStore((state) => state.clearLogs);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [newestOnTop, setNewestOnTop] = useState(true);

  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  // Handle auto-scroll on log updates
  useLayoutEffect(() => {
    if (!logContainerRef.current || !shouldAutoScroll) return;

    if (newestOnTop) {
      logContainerRef.current.scrollTop = 0;
    } else {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, newestOnTop, shouldAutoScroll]);

  // Track scroll position to update auto-scroll state
  const handleScroll = () => {
    if (!logContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    
    if (newestOnTop) {
      // If newest at top, we want to auto-scroll if we are at the top (scrollTop near 0)
      const isAtTop = scrollTop < 10;
      setShouldAutoScroll(isAtTop);
    } else {
      // If oldest first (newest at bottom), we want to auto-scroll if at the bottom
      const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 10;
      setShouldAutoScroll(isAtBottom);
    }
  };

  // Reset auto-scroll when switching modes
  useEffect(() => {
    setShouldAutoScroll(true);
  }, [newestOnTop]);

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
          <Button variant="destructive" size="sm" onClick={() => {
            clearLogs();
            setShouldAutoScroll(true);
          }}>
            Clear Logs
          </Button>
        </div>
      </div>
      <div
        ref={logContainerRef}
        onScroll={handleScroll}
        className="flex-grow overflow-y-auto bg-background/50 rounded p-2 font-mono text-sm h-[calc(100vh-300px)] border border-white/5"
        style={{ overflowAnchor: "auto" }}
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
