import type { MonetizeWallet, ProviderRateInfo } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader } from "@/components/ui/loader";
import { AlertCircle, ArrowDownToLine, CheckCircle2, Info } from "lucide-react";
import {
  MIN_WITHDRAWAL_MILLICENTS,
  SETTLEMENT_HOLD_DAYS,
  formatCents,
  formatMillicents,
} from "./monetize-utils";

interface WithdrawCardProps {
  wallet: MonetizeWallet | null;
  rateInfo: ProviderRateInfo | null;
  withdrawing: boolean;
  withdrawError: string | null;
  withdrawSuccess: boolean;
  onWithdraw: () => void;
}

export function WithdrawCard({
  wallet,
  rateInfo,
  withdrawing,
  withdrawError,
  withdrawSuccess,
  onWithdraw,
}: WithdrawCardProps) {
  const pendingAmount = wallet?.pending_earnings_millicents ?? 0;
  const availableAmount = wallet?.available_to_withdraw_millicents ?? 0;
  const withdrawShortfall = Math.max(
    0,
    MIN_WITHDRAWAL_MILLICENTS - availableAmount,
  );
  const withdrawProgress = Math.min(
    100,
    (availableAmount / MIN_WITHDRAWAL_MILLICENTS) * 100,
  );
  const canWithdraw =
    Boolean(wallet?.stripe_account_verified) &&
    availableAmount >= MIN_WITHDRAWAL_MILLICENTS;

  return (
    <Card className="relative overflow-hidden bg-surface/40 border-white/20 shadow-xl group">
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-amber-500/5" />
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-black/40 border border-amber-500/20 shadow-sm shadow-amber-500/20 text-amber-500">
              <ArrowDownToLine size={16} />
            </div>
            Withdraw Earnings
          </div>
          <Badge
            variant={canWithdraw ? "success" : "muted"}
            className="text-[10px]"
          >
            {canWithdraw ? "Ready" : "Not ready"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="relative z-10 space-y-4">
        <div className="rounded-lg border border-white/10 bg-black/20 p-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-white/45 font-black">
                Available balance
              </p>
              <p className="mt-1 text-2xl font-black tabular-nums text-emerald-400">
                {formatMillicents(availableAmount)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground">Minimum</p>
              <p className="font-mono text-xs text-white/70">
                {formatCents(MIN_WITHDRAWAL_MILLICENTS)}
              </p>
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${withdrawProgress}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <p className="text-[10px] uppercase tracking-[0.16em] text-amber-300/70 font-black">
              Pending settlement
            </p>
            <p className="mt-1 font-mono text-xs text-amber-200">
              {formatMillicents(pendingAmount)}
            </p>
            <p className="mt-1 text-[11px] text-white/50">
              {formatCents(pendingAmount)} awaiting settlement
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <p className="text-[10px] uppercase tracking-[0.16em] text-white/45 font-black">
              Platform fee
            </p>
            <p className="mt-1 font-mono text-xs text-white/80">
              {rateInfo ? `${rateInfo.platform_fee_percent}%` : "Applied"}
            </p>
            <p className="mt-1 text-[11px] text-white/50">
              Already deducted before wallet credit
            </p>
          </div>
        </div>

        {pendingAmount > 0 && !canWithdraw && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-100/90">
            <Info size={14} className="mt-0.5 shrink-0 text-amber-300" />
            <p>
              Pending earnings move into available balance after the{" "}
              {SETTLEMENT_HOLD_DAYS}-day hold during the settlement run. That
              is why you can have {formatMillicents(pendingAmount)} pending and{" "}
              {formatMillicents(availableAmount)} available right now.
            </p>
          </div>
        )}

        {!wallet?.stripe_account_verified ? (
          <p className="text-sm text-muted-foreground">
            Connect and verify your payout account before withdrawing.
          </p>
        ) : canWithdraw ? (
          <p className="text-sm text-muted-foreground">
            You can withdraw your cleared balance now. Payout timing is handled
            by Stripe after the request is created.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Minimum withdrawal is {formatMillicents(MIN_WITHDRAWAL_MILLICENTS)}.
            Pending earnings become withdrawable after the{" "}
            {SETTLEMENT_HOLD_DAYS}-day hold, when a settlement run moves them
            into available balance. You have {formatMillicents(availableAmount)}{" "}
            available
            {withdrawShortfall > 0
              ? ` and need ${formatMillicents(withdrawShortfall)} more available.`
              : "."}
          </p>
        )}

        {withdrawError && (
          <div className="flex items-center gap-2 text-destructive-foreground text-sm">
            <AlertCircle size={14} className="text-white" />
            {withdrawError}
          </div>
        )}
        {withdrawSuccess && (
          <div className="flex items-center gap-2 text-primary text-sm">
            <CheckCircle2 size={14} className="text-white" />
            Withdrawal requested! Arrives in 1-3 business days.
          </div>
        )}

        {wallet?.stripe_account_verified && (
          <Button
            onClick={onWithdraw}
            disabled={!canWithdraw || withdrawing}
            className="w-full"
          >
            {withdrawing ? (
              <Loader size="xs" className="mr-2 animate-spin text-white" />
            ) : (
              <ArrowDownToLine size={14} className="mr-2 text-white" />
            )}
            Withdraw {formatMillicents(availableAmount)}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
