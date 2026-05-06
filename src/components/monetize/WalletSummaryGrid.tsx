import type { LucideIcon } from "lucide-react";
import { ArrowDownToLine, Clock, DollarSign, WalletCards } from "lucide-react";
import type { MonetizeWallet } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { formatCents, formatMillicents } from "./monetize-utils";

interface WalletSummaryGridProps {
  wallet: MonetizeWallet | null;
}

interface WalletSummaryItem {
  label: string;
  value: string;
  raw: string;
  hint: string;
  color: string;
  icon: LucideIcon;
}

export function WalletSummaryGrid({ wallet }: WalletSummaryGridProps) {
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
                className={`mt-3 text-2xl font-black tabular-nums ${item.color} drop-shadow-2xl`}
              >
                {item.value}
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
  );
}
