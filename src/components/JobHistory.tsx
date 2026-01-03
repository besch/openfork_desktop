import { useState, useEffect, memo, useCallback } from "react";
import { useClientStore } from "@/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  History, 
  RefreshCw, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Loader2,
  Image,
  Video,
  Music,
  MessageSquare,
  Sparkles
} from "lucide-react";
import { supabase } from "@/supabase";

interface ProcessedJob {
  id: string;
  workflow_type: string;
  service_type: string | null;
  status: string;
  prompt: string | null;
  created_at: string;
  updated_at: string;
  generation_started_at: string | null;
  generation_completed_at: string | null;
  duration_seconds: number | null;
  user: {
    username: string;
    avatar_url: string | null;
  } | null;
}

const WORKFLOW_ICONS: Record<string, React.ReactNode> = {
  "image_generation": <Image className="h-4 w-4" />,
  "turbodiffusion": <Image className="h-4 w-4" />,
  "image_to_video": <Video className="h-4 w-4" />,
  "text_to_video": <Video className="h-4 w-4" />,
  "video_upscale": <Sparkles className="h-4 w-4" />,
  "audio_generation": <Music className="h-4 w-4" />,
  "tts": <MessageSquare className="h-4 w-4" />,
  "llm": <MessageSquare className="h-4 w-4" />,
};

const getWorkflowIcon = (workflowType: string): React.ReactNode => {
  // Check for partial matches
  for (const [key, icon] of Object.entries(WORKFLOW_ICONS)) {
    if (workflowType.toLowerCase().includes(key.toLowerCase())) {
      return icon;
    }
  }
  return <Sparkles className="h-4 w-4" />;
};

const formatDuration = (seconds: number | null): string => {
  if (!seconds) return "-";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
};

const formatTimeAgo = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
};

const StatusBadge = memo(({ status }: { status: string }) => {
  const config = {
    completed: { icon: <CheckCircle className="h-3 w-3" />, className: "bg-green-500/20 text-green-400 border-green-500/30" },
    failed: { icon: <XCircle className="h-3 w-3" />, className: "bg-red-500/20 text-red-400 border-red-500/30" },
    processing: { icon: <Loader2 className="h-3 w-3 animate-spin" />, className: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
    pending: { icon: <Clock className="h-3 w-3" />, className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  };

  const { icon, className } = config[status as keyof typeof config] || config.pending;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${className}`}>
      {icon}
      {status}
    </span>
  );
});

const JobRow = memo(({ job }: { job: ProcessedJob }) => {
  const truncatePrompt = (prompt: string | null, maxLength: number = 60): string => {
    if (!prompt) return "No prompt";
    return prompt.length > maxLength ? `${prompt.substring(0, maxLength)}...` : prompt;
  };

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-white/5 hover:border-primary/30 hover:bg-muted/50 transition-colors">
      <div className="p-2 rounded-lg bg-primary/10 text-primary">
        {getWorkflowIcon(job.workflow_type)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">
            {job.workflow_type.replace(/_/g, " ")}
          </span>
          <StatusBadge status={job.status} />
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5" title={job.prompt || undefined}>
          {truncatePrompt(job.prompt)}
        </p>
      </div>
      <div className="text-right shrink-0">
        <div className="text-xs font-medium text-muted-foreground">
          {job.user?.username || "Unknown"}
        </div>
        <div className="text-xs text-muted-foreground/70">
          {formatDuration(job.duration_seconds)} • {formatTimeAgo(job.updated_at)}
        </div>
      </div>
    </div>
  );
});

export const JobHistory = memo(() => {
  const [jobs, setJobs] = useState<ProcessedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const providerId = useClientStore((state) => state.providerId);
  const session = useClientStore((state) => state.session);

  const fetchJobHistory = useCallback(async () => {
    if (!session?.user?.id) {
      setJobs([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Fetch jobs processed by this user's provider (across all sessions)
      const { data, error: fetchError } = await supabase
        .from("dgn_jobs")
        .select(`
          id,
          workflow_type,
          service_type,
          status,
          prompt,
          created_at,
          updated_at,
          generation_started_at,
          generation_completed_at,
          duration_seconds,
          user:profiles!dgn_jobs_user_id_fkey(username, avatar_url)
        `)
        .or(`provider_id.eq.${providerId},status.in.(completed,failed)`)
        .eq("provider_id", providerId || "00000000-0000-0000-0000-000000000000")
        .order("updated_at", { ascending: false })
        .limit(50);

      if (fetchError) throw fetchError;

      // Type assertion for the joined data
      const typedJobs = (data || []).map(job => ({
        ...job,
        user: Array.isArray(job.user) ? job.user[0] : job.user
      })) as ProcessedJob[];

      setJobs(typedJobs);
    } catch (err) {
      console.error("Error fetching job history:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch job history");
    } finally {
      setLoading(false);
    }
  }, [session?.user?.id, providerId]);

  // Initial fetch
  useEffect(() => {
    fetchJobHistory();
  }, [fetchJobHistory]);

  // Realtime subscription for job updates
  useEffect(() => {
    if (!providerId) return;

    const channel = supabase
      .channel(`job-history-${providerId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "dgn_jobs",
          filter: `provider_id=eq.${providerId}`
        },
        () => {
          fetchJobHistory();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [providerId, fetchJobHistory]);

  const completedCount = jobs.filter(j => j.status === "completed").length;
  const failedCount = jobs.filter(j => j.status === "failed").length;

  if (loading && jobs.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Loading job history...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold">Job History</h2>
          <Button
            variant="primary"
            size="sm"
            onClick={fetchJobHistory}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1 text-green-400">
            <CheckCircle className="h-4 w-4" />
            {completedCount} completed
          </span>
          <span className="flex items-center gap-1 text-red-400">
            <XCircle className="h-4 w-4" />
            {failedCount} failed
          </span>
        </div>
      </header>

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive-foreground rounded-lg p-4">
          {error}
        </div>
      )}

      <Card className="bg-card/50 backdrop-blur-sm border-white/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            Jobs Processed by Your Provider
          </CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <div className="text-center py-8">
              <History className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground">
                No jobs processed yet. Start your DGN client to begin processing jobs.
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
              {jobs.map((job) => (
                <JobRow key={job.id} job={job} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
});
