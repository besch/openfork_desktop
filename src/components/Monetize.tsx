import { useEffect, useState, useCallback } from "react";
import { useClientStore } from "@/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import type { ProviderRateInfo } from "@/types";
import {
  DollarSign,
  Building2,
  ArrowDownToLine,
  Clock,
  Trash2,
  ExternalLink,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Gauge,
  TrendingDown,
  TrendingUp,
  Minus,
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

interface CleanupEvent {
  service_type: string;
  image: string;
  reason: string;
  timestamp: string;
}

// Reference VRAM for $/hr display (must match backend DISPLAY_VRAM_GB)
const DISPLAY_VRAM_GB = 8;

// Realistic job specs for earnings estimator (VRAM × duration drives payout)
const ESTIMATOR_JOBS = [
  {
    label: "WAN 2.2  (8 GB · ~7 min)",
    vramGb: 8,
    durationMin: 7,
    jobsPerHour: 7,
  },
  {
    label: "LTX-2 24 GB GGUF  (24 GB · ~12 min)",
    vramGb: 24,
    durationMin: 12,
    jobsPerHour: 4,
  },
  {
    label: "Hunyuan 1.5 24 GB  (24 GB · ~18 min)",
    vramGb: 24,
    durationMin: 18,
    jobsPerHour: 3,
  },
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
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingTxns, setLoadingTxns] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccess, setWithdrawSuccess] = useState(false);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [idleTimeout, setIdleTimeout] = useState(30);
  const [cleanupEnabled, setCleanupEnabled] = useState(false);
  const [cleanupLog, setCleanupLog] = useState<CleanupEvent[]>([]);

  // Provider pricing state
  const [rateInfo, setRateInfo] = useState<ProviderRateInfo | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateInput, setRateInput] = useState<string>("");
  const [rateSaving, setRateSaving] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);
  const [rateSaved, setRateSaved] = useState(false);

  // Fetch wallet + transactions + rate on mount
  useEffect(() => {
    fetchMonetizeWallet();
    loadTransactions();
    loadMonetizeConfig();
    loadProviderRate();
  }, []);

  // Listen for cleanup events from main process
  useEffect(() => {
    const cleanup = window.electronAPI.onMonetizeCleanupEvent((evt) => {
      setCleanupLog((prev) => [evt, ...prev].slice(0, 50));
    });
    return cleanup;
  }, []);

  async function loadProviderRate() {
    setRateLoading(true);
    try {
      const result = await window.electronAPI.getProviderRate();
      if (!result.error) {
        setRateInfo(result);
        setRateInput(rateToHourly(result.effective_rate).toFixed(3));
      }
    } catch {}
    setRateLoading(false);
  }

  async function loadMonetizeConfig() {
    try {
      const cfg = await window.electronAPI.getMonetizeConfig();
      setIdleTimeout(cfg.idleTimeoutMinutes ?? 30);
      setCleanupEnabled(cfg.enabled ?? false);
    } catch {}
  }

  async function loadTransactions() {
    if (!session?.user) return;
    setLoadingTxns(true);
    try {
      const { data } = await supabase
        .from("monetize_transactions")
        .select(
          "id, transaction_type, amount_cents, created_at, description, status",
        )
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      setTransactions((data as Transaction[]) || []);
    } catch (err) {
      console.error("Failed to load transactions:", err);
    } finally {
      setLoadingTxns(false);
    }
  }

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
      const result = await resp.json();
      if (!resp.ok) {
        setWithdrawError(result.error || "Withdrawal failed");
      } else {
        setWithdrawSuccess(true);
        fetchMonetizeWallet();
        loadTransactions();
        setTimeout(() => setWithdrawSuccess(false), 4000);
      }
    } catch (err: any) {
      setWithdrawError(err.message || "Network error");
    } finally {
      setWithdrawing(false);
    }
  }, [monetizeWallet, fetchMonetizeWallet]);

  const handleStripeOnboard = useCallback(async () => {
    setStripeLoading(true);
    try {
      const result = await window.electronAPI.openStripeOnboard();
      if (result.error) console.error("Stripe onboard error:", result.error);
    } finally {
      setStripeLoading(false);
    }
  }, []);

  const handleStripeDashboard = useCallback(async () => {
    setStripeLoading(true);
    try {
      const result = await window.electronAPI.openStripeDashboard();
      if (result.error) console.error("Stripe dashboard error:", result.error);
    } finally {
      setStripeLoading(false);
    }
  }, []);

  const handleIdleTimeoutChange = useCallback(async (val: number[]) => {
    const minutes = val[0];
    setIdleTimeout(minutes);
    await window.electronAPI.setMonetizeIdleTimeout(minutes);
  }, []);

  const toggleCleanup = useCallback((enabled: boolean) => {
    setCleanupEnabled(enabled);
    if (enabled) {
      window.electronAPI.startMonetizeCleanup();
    } else {
      window.electronAPI.stopMonetizeCleanup();
    }
  }, []);

  const handleSetPreset = useCallback(
    (multiplier: number) => {
      if (!rateInfo) return;
      const newRate = rateInfo.platform_rate_cents_per_vram_gb_min * multiplier;
      setRateInput(rateToHourly(newRate).toFixed(3));
      setRateError(null);
    },
    [rateInfo],
  );

  const handleSaveRate = useCallback(async () => {
    if (!rateInfo) return;
    const dollars = parseFloat(rateInput);
    if (isNaN(dollars) || dollars < 0) {
      setRateError("Enter a valid rate.");
      return;
    }
    const centsPerVramGbMin = hourlyToRate(dollars);
    if (centsPerVramGbMin < rateInfo.floor_rate) {
      setRateError(
        `Minimum rate is $${rateToHourly(rateInfo.floor_rate).toFixed(3)}/hr (50% of platform rate).`,
      );
      return;
    }
    if (centsPerVramGbMin > rateInfo.ceiling_rate) {
      setRateError(
        `Maximum rate is $${rateToHourly(rateInfo.ceiling_rate).toFixed(3)}/hr (300% of platform rate).`,
      );
      return;
    }
    setRateSaving(true);
    setRateError(null);
    try {
      const result =
        await window.electronAPI.setProviderRate(centsPerVramGbMin);
      if (result.error) {
        setRateError(result.error);
      } else {
        setRateInfo(result);
        setRateSaved(true);
        setTimeout(() => setRateSaved(false), 3000);
      }
    } catch {
      setRateError("Network error. Please try again.");
    } finally {
      setRateSaving(false);
    }
  }, [rateInfo, rateInput]);

  const handleResetRate = useCallback(async () => {
    if (!rateInfo) return;
    setRateSaving(true);
    setRateError(null);
    try {
      const result = await window.electronAPI.setProviderRate(null);
      if (result.error) {
        setRateError(result.error);
      } else {
        setRateInfo(result);
        setRateInput(rateToHourly(result.effective_rate).toFixed(3));
        setRateSaved(true);
        setTimeout(() => setRateSaved(false), 3000);
      }
    } catch {
      setRateError("Network error. Please try again.");
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
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Gauge size={16} />
            GPU Pricing
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {rateLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 size={14} className="animate-spin" />
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
                        setRateError(null);
                      }}
                      className="pl-7 pr-12 font-mono"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">
                      /hr
                    </span>
                  </div>
                  <Button
                    size="sm"
                    onClick={handleSaveRate}
                    disabled={rateSaving}
                    className="shrink-0"
                  >
                    {rateSaving ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      "Set Rate"
                    )}
                  </Button>
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
                <p className="text-[10px] text-muted-foreground">
                  Based on {DISPLAY_VRAM_GB} GB GPU reference. Platform range:{" "}
                  <span className="text-foreground/70">
                    ${rateToHourly(rateInfo.floor_rate).toFixed(3)} – $
                    {rateToHourly(rateInfo.ceiling_rate).toFixed(3)}/hr
                  </span>
                </p>
              </div>

              {/* Preset buttons */}
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "Min (50%)", multiplier: 0.5 },
                  { label: "Standard", multiplier: 1.0 },
                  { label: "+25%", multiplier: 1.25 },
                  { label: "+50%", multiplier: 1.5 },
                ].map(({ label, multiplier }) => {
                  const presetRate =
                    rateInfo.platform_rate_cents_per_vram_gb_min * multiplier;
                  const isActive =
                    currentInputRate !== null &&
                    Math.abs(currentInputRate - presetRate) < 0.0001;
                  return (
                    <button
                      key={label}
                      onClick={() => handleSetPreset(multiplier)}
                      className={`text-xs px-3 py-1 rounded-md border transition-colors ${
                        isActive
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                      }`}
                    >
                      {label}
                      <span className="ml-1 opacity-60">
                        ${rateToHourly(presetRate).toFixed(3)}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Error / success feedback */}
              {rateError && (
                <div className="flex items-center gap-2 text-red-400 text-sm">
                  <AlertCircle size={13} />
                  {rateError}
                </div>
              )}
              {rateSaved && (
                <div className="flex items-center gap-2 text-green-400 text-sm">
                  <CheckCircle2 size={13} />
                  Rate saved successfully.
                </div>
              )}

              {/* Earnings estimator */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground font-medium">
                    Per-job earnings
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Idle = $0 &mdash; paid per completed job only
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
                          <span className="font-medium">
                            ~{formatCents(perJob)}
                          </span>
                          <span className="text-muted-foreground/60">
                            ≈ {formatCents(perHour)}/hr if busy
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Market position */}
              {rateInfo.market_avg_rate !== null && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Market position</span>
                  <div className="flex items-center gap-1.5">
                    {marketPosition === "competitive" && (
                      <>
                        <TrendingDown size={12} className="text-green-400" />
                        <Badge
                          variant="outline"
                          className="text-[10px] border-green-500/30 text-green-400"
                        >
                          Competitive — more jobs likely
                        </Badge>
                      </>
                    )}
                    {marketPosition === "above" && (
                      <>
                        <Minus size={12} className="text-amber-400" />
                        <Badge
                          variant="outline"
                          className="text-[10px] border-amber-500/30 text-amber-400"
                        >
                          Above average — slightly fewer jobs
                        </Badge>
                      </>
                    )}
                    {marketPosition === "premium" && (
                      <>
                        <TrendingUp size={12} className="text-orange-400" />
                        <Badge
                          variant="outline"
                          className="text-[10px] border-orange-500/30 text-orange-400"
                        >
                          Premium — significantly fewer jobs
                        </Badge>
                      </>
                    )}
                  </div>
                </div>
              )}

              {rateInfo.custom_rate_cents_per_vram_gb_min === null && (
                <p className="text-[10px] text-muted-foreground">
                  Using platform default rate. Set a custom rate above to
                  override.
                </p>
              )}
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card/60">
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-muted-foreground mb-1">
              Pending Earnings
            </p>
            <p className="text-xl font-bold text-amber-400">
              {wallet ? formatCents(wallet.pending_earnings_cents) : "—"}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-card/60">
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-muted-foreground mb-1">
              Available to Withdraw
            </p>
            <p className="text-xl font-bold text-green-400">
              {wallet ? formatCents(wallet.available_to_withdraw_cents) : "—"}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-card/60">
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-muted-foreground mb-1">
              Lifetime Earned
            </p>
            <p className="text-xl font-bold">
              {wallet ? formatCents(wallet.total_earned_lifetime_cents) : "—"}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-card/60">
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-muted-foreground mb-1">
              Total Withdrawn
            </p>
            <p className="text-xl font-bold">
              {wallet ? formatCents(wallet.total_withdrawn_cents) : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Bank Account */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 size={16} />
              Payout Account
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {wallet?.stripe_account_verified ? (
              <>
                <div className="flex items-center gap-2 text-green-400 text-sm">
                  <CheckCircle2 size={14} />
                  <span>Bank account connected &amp; verified</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleStripeDashboard}
                  disabled={stripeLoading}
                  className="w-full"
                >
                  {stripeLoading ? (
                    <Loader2 size={14} className="mr-2 animate-spin" />
                  ) : (
                    <ExternalLink size={14} className="mr-2" />
                  )}
                  Manage Payout Account
                </Button>
              </>
            ) : wallet?.stripe_details_submitted ? (
              <>
                <div className="flex items-center gap-2 text-amber-400 text-sm">
                  <Clock size={14} />
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
                    <Loader2 size={14} className="mr-2 animate-spin" />
                  ) : (
                    <ExternalLink size={14} className="mr-2" />
                  )}
                  Open Stripe Dashboard
                </Button>
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
                    <Loader2 size={14} className="mr-2 animate-spin" />
                  ) : (
                    <Building2 size={14} className="mr-2" />
                  )}
                  Connect Bank Account
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* Withdraw */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowDownToLine size={16} />
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
                    <span className="font-semibold text-green-400">
                      {formatCents(availableAmount)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Platform fee (15%) is already deducted from your earnings at
                    job completion.
                  </p>
                </div>
                {withdrawError && (
                  <div className="flex items-center gap-2 text-red-400 text-sm">
                    <AlertCircle size={14} />
                    {withdrawError}
                  </div>
                )}
                {withdrawSuccess && (
                  <div className="flex items-center gap-2 text-green-400 text-sm">
                    <CheckCircle2 size={14} />
                    Withdrawal requested! Arrives in 1–3 business days.
                  </div>
                )}
                <Button
                  onClick={handleWithdraw}
                  disabled={withdrawing}
                  className="w-full"
                >
                  {withdrawing ? (
                    <Loader2 size={14} className="mr-2 animate-spin" />
                  ) : (
                    <ArrowDownToLine size={14} className="mr-2" />
                  )}
                  Withdraw {formatCents(availableAmount)}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Docker Auto-Cleanup */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Trash2 size={16} />
            Docker Auto-Cleanup
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Auto-remove idle images</p>
              <p className="text-xs text-muted-foreground">
                Images unused for the idle timeout are removed automatically
              </p>
            </div>
            <Button
              variant={cleanupEnabled ? "primary" : "outline"}
              size="sm"
              onClick={() => toggleCleanup(!cleanupEnabled)}
            >
              {cleanupEnabled ? "Enabled" : "Disabled"}
            </Button>
          </div>

          {cleanupEnabled && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Idle timeout</span>
                <span className="font-medium">{idleTimeout} min</span>
              </div>
              <Slider
                min={15}
                max={120}
                step={5}
                value={[idleTimeout]}
                onValueChange={handleIdleTimeoutChange}
                className="w-full"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>15 min</span>
                <span>120 min</span>
              </div>
            </div>
          )}

          {cleanupLog.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground font-medium">
                Recent cleanup events
              </p>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {cleanupLog.map((evt, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <Trash2
                      size={10}
                      className="text-amber-400 flex-shrink-0"
                    />
                    <span className="truncate">{evt.service_type}</span>
                    <span className="ml-auto flex-shrink-0">
                      {formatDate(evt.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Earnings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign size={16} />
            Recent Earnings
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingTxns ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 size={14} className="animate-spin" />
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
                      className={`text-[10px] ${txn.status === "completed" ? "border-green-500/30 text-green-400" : "border-amber-500/30 text-amber-400"}`}
                    >
                      {txn.status}
                    </Badge>
                    <span
                      className={`text-sm font-medium ${txn.amount_cents < 0 ? "text-red-400" : "text-green-400"}`}
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
  );
}
