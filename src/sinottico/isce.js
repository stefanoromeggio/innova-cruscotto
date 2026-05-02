// ================================================================
// src/sinottico/isce.js
// Calcolo dell'ISCE — Indice di Salute Clinica Economica
//
// L'ISCE è un numero intero su scala 0-100 che sintetizza lo stato
// di salute della clinica. È il numero grande che il Direttore
// Sanitario vede in cima alla pagina SINOTTICO.
//
// Metodologia di calcolo:
// 1. Ogni KPI viene normalizzato su scala 0-100 tramite
//    interpolazione lineare tra le tre soglie (critica, warning,
//    ottimale). Le soglie vengono da Supabase — non sono hardcoded.
// 2. I valori normalizzati vengono moltiplicati per un peso fisso
//    e sommati, poi divisi per la somma dei pesi effettivi usati
//    (non per 1.00 fisso, così l'ISCE rimane significativo anche
//    se mancano dati per uno o più KPI).
// 3. Il risultato viene arrotondato a intero.
//
// Perché EBITDA_MARGIN pesa il 25%:
// È l'unico KPI che misura la sostenibilità economica della clinica
// nel complesso. Se crolla, tutti gli altri indicatori diventano
// secondari perché la clinica non è più in grado di operare.
// ================================================================

// Pesi per la media pesata. Somma = 1.00 (verificata nel commento).
// Modificare questi valori cambia la sensibilità dell'ISCE verso
// l'uno o l'altro aspetto della gestione clinica.
const PESI = {
  EBITDA_MARGIN:    0.25,  // Sostenibilità economica — indicatore primario
  IRA_MEDIO:        0.15,  // Efficienza produttiva per unità di capacità
  CONVERSION_3K:    0.15,  // Capacità di chiusura sui piani complessi
  NPS:              0.10,  // Soddisfazione e fidelizzazione pazienti
  NO_SHOW_RATE:     0.10,  // Affidabilità degli appuntamenti
  RICALL_ADHERENCE: 0.10,  // Continuità delle cure preventive
  CHURN_IMPLICITO:  0.15,  // Ritenzione del parco pazienti attivo
  // Somma: 0.25 + 0.15 + 0.15 + 0.10 + 0.10 + 0.10 + 0.15 = 1.00
};

// Normalizza il valore di un singolo KPI su scala 0-100.
// Esportata per permettere test unitari indipendenti.
//
// Per direzione 'alto' (più alto = meglio):
//   valore >= ottimale → 100  (obiettivo raggiunto o superato)
//   warning ≤ valore < ottimale → interpolazione lineare 50..100
//   critica ≤ valore < warning → interpolazione lineare 0..50
//   valore < critica → 0  (oltre la soglia critica)
//
// Per direzione 'basso' (più basso = meglio): logica speculare.
//
// Ritorna null se valore o soglie sono null/undefined/NaN —
// il chiamante deve gestire il null escludendo il KPI dalla media.
export function normalizzaKPI(valore, ottimale, warning, critica, direzionePositiva) {
  const v    = Number(valore);
  const ott  = Number(ottimale);
  const war  = Number(warning);
  const crit = Number(critica);

  // Supabase può restituire i numeric come stringhe: Number() converte.
  // Se una delle conversioni fallisce (NaN) o i valori originali mancano,
  // non è possibile normalizzare — ritorna null.
  if (
    valore  === null || valore  === undefined ||
    ottimale === null || ottimale === undefined ||
    warning  === null || warning  === undefined ||
    critica  === null || critica  === undefined ||
    isNaN(v) || isNaN(ott) || isNaN(war) || isNaN(crit)
  ) return null;

  if (direzionePositiva === 'alto') {
    if (v >= ott) return 100;
    if (v >= war) return 50 + ((v - war) / (ott - war)) * 50;
    if (v >= crit) return ((v - crit) / (war - crit)) * 50;
    return 0;
  }

  // direzione 'basso': logica speculare — più basso è meglio
  if (v <= ott) return 100;
  if (v <= war) return 50 + ((war - v) / (war - ott)) * 50;
  if (v <= crit) return ((crit - v) / (crit - war)) * 50;
  return 0;
}

// Calcola l'ISCE come media pesata dei KPI normalizzati.
//
// kpiRows: array di oggetti dalla vista vw_sinottico_overview.
//   Campi usati per ogni oggetto: kpi_code, valore, soglia_ottimale,
//   soglia_warning, soglia_critica, direzione_positiva.
//
// KPI non presenti in PESI vengono ignorati silenziosamente.
// KPI con dati mancanti vengono esclusi dalla media e il loro peso
// non entra nel divisore — così l'ISCE rimane calibrato anche
// con dati parziali (es. KPI non ancora inseriti per il mese).
//
// Ritorna null (non 0) se non ci sono KPI con dati validi.
export function calcolaISCE(kpiRows) {
  if (!kpiRows || kpiRows.length === 0) return null;

  let sommaPesata = 0;
  let pesoTotale  = 0;

  for (const row of kpiRows) {
    const peso = PESI[row.kpi_code];
    if (!peso) continue;  // KPI non previsto in questo indice — ignora

    const normalizzato = normalizzaKPI(
      row.valore,
      row.soglia_ottimale,
      row.soglia_warning,
      row.soglia_critica,
      row.direzione_positiva,
    );

    if (normalizzato === null) continue;  // Dati insufficienti — escludi dalla media

    sommaPesata += normalizzato * peso;
    pesoTotale  += peso;
  }

  if (pesoTotale === 0) return null;  // Nessun KPI con dati validi

  // Divisore = pesi effettivamente usati, non 1.00 fisso.
  // Esempio: se manca CHURN_IMPLICITO (peso 0.15), il divisore è 0.85
  // e l'ISCE viene ricalibrato sui 6 KPI disponibili.
  return Math.round(sommaPesata / pesoTotale);
}

// Traduce il valore numerico dell'ISCE in valutazione testuale e colore.
// Il colore è usato dal componente SinotticoHeader per applicare
// la classe CSS corretta sul blocco ISCE (es. "isce-verde", "isce-rosso").
export function interpretaISCE(isce) {
  if (isce === null) return { frase: 'Dati insufficienti',             colore: 'grigio'    };
  if (isce >= 80)    return { frase: 'Clinica in salute',              colore: 'verde'     };
  if (isce >= 60)    return { frase: 'Attenzione su aree specifiche',  colore: 'giallo'    };
  if (isce >= 40)    return { frase: 'Segnali strutturali da gestire', colore: 'arancione' };
  return                    { frase: 'Situazione critica',             colore: 'rosso'     };
}
