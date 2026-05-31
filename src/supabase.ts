import { createClient } from "@supabase/supabase-js";

import config from "../config.json";

const supabaseUrl = config.SUPABASE_URL;
const supabasePublishableKey = config.SUPABASE_PUBLISHABLE_KEY;
let rendererAccessToken: string | null = null;

if (!supabaseUrl || !supabasePublishableKey) {
  console.error(
    "Supabase credentials not found. Make sure config.json has SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY."
  );
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  // The main process owns Supabase Auth persistence and refresh rotation.
  // Renderer requests only need the current access token for RLS/PostgREST.
  accessToken: async () => rendererAccessToken,
});

export const setSupabaseAccessToken = (accessToken: string | null) => {
  rendererAccessToken = accessToken;
  supabase.realtime.setAuth(accessToken);
};
