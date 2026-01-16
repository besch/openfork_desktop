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
import { motion, AnimatePresence } from "framer-motion";
import { Globe, Lock, Layout, Users } from "lucide-react";
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
  const policyInfo: Record<JobPolicy, { title: string; description: string; icon: any }> = {
    all: {
      title: "Global",
      description: "Share your GPU and use any GPU on the network",
      icon: Globe,
    },
    mine: {
      title: "Private",
      description: "Reserved for your tasks only",
      icon: Lock,
    },
    project: {
      title: "Project",
      description: "Authorized projects only",
      icon: Layout,
    },
    users: {
      title: "Users",
      description: "Trusted collaborators only",
      icon: Users,
    },
  };

  const currentInfo = policyInfo[jobPolicy];
  const Icon = currentInfo.icon;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Label className="text-sm font-medium whitespace-nowrap">Job Acceptance</Label>
        
        <div className="flex-1 min-w-0 flex justify-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={jobPolicy}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary border border-border/40 text-primary-foreground w-fit"
            >
              <Icon size={14} className="text-white flex-shrink-0" />
              <span className="text-[11px] font-medium leading-none whitespace-nowrap">
                {currentInfo.description}
              </span>
            </motion.div>
          </AnimatePresence>
        </div>

        <Select
          value={jobPolicy}
          onValueChange={(value) => onJobPolicyChange(value as JobPolicy)}
          disabled={disabled}
        >
          <SelectTrigger className="w-36 h-9">
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