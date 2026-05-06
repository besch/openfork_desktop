import { useState, type RefObject } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Loader } from "@/components/ui/loader";
import { ChevronDown, DollarSign, ReceiptText } from "lucide-react";
import type { Transaction } from "./monetize-types";
import {
  formatDate,
  formatSignedCents,
  formatSignedMillicents,
} from "./monetize-utils";

interface RecentEarningsCardProps {
  transactions: Transaction[];
  loadingTransactions: boolean;
  loadingMoreTransactions: boolean;
  transactionsError: string | null;
  hasMoreTransactions: boolean;
  transactionListRef: RefObject<HTMLDivElement | null>;
  lastTransactionRef: (node: HTMLDivElement | null) => void;
  onReload: () => Promise<void>;
}

export function RecentEarningsCard({
  transactions,
  loadingTransactions,
  loadingMoreTransactions,
  transactionsError,
  hasMoreTransactions,
  transactionListRef,
  lastTransactionRef,
  onReload,
}: RecentEarningsCardProps) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="bg-surface/40 border-white/20 shadow-xl overflow-hidden group">
        <CardHeader className="p-0">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left transition-colors hover:bg-white/[0.03]"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="p-2 rounded-lg bg-black/40 border border-amber-500/20 shadow-sm shadow-amber-500/20 text-amber-500">
                  <ReceiptText size={16} />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base truncate">
                    Recent Earnings
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Precise payout ledger, newest first.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="muted" className="text-[10px]">
                  {transactions.length} loaded
                </Badge>
                <ChevronDown
                  size={18}
                  className={`text-white/60 transition-transform duration-200 ${
                    open ? "rotate-180" : ""
                  }`}
                />
              </div>
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <div
            ref={transactionListRef}
            className="max-h-[560px] overflow-y-auto px-6 pb-5 pt-1 scrollbar-thin scrollbar-primary"
          >
            {transactionsError && (
              <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
                <span>{transactionsError}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => onReload()}
                >
                  Retry
                </Button>
              </div>
            )}

            {loadingTransactions ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm py-5">
                <Loader size="xs" className="text-white" />
                Loading transactions...
              </div>
            ) : transactions.length === 0 ? (
              <div className="rounded-lg border border-white/10 bg-black/20 px-4 py-8 text-center">
                <DollarSign className="mx-auto mb-3 h-8 w-8 text-white/20" />
                <p className="text-sm text-white/80">
                  No earnings ledger entries yet.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Paid jobs will appear here with exact payout amounts.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {transactions.map((transaction, index) => {
                  const isLast = index === transactions.length - 1;
                  const isNegative = transaction.amount_millicents < 0;
                  return (
                    <div
                      key={transaction.id}
                      ref={isLast ? lastTransactionRef : undefined}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border border-white/10 bg-black/20 px-4 py-3 transition-colors hover:bg-white/[0.04]"
                    >
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate text-sm font-semibold text-white/90">
                            {transaction.description ||
                              transaction.transaction_type}
                          </p>
                          <Badge
                            variant={
                              transaction.status === "completed"
                                ? "success"
                                : "warning"
                            }
                            className="text-[10px]"
                          >
                            {transaction.status}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDate(transaction.created_at)} -{" "}
                          {transaction.transaction_type.replace(/_/g, " ")}
                        </p>
                      </div>
                      <div className="text-right tabular-nums">
                        <p
                          className={`font-mono text-sm font-bold ${
                            isNegative
                              ? "text-destructive-foreground"
                              : "text-emerald-300"
                          }`}
                        >
                          {formatSignedMillicents(
                            transaction.amount_millicents,
                          )}
                        </p>
                        <p className="mt-1 text-[10px] text-white/45">
                          {formatSignedCents(transaction.amount_millicents)}
                        </p>
                      </div>
                    </div>
                  );
                })}

                {loadingMoreTransactions && (
                  <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                    <Loader size="xs" className="text-white" />
                    Loading more earnings...
                  </div>
                )}

                {!hasMoreTransactions && transactions.length > 0 && (
                  <p className="py-3 text-center text-[10px] uppercase tracking-[0.2em] text-muted-foreground/50">
                    All {transactions.length} ledger entries loaded
                  </p>
                )}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
