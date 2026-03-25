const https = require('https');

const SUPABASE_HOST = 'lbqqonocwaxpezhjuwe.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicXFvbm9jd2F4cGV6aGppdXdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMzA3ODcsImV4cCI6MjA4OTcwNjc4N30.9WeFufSUgP_jxqt9Toyre1zEHDLhkjjIwEGYAeT2qYc';

function sbRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: SUPABASE_HOST,
      port: 443,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Prefer': method === 'POST' ? 'resolution=merge-duplicates' : '',
      },
    };
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const action = req.query.action;

  try {
    if (action === 'get') {
      const r = await sbRequest('GET', '/rest/v1/patients?select=data&id=eq.innova-clinique');
      if (r.status !== 200) { res.status(r.status).json({ error: r.body }); return; }
      const rows = JSON.parse(r.body);
      res.status(200).json(rows[0] || null);
      return;
    }

    if (action === 'upsert') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }
      const r = await sbRequest('POST', '/rest/v1/patients', body);
      if (r.status >= 300) { res.status(r.status).json({ error: r.body }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: 'Unknown action: ' + action });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
