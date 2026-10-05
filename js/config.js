// ============================================================
// Supabase connection (project "Supernova")
// The anon / publishable key is meant to be public; the data is protected by RLS (signed-in only).
// ============================================================
const SUPABASE_URL = 'https://yvikhmwwymjvahyzafne.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2aWtobXd3eW1qdmFoeXphZm5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExODk2ODIsImV4cCI6MjEwNjc2NTY4Mn0.WhDLRZXgTu9YLSt02VrCdTCBEcsjiFn2kQIjMdZdyII';

/* the one shared Supabase account the passcode signs in to */
const SHARED_ACCOUNT_EMAIL = 'alchemy.slsp@gmail.com';

window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
