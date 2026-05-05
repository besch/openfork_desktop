import { createClient } from "@supabase/supabase-js";

import config from "../config.json";

const supabaseUrl = config.SUPABASE_URL;
const supabasePublishableKey = config.SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  console.error(
    "Supabase credentials not found. Make sure config.json has SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY."
  );
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    // The main process handles session persistence via electron-store.
    // The renderer client uses in-memory storage and gets the session from main.
    // Keep refresh ownership in the main process so we don't have multiple
    // clients racing to rotate the same refresh token.
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});
