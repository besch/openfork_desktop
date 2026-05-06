import { useCallback, useEffect, useRef, useState } from "react";
import type { MonetizeWallet } from "@/types";
import { supabase } from "@/supabase";
import type { ApiErrorResponse } from "../monetize-types";
import { getErrorMessage } from "../monetize-utils";

interface UseWithdrawalOptions {
  wallet: MonetizeWallet | null;
  fetchMonetizeWallet: () => Promise<void>;
  reloadTransactions: () => Promise<void>;
}

export function useWithdrawal({
  wallet,
  fetchMonetizeWallet,
  reloadTransactions,
}: UseWithdrawalOptions) {
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccess, setWithdrawSuccess] = useState(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleWithdraw = useCallback(async () => {
    if (!wallet) return;

    const amount = Math.floor(wallet.available_to_withdraw_millicents);
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
        body: JSON.stringify({ amount_millicents: amount }),
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
        reloadTransactions();
        if (successTimerRef.current) {
          clearTimeout(successTimerRef.current);
        }
        successTimerRef.current = setTimeout(() => {
          setWithdrawSuccess(false);
        }, 4000);
      }
    } catch (error) {
      setWithdrawError(getErrorMessage(error, "Network error"));
    } finally {
      setWithdrawing(false);
    }
  }, [fetchMonetizeWallet, reloadTransactions, wallet]);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
      }
    };
  }, []);

  return {
    withdrawing,
    withdrawError,
    withdrawSuccess,
    handleWithdraw,
  };
}
