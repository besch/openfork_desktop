import { useState, useEffect, useRef } from "react";
import { ProjectSelection } from "./ProjectSelection";
import { UserSelection } from "./UserSelection";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type {
  Project,
  Profile,
  ProviderRoutingConfig,
  CommunityMode,
} from "@/types";
import { supabase } from "@/supabase";

interface JobPolicySettingsProps {
  config: ProviderRoutingConfig;
  onChange: (config: ProviderRoutingConfig) => void;
  disabled?: boolean;
}

const communityOptions: {
  value: CommunityMode;
  label: string;
  description: string;
}[] = [
  { value: "none", label: "Private", description: "Only my own jobs" },
  {
    value: "trusted_users",
    label: "Trusted users",
    description: "My jobs + selected users",
  },
  {
    value: "trusted_projects",
    label: "Trusted projects",
    description: "My jobs + selected projects",
  },
  {
    value: "all",
    label: "Public network",
    description: "My jobs + all public jobs",
  },
];

export function JobPolicySettings({
  config,
  onChange,
  disabled,
}: JobPolicySettingsProps) {
  const update = (patch: Partial<ProviderRoutingConfig>) =>
    onChange({ ...config, ...patch });

  const [selectedProjects, setSelectedProjects] = useState<Project[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<Profile[]>([]);
  // Track the last hydrated trustedIds to avoid redundant fetches
  const lastHydratedIds = useRef<string>("");

  useEffect(() => {
    const ids = config.trustedIds;
    const idsKey = config.communityMode + ":" + ids.slice().sort().join(",");

    if (idsKey === lastHydratedIds.current) return;
    lastHydratedIds.current = idsKey;

    if (ids.length === 0) {
      setSelectedProjects([]);
      setSelectedUsers([]);
      return;
    }

    if (config.communityMode === "trusted_projects") {
      setSelectedUsers([]);
      supabase
        .from("projects")
        .select("id, title, slug, created_by, created_at, is_public")
        .in("id", ids)
        .then(({ data }) => {
          setSelectedProjects((data as Project[]) ?? []);
        });
    } else if (config.communityMode === "trusted_users") {
      setSelectedProjects([]);
      supabase
        .from("profiles")
        .select("id, username")
        .in("id", ids)
        .then(({ data }) => {
          setSelectedUsers((data as Profile[]) ?? []);
        });
    } else {
      setSelectedProjects([]);
      setSelectedUsers([]);
    }
  }, [config.communityMode, config.trustedIds]);

  return (
    <div className="space-y-5">
      {/* Process own jobs toggle */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-semibold text-white/90 tracking-normal">
            Process my own jobs first
          </Label>
          <p className="text-[11px] text-white/70 mt-0.5 tracking-normal">
            Pick up jobs you submitted before community jobs
          </p>
        </div>
        <Switch
          checked={config.processOwnJobs}
          onCheckedChange={(v) => update({ processOwnJobs: v })}
          disabled={disabled}
        />
      </div>

      {/* Community mode selector */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold text-white/90 tracking-normal">
          Community Jobs
        </Label>
        <div className="grid grid-cols-2 gap-2">
          {communityOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() =>
                !disabled &&
                update({ communityMode: opt.value, trustedIds: [] })
              }
              disabled={disabled}
              className={`text-left px-3 py-2.5 rounded-lg border text-xs tracking-normal transition-all ${
                config.communityMode === opt.value
                  ? "border-amber-500/50 bg-amber-500/10 text-white"
                  : "border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:text-white/70"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              <span className="font-semibold block tracking-normal">
                {opt.label}
              </span>
              <span className="text-[11px] opacity-70 block mt-0.5 leading-tight tracking-normal">
                {opt.description}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Trusted target selectors — animate in when needed */}
      {config.communityMode === "trusted_projects" && (
        <div className="pl-3 border-l border-border/50">
          <ProjectSelection
            selectedProjects={selectedProjects}
            onSelectedProjectsChange={(projects) =>
              update({ trustedIds: projects.map((p) => p.id) })
            }
            disabled={disabled}
          />
        </div>
      )}

      {config.communityMode === "trusted_users" && (
        <div className="pl-3 border-l border-border/50">
          <UserSelection
            selectedUsers={selectedUsers}
            onSelectedUsersChange={(users) =>
              update({ trustedIds: users.map((u) => u.id) })
            }
            disabled={disabled}
          />
        </div>
      )}

      {/* Monetize toggle */}
      <div className="flex items-center justify-between pt-1 border-t border-white/5">
        <div>
          <Label className="text-sm font-semibold text-white/90 tracking-normal">
            Monetize mode
          </Label>
          <p className="text-[11px] text-white/70 mt-0.5 tracking-normal">
            Earn real money — process only paid jobs
          </p>
        </div>
        <Switch
          checked={config.monetizeMode}
          onCheckedChange={(v) => update({ monetizeMode: v })}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
