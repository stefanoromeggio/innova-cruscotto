import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://lbqqonocwaxpezhjuwe.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicXFvbm9jd2F4cGV6aGppdXdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMzA3ODcsImV4cCI6MjA4OTcwNjc4N30.9WeFufSUgP_jxqt9Toyre1zEHDLhkjjIwEGYAeT2qYc';

// Client Supabase standard (usato solo dove non bloccato da firewall)
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Helper che usa il proxy Vercel quando in produzione
const isProd = typeof window !== 'undefined' && window.location.hostname !== 'localhost';

export async function dbGet() {
  if (isProd) {
    const r = await fetch('/api/db?action=get');
    const data = await r.json();
    return { data: data[0] || null, error: null };
  }
  const { data, error } = await supabase.from('patients').select('data').eq('id', 'innova-clinique').maybeSingle();
  return { data, error };
}

export async function dbUpsert(payload) {
  if (isProd) {
    const r = await fetch('/api/db?action=upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await r.json();
    return { error: result.error || null };
  }
  const { error } = await supabase.from('patients').upsert(payload);
  return { error };
}
