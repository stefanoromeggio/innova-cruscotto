// ================================================================
// src/sinottico/sinotticoApi.js
// Single point of contact tra il modulo SINOTTICO e il proxy
// serverless api/sinottico.js.
//
// Questo file sa solo come chiamare il proxy e come interpretare
// la risposta grezza. Non gestisce stato UI (loading, error, data):
// quella responsabilità appartiene ai componenti React che chiamano
// queste funzioni dentro useEffect / try-catch.
//
// In sviluppo locale (localhost) le chiamate a /api/sinottico
// vengono servite da Vercel Dev; in produzione dal serverless
// su Vercel — in entrambi i casi il proxy aggira il firewall
// Fortinet che blocca supabase.co dalla rete clinica.
// ================================================================

// Carica i KPI dalla vista vw_sinottico_overview tramite proxy.
// Ritorna un array di oggetti (una riga per KPI).
// Lancia Error se la rete fallisce, il server risponde con errore,
// o il body non è un array.
export async function fetchOverviewKPI() {
  const r = await fetch('/api/sinottico?action=kpi');

  if (!r.ok) {
    throw new Error(`Errore nel caricamento KPI (HTTP ${r.status})`);
  }

  const data = await r.json();

  if (!Array.isArray(data)) {
    throw new Error('Risposta inattesa dal server (KPI non è un array)');
  }

  return data;
}

// Carica gli alert con stato='aperto' tramite proxy.
// Ritorna un array di oggetti (può essere vuoto se non ci sono alert).
// Lancia Error se la rete fallisce o il server risponde con errore.
export async function fetchAlertAttivi() {
  const r = await fetch('/api/sinottico?action=alerts');

  if (!r.ok) {
    throw new Error(`Errore nel caricamento alert (HTTP ${r.status})`);
  }

  const data = await r.json();

  if (!Array.isArray(data)) {
    throw new Error('Risposta inattesa dal server (alert non è un array)');
  }

  return data;
}

// Aggiorna lo stato di un alert tramite proxy.
// Valida i parametri localmente prima di chiamare il server.
//
// id: UUID dell'alert (stringa non vuota)
// stato: nuovo stato — deve essere uno dei quattro valori validi
// notaDecisionale: testo libero opzionale (può essere null o '')
//
// Imposta automaticamente data_risoluzione al momento corrente
// se lo stato è 'risolto' o 'ignorato', altrimenti null.
//
// Ritorna { ok: true } se il PATCH ha avuto successo.
// Lancia Error con il messaggio del server in caso di errore.
export async function aggiornaStatoAlert(id, stato, notaDecisionale) {
  const STATI_VALIDI = ['aperto', 'in_gestione', 'risolto', 'ignorato'];

  if (!id || typeof id !== 'string' || id.trim() === '') {
    throw new Error('id alert non valido: deve essere una stringa non vuota');
  }

  if (!STATI_VALIDI.includes(stato)) {
    throw new Error(
      `stato non valido: "${stato}". Valori ammessi: ${STATI_VALIDI.join(', ')}`
    );
  }

  const body = {
    stato,
    nota_decisionale: notaDecisionale || null,
    data_risoluzione: (stato === 'risolto' || stato === 'ignorato')
      ? new Date().toISOString()
      : null,
  };

  const r = await fetch(`/api/sinottico?action=update_alert&id=${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    // Prova a leggere il messaggio di errore dal body JSON del proxy.
    // Fallback al testo HTTP se il body non è JSON.
    let messaggio;
    try {
      const err = await r.json();
      messaggio = err.error || `HTTP ${r.status}`;
    } catch {
      messaggio = `HTTP ${r.status}`;
    }
    throw new Error(`Errore nell'aggiornamento dell'alert: ${messaggio}`);
  }

  return { ok: true };
}
