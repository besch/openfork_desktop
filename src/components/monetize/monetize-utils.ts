const CENT_COUNT_FORMATTER = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
});
const USD_FORMATTER = new Intl.NumberFormat(undefined, {
  currency: "USD",
  maximumFractionDigits: 4,
  minimumFractionDigits: 2,
  style: "currency",
});

export const DISPLAY_VRAM_GB = 8;
export const TRANSACTIONS_PAGE_SIZE = 20;
export const MIN_WITHDRAWAL_MILLICENTS = 5000;
export const SETTLEMENT_HOLD_DAYS = 3;

export const ESTIMATOR_JOBS = [
  {
    label: "WAN 2.2  (8 GB, 5 min)",
    vramGb: 8,
    durationMin: 5,
    jobsPerHour: 10,
  },
  {
    label: "LTX-2.3  (24 GB, 2 min)",
    vramGb: 24,
    durationMin: 2,
    jobsPerHour: 27,
  },
  {
    label: "Hunyuan 1.5  (24 GB, 20 min)",
    vramGb: 24,
    durationMin: 20,
    jobsPerHour: 3,
  },
];

export const RATE_PRESETS = [
  { label: "Platform Rate", multiplier: 1.0 },
  { label: "+25%", multiplier: 1.25 },
  { label: "+50%", multiplier: 1.5 },
];

export function formatMillicents(millicents: number): string {
  return USD_FORMATTER.format(millicents / 1000);
}

export function formatSignedMillicents(millicents: number): string {
  if (millicents === 0) return formatMillicents(0);
  const sign = millicents > 0 ? "+" : "-";
  return `${sign}${formatMillicents(Math.abs(millicents))}`;
}

export function formatCents(millicents: number): string {
  const cents = millicents / 10;
  const unit = Math.abs(cents) === 1 ? "cent" : "cents";
  return `${CENT_COUNT_FORMATTER.format(cents)} ${unit}`;
}

export function formatSignedCents(millicents: number): string {
  if (millicents === 0) return formatCents(0);
  const sign = millicents > 0 ? "+" : "-";
  return `${sign}${formatCents(Math.abs(millicents))}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return fallback;
}

export function rateToHourly(centsPerVramGbMin: number): number {
  return (centsPerVramGbMin * DISPLAY_VRAM_GB * 60) / 100;
}

export function hourlyToRate(dollarsPerHr: number): number {
  return (dollarsPerHr * 100) / (DISPLAY_VRAM_GB * 60);
}

export function estimateJobEarnings(
  rateCentsPerVramGbMin: number,
  vramGb: number,
  durationMin: number,
): number {
  return Math.ceil(vramGb * durationMin * rateCentsPerVramGbMin * 10);
}
