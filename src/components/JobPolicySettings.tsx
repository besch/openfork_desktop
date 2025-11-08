import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectSelection } from "./ProjectSelection";
import { UserSelection } from "./UserSelection";
import type { Project, Profile } from "@/types";

export type JobPolicy = "all" | "mine" | "project" | "users";

interface JobPolicySettingsProps {
  jobPolicy: JobPolicy;
  onJobPolicyChange: (policy: JobPolicy) => void;
  selectedProjects: Project[];
  onSelectedProjectsChange: (projects: Project[]) => void;
  selectedUsers: Profile[];
  onSelectedUsersChange: (users: Profile[]) => void;
  disabled?: boolean;
}

export const JobPolicySettings: React.FC<JobPolicySettingsProps> = ({
  jobPolicy,
  onJobPolicyChange,
  selectedProjects,
  onSelectedProjectsChange,
  selectedUsers,
  onSelectedUsersChange,
  disabled,
}) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center">
        <span className="w-48 shrink-0 pr-4 text-right text-sm text-muted-foreground">
          Job Acceptance Policy:
        </span>
        <Select
          value={jobPolicy}
          onValueChange={(value) => onJobPolicyChange(value as JobPolicy)}
          disabled={disabled}
        >
          <SelectTrigger className="w-full bg-background/50">
            <SelectValue placeholder="Job Policy" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Public Jobs</SelectItem>
            <SelectItem value="mine">Only My Jobs</SelectItem>
            <SelectItem value="project">Only From Specific Projects</SelectItem>
            <SelectItem value="users">Only From Specific Users</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {jobPolicy === "project" && (
        <ProjectSelection
          selectedProjects={selectedProjects}
          onSelectedProjectsChange={onSelectedProjectsChange}
          disabled={disabled}
        />
      )}

      {jobPolicy === "users" && (
        <UserSelection
          selectedUsers={selectedUsers}
          onSelectedUsersChange={onSelectedUsersChange}
          disabled={disabled}
        />
      )}
    </div>
  );
};