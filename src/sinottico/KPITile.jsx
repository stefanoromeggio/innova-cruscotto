import React from 'react';
import { formatValore, formatDelta } from './kpiConfig';

// Tile di presentazione per un singolo KPI.
// Componente puro: nessuno stato locale, nessun side effect.
export default function KPITile({ config, data }) {

  // Dati assenti: placeholder minimale senza errori.
  if (!data) {
    return (
      <article className="kpi-tile">
        <header className="kpi-tile-header">
          <h3 className="kpi-label">{config.label}</h3>
        </header>
        <div className="kpi-valore">—</div>
        <p className="kpi-descrizione">{config.descrizione}</p>
      </article>
    );
  }

  const stato = data.stato || 'grigio';
  const delta = data.delta_assoluto;

  // Mostra il delta solo se è disponibile e non è zero.
  // delta === 0 significa "mese precedente assente" (vedi vista SQL).
  const hasDelta = delta !== null && delta !== undefined && delta !== 0;

  // Logica colorimetrica del delta: per KPI a direzione 'basso'
  // (es. NO_SHOW_RATE, CHURN_IMPLICITO) un delta negativo è un miglioramento
  // e va colorato di verde, non di rosso.
  const deltaEPositivo = data.direzione_positiva === 'basso'
    ? delta < 0
    : delta > 0;

  return (
    <article className={`kpi-tile kpi-${stato}`}>

      <header className="kpi-tile-header">
        <h3 className="kpi-label">{config.label}</h3>
        <span className={`kpi-semaforo ${stato}`} aria-hidden="true" />
      </header>

      <div className="kpi-valore">
        {formatValore(data.valore, config.formato)}
      </div>

      {hasDelta && (
        <div className={`kpi-delta ${deltaEPositivo ? 'positivo' : 'negativo'}`}>
          {delta > 0 ? '▲' : '▼'}{' '}
          {formatDelta(delta, config.formato)} vs mese prec.
        </div>
      )}

      <p className="kpi-descrizione">{config.descrizione}</p>

      <footer className="kpi-soglie">
        Ottimale: {formatValore(data.soglia_ottimale, config.formato)}
        {' · '}
        Warning: {formatValore(data.soglia_warning, config.formato)}
      </footer>

    </article>
  );
}
