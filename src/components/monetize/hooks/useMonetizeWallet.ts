import { useCallback, useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/supabase";
import type { MonetizeWallet } from "@/types";
import { getErrorMessage } from "../monetize-utils";

const WALLET_SELECT = [
  "id",
  "user_id",
  "pending_earnings_millicents",
  "available_to_withdraw_millicents",
  "total_earned_lifetime_millicents",
  "total_withdrawn_millicents",
  "prepaid_balance_millicents",
  "total_purchased_millicents",
  "reserved_balance_millicents",
  "stripe_account_id",
  "stripe_account_verified",
  "stripe_details_submitted",
  "updated_at",
].join(",");

function normalizeWallet(row: Partial<MonetizeWallet>): MonetizeWallet {
  return {
    ...row,
    pending_earnings_millicents: row.pending_earnings_millicents ?? 0,
    available_to_withdraw_millicents:
      row.available_to_withdraw_millicents ?? 0,
    total_earned_lifetime_millicents:
      row.total_earned_lifetime_millicents ?? 0,
    total_withdrawn_millicents: row.total_withdrawn_millicents ?? 0,
    prepaid_balance_millicents: row.prepaid_balance_millicents ?? 0,
    total_purchased_millicents: row.total_purchased_millicents ?? 0,
    reserved_balance_millicents: row.reserved_balance_millicents ?? 0,
    stripe_account_verified: row.stripe_account_verified ?? false,
    stripe_details_submitted: row.stripe_details_submitted ?? false,
  };
}

export function useMonetizeWallet(userId: string | undefined) {
  const [wallet, setWallet] = useState<MonetizeWallet | null>(null);
  const [loadingWallet, setLoadingWallet] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

  const reloadWallet = useCallback(async () => {
    if (!userId) {
      setWallet(null);
      setWalletError(null);
      setLoadingWallet(false);
      return;
    }

    setLoadingWallet(true);
    setWalletError(null);

    try {
      const { data, error } = await supabase
        .from("monetize_wallets")
        .select(WALLET_SELECT)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) throw error;
      setWallet(
        data ? normalizeWallet(data as unknown as Partial<MonetizeWallet>) : null,
      );
    } catch (error) {
      console.error("Failed to load monetize wallet:", error);
      setWalletError(getErrorMessage(error, "Failed to load wallet"));
    } finally {
      setLoadingWallet(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setWallet(null);
      setWalletError(null);
      setLoadingWallet(false);
      return;
    }

    let active = true;
    let channel: RealtimeChannel | null = null;

    const fetchIfActive = async () => {
      if (active) {
        await reloadWallet();
      }
    };

    channel = supabase
      .channel(`monetize-wallet:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "monetize_wallets",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (!active) return;

          if (payload.eventType === "DELETE") {
            setWallet(null);
            return;
          }

          setWallet(normalizeWallet(payload.new as MonetizeWallet));
          setWalletError(null);
        },
      )
      .subscribe((status, error) => {
        if (!active) return;

        if (status === "SUBSCRIBED") {
          void fetchIfActive();
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setWalletError("Wallet realtime disconnected; retrying sync");
          void fetchIfActive();
        }

        if (error) {
          console.error("Wallet realtime subscription error:", error);
          setWalletError(getErrorMessage(error, "Wallet realtime failed"));
        }
      });

    return () => {
      active = false;
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [reloadWallet, userId]);

  return {
    wallet,
    loadingWallet,
    walletError,
    reloadWallet,
  };
}
