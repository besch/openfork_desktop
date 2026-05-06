import { memo, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  HardDrive,
  RefreshCw,
  X,
} from "lucide-react";
import { useClientStore } from "@/store";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";

type NoticeTone = "amber" | "blue" | "emerald" | "destructive";

interface NoticeBannerProps {
  id: string;
  tone: NoticeTone;
  title: string;
  message: ReactNode;
  icon: ReactNode;
  isBusy?: boolean;
  onDismiss?: () => void;
}

const toneClassNames: Record<
  NoticeTone,
  { shell: string; title: string; button: string }
> = {
  amber: {
    shell: "border-amber-500/30 bg-amber-500/10",
    title: "text-amber-300",
    button: "text-amber-300 hover:bg-amber-500/20",
  },
  blue: {
    shell: "border-blue-500/30 bg-blue-500/10",
    title: "text-blue-300",
    button: "text-blue-300 hover:bg-blue-500/20",
  },
  emerald: {
    shell: "border-emerald-500/30 bg-emerald-500/10",
    title: "text-emerald-300",
    button: "text-emerald-300 hover:bg-emerald-500/20",
  },
  destructive: {
    shell: "border-destructive/30 bg-destructive/10",
    title: "text-destructive",
    button: "text-destructive hover:bg-destructive/20",
  },
};

