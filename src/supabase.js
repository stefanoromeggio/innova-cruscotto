import { createClient } from '@supabase/supabase-js';

// In produzione (Vercel) usa il proxy locale per bypassare firewall
// In sviluppo usa l'URL diretto
const isProduction = window.location.hostname !== 'localhost';
const SUPABASE_URL = isProduction
  ? window.location.origin + '/sb-api'
  : 'https://lbqqonocwaxpezhjuwe.supabase.co';

const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicXFvbm9jd2F4cGV6aGppdXdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMzA3ODcsImV4cCI6MjA4OTcwNjc4N30.9WeFufSUgP_jxqt9Toyre1zEHDLhkjjIwEGYAeT2qYc';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    headers: { 'X-Client-Info': 'innova-cruscotto' }
  }
});
