import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/supabase";
import type { Transaction } from "../monetize-types";
import {
  getErrorMessage,
  TRANSACTIONS_PAGE_SIZE,
} from "../monetize-utils";

export function useMonetizeTransactions(userId: string | undefined) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [loadingMoreTransactions, setLoadingMoreTransactions] = useState(false);
  const [transactionsError, setTransactionsError] = useState<string | null>(
    null,
  );
  const [hasMoreTransactions, setHasMoreTransactions] = useState(true);
  const transactionPageRef = useRef(0);
  const transactionLoadingRef = useRef(false);
  const hasMoreTransactionsRef = useRef(true);
  const transactionObserverRef = useRef<IntersectionObserver | null>(null);
  const transactionListRef = useRef<HTMLDivElement | null>(null);

  const loadTransactions = useCallback(
    async (isInitial = false) => {
      if (!userId) {
        setTransactions([]);
        setTransactionsError(null);
        setLoadingTransactions(false);
        setLoadingMoreTransactions(false);
        setHasMoreTransactions(false);
        hasMoreTransactionsRef.current = false;
        transactionPageRef.current = 0;
        return;
      }

      if (
        !isInitial &&
        (!hasMoreTransactionsRef.current || transactionLoadingRef.current)
      ) {
        return;
      }

      const targetPage = isInitial ? 0 : transactionPageRef.current;
      transactionLoadingRef.current = true;
      setTransactionsError(null);
      if (isInitial) {
        setLoadingTransactions(true);
      } else {
        setLoadingMoreTransactions(true);
      }

      try {
        const from = targetPage * TRANSACTIONS_PAGE_SIZE;
        const to = from + TRANSACTIONS_PAGE_SIZE - 1;
        const { data, error } = await supabase
          .from("monetize_transactions")
          .select(
            "id, transaction_type, amount_millicents, created_at, description, status",
          )
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .range(from, to);

        if (error) throw error;

        const nextTransactions = (data as Transaction[]) || [];
        if (isInitial) {
          setTransactions(nextTransactions);
          transactionPageRef.current = 1;
        } else {
          setTransactions((prev) => {
            const existingIds = new Set(prev.map((txn) => txn.id));
            const uniqueTransactions = nextTransactions.filter(
              (txn) => !existingIds.has(txn.id),
            );
            return [...prev, ...uniqueTransactions];
          });
          transactionPageRef.current += 1;
        }

        const hasMore = nextTransactions.length === TRANSACTIONS_PAGE_SIZE;
        setHasMoreTransactions(hasMore);
        hasMoreTransactionsRef.current = hasMore;
      } catch (error) {
        console.error("Failed to load transactions:", error);
        setTransactionsError(
          getErrorMessage(error, "Failed to load earnings"),
        );
      } finally {
        setLoadingTransactions(false);
        setLoadingMoreTransactions(false);
        transactionLoadingRef.current = false;
      }
    },
    [userId],
  );

  useEffect(() => {
    loadTransactions(true);
  }, [loadTransactions]);

  const lastTransactionRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (loadingTransactions || loadingMoreTransactions) return;
      if (transactionObserverRef.current) {
        transactionObserverRef.current.disconnect();
      }

      transactionObserverRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting && hasMoreTransactions) {
            loadTransactions(false);
          }
        },
        {
          root: transactionListRef.current,
          rootMargin: "120px",
        },
      );

      if (node) transactionObserverRef.current.observe(node);
    },
    [
      hasMoreTransactions,
      loadTransactions,
      loadingMoreTransactions,
      loadingTransactions,
    ],
  );

  useEffect(() => {
    return () => {
      if (transactionObserverRef.current) {
        transactionObserverRef.current.disconnect();
      }
    };
  }, []);

  return {
    transactions,
    loadingTransactions,
    loadingMoreTransactions,
    transactionsError,
    hasMoreTransactions,
    transactionListRef,
    lastTransactionRef,
    reloadTransactions: () => loadTransactions(true),
  };
}