const NoticeBanner = memo(
  ({
    id,
    tone,
    title,
    message,
    icon,
    isBusy,
    onDismiss,
  }: NoticeBannerProps) => {
    const toneClasses = toneClassNames[tone];

    return (
      <motion.div
        key={id}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className={`flex items-center justify-between gap-3 rounded-lg border p-3 text-white shadow-lg backdrop-blur-md ${toneClasses.shell}`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="shrink-0">
            {isBusy ? <Loader size="sm" variant="primary" /> : icon}
          </div>
          <div className="min-w-0">
            <p
              className={`text-[10px] font-black uppercase tracking-[0.18em] ${toneClasses.title}`}
            >
              {title}
            </p>
            <div className="mt-0.5 text-xs font-semibold text-white/85">
              {message}
            </div>
          </div>
        </div>
        {onDismiss && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDismiss}
            className={`h-8 w-8 shrink-0 p-0 ${toneClasses.button}`}
            aria-label={`Dismiss ${title}`}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </motion.div>
    );
  },
);

function describeCompactionPhase(phase?: string) {
  if (phase === "starting") return "Preparing to reclaim disk space";
  if (phase === "stopping_client") return "Pausing the DGN client";
  if (phase === "compacting") return "Shrinking the OpenFork Ubuntu disk";
  if (phase === "recovering_wsl") return "Recovering the WSL engine";
  if (phase?.startsWith("recovering_")) return "Recovering the WSL engine";
  if (phase === "restarting_client") return "Restarting the DGN client";
  if (phase === "waiting_for_compaction") {
    return "Waiting for the previous disk shrink to finish";
  }
  return "Disk compaction is in progress";
}

function describeWslRecoveryPhase(phase?: string, error?: string) {
  if (phase === "stopping_client") return "Stopping the DGN client";
  if (phase === "restarting_wsl") return "Restarting OpenFork Ubuntu";
  if (phase === "reconnecting") return "Reconnecting the Docker API";
  if (phase === "restarting_client") return "Starting the DGN client";
  if (phase === "completed") return "Recovery complete";
  if (phase === "failed") return `Recovery failed: ${error || "Unknown error"}`;
  return "Recovering OpenFork Ubuntu";
}

function describeEngine(engine: string) {
  if (engine === "wsl") return "OpenFork Ubuntu";
  if (engine === "linux") return "Linux Docker";
  return "Unavailable";
}

export const SystemNotifications = memo(() => {
  const autoCompactStatus = useClientStore(
    (state) => state.autoCompactStatus,
  );
  const wslRecoveryStatus = useClientStore(
    (state) => state.wslRecoveryStatus,
  );
  const diskSpaceError = useClientStore((state) => state.diskSpaceError);
  const engineSwitchNotice = useClientStore(
    (state) => state.engineSwitchNotice,
  );
  const imageEvictedNotification = useClientStore(
    (state) => state.imageEvictedNotification,
  );
  const setAutoCompactStatus = useClientStore(
    (state) => state.setAutoCompactStatus,
  );
  const setWslRecoveryStatus = useClientStore(
    (state) => state.setWslRecoveryStatus,
  );
  const setDiskSpaceError = useClientStore((state) => state.setDiskSpaceError);
  const setEngineSwitchNotice = useClientStore(
    (state) => state.setEngineSwitchNotice,
  );
  const setImageEvictedNotification = useClientStore(
    (state) => state.setImageEvictedNotification,
  );

  const notices: ReactNode[] = [];

  if (autoCompactStatus?.compactInProgress) {
    notices.push(
      <NoticeBanner
        key="auto-compact-active"
        id="auto-compact-active"
        tone="amber"
        title="Disk Compaction"
        message={describeCompactionPhase(autoCompactStatus.phase)}
        icon={<HardDrive className="h-4 w-4 text-amber-300" />}
        isBusy
      />,
    );
  } else if (autoCompactStatus?.phase === "completed") {
    notices.push(
      <NoticeBanner
        key="auto-compact-completed"
        id="auto-compact-completed"
        tone="emerald"
        title="Disk Compaction"
        message={
          autoCompactStatus.recoveredAfterRestart
            ? "Previous compaction finished; OpenFork is ready again"
            : "Reclaimed disk space successfully"
        }
        icon={<CheckCircle2 className="h-4 w-4 text-emerald-300" />}
        onDismiss={() =>
          setAutoCompactStatus({
            ...autoCompactStatus,
            phase: undefined,
            recoveredAfterRestart: undefined,
          })
        }
      />,
    );
  } else if (autoCompactStatus?.phase === "failed") {
    notices.push(
      <NoticeBanner
        key="auto-compact-failed"
        id="auto-compact-failed"
        tone="destructive"
        title="Disk Compaction Failed"
        message={autoCompactStatus.error || "Unknown error"}
        icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
        onDismiss={() =>
          setAutoCompactStatus({
            ...autoCompactStatus,
            phase: undefined,
            error: undefined,
          })
        }
      />,
    );
  } else if (autoCompactStatus?.interruptedCompaction) {
    notices.push(
      <NoticeBanner
        key="auto-compact-interrupted"
        id="auto-compact-interrupted"
        tone="amber"
        title="Disk Compaction"
        message="Previous compaction was interrupted; the DGN client can start normally"
        icon={<HardDrive className="h-4 w-4 text-amber-300" />}
        onDismiss={() => {
          setAutoCompactStatus({
            ...autoCompactStatus,
            interruptedCompaction: false,
          });
          window.electronAPI.clearAutoCompactInterrupted?.();
        }}
      />,
    );
  }

  if (wslRecoveryStatus) {
    const isTerminal =
      wslRecoveryStatus.phase === "completed" ||
      wslRecoveryStatus.phase === "failed";
    notices.push(
      <NoticeBanner
        key="wsl-recovery"
        id="wsl-recovery"
        tone={
          wslRecoveryStatus.phase === "failed"
            ? "destructive"
            : wslRecoveryStatus.phase === "completed"
              ? "emerald"
              : "amber"
        }
        title="WSL Recovery"
        message={describeWslRecoveryPhase(
          wslRecoveryStatus.phase,
          wslRecoveryStatus.error,
        )}
        icon={
          wslRecoveryStatus.phase === "failed" ? (
            <AlertTriangle className="h-4 w-4 text-destructive" />
          ) : (
            <RefreshCw className="h-4 w-4 text-emerald-300" />
          )
        }
        isBusy={!isTerminal}
        onDismiss={
          isTerminal ? () => setWslRecoveryStatus(null) : undefined
        }
      />,
    );
  }

  if (engineSwitchNotice) {
    notices.push(
      <NoticeBanner
        key="engine-switch"
        id="engine-switch"
        tone="blue"
        title="Docker Engine"
        message={`${describeEngine(engineSwitchNotice.from)} -> ${describeEngine(
          engineSwitchNotice.to,
        )}`}
        icon={<RefreshCw className="h-4 w-4 text-blue-300" />}
        onDismiss={() => setEngineSwitchNotice(null)}
      />,
    );
  }

  if (imageEvictedNotification) {
    const freedGb =
      imageEvictedNotification.freed_bytes > 0
        ? `${(imageEvictedNotification.freed_bytes / 1024 ** 3).toFixed(1)} GB`
        : "disk space";
    notices.push(
      <NoticeBanner
        key="image-evicted"
        id="image-evicted"
        tone="blue"
        title="Storage Reclaimed"
        message={
          <>
            {freedGb} from{" "}
            <span className="text-white">
              {imageEvictedNotification.service_type ||
                imageEvictedNotification.image ||
                "image"}
            </span>
          </>
        }
        icon={<HardDrive className="h-4 w-4 text-blue-300" />}
        onDismiss={() => setImageEvictedNotification(null)}
      />,
    );
  }

  if (diskSpaceError) {
    notices.push(
      <NoticeBanner
        key="disk-space-error"
        id="disk-space-error"
        tone="destructive"
        title={`Insufficient Disk Space: ${diskSpaceError.image_name}`}
        message={
          <>
            Need{" "}
            <span className="font-black">{diskSpaceError.required_gb} GB</span>,
            available{" "}
            <span className="font-black">
              {diskSpaceError.available_gb} GB
            </span>
          </>
        }
        icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
        onDismiss={() => setDiskSpaceError(null)}
      />,
    );
  }

  return (
    <AnimatePresence>
      {notices.length > 0 && (
        <motion.div
          key="system-notifications"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="relative z-10 mb-6 space-y-3"
        >
          {notices}
        </motion.div>
      )}
    </AnimatePresence>
  );
});
