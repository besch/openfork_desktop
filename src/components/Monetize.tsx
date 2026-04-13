import { useEffect, useState, useCallback } from "react";
import { useClientStore } from "@/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { ProviderRateInfo } from "@/types";
import { Loader } from "@/components/ui/loader";
import {
  DollarSign,
  Building2,
  ArrowDownToLine,
  Clock,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Gauge,
  TrendingDown,
  TrendingUp,
  Minus,
  Flame,
  Lock,
} from "lucide-react";
import { supabase } from "@/supabase";

interface Transaction {
  id: string;
  transaction_type: string;
  amount_cents: number;
  created_at: string;
  description: string | null;
  status: string;
}

interface ApiErrorResponse {
  error?: string;
}

// Reference VRAM for $/hr display (must match backend DISPLAY_VRAM_GB)
const DISPLAY_VRAM_GB = 8;

// Realistic job specs for earnings estimator (VRAM × duration drives payout)
const ESTIMATOR_JOBS = [
  {
    label: "WAN 2.2  (8 GB, 5 min)",
    vramGb: 8,
    durationMin: 5,
    jobsPerHour: 10,
  },
  {
    label: "LTX-2.3  (24 GB, 2 min)",
    vramGb: 24,
    durationMin: 2,
    jobsPerHour: 27,
  },
  {
    label: "Hunyuan 1.5  (24 GB, 20 min)",
    vramGb: 24,
    durationMin: 20,
    jobsPerHour: 3,
  },
];

// Rate preset multipliers for quick rate adjustment (relative to platform rate)
const RATE_PRESETS = [
  { label: "Platform Rate", multiplier: 1.0 },
  { label: "+25%", multiplier: 1.25 },
  { label: "+50%", multiplier: 1.5 },
];

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return fallback;
}

/** Convert internal rate to $/hr display using reference VRAM */
function rateToHourly(centsPerVramGbMin: number): number {
  return (centsPerVramGbMin * DISPLAY_VRAM_GB * 60) / 100;
}

/** Convert $/hr display back to internal rate using reference VRAM */
function hourlyToRate(dollarsPerHr: number): number {
  return (dollarsPerHr * 100) / (DISPLAY_VRAM_GB * 60);
}

/** Estimated provider payout for a job (before platform fee is already baked into provider_rate) */
function estimateJobEarnings(
  rateCentsPerVramGbMin: number,
  vramGb: number,
  durationMin: number,
): number {
  return Math.ceil(vramGb * durationMin * rateCentsPerVramGbMin);
}

