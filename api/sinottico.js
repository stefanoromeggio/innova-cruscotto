// ================================================================
// Proxy serverless per il modulo SINOTTICO Executive Overview
// Progetto  : Innova Clinique · Cruscotto Paziente 360°
// Creato il : 2026-04-25
// ----------------------------------------------------------------
// Questo file ha lo stesso stile e la stessa struttura di api/db.js.
// Esiste perché api/db.js è hardcoded sulla tabella 'patients';
// il modulo SINOTTICO ha bisogno di leggere tabelle e viste diverse
// e di fare PATCH su singoli alert — operazioni non supportate da dbGet/dbUpsert.
//
// AZIONI DISPONIBILI (via query param ?action=...)
//
//   action=kpi
//     Restituisce tutti i KPI dalla vista vw_sinottico_overview
//     (ultimo snapshot per KPI + delta vs mese precedente).
//     Esempio: fetch('/api/sinottico?action=kpi')
//
//   action=alerts
//     Restituisce gli alert con stato='aperto', ordinati per data desc.
//     Esempio: fetch('/api/sinottico?action=alerts')
//
//   action=update_alert&id=<uuid>
//     Aggiorna stato, nota_decisionale e/o data_risoluzione di un alert.
//     L'id si passa come query param; il body contiene solo i campi da aggiornare.
//     Accetta sia PATCH che POST (compatibilità con fetch standard).
//     Esempio:
//       fetch('/api/sinottico?action=update_alert&id=abc-123', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({ stato: 'risolto', nota_decisionale: 'Gestito.' })
//       })
// ================================================================

const SUPABASE_URL = 'https://lbqqonocwaxpezhjuwe.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicXFvbm9jd2F4cGV6aGppdXdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMzA3ODcsImV4cCI6MjA4OTcwNjc4N30.9WeFufSUgP_jxqt9Toyre1zEHDLhkjjIwEGYAeT2qYc';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey, Prefer');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, id } = req.query;

  if (!action) return res.status(400).json({ error: 'Missing action parameter' });

  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=minimal',
  };

  try {
    // ── KPI overview ──────────────────────────────────────────────
    if (action === 'kpi') {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/vw_sinottico_overview?select=*`,
        { headers }
      );
      const data = await r.json();
      return res.status(200).json(data);
    }

    // ── Alert aperti ──────────────────────────────────────────────
    if (action === 'alerts') {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/sinottico_alert?stato=eq.aperto&order=data_attivazione.desc`,
        { headers }
      );
      const data = await r.json();
      return res.status(200).json(data);
    }

    // ── Aggiornamento stato alert ─────────────────────────────────
    if (action === 'update_alert') {
      const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
      if (!id || !UUID_RE.test(id)) {
        return res.status(400).json({ error: 'Invalid id format: expected UUID' });
      }

      const STATI_VALIDI = ['aperto', 'in_gestione', 'risolto', 'ignorato'];
      const body = req.body || {};

      // Whitelist esplicita: qualunque campo non in lista viene ignorato
      // silenziosamente per evitare che il frontend sovrascriva campi
      // come codice_alert, titolo, severita, ecc.
      const patch = {};
      if (body.stato !== undefined) {
        if (!STATI_VALIDI.includes(body.stato)) {
          return res.status(400).json({
            error: `Stato non valido: "${body.stato}". Valori ammessi: ${STATI_VALIDI.join(', ')}`,
          });
        }
        patch.stato = body.stato;
      }
      if (body.nota_decisionale !== undefined) patch.nota_decisionale = body.nota_decisionale;
      if (body.data_risoluzione  !== undefined) patch.data_risoluzione  = body.data_risoluzione;

      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/sinottico_alert?id=eq.${id}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify(patch),
        }
      );
      if (r.ok) return res.status(200).json({ ok: true });
      const err = await r.text();
      return res.status(r.status).json({ error: err });
    }

    // ── Action sconosciuta ────────────────────────────────────────
    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
