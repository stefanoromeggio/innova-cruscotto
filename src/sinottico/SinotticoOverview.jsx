import React, { useState, useEffect, useCallback } from 'react';
import SinotticoHeader from './SinotticoHeader';
import KPITile         from './KPITile';
import AlertList       from './AlertList';
import { KPI_CONFIG }  from './kpiConfig';
import { calcolaISCE, interpretaISCE } from './isce';
import { fetchOverviewKPI, fetchAlertAttivi } from './sinotticoApi';
import './SinotticoOverview.css';

// Orchestratore del modulo SINOTTICO Executive Overview.
// Gestisce il ciclo di vita dei dati (fetch, error, refresh) e
// distribuisce il risultato ai componenti figli già approvati.
//
// Filosofia "degradazione con grazia": non esiste un messaggio
// "Caricamento…" esplicito. Prima del fetch completato i componenti
// figli ricevono array vuoti e data=undefined e gestiscono
// autonomamente il caso (ISCE="—", tile vuoti, lista vuota).
// Questo evita layout shift e rende la pagina immediatamente
// utilizzabile visivamente anche durante il caricamento.
export default function SinotticoOverview({ session }) {

  // Gate di accesso — controllo immediato prima di qualunque hook.
  // Il modulo SINOTTICO è riservato esclusivamente alla Direzione Sanitaria.
  // Gli altri utenti (CEO, Segreteria) vedono un messaggio neutro senza
  // dettagli su cosa contiene la pagina.
  if (!session || session.email !== 'stefanoromeggio@innovaclinique.it') {
    return (
      <div className="sinottico-no-access">
        <h2>Area riservata</h2>
        <p>Il SINOTTICO è riservato alla Direzione Sanitaria.</p>
      </div>
    );
  }

  return <SinotticoInner />;
}

// Componente interno separato per evitare che il gate sopra
// violi la regola "hooks non possono essere chiamati condizionatamente".
function SinotticoInner() {
  const [kpiData, setKpiData] = useState([]);
  const [alerts,  setAlerts]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // useCallback perché carica è usata sia in useEffect (dependency)
  // sia come onUpdate di AlertList — stessa istanza, nessun loop.
  const carica = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [kpi, al] = await Promise.all([fetchOverviewKPI(), fetchAlertAttivi()]);
      setKpiData(kpi);
      setAlerts(al);
    } catch (e) {
      console.error('[SINOTTICO] Errore nel caricamento dati:', e);
      setError('Impossibile caricare i dati. Verificare la connessione e riprovare.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carica(); }, [carica]);

  // Calcoli derivati — ricalcolati ad ogni render dai dati correnti.
  // Con kpiData=[] calcolaISCE ritorna null → interpretaISCE restituisce
  // "Dati insufficienti" che è il placeholder visivo durante il caricamento.
  const isceValue    = calcolaISCE(kpiData);
  const statoISCEObj = interpretaISCE(isceValue);
  const nAlertCritici = alerts.filter(a => a.severita === 'CRITICA').length;
  const nAlertAlti    = alerts.filter(a => a.severita === 'ALTA').length;

  return (
    <div className="sinottico-page">

      <SinotticoHeader
        isce={isceValue}
        statoISCE={statoISCEObj}
        nAlertCritici={nAlertCritici}
        nAlertAlti={nAlertAlti}
        onRefresh={carica}
        loading={loading}
      />

      {error && <div className="sinottico-error">{error}</div>}

      <section className="kpi-grid" aria-label="KPI chiave">
        {KPI_CONFIG.map(cfg => {
          const data = kpiData.find(k => k.kpi_code === cfg.code);
          return <KPITile key={cfg.code} config={cfg} data={data} />;
        })}
      </section>

      <section className="alert-section" aria-label="Alert attivi">
        <h2 className="alert-section-title">Alert attivi</h2>
        <AlertList alerts={alerts} onUpdate={carica} />
      </section>

    </div>
  );
}
