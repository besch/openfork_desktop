import type { LucideIcon } from "lucide-react";
import { ArrowDownToLine, Clock, DollarSign, WalletCards } from "lucide-react";
import type { MonetizeWallet } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader } from "@/components/ui/loader";
import { formatCents, formatMillicents } from "./monetize-utils";

interface WalletSummaryGridProps {
  wallet: MonetizeWallet | null;
  loadingWallet?: boolean;
  walletError?: string | null;
  onReload?: () => Promise<void>;
}

interface WalletSummaryItem {
  label: string;
  value: string;
  raw: string;
  hint: string;
  color: string;
  icon: LucideIcon;
}

export function WalletSummaryGrid({
  wallet,
  loadingWallet = false,
  walletError = null,
  onReload,
}: WalletSummaryGridProps) {
  const pendingAmount = wallet?.pending_earnings_millicents ?? 0;
  const availableAmount = wallet?.available_to_withdraw_millicents ?? 0;
  const lifetimeAmount = wallet?.total_earned_lifetime_millicents ?? 0;
  const withdrawnAmount = wallet?.total_withdrawn_millicents ?? 0;

  const items: WalletSummaryItem[] = [
    {
      label: "Pending Earnings",
      value: wallet ? formatMillicents(pendingAmount) : "-",
      raw: wallet ? formatCents(pendingAmount) : "Wallet sync pending",
      hint: "Completed paid jobs awaiting settlement.",
      color: "text-amber-400",
      icon: Clock,
    },
    {
      label: "Available Now",
      value: wallet ? formatMillicents(availableAmount) : "-",
      raw: wallet ? formatCents(availableAmount) : "Wallet sync pending",
      hint: "Cleared balance eligible for withdrawal.",
      color: "text-emerald-400",
      icon: WalletCards,
    },
    {
      label: "Lifetime Earned",
      value: wallet ? formatMillicents(lifetimeAmount) : "-",
      raw: wallet ? formatCents(lifetimeAmount) : "Wallet sync pending",
      hint: "Net provider payouts after platform fee.",
      color: "text-white",
      icon: DollarSign,
    },
    {
      label: "Withdrawn",
      value: wallet ? formatMillicents(withdrawnAmount) : "-",
      raw: wallet ? formatCents(withdrawnAmount) : "Wallet sync pending",
      hint: "Paid out through your connected account.",
      color: "text-muted/70",
      icon: ArrowDownToLine,
    },
  ];

  return (
    <div className="space-y-3">
      {walletError && (
        <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="break-words">{walletError}</span>
          {onReload && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onReload()}
            >
              Retry
            </Button>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Card
              key={item.label}
              className="relative overflow-hidden group hover:shadow-xl transition-all duration-500 border-white/20 bg-surface/45 backdrop-blur-md"
            >
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
              <CardContent className="pt-5 pb-5 relative z-10">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-muted/50 font-black group-hover:text-muted/70 transition-colors">
                    {item.label}
                  </p>
                  <div className="h-8 w-8 rounded-lg border border-white/10 bg-black/25 text-white/60 flex items-center justify-center">
                    <Icon size={15} />
                  </div>
                </div>
                <p
                  className={`mt-3 flex min-h-8 items-center break-words text-xl font-black tabular-nums sm:text-2xl ${item.color} drop-shadow-2xl`}
                >
                  {loadingWallet && !wallet ? (
                    <Loader size="xs" className="text-white" />
                  ) : (
                    item.value
                  )}
                </p>
                <p className="mt-2 text-[10px] font-mono text-white/45 truncate">
                  {item.raw}
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  {item.hint}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
