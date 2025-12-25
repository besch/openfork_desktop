import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectSelection } from "./ProjectSelection";
import { UserSelection } from "./UserSelection";
import { Label } from "@/components/ui/label";
import type { Project, Profile, JobPolicy } from "@/types";

interface JobPolicySettingsProps {
  jobPolicy: JobPolicy;
  onJobPolicyChange: (policy: JobPolicy) => void;
  selectedProjects: Project[];
  onSelectedProjectsChange: (projects: Project[]) => void;
  selectedUsers: Profile[];
  onSelectedUsersChange: (users: Profile[]) => void;
  disabled?: boolean;
}

export function JobPolicySettings({
  jobPolicy,
  onJobPolicyChange,
  selectedProjects,
  onSelectedProjectsChange,
  selectedUsers,
  onSelectedUsersChange,
  disabled,
}: JobPolicySettingsProps) {
  const policyLabels: Record<JobPolicy, string> = {
    all: "Accept all public jobs",
    mine: "Only my own jobs",
    project: "From specific projects",
    users: "From specific users",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Job Acceptance</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            {policyLabels[jobPolicy]}
          </p>
        </div>
        <Select
          value={jobPolicy}
          onValueChange={(value) => onJobPolicyChange(value as JobPolicy)}
          disabled={disabled}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Policy" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Public</SelectItem>
            <SelectItem value="mine">Only Mine</SelectItem>
            <SelectItem value="project">By Project</SelectItem>
            <SelectItem value="users">By User</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {jobPolicy === "project" && (
        <div className="pl-4 border-l-2 border-border/50">
          <ProjectSelection
            selectedProjects={selectedProjects}
            onSelectedProjectsChange={onSelectedProjectsChange}
            disabled={disabled}
          />
        </div>
      )}

      {jobPolicy === "users" && (
        <div className="pl-4 border-l-2 border-border/50">
          <UserSelection
            selectedUsers={selectedUsers}
            onSelectedUsersChange={onSelectedUsersChange}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}