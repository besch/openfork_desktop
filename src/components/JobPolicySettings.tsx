import React from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { motion } from "framer-motion";

interface JobPolicySettingsProps {
  policy: string;
  allowedIds: string;
  setAllowedIds: (ids: string) => void;
  isDisabled: boolean;
}

export const JobPolicySettings: React.FC<JobPolicySettingsProps> = ({
  policy,
  allowedIds,
  setAllowedIds,
  isDisabled,
}) => {
  const showAllowedIds =
    policy === "specific_projects" || policy === "specific_branches";

  return (
    <motion.div
      initial={false}
      animate={{
        opacity: showAllowedIds ? 1 : 0,
        height: showAllowedIds ? "auto" : 0,
        marginTop: showAllowedIds ? "1rem" : "0rem",
      }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className="space-y-2 overflow-hidden"
    >
      <Label htmlFor="allowed-ids">
        {policy === "specific_projects" ? "Project IDs" : "Branch IDs"}{" "}
        (comma-separated)
      </Label>
      <Textarea
        id="allowed-ids"
        placeholder="Enter one or more IDs, separated by commas"
        value={allowedIds}
        onChange={(e) => setAllowedIds(e.target.value)}
        disabled={isDisabled}
        className="min-h-[60px] bg-background/50"
      />
    </motion.div>
  );
};
