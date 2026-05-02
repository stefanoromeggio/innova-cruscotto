// ================================================================
// src/sinottico/kpiConfig.js
// Contratto tra i dati del database e l'interfaccia SINOTTICO.
//
// Questo file è puramente statico: nessun import, nessuna dipendenza.
// Definisce i 7 KPI dell'Executive Overview e le funzioni di
// formattazione usate dai componenti KPITile e AlertList.
//
// I codici in KPI_CONFIG devono corrispondere ESATTAMENTE ai
// valori della colonna kpi_code in sinottico_kpi_snapshot.
// L'ordine dell'array è l'ordine di rendering in UI.
// ================================================================

// I 7 KPI chiave dell'Executive Overview, nell'ordine di visualizzazione.
export const KPI_CONFIG = [
  {
    code: 'EBITDA_MARGIN',
    label: 'EBITDA margin',
    formato: 'percentuale',
    descrizione: 'Margine operativo prima di ammortamenti, imposte, oneri finanziari.',
  },
  {
    code: 'IRA_MEDIO',
    label: 'Saturazione economica (IRA)',
    formato: 'percentuale',
    descrizione: 'Valore economico prodotto per unità di capacità disponibile.',
  },
  {
    code: 'CONVERSION_3K',
    label: 'Conversion piani > 3k€',
    formato: 'percentuale',
    descrizione: 'Preventivi alti accettati entro 60 giorni.',
  },
  {
    code: 'NPS',
    label: 'NPS',
    formato: 'numero',
    descrizione: 'Net Promoter Score — soddisfazione netta pazienti.',
  },
  {
    code: 'NO_SHOW_RATE',
    label: 'No-show rate',
    formato: 'percentuale',
    descrizione: 'Appuntamenti non onorati senza preavviso utile.',
  },
  {
    code: 'RICALL_ADHERENCE',
    label: 'Ricall adherence',
    formato: 'percentuale',
    descrizione: 'Richiami pianificati effettivamente onorati entro 45 gg.',
  },
  {
    code: 'CHURN_IMPLICITO',
    label: 'Churn implicito 24m',
    formato: 'percentuale',
    descrizione: 'Pazienti di lungo termine silenziosamente persi.',
  },
];

// Formatta il valore assoluto di un KPI per la visualizzazione nel tile.
// Ritorna sempre una stringa — mai un numero grezzo all'UI.
export function formatValore(valore, formato) {
  if (valore === null || valore === undefined) return '—';
  if (formato === 'percentuale') return `${Number(valore).toFixed(1)}%`;
  if (formato === 'numero') return `${Number(valore).toFixed(0)}`;
  return String(valore);
}

// Formatta la variazione mensile (delta_assoluto dalla vista DB).
// Ritorna stringa vuota se il delta non è disponibile (primo mese registrato).
// "p.p." = punti percentuali — unità corretta per delta tra percentuali.
export function formatDelta(delta, formato) {
  if (delta === null || delta === undefined) return '';
  const segno = delta >= 0 ? '+' : '';
  if (formato === 'percentuale') return `${segno}${Number(delta).toFixed(1)} p.p.`;
  if (formato === 'numero') return `${segno}${Number(delta).toFixed(0)}`;
  return '';
}
