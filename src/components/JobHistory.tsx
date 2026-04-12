import { useState, useEffect, memo, useCallback, useMemo, useRef } from "react";
import { useClientStore } from "@/store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import {
  History,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Image as ImageIcon,
  Video,
  Music,
  MessageSquare,
  Sparkles,
  Search,
  X,
} from "lucide-react";
import { supabase } from "@/supabase";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  image_generation: <ImageIcon className="h-4 w-4" />,
  turbodiffusion: <ImageIcon className="h-4 w-4" />,
  image_to_video: <Video className="h-4 w-4" />,
  text_to_video: <Video className="h-4 w-4" />,
  video_upscale: <Sparkles className="h-4 w-4" />,
  audio_generation: <Music className="h-4 w-4" />,
  tts: <MessageSquare className="h-4 w-4" />,
  llm: <MessageSquare className="h-4 w-4" />,
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
    completed: {
      icon: <CheckCircle className="h-3 w-3 text-white" />,
      className: "border-primary bg-primary/70 text-white",
    },
    failed: {
      icon: <XCircle className="h-3 w-3 text-white" />,
      className: "border-destructive bg-destructive/70 text-white",
    },
    cancelled: {
      icon: <XCircle className="h-3 w-3 text-white" />,
      className: "border-merged-status bg-merged-status/70 text-white-status",
    },
    processing: {
      icon: <Loader size="xs" className="text-merged-status" />,
      className: "border-merged-status bg-merged-status/70 text-white-status",
    },
    pending: {
      icon: <Clock className="h-3 w-3 text-white" />,
      className: "border-white/5 bg-white/20 text-muted/50",
    },
  };

  const { icon, className } =
    config[status as keyof typeof config] || config.pending;

  return (
    <Badge
      variant="outline"
      className={`flex items-center gap-1.5 px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all duration-300 ${className}`}
    >
      {icon}
      {status}
    </Badge>
  );
});

