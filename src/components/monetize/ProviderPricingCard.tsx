import type { ProviderRateInfo } from "@/types";
import type { MarketPosition } from "./monetize-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import {
  AlertCircle,
  Flame,
  Gauge,
  Lock,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  DISPLAY_VRAM_GB,
  ESTIMATOR_JOBS,
  RATE_PRESETS,
  estimateJobEarnings,
  formatMillicents,
  rateToHourly,
} from "./monetize-utils";

interface ProviderPricingCardProps {
  rateInfo: ProviderRateInfo | null;
  rateLoading: boolean;
  rateInput: string;
  rateSaving: boolean;
  rateSaveError: string | null;
  cooldownSeconds: number;
  marketPosition: MarketPosition | null;
  currentInputRate: number | null;
  onRateInputChange: (value: string) => void;
  onSaveRate: (valueStr?: string) => void;
  onSetPreset: (multiplier: number) => void;
  onResetRate: () => void;
}

export function ProviderPricingCard({
  rateInfo,
  rateLoading,
  rateInput,
  rateSaving,
  rateSaveError,
  cooldownSeconds,
  marketPosition,
  currentInputRate,
  onRateInputChange,
  onSaveRate,
  onSetPreset,
  onResetRate,
}: ProviderPricingCardProps) {
  return (
    <Card className="group relative overflow-hidden transition-all duration-500 hover:shadow-2xl border-white/20 bg-surface/40 backdrop-blur-md">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-secondary/5" />
      <CardHeader className="pb-3 relative z-10">
        <CardTitle className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-black/40 border border-amber-500/20 shadow-lg shadow-amber-500/20 text-amber-500 flex items-center justify-center shrink-0">
            <Gauge size={14} />
          </div>
          <span className="font-black tracking-widest uppercase text-[10px] text-white">
            GPU Pricing
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {rateLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader size="xs" className="text-white" />
            Loading rate info...
          </div>
        ) : rateInfo ? (
          <>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    $
                  </span>
                  <Input
                    type="number"
                    step="0.001"
                    min={rateToHourly(rateInfo.floor_rate).toFixed(3)}
                    max={rateToHourly(rateInfo.ceiling_rate).toFixed(3)}
                    value={rateInput}
                    onChange={(event) => onRateInputChange(event.target.value)}
                    onBlur={() => onSaveRate()}
                    disabled={cooldownSeconds > 0}
                    className="pl-7 pr-12 font-mono disabled:opacity-50"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">
                    {rateSaving ? (
                      <Loader size="xs" className="text-white" />
                    ) : cooldownSeconds > 0 ? (
                      <Lock size={12} className="text-amber-400" />
                    ) : (
                      "/hr"
                    )}
                  </span>
                </div>
                {rateInfo.custom_rate_cents_per_vram_gb_min !== null && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onResetRate}
                    disabled={rateSaving}
                    className="shrink-0 text-xs"
                  >
                    Reset
                  </Button>
                )}
              </div>

              {cooldownSeconds > 0 && (
                <div className="flex items-center gap-1.5 text-[10px] text-amber-400/90">
                  <Lock size={10} />
                  Rate increases locked for{" "}
                  {cooldownSeconds >= 60
                    ? `${Math.ceil(cooldownSeconds / 60)}m`
                    : `${cooldownSeconds}s`}{" "}
                  - decreases and resets are always allowed
                </div>
              )}

              {rateSaveError && (
                <div className="flex items-center gap-1.5 text-[10px] text-destructive-foreground">
                  <AlertCircle size={10} />
                  {rateSaveError}
                </div>
              )}

              <p className="text-[10px] text-white/70">
                Based on {DISPLAY_VRAM_GB} GB GPU reference. Current allowed
                range:{" "}
                <span className="text-white/90">
                  ${rateToHourly(rateInfo.floor_rate).toFixed(3)} - $
                  {rateToHourly(rateInfo.ceiling_rate).toFixed(3)}/hr
                </span>
                {rateInfo.online_monetize_providers_count > 0 && (
                  <span className="text-white/50">
                    {" "}
                    ({rateInfo.online_monetize_providers_count} provider
                    {rateInfo.online_monetize_providers_count !== 1
                      ? "s"
                      : ""}{" "}
                    online)
                  </span>
                )}
              </p>
            </div>

            {rateInfo.surge_factor !== null &&
              rateInfo.surge_factor > 1.0 && (
                <div className="flex items-center gap-1.5 rounded-md border border-amber-400/20 bg-amber-400/5 px-2.5 py-1.5">
                  <Flame size={12} className="text-amber-400 shrink-0" />
                  <p className="text-[10px] text-amber-400/90">
                    High demand - {rateInfo.pending_jobs_count} job
                    {rateInfo.pending_jobs_count !== 1 ? "s" : ""} queued for{" "}
                    {rateInfo.online_monetize_providers_count} provider
                    {rateInfo.online_monetize_providers_count !== 1
                      ? "s"
                      : ""}
                    . Suggested rate raised{" "}
                    {Math.round((rateInfo.surge_factor - 1) * 100)}% to
                    attract providers.
                  </p>
                </div>
              )}

            <div className="flex flex-wrap gap-2">
              {RATE_PRESETS.map(({ label, multiplier }) => {
                const presetRate =
                  rateInfo.platform_rate_cents_per_vram_gb_min * multiplier;
                const presetHourly = rateToHourly(presetRate);
                const inputHourly = parseFloat(rateInput);
                const isActive =
                  !isNaN(inputHourly) &&
                  Math.abs(inputHourly - presetHourly) < 0.00001;
                const exceedsCeiling = presetRate > rateInfo.ceiling_rate;
                return (
                  <Button
                    key={label}
                    type="button"
                    variant={isActive ? "primary" : "outline"}
                    size="xs"
                    aria-pressed={isActive}
                    onClick={() => onSetPreset(multiplier)}
                    disabled={exceedsCeiling || cooldownSeconds > 0}
                    className={`h-auto rounded-lg px-2.5 py-1.5 font-semibold transition-colors justify-between gap-1.5 ${
                      isActive
                        ? ""
                        : "text-muted-foreground hover:text-foreground hover:border-primary/50"
                    }`}
                  >
                    <span>{label}</span>
                    <span className="opacity-60">
                      ${rateToHourly(presetRate).toFixed(3)}
                    </span>
                  </Button>
                );
              })}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground font-medium">
                  Estimated earnings
                </p>
              </div>
              <div className="rounded-md border border-border/40 divide-y divide-border/30">
                {ESTIMATOR_JOBS.map((job) => {
                  const displayRate = currentInputRate ?? rateInfo.effective_rate;
                  const perJob = estimateJobEarnings(
                    displayRate,
                    job.vramGb,
                    job.durationMin,
                  );
                  const perHour = Math.ceil(perJob * job.jobsPerHour);
                  return (
                    <div
                      key={job.label}
                      className="flex items-center justify-between px-3 py-1.5 text-xs"
                    >
                      <span className="text-muted-foreground">{job.label}</span>
                      <div className="flex items-center gap-2 tabular-nums">
                        <span className="font-medium text-white">
                          {formatMillicents(perJob)}/job
                        </span>
                        <span className="text-muted-foreground/60">
                          ({formatMillicents(perHour)}/hr)
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Market position</span>
              <div className="flex items-center gap-1.5">
                {currentInputRate !== null &&
                currentInputRate >
                  rateInfo.platform_rate_cents_per_vram_gb_min ? (
                  <>
                    <TrendingUp
                      size={12}
                      className="text-destructive-foreground"
                    />
                    <Badge
                      variant="outline"
                      className="text-[10px] border-destructive/30 text-destructive-foreground"
                    >
                      Above platform rate - no standard jobs
                    </Badge>
                  </>
                ) : rateInfo.market_avg_rate !== null ? (
                  <>
                    {marketPosition === "competitive" && (
                      <>
                        <TrendingDown size={12} className="text-white" />
                        <Badge
                          variant="primary"
                          className="text-[10px] border-primary/30 text-white"
                        >
                          Competitive - more jobs likely
                        </Badge>
                      </>
                    )}
                    {marketPosition === "above" && (
                      <>
                        <Minus size={12} className="text-white" />
                        <Badge
                          variant="outline"
                          className="text-[10px] border-merged-status/30 text-merged-status"
                        >
                          Above average - slightly fewer jobs
                        </Badge>
                      </>
                    )}
                    {marketPosition === "premium" && (
                      <>
                        <TrendingUp size={12} className="text-white" />
                        <Badge
                          variant="outline"
                          className="text-[10px] border-merged-status/30 text-merged-status"
                        >
                          Premium - significantly fewer jobs
                        </Badge>
                      </>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground text-[10px]">
                    No market data yet
                  </span>
                )}
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Rate info unavailable - connect to the network to configure
            pricing.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
