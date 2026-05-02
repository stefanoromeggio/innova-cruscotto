import React, { useState } from 'react';
import AlertBadge from './AlertBadge';
import { aggiornaStatoAlert } from './sinotticoApi';

// Lista degli alert attivi con espansione/compressione per riga
// e azioni di gestione del ciclo di vita (prendi in carico, risolvi, ignora).
export default function AlertList({ alerts, onUpdate }) {
  const [expandedId, setExpandedId] = useState(null);
  const [nota,       setNota]       = useState('');
  const [busy,       setBusy]       = useState(false);

  if (alerts.length === 0) {
    return <p className="alert-empty">Nessun alert attivo. Tutto sotto controllo.</p>;
  }

  // Espande l'alert cliccato; comprime se già aperto.
  // Resetta la nota quando si cambia alert per evitare contaminazioni.
  function toggleExpand(id) {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      setNota('');
    }
  }

  // Invia l'aggiornamento di stato al proxy, poi notifica il parent.
  async function gestisci(alertId, nuovoStato) {
    setBusy(true);
    try {
      await aggiornaStatoAlert(alertId, nuovoStato, nota);
      setExpandedId(null);
      setNota('');
      onUpdate();
    } catch (e) {
      // Soluzione provvisoria Fase 1 — sostituire con toast in Fase 2.
      window.alert('Errore: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ul className="alert-list">
      {alerts.map(a => {
        const isExpanded = expandedId === a.id;
        return (
          <li key={a.id} className={`alert-item alert-${a.severita.toLowerCase()}`}>

            <header className="alert-header" onClick={() => toggleExpand(a.id)}>
              <AlertBadge severita={a.severita} />
              <span className="alert-codice">{a.codice_alert}</span>
              <span className="alert-titolo">{a.titolo}</span>
              <span className="alert-chevron">{isExpanded ? '▲' : '▼'}</span>
            </header>

            {isExpanded && (
              <div className="alert-body">
                <p className="alert-descrizione">{a.descrizione}</p>

                {a.azione_suggerita && (
                  <div className="alert-azione">
                    <strong>Azione suggerita:</strong> {a.azione_suggerita}
                  </div>
                )}

                <div className="alert-actions">
                  <textarea
                    placeholder="Nota decisionale (opzionale)…"
                    value={nota}
                    onChange={e => setNota(e.target.value)}
                    disabled={busy}
                  />
                  <div className="alert-btn-row">
                    <button
                      className="alert-btn"
                      onClick={() => gestisci(a.id, 'in_gestione')}
                      disabled={busy}
                    >
                      Prendi in carico
                    </button>
                    <button
                      className="alert-btn alert-btn-primary"
                      onClick={() => gestisci(a.id, 'risolto')}
                      disabled={busy}
                    >
                      Risolvi
                    </button>
                    <button
                      className="alert-btn alert-btn-secondary"
                      onClick={() => gestisci(a.id, 'ignorato')}
                      disabled={busy}
                    >
                      Ignora
                    </button>
                  </div>
                </div>
              </div>
            )}

          </li>
        );
      })}
    </ul>
  );
}
