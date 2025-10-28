import { motion, AnimatePresence } from "framer-motion";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ProjectSelector } from "@/components/ProjectSelector";
import type { Project } from "@/types";

export type JobPolicy = "all" | "mine" | "project";

interface JobPolicySettingsProps {
  jobPolicy: JobPolicy;
  onJobPolicyChange: (policy: JobPolicy) => void;
  selectedProjects: Project[];
  onSelectedProjectsChange: (projects: Project[]) => void;
  disabled?: boolean;
}

const policyOptions: {
  value: JobPolicy;
  label: string;
  description: string;
}[] = [
  {
    value: "mine",
    label: "Accept my jobs only",
    description: "Only process jobs that you have created.",
  },
  {
    value: "all",
    label: "Accept all jobs",
    description: "Contribute to any available job from any project.",
  },
  {
    value: "project",
    label: "Accept jobs from selected projects",
    description: "Choose which projects you want to contribute to.",
  },
];

export function JobPolicySettings({
  jobPolicy,
  onJobPolicyChange,
  selectedProjects,
  onSelectedProjectsChange,
  disabled = false,
}: JobPolicySettingsProps) {
  const handlePolicyChange = (value: string) => {
    const newPolicy = value as JobPolicy;
    onJobPolicyChange(newPolicy);
    if (newPolicy !== "project") {
      onSelectedProjectsChange([]);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Job Acceptance Policy</h3>
        <p className="text-sm text-muted-foreground">
          Choose which jobs this client will accept from the network.
        </p>
      </div>
      <RadioGroup
        value={jobPolicy}
        onValueChange={handlePolicyChange}
        disabled={disabled}
        className="grid grid-cols-1 gap-4"
      >
        {policyOptions.map((option) => (
          <Label
            key={option.value}
            htmlFor={option.value}
            className={`flex flex-col items-start space-y-1 rounded-md border-2 p-4 transition-all ${
              jobPolicy === option.value
                ? "border-primary shadow-md"
                : "border-muted"
            } ${
              disabled
                ? "cursor-not-allowed opacity-50"
                : "cursor-pointer hover:border-primary/50"
            }`}
          >
            <div className="flex items-center space-x-3">
              <RadioGroupItem value={option.value} id={option.value} />
              <span className="font-semibold text-foreground">
                {option.label}
              </span>
            </div>
            <span className="pl-7 text-sm text-muted-foreground">
              {option.description}
            </span>
          </Label>
        ))}
      </RadioGroup>

      <AnimatePresence>
        {jobPolicy === "project" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="space-y-2 pt-4">
              <Label htmlFor="project-selector" className="font-medium">
                Select Projects
              </Label>
              <ProjectSelector
                selected={selectedProjects}
                onSelectedChange={onSelectedProjectsChange}
                disabled={disabled}
                placeholder="Click to select projects"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
