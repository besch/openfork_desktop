import { useCallback, useState } from "react";
import { getErrorMessage } from "../monetize-utils";

export function useStripePayout() {
  const [stripeLoading, setStripeLoading] = useState(false);
  const [stripeError, setStripeError] = useState<string | null>(null);

  const handleStripeOnboard = useCallback(async () => {
    setStripeLoading(true);
    setStripeError(null);
    try {
      const result = await window.electronAPI.openStripeOnboard();
      if (result.error) {
        console.error("Stripe onboard error:", result.error);
        setStripeError(result.error);
      }
    } catch (error) {
      console.error("Stripe onboard error:", error);
      setStripeError(
        getErrorMessage(error, "Failed to open Stripe onboarding"),
      );
    } finally {
      setStripeLoading(false);
    }
  }, []);

  const handleStripeDashboard = useCallback(async () => {
    setStripeLoading(true);
    setStripeError(null);
    try {
      const result = await window.electronAPI.openStripeDashboard();
      if (result.error) {
        console.error("Stripe dashboard error:", result.error);
        setStripeError(result.error);
      }
    } catch (error) {
      console.error("Stripe dashboard error:", error);
      setStripeError(getErrorMessage(error, "Failed to open Stripe dashboard"));
    } finally {
      setStripeLoading(false);
    }
  }, []);

  return {
    stripeLoading,
    stripeError,
    handleStripeOnboard,
    handleStripeDashboard,
  };
}
