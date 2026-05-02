import React from 'react';

// Header della pagina SINOTTICO: ISCE grande, contatori alert,
// data corrente e pulsante di refresh. Componente puro, nessuno stato.
export default function SinotticoHeader({
  isce,
  statoISCE,
  nAlertCritici,
  nAlertAlti,
  onRefresh,
  loading,
}) {
  const dataOggi = new Date().toLocaleDateString('it-IT', {
    weekday: 'long',
    day:     'numeric',
    month:   'long',
    year:    'numeric',
  });

  return (
    <header className="sinottico-header">

      {/* Blocco titolo e data */}
      <div className="sinottico-header-title">
        <h1>SINOTTICO</h1>
        <p className="sottotitolo">La clinica vista dalla torre di controllo</p>
        <p className="data-oggi">{dataOggi}</p>
      </div>

      {/* Blocco ISCE — la classe variante determina il colore del numero */}
      <div
        className={`isce-block isce-${statoISCE.colore}`}
        aria-label={`ISCE: ${isce !== null ? isce : 'non disponibile'}. ${statoISCE.frase}`}
      >
        <div className="isce-label">ISCE</div>
        <div className="isce-value">{isce !== null ? isce : '—'}</div>
        <div className="isce-frase">{statoISCE.frase}</div>
      </div>

      {/* Contatori alert attivi */}
      <div className="alert-counters">
        {nAlertCritici > 0 && (
          <div className="alert-counter critica">
            <span className="alert-counter-num">{nAlertCritici}</span>
            <span className="alert-counter-label">critici</span>
          </div>
        )}
        {nAlertAlti > 0 && (
          <div className="alert-counter alta">
            <span className="alert-counter-num">{nAlertAlti}</span>
            <span className="alert-counter-label">alti</span>
          </div>
        )}
        {nAlertCritici === 0 && nAlertAlti === 0 && (
          <div className="alert-counter ok">
            <span className="alert-counter-num">✓</span>
            <span className="alert-counter-label">Nessun alert attivo</span>
          </div>
        )}
      </div>

      {/* Pulsante refresh */}
      <button
        className="sinottico-refresh-btn"
        onClick={onRefresh}
        disabled={loading}
        aria-label="Ricarica i dati del SINOTTICO"
      >
        {loading ? 'Aggiornamento…' : 'Aggiorna'}
      </button>

    </header>
  );
}
