import { useEffect, useState, useCallback } from "react";
import { useClientStore } from "@/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
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

  // Fetch wallet + transactions on mount
  useEffect(() => {
    fetchMonetizeWallet();
    loadTransactions();
    loadMonetizeConfig();
  }, []);

  // Listen for cleanup events from main process
  useEffect(() => {
    const cleanup = window.electronAPI.onMonetizeCleanupEvent((evt) => {
      setCleanupLog((prev) => [evt, ...prev].slice(0, 50));
    });
    return cleanup;
  }, []);

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

  const wallet = monetizeWallet;
  const availableAmount = wallet?.available_to_withdraw_cents ?? 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Amber banner */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm">
        <DollarSign size={16} className="flex-shrink-0" />
        <span>
          <strong>Monetize mode active</strong> — you earn real money for
          processing paid jobs. Docker images will auto-cleanup when idle.
        </span>
      </div>

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
            <p className="text-[10px] text-muted-foreground mt-1">
              3-day security hold
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
                    <span className="text-muted-foreground">Available balance</span>
                    <span className="font-semibold text-green-400">{formatCents(availableAmount)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Platform fee (15%) is already deducted from your earnings at job completion.
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
