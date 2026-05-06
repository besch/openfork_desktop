import { useEffect } from "react";
import { useClientStore } from "@/store";
import { ProviderPricingCard } from "@/components/monetize/ProviderPricingCard";
import { PayoutAccountCard } from "@/components/monetize/PayoutAccountCard";
import { RecentEarningsCard } from "@/components/monetize/RecentEarningsCard";
import { WalletSummaryGrid } from "@/components/monetize/WalletSummaryGrid";
import { WithdrawCard } from "@/components/monetize/WithdrawCard";
import { useMonetizeTransactions } from "@/components/monetize/hooks/useMonetizeTransactions";
import { useProviderRate } from "@/components/monetize/hooks/useProviderRate";
import { useStripePayout } from "@/components/monetize/hooks/useStripePayout";
import { useWithdrawal } from "@/components/monetize/hooks/useWithdrawal";

export function Monetize() {
  const { session, monetizeWallet, fetchMonetizeWallet } = useClientStore();
  const userId = session?.user?.id;

  const providerRate = useProviderRate();
  const transactions = useMonetizeTransactions(userId);
  const stripePayout = useStripePayout();
  const withdrawal = useWithdrawal({
    wallet: monetizeWallet,
    fetchMonetizeWallet,
    reloadTransactions: transactions.reloadTransactions,
  });

  useEffect(() => {
    fetchMonetizeWallet();
  }, [fetchMonetizeWallet]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <ProviderPricingCard
        rateInfo={providerRate.rateInfo}
        rateLoading={providerRate.rateLoading}
        rateInput={providerRate.rateInput}
        rateSaving={providerRate.rateSaving}
        rateSaveError={providerRate.rateSaveError}
        cooldownSeconds={providerRate.cooldownSeconds}
        marketPosition={providerRate.marketPosition}
        currentInputRate={providerRate.currentInputRate}
        onRateInputChange={providerRate.handleRateInputChange}
        onSaveRate={providerRate.handleSaveRate}
        onSetPreset={providerRate.handleSetPreset}
        onResetRate={providerRate.handleResetRate}
      />

      <WalletSummaryGrid wallet={monetizeWallet} />

      <div className="grid md:grid-cols-2 gap-6">
        <PayoutAccountCard
          wallet={monetizeWallet}
          stripeLoading={stripePayout.stripeLoading}
          stripeError={stripePayout.stripeError}
          onStripeOnboard={stripePayout.handleStripeOnboard}
          onStripeDashboard={stripePayout.handleStripeDashboard}
        />

        <WithdrawCard
          wallet={monetizeWallet}
          rateInfo={providerRate.rateInfo}
          withdrawing={withdrawal.withdrawing}
          withdrawError={withdrawal.withdrawError}
          withdrawSuccess={withdrawal.withdrawSuccess}
          onWithdraw={withdrawal.handleWithdraw}
        />
      </div>

      <RecentEarningsCard
        transactions={transactions.transactions}
        loadingTransactions={transactions.loadingTransactions}
        loadingMoreTransactions={transactions.loadingMoreTransactions}
        transactionsError={transactions.transactionsError}
        hasMoreTransactions={transactions.hasMoreTransactions}
        transactionListRef={transactions.transactionListRef}
        lastTransactionRef={transactions.lastTransactionRef}
        onReload={transactions.reloadTransactions}
      />
    </div>
  );
}
