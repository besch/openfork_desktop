import { useState, useEffect, memo, useCallback, useMemo, useRef } from "react";
import { useClientStore } from "@/store";
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
import { cn } from "@/lib/utils";
import type { JobStats } from "@/types";
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

interface ProviderJobHistoryRow {
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
  username: string | null;
}

interface HistoryRpcError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

const HISTORY_PAGE_SIZE = 20;
const HISTORY_QUERY_TIMEOUT_MS = 30000;
const HISTORY_PROFILE_TIMEOUT_MS = 5000;

const withHistoryTimeout = async <T,>(
  request: PromiseLike<T>,
  label: string,
  timeoutMs = HISTORY_QUERY_TIMEOUT_MS,
): Promise<T> => {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(
        new Error(
          `${label} timed out. Check your connection and refresh history.`,
        ),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
};

const shouldFallbackToDirectHistoryQuery = (error: unknown): boolean => {
  const rpcError = error as HistoryRpcError;
  const message = [
    rpcError?.message,
    rpcError?.details,
    rpcError?.hint,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    rpcError?.code === "PGRST202" ||
    rpcError?.code === "42804" ||
    /fetch_provider_job_history|schema cache|could not find|function result type/i.test(
      message,
    )
  );
};

const getHistoryErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const supabaseError = error as HistoryRpcError;
    const parts = [
      supabaseError.message,
      supabaseError.details,
      supabaseError.hint,
      supabaseError.code ? `Code: ${supabaseError.code}` : undefined,
    ].filter(Boolean);

    if (parts.length > 0) {
      return parts.join(" ");
    }
  }

  return "Failed to fetch job history";
};

const mapProviderHistoryRows = (
  rows: ProviderJobHistoryRow[],
): ProcessedJob[] =>
  rows.map((row) => ({
    id: row.id,
    workflow_type: row.workflow_type,
    service_type: row.service_type,
    status: row.status,
    prompt: row.prompt,
    created_at: row.created_at,
    updated_at: row.updated_at,
    generation_started_at: row.generation_started_at,
    generation_completed_at: row.generation_completed_at,
    duration_seconds: row.duration_seconds,
    user_id: row.user_id,
    user:
      row.user_id && row.username
        ? { username: row.username, avatar_url: null }
        : null,
  }));

const fetchProviderHistoryViaRpc = async ({
  userId,
  statusFilter,
  typeFilter,
  searchQuery,
  page,
}: {
  userId: string;
  statusFilter: string;
  typeFilter: string;
  searchQuery: string;
  page: number;
}): Promise<ProcessedJob[] | null> => {
  const { data, error } = await withHistoryTimeout(
    supabase.rpc("fetch_provider_job_history", {
      p_user_id: userId,
      p_status: statusFilter === "all" ? null : statusFilter,
      p_type: typeFilter === "all" ? null : typeFilter,
      p_search: searchQuery.trim() || null,
      p_limit: HISTORY_PAGE_SIZE,
      p_offset: page * HISTORY_PAGE_SIZE,
    }),
    "Loading work history",
  );

  if (error) {
    if (shouldFallbackToDirectHistoryQuery(error)) {
      return null;
    }
    throw error;
  }

  return mapProviderHistoryRows((data || []) as ProviderJobHistoryRow[]);
};

type HistoryMetricKey = keyof Pick<
  JobStats,
  "pending" | "processing" | "completed" | "failed"
>;

const HISTORY_METRICS: Array<{
  key: HistoryMetricKey;
  label: string;
  className: string;
  barClassName: string;
}> = [
  {
    key: "pending",
    label: "Queue",
    className: "text-yellow-300",
    barClassName: "bg-yellow-400",
  },
  {
    key: "processing",
    label: "Active",
    className: "text-blue-300",
    barClassName: "bg-blue-400",
  },
  {
    key: "completed",
    label: "Done",
    className: "text-emerald-300",
    barClassName: "bg-emerald-400",
  },
  {
    key: "failed",
    label: "Failed",
    className: "text-red-300",
    barClassName: "bg-red-400",
  },
];

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
      icon: <RefreshCw className="h-3 w-3 animate-spin text-white" />,
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
      className={`flex h-5 items-center gap-1.5 px-3 py-0 text-[10px] font-black uppercase leading-none tracking-wider rounded-lg transition-all duration-300 ${className}`}
    >
      {icon}
      {status}
    </Badge>
  );
});