const JobRow = memo(({ job }: { job: ProcessedJob }) => {
  const truncatePrompt = (
    prompt: string | null,
    maxLength: number = 70,
  ): string => {
    if (!prompt) return "No prompt provided";
    return prompt.length > maxLength
      ? `${prompt.substring(0, maxLength)}...`
      : prompt;
  };

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-surface/40 border border-white/20 hover:border-white/30 hover:bg-surface/50 transition-all duration-500 group relative overflow-hidden shadow-sm">
      <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      <div className="relative z-10 p-2 rounded-lg bg-white/5 border border-white/5 text-white/70 group-hover:text-white group-hover:scale-105 transition-all duration-500">
        {getWorkflowIcon(job.workflow_type)}
      </div>
      <div className="relative z-10 flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-black text-[10px] tracking-widest text-white uppercase line-clamp-1">
            {job.workflow_type?.replace(/_/g, " ") || "unknown workflow"}
          </span>
          <StatusBadge status={job.status} />
        </div>
        <p
          className="text-[10px] text-white/70 line-clamp-1 mt-0.5 font-medium group-hover:text-white/90 transition-colors"
          title={job.prompt || undefined}
        >
          {truncatePrompt(job.prompt)}
        </p>
      </div>
      <div className="relative z-10 text-right shrink-0 flex flex-col justify-center">
        <div className="text-[9px] font-black tracking-widest text-white/80 flex items-center justify-end group-hover:text-white transition-colors">
          {job.user?.username ? (
            <a
              href={`https://openfork.video/${job.user.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary-active transition-colors cursor-pointer underline-offset-4 hover:underline"
            >
              @{job.user.username.toUpperCase()}
            </a>
          ) : (
            "UNKNOWN USER"
          )}
        </div>
        <div className="text-[8px] font-black text-white/40 mt-0.5 uppercase tracking-[0.2em] flex items-center justify-end gap-2">
          {job.duration_seconds && (
            <span className="flex items-center gap-1">
              <Clock size={8} className="opacity-50" />
              {formatDuration(job.duration_seconds)}
            </span>
          )}
          {job.duration_seconds && <span className="opacity-20">•</span>}
          <span>{formatTimeAgo(job.updated_at)}</span>
        </div>
      </div>
    </div>
  );
});

export const JobHistory = memo(() => {
  const [jobs, setJobs] = useState<ProcessedJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 20;

  // Refs to avoid stale closure or infinite loops in useCallback
  const pageRef = useRef(0);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");

  const session = useClientStore((state) => state.session);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchJobHistory = useCallback(
    async (isInitial = false) => {
      if (!session?.user?.id) {
        setJobs([]);
        setLoading(false);
        return;
      }

      const targetPage = isInitial ? 0 : pageRef.current;
      if (!isInitial && (!hasMoreRef.current || loadingRef.current)) return;

      setLoading(true);
      loadingRef.current = true;
      setError(null);

      try {
        // 1. Get user's provider IDs
        const { data: providerData, error: providerError } = await supabase
          .from("dgn_providers")
          .select("id")
          .eq("user_id", session.user.id);

        if (providerError) throw providerError;

        const providerIds = providerData?.map((p) => p.id) || [];

        if (providerIds.length === 0) {
          setJobs([]);
          setLoading(false);
          loadingRef.current = false;
          setHasMore(false);
          hasMoreRef.current = false;
          return;
        }

        // 2. Fetch jobs with server-side filters and pagination
        let query = supabase
          .from("dgn_jobs")
          .select(
            `
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
          `,
          )
          .in("provider_id", providerIds);

        if (statusFilter !== "all") {
          query = query.eq("status", statusFilter);
        }

        if (typeFilter !== "all") {
          query = query.ilike("workflow_type", `%${typeFilter}%`);
        }

        if (debouncedSearchQuery) {
          // Fetch matching user IDs for username search
          const { data: matchedProfiles } = await supabase
            .from("profiles")
            .select("id")
            .ilike("username", `%${debouncedSearchQuery}%`);

          const orConditions = [
            `prompt.ilike.%${debouncedSearchQuery}%`,
            `workflow_type.ilike.%${debouncedSearchQuery}%`,
          ];

          if (matchedProfiles && matchedProfiles.length > 0) {
            const matchedUserIds = matchedProfiles.map((p) => p.id);
            orConditions.push(`user_id.in.(${matchedUserIds.join(",")})`);
          }
          query = query.or(orConditions.join(","));
        }

        const from = targetPage * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;

        query = query.order("updated_at", { ascending: false }).range(from, to);

        const { data, error: fetchError } = await query;

        if (fetchError) throw fetchError;

        // 3. Fetch profiles for user mapping
        const userIds = [
          ...new Set((data || []).map((j) => j.user_id).filter(Boolean)),
        ];
        let profileMap: Record<
          string,
          { username: string; avatar_url: string | null }
        > = {};

        if (userIds.length > 0) {
          const { data: profiles, error: profileError } = await supabase
            .from("profiles")
            .select("id, username")
            .in("id", userIds);

          if (profileError) {
            console.warn(
              "Could not fetch profiles, usernames will be unknown:",
              profileError,
            );
          } else {
            profileMap = (profiles || []).reduce(
              (acc, p) => {
                acc[p.id] = { username: p.username, avatar_url: null };
                return acc;
              },
              {} as typeof profileMap,
            );
          }
        }

        const mergedJobs: ProcessedJob[] = (data || []).map((job) => ({
          ...job,
          user: job.user_id ? profileMap[job.user_id] || null : null,
        }));

        if (isInitial) {
          setJobs(mergedJobs);
          pageRef.current = 1;
        } else {
          setJobs((prev) => {
            const existingIds = new Set(prev.map((j) => j.id));
            const newJobs = mergedJobs.filter((j) => !existingIds.has(j.id));
            return [...prev, ...newJobs];
          });
          pageRef.current = pageRef.current + 1;
        }
        const hasMoreData = mergedJobs.length === PAGE_SIZE;
        setHasMore(hasMoreData);
        hasMoreRef.current = hasMoreData;
      } catch (err) {
        console.error("Error fetching job history:", err);
        setError(
          err instanceof Error ? err.message : "Failed to fetch job history",
        );
      } finally {
        setLoading(false);
        loadingRef.current = false;
      }
    },
    [session?.user?.id, statusFilter, typeFilter, debouncedSearchQuery],
  );

  // Initial load or when filters change
  useEffect(() => {
    fetchJobHistory(true);
  }, [fetchJobHistory]);

  // Intersection observer for infinite scroll
  const observer = useRef<IntersectionObserver | null>(null);
  const lastJobElementRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (loading) return;
      if (observer.current) observer.current.disconnect();
      observer.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasMore) {
          fetchJobHistory();
        }
      });
      if (node) observer.current.observe(node);
    },
    [loading, hasMore, fetchJobHistory],
  );

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
          table: "dgn_jobs",
        },
        () => {
          // On real-time update, we refresh to catch new entries at the top
          fetchJobHistory(true);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, fetchJobHistory]);

  const filteredJobs = jobs; // Results are already filtered by the server

  const stats = useMemo(() => {
    return {
      completed: jobs.filter((j) => j.status === "completed").length,
      failed: jobs.filter((j) => j.status === "failed").length,
      cancelled: jobs.filter((j) => j.status === "cancelled").length,
      processing: jobs.filter((j) => j.status === "processing").length,
    };
  }, [jobs]);

  const workflowTypes = useMemo(() => {
    const types = new Set<string>(["Image", "Video", "Audio", "Text"]);
    jobs.forEach((j) => {
      if (j.workflow_type) {
        if (j.workflow_type.includes("video")) types.add("Video");
        else if (
          j.workflow_type.includes("audio") ||
          j.workflow_type.includes("tts") ||
          j.workflow_type.includes("diffrhythm") ||
          j.workflow_type.includes("foley")
        )
          types.add("Audio");
        else if (
          j.workflow_type.includes("image") ||
          j.workflow_type.includes("diffusion")
        )
          types.add("Image");
        else types.add("Text");
      }
    });
    return Array.from(types);
  }, [jobs]);

  if (loading && jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[400px] gap-4">
        <Loader size="lg" variant="white" />
        <span className="text-muted-foreground font-medium animate-pulse">
          Synchronizing your work history...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="primary">{stats.completed} Completed</Badge>
          <Badge variant="secondary">{stats.failed} Failed</Badge>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => fetchJobHistory(true)}
          disabled={loading}
          className="rounded-lg"
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${loading && jobs.length === 0 ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {/* Filters Card */}
      <Card className="bg-card/40 backdrop-blur-xl border-white/20 shadow-2xl overflow-hidden group">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[200px] group/search">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50 group-focus-within/search:text-white transition-colors" />
              <input
                placeholder="Search by prompt, workflow or username..."
                className="flex h-10 w-full rounded-lg border border-white/5 bg-muted/20 px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 pl-9"
                value={searchQuery}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setSearchQuery(e.target.value)
                }
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white transition-colors"
                >
                  <X className="h-4 w-4 text-white" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px] bg-muted/20 border-white/5 text-xs font-bold">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent className="bg-surface border-white/10">
                  <SelectItem
                    value="all"
                    className="text-xs font-bold focus:bg-primary/20 focus:text-white"
                  >
                    All Statuses
                  </SelectItem>
                  <SelectItem
                    value="completed"
                    className="text-xs font-bold focus:bg-primary/20 focus:text-white"
                  >
                    Completed
                  </SelectItem>
                  <SelectItem
                    value="failed"
                    className="text-xs font-bold focus:bg-primary/20 focus:text-white"
                  >
                    Failed
                  </SelectItem>
                  <SelectItem
                    value="cancelled"
                    className="text-xs font-bold focus:bg-primary/20 focus:text-white"
                  >
                    Cancelled
                  </SelectItem>
                  <SelectItem
                    value="processing"
                    className="text-xs font-bold focus:bg-primary/20 focus:text-white"
                  >
                    Active
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[140px] bg-muted/20 border-white/5 text-xs font-bold">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent className="bg-surface border-white/10">
                  <SelectItem
                    value="all"
                    className="text-xs font-bold focus:bg-primary/20 focus:text-white"
                  >
                    All Types
                  </SelectItem>
                  {workflowTypes.map((t) => (
                    <SelectItem
                      key={t}
                      value={t}
                      className="text-xs font-bold focus:bg-primary/20 focus:text-white"
                    >
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* List Card */}
      <Card className="bg-surface/20 backdrop-blur-3xl border-white/20 shadow-3xl min-h-[400px] flex flex-col rounded-lg overflow-hidden">
        <CardContent className="p-8 flex-1 overflow-y-auto max-h-[600px] scrollbar-thin scrollbar-primary">
          {error && (
            <div className="mb-6 bg-destructive-foreground/10 border border-destructive-foreground/20 text-destructive-foreground rounded-lg p-5 flex items-start gap-4">
              <div className="p-2 rounded-lg bg-destructive-foreground/20 text-destructive-foreground">
                <XCircle className="h-5 w-5" />
              </div>
              <div>
                <h4 className="font-bold text-sm">Synchronisation Error</h4>
                <p className="text-xs text-destructive-foreground/70 mt-1">
                  {error}
                </p>
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => fetchJobHistory(true)}
                  className="h-auto p-0 mt-2 text-destructive-foreground hover:text-destructive-foreground/80 font-bold"
                >
                  Try reconnecting now
                </Button>
              </div>
            </div>
          )}

          {filteredJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in zoom-in duration-500">
              <div className="relative mb-6">
                <History className="h-16 w-16 text-white/20" />
                <Search className="h-8 w-8 text-white/30 absolute -bottom-2 -right-2 animate-bounce" />
              </div>
              <h3 className="text-xl font-bold text-foreground/80">
                {jobs.length === 0
                  ? "No activity detected"
                  : "No matches found"}
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
              {filteredJobs.map((job, index) => {
                if (filteredJobs.length === index + 1) {
                  return (
                    <div ref={lastJobElementRef} key={job.id}>
                      <JobRow job={job} />
                    </div>
                  );
                }
                return <JobRow key={job.id} job={job} />;
              })}

              {loading && jobs.length > 0 && (
                <div className="flex justify-center py-4">
                  <Loader size="md" className="text-white/50" />
                </div>
              )}

              <div className="mt-8 text-center">
                <p className="text-[10px] font-bold text-muted-foreground/30 uppercase tracking-[0.2em]">
                  {hasMore
                    ? `Loading more... (${jobs.length} loaded)`
                    : `Displaying all ${jobs.length} records`}
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
