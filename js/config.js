// ============================================================
// Supabase connection (project "Supernova")
// The anon / publishable key is meant to be public; the data is protected by RLS (signed-in only).
// ============================================================
const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_KEY = 'YOUR-ANON-KEY';

/* the one shared Supabase account the passcode signs in to */
const SHARED_ACCOUNT_EMAIL = 'alchemy.slsp@gmail.com';

window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
