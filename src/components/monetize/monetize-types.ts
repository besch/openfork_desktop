export interface Transaction {
  id: string;
  transaction_type: string;
  amount_millicents: number;
  created_at: string;
  description: string | null;
  status: string;
}

export interface ApiErrorResponse {
  error?: string;
}

export type MarketPosition = "competitive" | "above" | "premium";
