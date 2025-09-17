import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

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
