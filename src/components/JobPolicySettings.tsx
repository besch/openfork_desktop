import React from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface JobPolicySettingsProps {
  policy: string;
  setPolicy: (policy: string) => void;
  allowedIds: string;
  setAllowedIds: (ids: string) => void;
  isDisabled: boolean;
}

export const JobPolicySettings: React.FC<JobPolicySettingsProps> = ({
  policy,
  setPolicy,
  allowedIds,
  setAllowedIds,
  isDisabled,
}) => {
  return (
    <div className="space-y-4 p-4 rounded-lg bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50">
      <h3 className="text-lg font-semibold">Job Acceptance Policy</h3>
      <div className="space-y-2">
        <Label htmlFor="policy-select">Who can run jobs on your machine?</Label>
        <Select value={policy} onValueChange={setPolicy} disabled={isDisabled}>
          <SelectTrigger id="policy-select">
            <SelectValue placeholder="Select a policy" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="public">Everyone</SelectItem>
            <SelectItem value="own">Only My Jobs</SelectItem>
            <SelectItem value="specific_projects">
              Only Specific Projects
            </SelectItem>
            <SelectItem value="specific_branches">
              Only Specific Branches
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      {(policy === "specific_projects" || policy === "specific_branches") && (
        <div className="space-y-2">
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
            className="min-h-[60px]"
          />
        </div>
      )}
    </div>
  );
};
