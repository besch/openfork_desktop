import type { MonetizeWallet } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader } from "@/components/ui/loader";
import {
  Building2,
  CheckCircle2,
  Clock,
  ExternalLink,
} from "lucide-react";

interface PayoutAccountCardProps {
  wallet: MonetizeWallet | null;
  stripeLoading: boolean;
  stripeError: string | null;
  onStripeOnboard: () => void;
  onStripeDashboard: () => void;
}

export function PayoutAccountCard({
  wallet,
  stripeLoading,
  stripeError,
  onStripeOnboard,
  onStripeDashboard,
}: PayoutAccountCardProps) {
  return (
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
              onClick={onStripeDashboard}
              disabled={stripeLoading}
            >
              {stripeLoading ? (
                <Loader size="xs" className="mr-2 animate-spin" />
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
              <span>Verification in progress - check your email</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onStripeDashboard}
              disabled={stripeLoading}
              className="w-full"
            >
              {stripeLoading ? (
                <Loader size="xs" className="mr-2 animate-spin text-white" />
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
              Connect your bank account to receive payouts. Stripe handles all
              identity verification - takes 5-10 minutes.
            </p>
            <Button
              onClick={onStripeOnboard}
              disabled={stripeLoading}
              variant="primary"
            >
              {stripeLoading ? (
                <Loader size="xs" className="mr-2 animate-spin text-white" />
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
  );
}
