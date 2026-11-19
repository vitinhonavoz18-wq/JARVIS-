import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

/** Só existe quando o projeto Supabase está configurado; caso contrário o app roda em Modo Local. */
export const supabase: SupabaseClient | null =
  url && key && !url.includes('SEU-PROJETO')
    ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
    : null;

export const isCloud = Boolean(supabase);
