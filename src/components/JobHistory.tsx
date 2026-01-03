import { useState, useEffect, memo, useCallback, useMemo } from "react";
import { useClientStore } from "@/store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  History, 
  RefreshCw, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Loader2,
  Image as ImageIcon,
  Video,
  Music,
  MessageSquare,
  Sparkles,
  Search,
  X
} from "lucide-react";
import { supabase } from "@/supabase";
import { Badge } from "@/components/ui/badge";

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
  user_id: string | null;
  user: {
    username: string;
    avatar_url: string | null;
  } | null;
}

const WORKFLOW_ICONS: Record<string, React.ReactNode> = {
  "image_generation": <ImageIcon className="h-4 w-4" />,
  "turbodiffusion": <ImageIcon className="h-4 w-4" />,
  "image_to_video": <Video className="h-4 w-4" />,
  "text_to_video": <Video className="h-4 w-4" />,
  "video_upscale": <Sparkles className="h-4 w-4" />,
  "audio_generation": <Music className="h-4 w-4" />,
  "tts": <MessageSquare className="h-4 w-4" />,
  "llm": <MessageSquare className="h-4 w-4" />,
};

const getWorkflowIcon = (workflowType: string): React.ReactNode => {
  for (const [key, icon] of Object.entries(WORKFLOW_ICONS)) {
    if (workflowType?.toLowerCase().includes(key.toLowerCase())) {
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
  if (isNaN(date.getTime())) return "unknown";
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
    completed: { icon: <CheckCircle className="h-3 w-3" />, className: "bg-green-500/10 text-green-400 border-green-500/20" },
    failed: { icon: <XCircle className="h-3 w-3" />, className: "bg-red-500/10 text-red-400 border-red-500/20" },
    processing: { icon: <Loader2 className="h-3 w-3 animate-spin" />, className: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
    pending: { icon: <Clock className="h-3 w-3" />, className: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  };

  const { icon, className } = config[status as keyof typeof config] || config.pending;

  return (
    <Badge variant="outline" className={`flex items-center gap-1.5 px-2.5 py-0.5 font-semibold capitalize ${className}`}>
      {icon}
      {status}
    </Badge>
  );
});

const JobRow = memo(({ job }: { job: ProcessedJob }) => {
  const truncatePrompt = (prompt: string | null, maxLength: number = 70): string => {
    if (!prompt) return "No prompt provided";
    return prompt.length > maxLength ? `${prompt.substring(0, maxLength)}...` : prompt;
  };

  return (
    <div className="flex items-center gap-4 p-4 rounded-xl bg-muted/20 border border-white/5 hover:border-primary/20 hover:bg-muted/40 transition-all group">
      <div className="p-3 rounded-xl bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors shadow-inner">
        {getWorkflowIcon(job.workflow_type)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3">
          <span className="font-bold text-sm tracking-tight text-foreground/90 uppercase">
            {job.workflow_type?.replace(/_/g, " ") || "unknown workflow"}
          </span>
          <StatusBadge status={job.status} />
        </div>
        <p className="text-xs text-muted-foreground line-clamp-1 mt-1 font-medium" title={job.prompt || undefined}>
          {truncatePrompt(job.prompt)}
        </p>
      </div>
      <div className="text-right shrink-0 flex flex-col justify-center">
        <div className="text-xs font-bold text-foreground/80 flex items-center justify-end gap-1.5">
          <span className="h-1 w-1 rounded-full bg-primary/40" />
          {job.user?.username || "Unknown Submitter"}
        </div>
        <div className="text-[10px] font-medium text-muted-foreground/60 mt-1 uppercase tracking-wider">
          {formatDuration(job.duration_seconds)} <span className="mx-1">•</span> {formatTimeAgo(job.updated_at)}
        </div>
      </div>
    </div>
  );
});

export const JobHistory = memo(() => {
  const [jobs, setJobs] = useState<ProcessedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

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
      // 1. Get user's provider IDs
      const { data: providerData, error: providerError } = await supabase
        .from("dgn_providers")
        .select("id")
        .eq("user_id", session.user.id);

      if (providerError) throw providerError;
      
      const providerIds = providerData?.map(p => p.id) || [];
      
      if (providerIds.length === 0) {
        setJobs([]);
        setLoading(false);
        return;
      }

      // 2. Fetch jobs
      let query = supabase
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
          user_id
        `)
        .in("provider_id", providerIds)
        .order("updated_at", { ascending: false })
        .limit(100);

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      // 3. Fetch profiles for user mapping
      const userIds = [...new Set((data || []).map(j => j.user_id).filter(Boolean))];
      let profileMap: Record<string, { username: string; avatar_url: string | null }> = {};
      
      if (userIds.length > 0) {
        const { data: profiles, error: profileError } = await supabase
          .from("profiles")
          .select("id, username")
          .in("id", userIds);
        
        if (profileError) {
          console.warn("Could not fetch profiles, usernames will be unknown:", profileError);
        } else {
          profileMap = (profiles || []).reduce((acc, p) => {
            acc[p.id] = { username: p.username, avatar_url: null };
            return acc;
          }, {} as typeof profileMap);
        }
      }

      const mergedJobs: ProcessedJob[] = (data || []).map(job => ({
        ...job,
        user: job.user_id ? profileMap[job.user_id] || null : null
      }));

      setJobs(mergedJobs);
    } catch (err) {
      console.error("Error fetching job history:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch job history");
    } finally {
      setLoading(false);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    fetchJobHistory();
  }, [fetchJobHistory]);

  // Real-time updates
  useEffect(() => {
    if (!session?.user?.id) return;

    const channel = supabase
      .channel("job-history-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "dgn_jobs"
        },
        () => {
          fetchJobHistory();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, fetchJobHistory]);

  const filteredJobs = useMemo(() => {
    return jobs.filter(job => {
      const matchStatus = statusFilter === "all" || job.status === statusFilter;
      const matchType = typeFilter === "all" || (job.workflow_type || "").toLowerCase().includes(typeFilter.toLowerCase());
      const matchSearch = !searchQuery || 
        (job.prompt || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (job.workflow_type || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (job.user?.username || "").toLowerCase().includes(searchQuery.toLowerCase());
      
      return matchStatus && matchType && matchSearch;
    });
  }, [jobs, statusFilter, typeFilter, searchQuery]);

  const stats = useMemo(() => {
    return {
      completed: jobs.filter(j => j.status === "completed").length,
      failed: jobs.filter(j => j.status === "failed").length,
      processing: jobs.filter(j => j.status === "processing").length,
    };
  }, [jobs]);

  const workflowTypes = useMemo(() => {
    const types = new Set<string>();
    jobs.forEach(j => {
      if (j.workflow_type) {
        if (j.workflow_type.includes("video")) types.add("Video");
        else if (j.workflow_type.includes("audio") || j.workflow_type.includes("tts") || j.workflow_type.includes("diffrhythm") || j.workflow_type.includes("foley")) types.add("Audio");
        else if (j.workflow_type.includes("image") || j.workflow_type.includes("diffusion")) types.add("Image");
        else types.add("Text");
      }
    });
    return Array.from(types);
  }, [jobs]);

  if (loading && jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[400px] gap-4">
        <div className="relative">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <div className="absolute inset-0 blur-lg bg-primary/20 animate-pulse" />
        </div>
        <span className="text-muted-foreground font-medium animate-pulse">Synchronizing your work history...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60">
            Job History
          </h2>
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="bg-green-500/10 text-green-400 border-green-500/20 px-3 py-1">
            {stats.completed} Completed
          </Badge>
          <Badge variant="secondary" className="bg-red-500/10 text-red-400 border-red-500/20 px-3 py-1">
            {stats.failed} Failed
          </Badge>
          <Badge variant="secondary" className="bg-blue-500/10 text-blue-400 border-blue-500/20 px-3 py-1">
            {stats.processing} Active
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchJobHistory}
            disabled={loading}
            className="ml-2 hover:bg-primary/10 hover:text-primary transition-all rounded-full"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </header>

      {/* Filters Card */}
      <Card className="bg-card/30 backdrop-blur-xl border-white/5 shadow-2xl overflow-hidden group">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="relative flex-1 group/search">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within/search:text-primary transition-colors" />
              <input
                placeholder="Search by prompt, workflow or username..."
                className="flex h-10 w-full rounded-xl border border-white/5 bg-muted/20 px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 pl-9"
                value={searchQuery}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 p-1 bg-muted/20 border border-white/5 rounded-xl">
                {[
                  { id: "all", label: "All" },
                  { id: "completed", label: "Completed" },
                  { id: "failed", label: "Failed" },
                  { id: "processing", label: "Active" },
                ].map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setStatusFilter(s.id)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      statusFilter === s.id 
                        ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" 
                        : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 p-1 bg-muted/20 border border-white/5 rounded-xl">
                <button
                  onClick={() => setTypeFilter("all")}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                    typeFilter === "all" 
                      ? "bg-muted-foreground/20 text-foreground" 
                      : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                  }`}
                >
                  All Types
                </button>
                {workflowTypes.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTypeFilter(t)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      typeFilter === t 
                        ? "bg-muted-foreground/20 text-foreground" 
                        : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* List Card */}
      <Card className="bg-card/40 backdrop-blur-2xl border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.3)] min-h-[400px] flex flex-col rounded-3xl overflow-hidden border-t-white/20">
        <CardContent className="p-6 flex-1 overflow-y-auto max-h-[600px] custom-scrollbar">
          {error && (
            <div className="mb-6 bg-red-500/10 border border-red-500/20 text-red-200 rounded-2xl p-5 flex items-start gap-4">
              <div className="p-2 rounded-lg bg-red-500/20 text-red-400">
                <XCircle className="h-5 w-5" />
              </div>
              <div>
                <h4 className="font-bold text-sm">Synchronisation Error</h4>
                <p className="text-xs text-red-100/70 mt-1">{error}</p>
                <Button variant="link" size="sm" onClick={fetchJobHistory} className="h-auto p-0 mt-2 text-red-400 hover:text-red-300 font-bold">
                  Try reconnecting now
                </Button>
              </div>
            </div>
          )}

          {filteredJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in zoom-in duration-500">
              <div className="relative mb-6">
                <History className="h-16 w-16 text-muted-foreground/20" />
                <Search className="h-8 w-8 text-primary/30 absolute -bottom-2 -right-2 animate-bounce" />
              </div>
              <h3 className="text-xl font-bold text-foreground/80">
                {jobs.length === 0 ? "No activity detected" : "No matches found"}
              </h3>
              <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto font-medium">
                {jobs.length === 0 
                  ? "Start your DGN node and wait for jobs to arrive from the network."
                  : "Try adjusting your filters or search terms to find what you're looking for."}
              </p>
              {jobs.length > 0 && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-6 border-white/10 hover:bg-white/5 rounded-full px-6"
                  onClick={() => {
                    setStatusFilter("all");
                    setTypeFilter("all");
                    setSearchQuery("");
                  }}
                >
                  Clear all filters
                </Button>
              )}
            </div>
          ) : (
            <div className="grid gap-3">
              {filteredJobs.map((job) => (
                <JobRow key={job.id} job={job} />
              ))}
              
              <div className="mt-8 text-center">
                <p className="text-[10px] font-bold text-muted-foreground/30 uppercase tracking-[0.2em]">
                  Displaying last {filteredJobs.length} active records
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>
    </div>
  );
});