const HistoryMetricStrip = memo(({ stats }: { stats: JobStats }) => {
  const total = HISTORY_METRICS.reduce(
    (sum, metric) => sum + (stats[metric.key] || 0),
    0,
  );

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {HISTORY_METRICS.map((metric) => {
        const value = stats[metric.key] || 0;
        const percent = total > 0 ? Math.max(6, (value / total) * 100) : 0;

        return (
          <div
            key={metric.key}
            className="min-w-0 rounded-lg border border-white/10 bg-black/20 px-3 py-2"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-[9px] font-black uppercase tracking-[0.18em] text-white/40">
                {metric.label}
              </span>
              <span className={cn("text-sm font-black", metric.className)}>
                {value.toLocaleString()}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className={cn("h-full rounded-full", metric.barClassName)}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
});

HistoryMetricStrip.displayName = "HistoryMetricStrip";

const JobRow = memo(
  ({ job, compact = false }: { job: ProcessedJob; compact?: boolean }) => {
  const truncatePrompt = (
    prompt: string | null,
    maxLength: number = 70,
  ): string => {
    if (!prompt) return "No prompt provided";
    return prompt.length > maxLength
      ? `${prompt.substring(0, maxLength)}…`
      : prompt;
  };

  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-lg border border-amber-500/50 bg-amber-500/10 text-white shadow-sm transition-[background-color,border-color,box-shadow] duration-500 hover:bg-amber-500/20 sm:flex-row sm:items-center",
        compact ? "gap-2 p-2.5" : "gap-3 p-3",
      )}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
      <div
        className={cn(
          "relative z-10 w-fit rounded-lg bg-black/40 border border-amber-500/20 shadow-sm shadow-amber-500/10 text-amber-500 group-hover:scale-105 transition-[transform,background-color,border-color] duration-500",
          compact ? "p-1.5" : "p-2",
        )}
      >
        {getWorkflowIcon(job.workflow_type)}
      </div>
      <div className="relative z-10 flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-black text-[11px] text-white/90 truncate uppercase tracking-wide line-clamp-1">
            {job.workflow_type?.replace(/_/g, " ") || "unknown workflow"}
          </span>
          <StatusBadge status={job.status} />
        </div>
        <p
          className="text-[10px] text-white/40 truncate font-bold uppercase mt-0.5 tracking-wide line-clamp-1 group-hover:text-white/60 transition-colors"
          title={job.prompt || undefined}
        >
          {truncatePrompt(job.prompt, compact ? 52 : 70)}
        </p>
      </div>
      <div className="relative z-10 flex shrink-0 flex-col justify-center text-left sm:text-right">
        <div className="flex items-center justify-start text-[9px] font-black uppercase tracking-wide text-white/90 transition-colors group-hover:text-white sm:justify-end">
          {job.user?.username ? (
            <a
              href={`https://openfork.video/${job.user.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="max-w-[14rem] truncate hover:text-amber-400 transition-colors cursor-pointer underline-offset-4 hover:underline"
            >
              @{job.user.username.toUpperCase()}
            </a>
          ) : (
            "UNKNOWN USER"
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center justify-start gap-2 text-[8px] font-black uppercase tracking-wide text-white/40 sm:justify-end">
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
  },
);

JobRow.displayName = "JobRow";

interface JobHistoryProps {
  compact?: boolean;
  className?: string;
}

export const JobHistory = memo(
  ({ compact = false, className }: JobHistoryProps) => {
  const [jobs, setJobs] = useState<ProcessedJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  // Refs to avoid stale closure or infinite loops in useCallback
  const pageRef = useRef(0);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");

  const session = useClientStore((state) => state.session);
  const dashboardStats = useClientStore((state) => state.stats);

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
        requestIdRef.current += 1;
        setJobs([]);
        setLoading(false);
        loadingRef.current = false;
        pageRef.current = 0;
        setHasMore(true);
        hasMoreRef.current = true;
        return;
      }

      const targetPage = isInitial ? 0 : pageRef.current;
      if (!isInitial && (!hasMoreRef.current || loadingRef.current)) return;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      const isCurrentRequest = () => requestIdRef.current === requestId;

      setLoading(true);
      loadingRef.current = true;
      setError(null);
      if (isInitial) {
        pageRef.current = 0;
        setHasMore(true);
        hasMoreRef.current = true;
      }

      const commitJobs = (mergedJobs: ProcessedJob[]) => {
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

        const hasMoreData = mergedJobs.length === HISTORY_PAGE_SIZE;
        setHasMore(hasMoreData);
        hasMoreRef.current = hasMoreData;
      };

      try {
        const rpcJobs = await fetchProviderHistoryViaRpc({
          userId: session.user.id,
          statusFilter,
          typeFilter,
          searchQuery: debouncedSearchQuery,
          page: targetPage,
        });

        if (rpcJobs) {
          if (!isCurrentRequest()) return;
          commitJobs(rpcJobs);
          return;
        }

        // 1. Get user's provider IDs
        const { data: providerData, error: providerError } =
          await withHistoryTimeout(
            supabase
              .from("dgn_providers")
              .select("id")
              .eq("user_id", session.user.id),
            "Loading provider history",
          );

        if (providerError) throw providerError;
        if (!isCurrentRequest()) return;

        const providerIds = providerData?.map((p) => p.id) || [];

        if (providerIds.length === 0) {
          if (!isCurrentRequest()) return;
          setJobs([]);
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
          const { data: matchedProfiles, error: matchedProfilesError } =
            await withHistoryTimeout(
              supabase
                .from("profiles")
                .select("id")
                .ilike("username", `%${debouncedSearchQuery}%`),
              "Searching job users",
            );

          if (matchedProfilesError) throw matchedProfilesError;
          if (!isCurrentRequest()) return;

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

        const from = targetPage * HISTORY_PAGE_SIZE;
        const to = from + HISTORY_PAGE_SIZE - 1;

        query = query.order("created_at", { ascending: false }).range(from, to);

        const { data, error: fetchError } = await withHistoryTimeout(
          query,
          "Loading work history",
        );

        if (fetchError) throw fetchError;
        if (!isCurrentRequest()) return;

        // 3. Fetch profiles for user mapping
        const userIds = [
          ...new Set((data || []).map((j) => j.user_id).filter(Boolean)),
        ];
        let profileMap: Record<
          string,
          { username: string; avatar_url: string | null }
        > = {};

        if (userIds.length > 0) {
          try {
            const { data: profiles, error: profileError } =
              await withHistoryTimeout(
                supabase
                  .from("profiles")
                  .select("id, username")
                  .in("id", userIds),
                "Loading job usernames",
                HISTORY_PROFILE_TIMEOUT_MS,
              );

            if (!isCurrentRequest()) return;

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
          } catch (profileError) {
            console.warn(
              "Could not fetch profiles, usernames will be unknown:",
              profileError,
            );
          }
        }

        if (!isCurrentRequest()) return;

        const mergedJobs: ProcessedJob[] = (data || []).map((job) => ({
          ...job,
          user: job.user_id ? profileMap[job.user_id] || null : null,
        }));

        commitJobs(mergedJobs);
      } catch (err) {
        if (!isCurrentRequest()) return;
        console.error("Error fetching job history:", err);
        setError(getHistoryErrorMessage(err));
      } finally {
        if (isCurrentRequest()) {
          setLoading(false);
          loadingRef.current = false;
        }
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
      <div className={cn("rounded-lg border border-white/10 bg-surface/35 p-4", className)}>
        <HistoryMetricStrip stats={dashboardStats} />
        <div className="mt-4 flex h-[220px] flex-col items-center justify-center gap-3 rounded-lg border border-white/10 bg-black/20">
          <Loader size="lg" variant="primary" />
          <span className="text-sm font-semibold text-muted-foreground animate-pulse">
            Synchronizing your work history…
          </span>
        </div>
      </div>
    );
  }

  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border border-white/15 bg-surface/35 shadow-2xl shadow-black/20 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4 duration-500",
        className,
      )}
    >
      <div className="space-y-3 border-b border-white/10 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.22em] text-white/40">
              Work history
            </p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-lg font-black leading-none text-white">
                {filteredJobs.length.toLocaleString()} loaded
              </h2>
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                {hasMore ? "Recent provider jobs" : "All visible records"}
              </span>
            </div>
          </div>
          <Button
            variant="primary"
            size={compact ? "xs" : "sm"}
            onClick={() => fetchJobHistory(true)}
            disabled={loading}
            className="rounded-lg"
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>

        <HistoryMetricStrip stats={dashboardStats} />

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1 group/search">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50 transition-colors group-focus-within/search:text-white" />
            <input
              aria-label="Search job history"
              name="job-history-search"
              autoComplete="off"
              placeholder="Search prompt, workflow or username…"
              className={cn(
                "flex w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 pl-9 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50",
                compact ? "h-8 text-xs" : "h-10 text-sm",
              )}
              value={searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setSearchQuery(e.target.value)
              }
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear job history search"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <X className="h-4 w-4 text-white" />
              </button>
            )}
          </div>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger
              className={cn(
                "w-[132px] bg-black/20 border-white/10 text-xs font-bold",
                compact && "h-8",
              )}
            >
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
            <SelectTrigger
              className={cn(
                "w-[120px] bg-black/20 border-white/10 text-xs font-bold",
                compact && "h-8",
              )}
            >
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

        {error && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-amber-100">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold">History sync is delayed</p>
              <p className="mt-0.5 line-clamp-2 text-[11px] font-medium text-amber-100/65">
                {error}
              </p>
            </div>
          </div>
        )}
      </div>

      <div
        className={cn(
          "overflow-y-auto scrollbar-thin scrollbar-primary",
          compact ? "max-h-[560px] p-3" : "max-h-[640px] p-4 sm:p-6",
        )}
      >
        {filteredJobs.length === 0 ? (
          <div
            className={cn(
              "flex flex-col items-center justify-center text-center animate-in fade-in zoom-in duration-500",
              compact ? "py-12" : "py-20",
            )}
          >
            <div className={cn("relative", compact ? "mb-4" : "mb-6")}>
              <History
                className={cn(
                  "text-white/20",
                  compact ? "h-12 w-12" : "h-16 w-16",
                )}
              />
              <Search
                className={cn(
                  "absolute -bottom-2 -right-2 text-white/30 animate-bounce",
                  compact ? "h-6 w-6" : "h-8 w-8",
                )}
              />
            </div>
            <h3
              className={cn(
                "font-bold text-foreground/80",
                compact ? "text-base" : "text-xl",
              )}
            >
              {jobs.length === 0 ? "No activity detected" : "No matches found"}
            </h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto font-medium">
              {jobs.length === 0
                ? error
                  ? "History could not sync yet. Your live totals above are still available."
                  : "Start your DGN node and wait for jobs to arrive from the network."
                : "Try adjusting your filters or search terms."}
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
          <div className="grid gap-2.5">
            {filteredJobs.map((job, index) => {
              if (filteredJobs.length === index + 1) {
                return (
                  <div ref={lastJobElementRef} key={job.id}>
                    <JobRow job={job} compact={compact} />
                  </div>
                );
              }
              return <JobRow key={job.id} job={job} compact={compact} />;
            })}

            {loading && jobs.length > 0 && (
              <div className="flex justify-center py-4">
                <Loader size="md" className="text-white/50" />
              </div>
            )}

            <div className="mt-5 text-center">
              <p className="text-[10px] font-bold text-muted-foreground/30 uppercase tracking-[0.2em]">
                {hasMore
                  ? `Loading more… (${jobs.length} loaded)`
                  : `Displaying all ${jobs.length} records`}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
});
