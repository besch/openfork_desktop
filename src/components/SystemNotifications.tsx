import { memo, useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  HardDrive,
  RefreshCw,
  X,
} from "lucide-react";
import { useClientStore } from "@/store";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";

type NoticeTone = "amber" | "blue" | "emerald" | "destructive";
const MIN_CUDA_VERSION = "12.8";
const NOTICE_AUTO_DISMISS_MS = 8000;

interface UpdateInfo {
  version: string;
  releaseNotes?: string;
}

interface UpdateProgress {
  percent: number;
}

interface UpdateState {
  available: UpdateInfo | null;
  progress: UpdateProgress | null;
  downloaded: boolean;
  installing?: boolean;
}

interface NoticeBannerProps {
  id: string;
  tone: NoticeTone;
  title: string;
  message: ReactNode;
  icon: ReactNode;
  isBusy?: boolean;
  onDismiss?: () => void;
  details?: ReactNode;
  actions?: ReactNode;
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
    details,
    actions,
  }: NoticeBannerProps) => {
    const toneClasses = toneClassNames[tone];

    return (
      <motion.div
        key={id}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className={`flex items-start justify-between gap-3 rounded-lg border p-3 text-white shadow-lg backdrop-blur-md ${toneClasses.shell}`}
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-4 w-4 shrink-0 items-center justify-center">
            {isBusy ? (
              <Loader
                size="xs"
                variant="primary"
                className="h-4 w-4 p-0"
              />
            ) : (
              icon
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p
              className={`text-[10px] font-black uppercase tracking-[0.18em] ${toneClasses.title}`}
            >
              {title}
            </p>
            <div className="mt-0.5 text-xs font-semibold text-white/85">
              {message}
            </div>
            {details && (
              <div className="mt-2 text-[11px] font-medium leading-relaxed text-white/60">
                {details}
              </div>
            )}
            {actions && <div className="mt-3">{actions}</div>}
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
  if (phase === "external_compacting") {
    return "OpenFork Ubuntu disk is locked while compaction finishes";
  }
  if (phase === "recovering_wsl") return "Recovering the WSL engine";
  if (phase?.startsWith("recovering_")) return "Recovering the WSL engine";
  if (phase === "restarting_client") return "Restarting the DGN client";
  if (phase === "waiting_for_compaction") {
    return "Waiting for the previous disk shrink to finish";
  }
  return "Disk compaction is in progress";
}

function describeManualReclaimPhase(phase?: string) {
  if (phase === "waiting_for_idle") return "Waiting for current work to finish";
  if (phase === "stopping_client") return "Pausing the DGN client";
  if (phase === "pruning_cache") return "Cleaning Docker build cache";
  if (phase === "compacting") return "Shrinking the OpenFork Ubuntu disk";
  if (phase === "recovering_wsl") return "Reconnecting the WSL engine";
  if (phase?.startsWith("recovering_")) return "Reconnecting the WSL engine";
  if (phase === "cancelling") return "Cancelling disk compaction";
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

function normalizeReleaseNotes(releaseNotes: string) {
  const parsed = new DOMParser().parseFromString(releaseNotes, "text/html");
  return (parsed.body.textContent || releaseNotes).trim();
}

export const SystemNotifications = memo(() => {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateProgress, setUpdateProgress] =
    useState<UpdateProgress | null>(null);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [cudaDismissed, setCudaDismissed] = useState(false);

  const autoCompactStatus = useClientStore(
    (state) => state.autoCompactStatus,
  );
  const dependencyStatus = useClientStore((state) => state.dependencyStatus);
  const reclaimStatus = useClientStore((state) => state.reclaimStatus);
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
  const setReclaimStatus = useClientStore((state) => state.setReclaimStatus);
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
  const reclaimPhase = reclaimStatus?.phase;
  const reclaimInProgress = reclaimStatus?.inProgress;
  const reclaimSettling = reclaimStatus?.settling;
  const reclaimStartedTs = reclaimStatus?.startedTs;

  useEffect(() => {
    let cancelled = false;
    const applyUpdateState = (state: UpdateState | null) => {
      if (cancelled || !state?.available) return;
      setUpdateInfo(state.available);
      setUpdateProgress(state.progress);
      setUpdateDownloaded(state.downloaded);
      setUpdateInstalling(state.installing ?? false);
      setUpdateDismissed(false);
    };

    const cleanupAvailable = window.electronAPI.onUpdateAvailable((info) => {
      setUpdateInfo(info);
      setUpdateDownloaded(false);
      setUpdateInstalling(false);
      setUpdateProgress(null);
      setUpdateDismissed(false);
    });

    const cleanupProgress = window.electronAPI.onUpdateProgress((progress) => {
      setUpdateProgress(progress);
      setUpdateInstalling(false);
    });

    const cleanupDownloaded = window.electronAPI.onUpdateDownloaded((info) => {
      setUpdateInfo(info);
      setUpdateDownloaded(true);
      setUpdateInstalling(false);
      setUpdateProgress(null);
      setUpdateDismissed(false);
    });

    const cleanupInstalling = window.electronAPI.onUpdateInstalling((info) => {
      if (info) setUpdateInfo(info);
      setUpdateDownloaded(true);
      setUpdateInstalling(true);
      setUpdateProgress(null);
      setUpdateDismissed(false);
    });

    window.electronAPI
      .getUpdateState()
      .then(applyUpdateState)
      .catch((error) => {
        console.error("Failed to read update state:", error);
      });

    window.electronAPI
      .checkForUpdates()
      .then(applyUpdateState)
      .catch((error) => {
        console.error("Failed to check for app updates:", error);
      });

    return () => {
      cancelled = true;
      cleanupAvailable();
      cleanupProgress();
      cleanupDownloaded();
      cleanupInstalling();
    };
  }, []);

  useEffect(() => {
    const isTerminalReclaim =
      reclaimPhase === "completed" ||
      reclaimPhase === "failed" ||
      reclaimPhase === "cancelled";
    if (!isTerminalReclaim || reclaimInProgress || reclaimSettling) {
      return;
    }

    const phase = reclaimPhase;
    const startedTs = reclaimStartedTs;
    const timeoutId = window.setTimeout(() => {
      const current = useClientStore.getState().reclaimStatus;
      if (
        current?.phase === phase &&
        current?.startedTs === startedTs &&
        !current?.inProgress &&
        !current?.settling
      ) {
        setReclaimStatus(null);
      }
    }, NOTICE_AUTO_DISMISS_MS);

    return () => window.clearTimeout(timeoutId);
  }, [
    reclaimPhase,
    reclaimInProgress,
    reclaimSettling,
    reclaimStartedTs,
    setReclaimStatus,
  ]);

  const notices: ReactNode[] = [];
  const nvidia = dependencyStatus?.nvidia;
  const showCudaNotice =
    nvidia?.available &&
    nvidia.isOutdated &&
    nvidia.cudaVersion &&
    !cudaDismissed;

  if (updateInfo && !updateDismissed) {
    const releaseNotes = updateInfo.releaseNotes
      ? normalizeReleaseNotes(updateInfo.releaseNotes)
      : null;
    const progressPercent = Math.max(
      0,
      Math.min(100, Math.round(updateProgress?.percent ?? 0)),
    );

    notices.push(
      <NoticeBanner
        key="app-update"
        id="app-update"
        tone={updateDownloaded ? "emerald" : "blue"}
        title="App Update"
        message={
          updateInstalling
            ? `Version ${updateInfo.version} is installing automatically.`
            : updateDownloaded
              ? `Version ${updateInfo.version} is starting the installer.`
              : updateProgress
                ? `Version ${updateInfo.version} is downloading automatically.`
                : `Version ${updateInfo.version} will install automatically.`
        }
        icon={
          <img
            src="./logo.png"
            alt="OpenFork logo"
            width={16}
            height={16}
            className="h-4 w-4 object-contain"
          />
        }
        details={
          releaseNotes && !updateDownloaded && !updateProgress ? (
            <pre className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-white/10 bg-black/20 p-2 font-sans">
              {releaseNotes}
            </pre>
          ) : undefined
        }
        actions={
          updateProgress && !updateDownloaded ? (
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-white/45">
                <span>Downloading</span>
                <span>{progressPercent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <motion.div
                  className="h-full rounded-full bg-blue-400"
                  initial={{ width: 0 }}
                  animate={{ width: `${progressPercent}%` }}
                  transition={{ duration: 0.2 }}
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[11px] font-semibold text-white/60">
              <img
                src="./logo.png"
                alt=""
                width={20}
                height={20}
                className="h-5 w-5 object-contain"
              />
              <span>
                {updateInstalling
                  ? "Installer is running"
                  : "Installer will start automatically"}
              </span>
            </div>
          )
        }
      />,
    );
  }

  if (showCudaNotice) {
    notices.push(
      <NoticeBanner
        key="cuda-update"
        id="cuda-update"
        tone="amber"
        title="CUDA Outdated"
        message={`CUDA ${nvidia.cudaVersion} is below the required ${MIN_CUDA_VERSION}.`}
        icon={<AlertTriangle className="h-4 w-4 text-amber-300" />}
        details={nvidia.gpu ? `GPU: ${nvidia.gpu}` : undefined}
        actions={
          <Button
            size="sm"
            variant="primary"
            className="h-8 px-3 text-[11px] font-bold"
            onClick={() =>
              window.electronAPI.openExternal("https://www.nvidia.com/drivers")
            }
          >
            <ExternalLink className="mr-2 h-3.5 w-3.5" />
            Update Drivers
          </Button>
        }
        onDismiss={() => setCudaDismissed(true)}
      />,
    );
  }

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

  if (reclaimStatus?.inProgress || reclaimStatus?.settling) {
    notices.push(
      <NoticeBanner
        key="manual-reclaim-active"
        id="manual-reclaim-active"
        tone="amber"
        title="Disk Compaction"
        message={
          reclaimStatus.settling
            ? "Reconnecting the WSL engine"
            : describeManualReclaimPhase(reclaimStatus.phase)
        }
        icon={<HardDrive className="h-4 w-4 text-amber-300" />}
        isBusy
      />,
    );
  } else if (reclaimStatus?.phase === "completed") {
    notices.push(
      <NoticeBanner
        key="manual-reclaim-completed"
        id="manual-reclaim-completed"
        tone="emerald"
        title="Disk Compaction"
        message="Reclaimed disk space successfully"
        icon={<CheckCircle2 className="h-4 w-4 text-emerald-300" />}
        onDismiss={() => setReclaimStatus(null)}
      />,
    );
  } else if (reclaimStatus?.phase === "failed") {
    notices.push(
      <NoticeBanner
        key="manual-reclaim-failed"
        id="manual-reclaim-failed"
        tone="destructive"
        title="Disk Compaction Failed"
        message={reclaimStatus.error || "Unknown error"}
        icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
        onDismiss={() => setReclaimStatus(null)}
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
          diskSpaceError.message || (
            <>
              Need{" "}
              <span className="font-black">{diskSpaceError.required_gb} GB</span>,
              available{" "}
              <span className="font-black">
                {diskSpaceError.available_gb} GB
              </span>
            </>
          )
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
