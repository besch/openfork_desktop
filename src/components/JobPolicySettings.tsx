import { motion, AnimatePresence } from "framer-motion";
import { ProjectSelection } from "./ProjectSelection";
import { UserSelection } from "./UserSelection";
import type { Project, Profile, JobPolicy } from "@/types";

interface JobPolicySettingsProps {
  jobPolicy: JobPolicy;
  selectedProjects: Project[];
  onSelectedProjectsChange: (projects: Project[]) => void;
  selectedUsers: Profile[];
  onSelectedUsersChange: (users: Profile[]) => void;
  disabled?: boolean;
}

export function JobPolicySettings({
  jobPolicy,
  selectedProjects,
  onSelectedProjectsChange,
  selectedUsers,
  onSelectedUsersChange,
  disabled,
}: JobPolicySettingsProps) {
  return (
    <div className="space-y-6">
      <AnimatePresence>
        {jobPolicy === "project" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="pl-4 border-l border-border/50 overflow-hidden"
          >
            <ProjectSelection
              selectedProjects={selectedProjects}
              onSelectedProjectsChange={onSelectedProjectsChange}
              disabled={disabled}
            />
          </motion.div>
        )}

        {jobPolicy === "users" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="pl-4 border-l border-border/50 overflow-hidden"
          >
            <UserSelection
              selectedUsers={selectedUsers}
              onSelectedUsersChange={onSelectedUsersChange}
              disabled={disabled}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
