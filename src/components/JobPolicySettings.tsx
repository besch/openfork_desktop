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
  { value: "none", label: "Private", description: "Only my own" },
  { value: "all", label: "Public", description: "All public jobs" },
  {
    value: "trusted_users",
    label: "Trusted users",
    description: "Selected users",
  },
  {
    value: "trusted_projects",
    label: "Trusted projects",
    description: "Selected projects",
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
    <div className="space-y-4">
      {/* Primary Policy Toggles */}
      <div className="grid grid-cols-2 gap-x-8 pb-3 border-b border-white/5">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold text-white/90 tracking-normal leading-tight">
            Process my own jobs first
          </Label>
          <Switch
            checked={config.processOwnJobs}
            onCheckedChange={(v: boolean) => update({ processOwnJobs: v })}
            disabled={disabled}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-semibold text-white/90 tracking-normal">
              Monetize mode
            </Label>
            <p className="text-[10px] text-white/50 mt-0.5 tracking-normal leading-tight">
              Earn real money from paid jobs
            </p>
          </div>
          <Switch
            checked={config.monetizeMode}
            onCheckedChange={(v: boolean) => update({ monetizeMode: v })}
            disabled={disabled}
          />
        </div>
      </div>

      {/* Community — hidden when monetize is active */}
      {!config.monetizeMode && (
        <div className="space-y-3">
          {/* Community mode selector */}
          <div className="space-y-1.5">
            <Label className="text-xs text-white/50 uppercase tracking-widest">
              Job Execution Policy
            </Label>
            <div className="grid grid-cols-4 gap-1.5">
              {communityOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() =>
                    !disabled &&
                    update({
                      communityMode: opt.value,
                      trustedIds: [],
                      ...(opt.value === "none" && { processOwnJobs: true }),
                    })
                  }
                  disabled={disabled}
                  className={`text-left px-2 py-1.5 rounded-lg border text-xs tracking-normal transition-all ${
                    config.communityMode === opt.value
                      ? "border-amber-500/50 bg-amber-500/10 text-white"
                      : "border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:text-white/70"
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <span className="font-semibold block tracking-wider uppercase truncate">
                    {opt.label}
                  </span>
                  <span className="text-[10px] opacity-60 block mt-0.5 leading-tight tracking-normal">
                    {opt.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Trusted target selectors */}
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
        </div>
      )}
    </div>
  );
}
