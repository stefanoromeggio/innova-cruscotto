const SUPABASE_URL = 'https://lbqqonocwaxpezhjuwe.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicXFvbm9jd2F4cGV6aGppdXdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMzA3ODcsImV4cCI6MjA4OTcwNjc4N30.9WeFufSUgP_jxqt9Toyre1zEHDLhkjjIwEGYAeT2qYc';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const action = req.query.action;

  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
  };

  try {
    if (action === 'get') {
      const r = await fetch(
        SUPABASE_URL + '/rest/v1/patients?select=data&id=eq.innova-clinique',
        { method: 'GET', headers }
      );
      const rows = await r.json();
      if (!r.ok) { res.status(r.status).json({ error: rows }); return; }
      res.status(200).json(rows[0] || null);
      return;
    }

    if (action === 'upsert') {
      const body = req.body;
      const r = await fetch(
        SUPABASE_URL + '/rest/v1/patients',
        {
          method: 'POST',
          headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify(body),
        }
      );
      const text = await r.text();
      if (!r.ok) { res.status(r.status).json({ error: text }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: 'Unknown action: ' + action });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
