import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProviderRateInfo } from "@/types";
import type { MarketPosition } from "../monetize-types";
import {
  getErrorMessage,
  hourlyToRate,
  rateToHourly,
} from "../monetize-utils";

export function useProviderRate() {
  const [rateInfo, setRateInfo] = useState<ProviderRateInfo | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateInput, setRateInput] = useState("");
  const [rateSaving, setRateSaving] = useState(false);
  const [rateSaveError, setRateSaveError] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  const loadProviderRate = useCallback(async () => {
    setRateLoading(true);
    try {
      const result = await window.electronAPI.getProviderRate();
      if (!result.error) {
        setRateInfo(result);
        setCooldownSeconds(result.cooldown_remaining_seconds ?? 0);
        const suggestedRate =
          result.suggested_rate_cents_per_vram_gb_min ??
          result.platform_rate_cents_per_vram_gb_min;
        const initialRate =
          result.custom_rate_cents_per_vram_gb_min !== null
            ? result.effective_rate
            : suggestedRate;
        setRateInput(rateToHourly(initialRate).toFixed(3));
      }
    } catch (error) {
      console.error("Failed to load provider rate:", error);
    } finally {
      setRateLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProviderRate();
  }, [loadProviderRate]);

  useEffect(() => {
    const interval = setInterval(loadProviderRate, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadProviderRate]);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setCooldownSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  const handleRateInputChange = useCallback((value: string) => {
    setRateInput(value);
    setRateSaveError(null);
  }, []);

  const handleSaveRate = useCallback(
    async (valueStr?: string) => {
      if (!rateInfo) return;
      const dollars = parseFloat(valueStr ?? rateInput);
      if (isNaN(dollars) || dollars < 0) return;

      const centsPerVramGbMin = hourlyToRate(dollars);
      if (centsPerVramGbMin < rateInfo.floor_rate) {
        setRateSaveError(
          `Minimum rate is $${rateToHourly(rateInfo.floor_rate).toFixed(3)}/hr`,
        );
        return;
      }

      if (centsPerVramGbMin > rateInfo.ceiling_rate) {
        setRateSaveError(
          `Maximum rate is $${rateToHourly(rateInfo.ceiling_rate).toFixed(3)}/hr (${rateInfo.online_monetize_providers_count} provider(s) online)`,
        );
        return;
      }

      setRateSaving(true);
      setRateSaveError(null);
      try {
        const result =
          await window.electronAPI.setProviderRate(centsPerVramGbMin);
        if (result.error) {
          setRateSaveError(result.error);
          if (result.cooldown_remaining_seconds) {
            setCooldownSeconds(result.cooldown_remaining_seconds);
          }
        } else {
          setRateInfo((prev) => (prev ? { ...prev, ...result } : result));
          if (result.cooldown_remaining_seconds) {
            setCooldownSeconds(result.cooldown_remaining_seconds);
          }
        }
      } catch (error) {
        setRateSaveError(getErrorMessage(error, "Failed to save rate"));
      } finally {
        setRateSaving(false);
      }
    },
    [rateInfo, rateInput],
  );

  const handleSetPreset = useCallback(
    (multiplier: number) => {
      if (!rateInfo) return;
      const newRate = rateInfo.platform_rate_cents_per_vram_gb_min * multiplier;
      const valueStr = rateToHourly(newRate).toFixed(3);
      setRateInput(valueStr);
      setRateSaveError(null);
      handleSaveRate(valueStr);
    },
    [handleSaveRate, rateInfo],
  );

  const handleResetRate = useCallback(async () => {
    if (!rateInfo) return;

    setRateSaving(true);
    setRateSaveError(null);
    try {
      const result = await window.electronAPI.setProviderRate(null);
      if (result.error) {
        setRateSaveError(result.error);
      } else {
        setRateInfo((prev) => (prev ? { ...prev, ...result } : result));
        setRateInput(rateToHourly(result.effective_rate).toFixed(3));
        setCooldownSeconds(0);
      }
    } catch (error) {
      setRateSaveError(getErrorMessage(error, "Failed to reset rate"));
    } finally {
      setRateSaving(false);
    }
  }, [rateInfo]);

  const marketPosition = useMemo<MarketPosition | null>(() => {
    if (!rateInfo || !rateInfo.market_avg_rate) return null;
    const ratio = rateInfo.effective_rate / rateInfo.market_avg_rate;
    if (ratio <= 1.0) return "competitive";
    if (ratio <= 1.25) return "above";
    return "premium";
  }, [rateInfo]);

  const currentInputRate = useMemo(() => {
    const dollars = parseFloat(rateInput);
    return isNaN(dollars) ? null : hourlyToRate(dollars);
  }, [rateInput]);

  return {
    rateInfo,
    rateLoading,
    rateInput,
    rateSaving,
    rateSaveError,
    cooldownSeconds,
    marketPosition,
    currentInputRate,
    handleRateInputChange,
    handleSaveRate,
    handleSetPreset,
    handleResetRate,
  };
}
