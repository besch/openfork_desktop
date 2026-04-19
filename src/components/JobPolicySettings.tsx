import { useState, useEffect, useRef } from "react";
import { ProjectSelection } from "./ProjectSelection";
import { UserSelection } from "./UserSelection";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { Project, Profile, ProviderRoutingConfig } from "@/types";
import { supabase } from "@/supabase";

interface JobPolicySettingsProps {
  config: ProviderRoutingConfig;
  onChange: (config: ProviderRoutingConfig) => void;
  disabled?: boolean;
}

type PrimaryMode = "private" | "public" | "monetize";
type TrustedTarget = "users" | "projects";

function getPrimaryMode(config: ProviderRoutingConfig): PrimaryMode {
  if (config.monetizeMode) return "monetize";
  if (config.communityMode === "all") return "public";
  return "private";
}

function getTrustedTarget(config: ProviderRoutingConfig): TrustedTarget {
  return config.communityMode === "trusted_projects" ? "projects" : "users";
}

function hasTrustedGroup(config: ProviderRoutingConfig): boolean {
  return (
    config.communityMode === "trusted_users" ||
    config.communityMode === "trusted_projects"
  );
}

const primaryModes: {
  value: PrimaryMode;
  label: string;
  description: string;
}[] = [
  {
    value: "private",
    label: "Private",
    description: "Only your own jobs",
  },
  {
    value: "public",
    label: "Public",
    description: "Earn credits from the network",
  },
  {
    value: "monetize",
    label: "Monetize",
    description: "Earn real money from paid jobs",
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

  const primaryMode = getPrimaryMode(config);
  const trustedTarget = getTrustedTarget(config);
  const trustedEnabled = hasTrustedGroup(config);

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
        .then(({ data }) => setSelectedProjects((data as Project[]) ?? []));
    } else if (config.communityMode === "trusted_users") {
      setSelectedProjects([]);
      supabase
        .from("profiles")
        .select("id, username")
        .in("id", ids)
        .then(({ data }) => setSelectedUsers((data as Profile[]) ?? []));
    } else {
      setSelectedProjects([]);
      setSelectedUsers([]);
    }
  }, [config.communityMode, config.trustedIds]);

  function handlePrimaryModeChange(mode: PrimaryMode) {
    if (disabled) return;
    if (mode === "private") {
      update({ communityMode: "none", processOwnJobs: true, monetizeMode: false, trustedIds: [] });
    } else if (mode === "public") {
      update({ communityMode: "all", processOwnJobs: true, monetizeMode: false, trustedIds: [] });
    } else {
      update({ communityMode: "none", processOwnJobs: true, monetizeMode: true, trustedIds: [] });
    }
  }

  function handleTrustedGroupToggle(enabled: boolean) {
    if (disabled) return;
    if (enabled) {
      // Default to trusted_users when first enabling; keep existing target on re-enable
      const target =
        trustedTarget === "projects" ? "trusted_projects" : "trusted_users";
      update({ communityMode: target, trustedIds: [] });
    } else {
      update({ communityMode: "none", trustedIds: [] });
    }
  }

  function handleTrustedTargetChange(target: TrustedTarget) {
    if (disabled) return;
    update({
      communityMode: target === "projects" ? "trusted_projects" : "trusted_users",
      trustedIds: [],
    });
  }

  return (
    <div className="space-y-3">
      {/* Primary mode tiles */}
      <div className="grid grid-cols-3 gap-1.5">
        {primaryModes.map((mode) => (
          <button
            key={mode.value}
            onClick={() => handlePrimaryModeChange(mode.value)}
            disabled={disabled}
            className={`text-left px-2.5 py-2.5 rounded-lg border text-xs tracking-normal transition-all ${
              primaryMode === mode.value
                ? "border-amber-500/50 bg-amber-500/10 text-white"
                : "border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:text-white/90"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            <span className="font-semibold block tracking-wider uppercase">
              {mode.label}
            </span>
            <span className="text-[10px] block mt-0.5 leading-tight text-white/50">
              {mode.description}
            </span>
          </button>
        ))}
      </div>

      {/* Private sub-settings */}
      {primaryMode === "private" && (
        <div className="space-y-2 pl-3 border-l-2 border-amber-500/20">
          {/* Trusted group toggle */}
          <div className="flex items-center justify-between py-1">
            <div>
              <Label className="text-xs font-semibold text-white/80 tracking-normal">
                Trusted group
              </Label>
              <p className="text-[10px] text-white/40 mt-0.5 leading-tight">
                Also process jobs from specific users or projects
              </p>
            </div>
            <Switch
              checked={trustedEnabled}
              onCheckedChange={handleTrustedGroupToggle}
              disabled={disabled}
            />
          </div>

          {/* Trusted group details */}
          {trustedEnabled && (
            <div className="space-y-2 pt-0.5">
              {/* Users vs Projects sub-toggle */}
              <div className="flex gap-1.5">
                {(["users", "projects"] as TrustedTarget[]).map((target) => (
                  <button
                    key={target}
                    onClick={() => handleTrustedTargetChange(target)}
                    disabled={disabled}
                    className={`px-2.5 py-1 rounded text-[10px] font-semibold uppercase tracking-wider transition-all ${
                      trustedTarget === target
                        ? "bg-white/15 text-white"
                        : "bg-white/5 text-white/40 hover:text-white/70"
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    {target}
                  </button>
                ))}
              </div>

              {config.communityMode === "trusted_projects" ? (
                <ProjectSelection
                  selectedProjects={selectedProjects}
                  onSelectedProjectsChange={(projects) =>
                    update({ trustedIds: projects.map((p) => p.id) })
                  }
                  disabled={disabled}
                />
              ) : (
                <UserSelection
                  selectedUsers={selectedUsers}
                  onSelectedUsersChange={(users) =>
                    update({ trustedIds: users.map((u) => u.id) })
                  }
                  disabled={disabled}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Public sub-settings */}
      {primaryMode === "public" && (
        <div className="pl-3 border-l-2 border-amber-500/20">
          <div className="flex items-center justify-between py-1">
            <div>
              <Label className="text-xs font-semibold text-white/80 tracking-normal">
                Prioritize my own jobs
              </Label>
              <p className="text-[10px] text-white/40 mt-0.5 leading-tight">
                Your submissions skip the community queue
              </p>
            </div>
            <Switch
              checked={config.processOwnJobs}
              onCheckedChange={(v: boolean) => update({ processOwnJobs: v })}
              disabled={disabled}
            />
          </div>
        </div>
      )}
    </div>
  );
}
