import { createClient } from "@supabase/supabase-js";

import config from "../config.json";

const supabaseUrl = config.SUPABASE_URL;
const supabaseAnonKey = config.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "Supabase credentials not found. Make sure to create a .env file in the dgn_client_desktop directory."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // The main process handles session persistence via electron-store.
    // The renderer client uses in-memory storage and gets the session from main.
    persistSession: false,
  },
});
