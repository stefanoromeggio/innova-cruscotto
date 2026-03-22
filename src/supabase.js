import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://lbqqonocwaxpezhjuwe.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicXFvbm9jd2F4cGV6aGppdXdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMzA3ODcsImV4cCI6MjA4OTcwNjc4N30.9WeFufSUgP_jxqt9Toyre1zEHDLhkjjIwEGYAeT2qYc';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    headers: { 'X-Client-Info': 'innova-cruscotto' }
  }
});