export function Monetize() {
  const { session, monetizeWallet, fetchMonetizeWallet } = useClientStore();
  const userId = session?.user?.id;
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingTxns, setLoadingTxns] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccess, setWithdrawSuccess] = useState(false);
  const [stripeLoading, setStripeLoading] = useState(false);

  // Provider pricing state
  const [rateInfo, setRateInfo] = useState<ProviderRateInfo | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateInput, setRateInput] = useState<string>("");
  const [rateSaving, setRateSaving] = useState(false);
  const [rateSaveError, setRateSaveError] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  const loadProviderRate = useCallback(async () => {
    setRateLoading(true);
    try {
      const result = await window.electronAPI.getProviderRate();
      if (!result.error) {
        setRateInfo(result);
        setCooldownSeconds(result.cooldown_remaining_seconds ?? 0);
        // If no custom rate is set, default the input to the market-suggested rate
        // so the provider sees the optimal competitive rate immediately.
        const suggestedRate =
          result.suggested_rate_cents_per_vram_gb_min ?? result.platform_rate_cents_per_vram_gb_min;
        const initialRate =
          result.custom_rate_cents_per_vram_gb_min !== null
            ? result.effective_rate
            : suggestedRate;
        setRateInput(rateToHourly(initialRate).toFixed(3));
      }
    } catch (error) {
      console.error("Failed to load provider rate:", error);
    } finally {
      setRateLoading(false);
    }
  }, []);

  const loadTransactions = useCallback(async () => {
    if (!userId) {
      setTransactions([]);
      return;
    }

    setLoadingTxns(true);
    try {
      const { data } = await supabase
        .from("monetize_transactions")
        .select(
          "id, transaction_type, amount_cents, created_at, description, status",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20);
      setTransactions((data as Transaction[]) || []);
    } catch (error) {
      console.error("Failed to load transactions:", error);
    } finally {
      setLoadingTxns(false);
    }
  }, [userId]);

  // Fetch wallet + transactions + rate on mount
  useEffect(() => {
    fetchMonetizeWallet();
    loadTransactions();
    loadProviderRate();
  }, [fetchMonetizeWallet, loadProviderRate, loadTransactions]);

  // Auto-refresh rate info every 5 minutes to keep market data fresh
  useEffect(() => {
    const interval = setInterval(loadProviderRate, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadProviderRate]);

  // Countdown timer for rate increase cooldown
  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setCooldownSeconds((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  const handleWithdraw = useCallback(async () => {
    if (!monetizeWallet) return;
    const amount = monetizeWallet.available_to_withdraw_cents;
    if (amount < 500) return;

    setWithdrawing(true);
    setWithdrawError(null);
    setWithdrawSuccess(false);
    try {
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession();
      const orchestratorUrl = await window.electronAPI.getOrchestratorApiUrl();
      const resp = await fetch(`${orchestratorUrl}/api/monetize/withdraw`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentSession?.access_token || ""}`,
        },
        body: JSON.stringify({ amount_cents: amount }),
      });
      let result: ApiErrorResponse | null = null;
      try {
        result = (await resp.json()) as ApiErrorResponse;
      } catch (error) {
        console.warn("Withdrawal response did not include JSON:", error);
      }

      if (!resp.ok) {
        setWithdrawError(result?.error || "Withdrawal failed");
      } else {
        setWithdrawSuccess(true);
        fetchMonetizeWallet();
        loadTransactions();
        setTimeout(() => setWithdrawSuccess(false), 4000);
      }
    } catch (error) {
      setWithdrawError(getErrorMessage(error, "Network error"));
    } finally {
      setWithdrawing(false);
    }
  }, [fetchMonetizeWallet, loadTransactions, monetizeWallet]);

  // Stripe error state
  const [stripeError, setStripeError] = useState<string | null>(null);

  const handleStripeOnboard = useCallback(async () => {
    setStripeLoading(true);
    setStripeError(null);
    try {
      const result = await window.electronAPI.openStripeOnboard();
      if (result.error) {
        console.error("Stripe onboard error:", result.error);
        setStripeError(result.error);
      }
    } catch (error) {
      console.error("Stripe onboard error:", error);
      setStripeError(getErrorMessage(error, "Failed to open Stripe onboarding"));
    } finally {
      setStripeLoading(false);
    }
  }, []);

  const handleStripeDashboard = useCallback(async () => {
    setStripeLoading(true);
    setStripeError(null);
    try {
      const result = await window.electronAPI.openStripeDashboard();
      if (result.error) {
        console.error("Stripe dashboard error:", result.error);
        setStripeError(result.error);
      }
    } catch (error) {
      console.error("Stripe dashboard error:", error);
      setStripeError(getErrorMessage(error, "Failed to open Stripe dashboard"));
    } finally {
      setStripeLoading(false);
    }
  }, []);

  const handleSaveRate = useCallback(
    async (valueStr?: string) => {
      if (!rateInfo) return;
      const dollars = parseFloat(valueStr ?? rateInput);
      if (isNaN(dollars) || dollars < 0) return;
      const centsPerVramGbMin = hourlyToRate(dollars);
      if (centsPerVramGbMin < rateInfo.floor_rate) {
        setRateSaveError(`Minimum rate is $${rateToHourly(rateInfo.floor_rate).toFixed(3)}/hr`);
        return;
      }
      if (centsPerVramGbMin > rateInfo.ceiling_rate) {
        setRateSaveError(`Maximum rate is $${rateToHourly(rateInfo.ceiling_rate).toFixed(3)}/hr (${rateInfo.online_monetize_providers_count} provider(s) online)`);
        return;
      }
      setRateSaving(true);
      setRateSaveError(null);
      try {
        const result = await window.electronAPI.setProviderRate(centsPerVramGbMin);
        if (result.error) {
          setRateSaveError(result.error);
          if (result.cooldown_remaining_seconds) {
            setCooldownSeconds(result.cooldown_remaining_seconds);
          }
        } else {
          setRateInfo((prev) => (prev ? { ...prev, ...result } : result));
          if (result.cooldown_remaining_seconds) {
            setCooldownSeconds(result.cooldown_remaining_seconds);
          }
        }
      } catch (error) {
        setRateSaveError(getErrorMessage(error, "Failed to save rate"));
      } finally {
        setRateSaving(false);
      }
    },
    [rateInfo, rateInput],
  );

  const handleSetPreset = useCallback(
    (multiplier: number) => {
      if (!rateInfo) return;
      const newRate = rateInfo.platform_rate_cents_per_vram_gb_min * multiplier;
      const valueStr = rateToHourly(newRate).toFixed(3);
      setRateInput(valueStr);
      setRateSaveError(null);
      handleSaveRate(valueStr);
    },
    [rateInfo, handleSaveRate],
  );

  const handleResetRate = useCallback(async () => {
    if (!rateInfo) return;
    setRateSaving(true);
    setRateSaveError(null);
    try {
      const result = await window.electronAPI.setProviderRate(null);
      if (result.error) {
        setRateSaveError(result.error);
      } else {
        setRateInfo((prev) => (prev ? { ...prev, ...result } : result));
        setRateInput(rateToHourly(result.effective_rate).toFixed(3));
        setCooldownSeconds(0);
      }
    } catch (error) {
      setRateSaveError(getErrorMessage(error, "Failed to reset rate"));
    } finally {
      setRateSaving(false);
    }
  }, [rateInfo]);

  const wallet = monetizeWallet;
  const availableAmount = wallet?.available_to_withdraw_cents ?? 0;

  // Market position relative to average
  const marketPosition = (() => {
    if (!rateInfo || !rateInfo.market_avg_rate) return null;
    const ratio = rateInfo.effective_rate / rateInfo.market_avg_rate;
    if (ratio <= 1.0) return "competitive";
    if (ratio <= 1.25) return "above";
    return "premium";
  })();

  const currentInputRate = (() => {
    const d = parseFloat(rateInput);
    return isNaN(d) ? null : hourlyToRate(d);
  })();

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* GPU Pricing */}
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
              Loading rate info…
            </div>
          ) : rateInfo ? (
            <>
              {/* Rate input row */}
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
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        setRateInput(e.target.value);
                        setRateSaveError(null);
                      }}
                      onBlur={() => handleSaveRate()}
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
                      onClick={handleResetRate}
                      disabled={rateSaving}
                      className="shrink-0 text-xs"
                    >
                      Reset
                    </Button>
                  )}
                </div>

                {/* Cooldown notice */}
                {cooldownSeconds > 0 && (
                  <div className="flex items-center gap-1.5 text-[10px] text-amber-400/90">
                    <Lock size={10} />
                    Rate increases locked for{" "}
                    {cooldownSeconds >= 60
                      ? `${Math.ceil(cooldownSeconds / 60)}m`
                      : `${cooldownSeconds}s`}
                    {" "}— decreases and resets are always allowed
                  </div>
                )}

                {/* Save error */}
                {rateSaveError && (
                  <div className="flex items-center gap-1.5 text-[10px] text-destructive-foreground">
                    <AlertCircle size={10} />
                    {rateSaveError}
                  </div>
                )}

                <p className="text-[10px] text-white/70">
                  Based on {DISPLAY_VRAM_GB} GB GPU reference. Current allowed range:{" "}
                  <span className="text-white/90">
                    ${rateToHourly(rateInfo.floor_rate).toFixed(3)} – $
                    {rateToHourly(rateInfo.ceiling_rate).toFixed(3)}/hr
                  </span>
                  {rateInfo.online_monetize_providers_count > 0 && (
                    <span className="text-white/50">
                      {" "}({rateInfo.online_monetize_providers_count} provider{rateInfo.online_monetize_providers_count !== 1 ? "s" : ""} online)
                    </span>
                  )}
                </p>
              </div>

              {/* Surge demand indicator */}
              {rateInfo.surge_factor !== null && rateInfo.surge_factor > 1.0 && (
                <div className="flex items-center gap-1.5 rounded-md border border-amber-400/20 bg-amber-400/5 px-2.5 py-1.5">
                  <Flame size={12} className="text-amber-400 shrink-0" />
                  <p className="text-[10px] text-amber-400/90">
                    High demand — {rateInfo.pending_jobs_count} job{rateInfo.pending_jobs_count !== 1 ? "s" : ""} queued for{" "}
                    {rateInfo.online_monetize_providers_count} provider{rateInfo.online_monetize_providers_count !== 1 ? "s" : ""}.
                    Suggested rate raised {Math.round((rateInfo.surge_factor - 1) * 100)}% to attract providers.
                  </p>
                </div>
              )}

              {/* Preset buttons */}
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
                      onClick={() => handleSetPreset(multiplier)}
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

              {/* Earnings estimator */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground font-medium">
                    Estimated earnings
                  </p>
                </div>
                <div className="rounded-md border border-border/40 divide-y divide-border/30">
                  {ESTIMATOR_JOBS.map((job) => {
                    const displayRate =
                      currentInputRate ?? rateInfo.effective_rate;
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
                        <span className="text-muted-foreground">
                          {job.label}
                        </span>
                        <div className="flex items-center gap-2 tabular-nums">
                          <span className="font-medium text-white">
                            {formatCents(perJob)}/job
                          </span>
                          <span className="text-muted-foreground/60">
                            ({formatCents(perHour)}/hr)
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Market position */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Market position</span>
                <div className="flex items-center gap-1.5">
                  {currentInputRate !== null &&
                  currentInputRate > rateInfo.platform_rate_cents_per_vram_gb_min ? (
                    <>
                      <TrendingUp size={12} className="text-destructive-foreground" />
                      <Badge
                        variant="outline"
                        className="text-[10px] border-destructive/30 text-destructive-foreground"
                      >
                        Above platform rate — no standard jobs
                      </Badge>
                    </>
                  ) : rateInfo.market_avg_rate !== null ? (
                    <>
                      {marketPosition === "competitive" && (
                        <>
                          <TrendingDown size={12} className="text-white" />
                          <Badge
                            variant="outline"
                            className="text-[10px] border-primary/30 text-primary"
                          >
                            Competitive — more jobs likely
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
                            Above average — slightly fewer jobs
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
                            Premium — significantly fewer jobs
                          </Badge>
                        </>
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground text-[10px]">No market data yet</span>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Rate info unavailable — connect to the network to configure
              pricing.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Wallet Summary */}
      <div className="grid grid-cols-4 gap-4">
        {[
          {
            label: "Pending Earnings",
            value: wallet ? formatCents(wallet.pending_earnings_cents) : "—",
            color: "text-amber-400",
          },
          {
            label: "Available to Withdraw",
            value: wallet
              ? formatCents(wallet.available_to_withdraw_cents)
              : "—",
            color: "text-emerald-400",
          },
          {
            label: "Lifetime Earned",
            value: wallet
              ? formatCents(wallet.total_earned_lifetime_cents)
              : "—",
            color: "text-white",
          },
          {
            label: "Total Withdrawn",
            value: wallet ? formatCents(wallet.total_withdrawn_cents) : "—",
            color: "text-muted/60",
          },
        ].map((item, i) => (
          <Card
            key={i}
            className="relative overflow-hidden group hover:shadow-xl transition-all duration-500 border-white/20 bg-surface/40 backdrop-blur-md"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <CardContent className="pt-6 pb-5 relative z-10">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted/40 font-black mb-2 group-hover:text-muted/60 transition-colors">
                {item.label}
              </p>
              <p
                className={`text-2xl font-black ${item.color} drop-shadow-2xl`}
              >
                {item.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Bank Account */}
        <Card className="group relative overflow-hidden transition-all duration-500 hover:shadow-2xl border-white/20 bg-surface/40 backdrop-blur-md">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-secondary/5" />
          <CardHeader className="pb-3 relative z-10">
            <CardTitle className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-black/40 border border-amber-500/20 shadow-lg shadow-amber-500/20 text-amber-500 flex items-center justify-center shrink-0">
                <Building2 size={16} />
              </div>
              <span className="font-black tracking-widest uppercase text-[10px] text-white">
                Payout Account
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 relative z-10">
            {wallet?.stripe_account_verified ? (
              <>
                <div className="w-full">
                  <Badge variant="success" className="gap-1.5">
                    <CheckCircle2 size={12} />
                    Bank account connected &amp; verified
                  </Badge>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleStripeDashboard}
                  disabled={stripeLoading}
                >
                  {stripeLoading ? (
                    <Loader
                      size="xs"
                      className="mr-2 animate-spin"
                    />
                  ) : (
                    <ExternalLink size={14} className="mr-2" />
                  )}
                  Manage Payout Account
                </Button>
                {stripeError && (
                  <p className="text-xs text-destructive-foreground mt-2">
                    {stripeError}
                  </p>
                )}
              </>
            ) : wallet?.stripe_details_submitted ? (
              <>
                <div className="flex items-center gap-2 text-merged-status text-sm">
                  <Clock size={14} className="text-white" />
                  <span>Verification in progress — check your email</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleStripeDashboard}
                  disabled={stripeLoading}
                  className="w-full"
                >
                  {stripeLoading ? (
                    <Loader
                      size="xs"
                      className="mr-2 animate-spin text-white"
                    />
                  ) : (
                    <ExternalLink size={14} className="mr-2 text-white" />
                  )}
                  Open Stripe Dashboard
                </Button>
                {stripeError && (
                  <p className="text-xs text-destructive-foreground mt-2">
                    {stripeError}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Connect your bank account to receive payouts. Stripe handles
                  all identity verification — takes 5–10 minutes.
                </p>
                <Button
                  onClick={handleStripeOnboard}
                  disabled={stripeLoading}
                  variant="primary"
                >
                  {stripeLoading ? (
                    <Loader
                      size="xs"
                      className="mr-2 animate-spin text-white"
                    />
                  ) : (
                    <Building2 size={14} className="mr-2 text-white" />
                  )}
                  Connect Bank Account
                </Button>
                {stripeError && (
                  <p className="text-xs text-destructive-foreground mt-2">
                    {stripeError}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Withdraw */}
        <Card className="bg-surface/40 border-white/20 shadow-xl overflow-hidden group">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-3">
              <div className="p-2 rounded-lg bg-black/40 border border-amber-500/20 shadow-sm shadow-amber-500/20 text-amber-500">
                <ArrowDownToLine size={16} />
              </div>
              Withdraw Earnings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!wallet?.stripe_account_verified ? (
              <p className="text-sm text-muted-foreground">
                Connect and verify your bank account first.
              </p>
            ) : availableAmount < 500 ? (
              <p className="text-sm text-muted-foreground">
                Minimum withdrawal is $5.00. You have{" "}
                {formatCents(availableAmount)} available.
              </p>
            ) : (
              <>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Available balance
                    </span>
                    <span className="font-semibold text-primary">
                      {formatCents(availableAmount)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Platform fee (25%) is already deducted from your earnings at
                    job completion.
                  </p>
                </div>
                {withdrawError && (
                  <div className="flex items-center gap-2 text-destructive-foreground text-sm">
                    <AlertCircle size={14} className="text-white" />
                    {withdrawError}
                  </div>
                )}
                {withdrawSuccess && (
                  <div className="flex items-center gap-2 text-primary text-sm">
                    <CheckCircle2 size={14} className="text-white" />
                    Withdrawal requested! Arrives in 1–3 business days.
                  </div>
                )}
                <Button
                  onClick={handleWithdraw}
                  disabled={withdrawing}
                  className="w-full"
                >
                  {withdrawing ? (
                    <Loader
                      size="xs"
                      className="mr-2 animate-spin text-white"
                    />
                  ) : (
                    <ArrowDownToLine size={14} className="mr-2 text-white" />
                  )}
                  Withdraw {formatCents(availableAmount)}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Recent Earnings */}
        <Card className="bg-surface/40 border-white/20 shadow-xl overflow-hidden group">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-3">
              <div className="p-2 rounded-lg bg-black/40 border border-amber-500/20 shadow-sm shadow-amber-500/20 text-amber-500">
                <DollarSign size={16} />
              </div>
              Recent Earnings
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingTxns ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader size="xs" className="text-white" />
                Loading transactions...
              </div>
            ) : transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No transactions yet. Start processing paid jobs to earn.
              </p>
            ) : (
              <div className="divide-y divide-border/40">
                {transactions.map((txn) => (
                  <div
                    key={txn.id}
                    className="flex items-center justify-between py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm truncate">
                        {txn.description || txn.transaction_type}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(txn.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          txn.status === "completed"
                            ? "border-primary/30 text-primary"
                            : "border-merged-status/30 text-merged-status"
                        }`}
                      >
                        {txn.status}
                      </Badge>
                      <span
                        className={`text-sm font-medium ${
                          txn.amount_cents < 0
                            ? "text-destructive-foreground"
                            : "text-white"
                        }`}
                      >
                        {txn.amount_cents >= 0 ? "+" : ""}
                        {formatCents(txn.amount_cents)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
