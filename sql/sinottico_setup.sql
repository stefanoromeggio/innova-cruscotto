-- ================================================================
-- SINOTTICO Executive Overview — Setup Database
-- Progetto  : Innova Clinique · Cruscotto Paziente 360°
-- Supabase  : lbqqonocwaxpezhjuwe
-- Creato il : 2026-04-25
-- ----------------------------------------------------------------
-- ISTRUZIONI PER L'ESECUZIONE
-- 1. Aprire l'SQL Editor del progetto Supabase
-- 2. Eseguire le sezioni nell'ordine: A → B → C → D → E
-- 3. Verificare con le query della sezione F
-- 4. Lo script è idempotente per tabelle, indici, vista e KPI seed.
--    Il seed degli ALERT non è idempotente (nessuna unique constraint):
--    eseguirlo UNA SOLA VOLTA (vedi nota nella sezione E).
-- ================================================================


-- ================================================================
-- (A) TABELLA sinottico_kpi_snapshot
-- ================================================================
-- Memorizza uno snapshot mensile per ciascun KPI della clinica.
-- Ogni riga rappresenta il valore di UN KPI in UN mese specifico.
-- La colonna `stato` è calcolata automaticamente dal database
-- confrontando `valore` con le soglie: non va mai scritta a mano.
--
-- Chiave naturale: (kpi_code, periodo_riferimento)
-- Unicità garantita da constraint per prevenire duplicati di mese.
-- ================================================================

create table if not exists sinottico_kpi_snapshot (
  id                  uuid        primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),

  -- Codice univoco del KPI (es: 'EBITDA_MARGIN', 'NO_SHOW_RATE')
  kpi_code            text        not null,

  -- Primo giorno del mese di riferimento (es: 2026-04-01 = aprile 2026)
  periodo_riferimento date        not null,

  -- Valore misurato del KPI per quel mese
  valore              numeric(12,4) not null,

  -- Unità di misura: 'pct', 'euro', 'ratio', 'gg', 'numero'
  unita               text        not null,

  -- Soglie per la valutazione del semaforo
  soglia_ottimale     numeric(12,4),   -- valore target (verde pieno)
  soglia_warning      numeric(12,4),   -- soglia attenzione (giallo)
  soglia_critica      numeric(12,4),   -- soglia critica (rosso)

  -- Indica se un valore più alto è positivo ('alto') o negativo ('basso')
  -- Esempi: EBITDA_MARGIN = 'alto' (più è alto, meglio è)
  --         NO_SHOW_RATE  = 'basso' (meno no-show, meglio è)
  direzione_positiva  text        not null
                        check (direzione_positiva in ('alto', 'basso')),

  -- Stato semaforo calcolato automaticamente dal DB — NON scrivere direttamente
  -- Verde  : valore raggiunge o supera la soglia ottimale
  -- Giallo : valore tra warning e ottimale
  -- Rosso  : valore peggiore della soglia warning
  stato               text generated always as (
    case
      when direzione_positiva = 'alto'  and valore >= soglia_ottimale then 'verde'
      when direzione_positiva = 'alto'  and valore >= soglia_warning  then 'giallo'
      when direzione_positiva = 'alto'                                 then 'rosso'
      when direzione_positiva = 'basso' and valore <= soglia_ottimale then 'verde'
      when direzione_positiva = 'basso' and valore <= soglia_warning  then 'giallo'
      else 'rosso'
    end
  ) stored,

  note                text,

  -- Impedisce di inserire due snapshot per lo stesso KPI nello stesso mese
  unique (kpi_code, periodo_riferimento)
);

-- Indice per query di overview (tutti i KPI più recenti)
create index if not exists idx_kpi_snapshot_periodo
  on sinottico_kpi_snapshot (periodo_riferimento desc);

-- Indice per query di trend su singolo KPI
create index if not exists idx_kpi_snapshot_code_periodo
  on sinottico_kpi_snapshot (kpi_code, periodo_riferimento desc);


-- ================================================================
-- (B) TABELLA sinottico_alert
-- ================================================================
-- Alert attivi generati dal Direttore Sanitario (manualmente in Fase 1)
-- o dal motore di regole automatico (Fase 2, ~60 giorni).
--
-- Ciclo di vita di un alert:
--   aperto → in_gestione → risolto
--         ↘ ignorato
--
-- Gli alert risolti o ignorati NON vanno cancellati: servono per
-- lo storico decisionale e la futura reportistica direzionale.
-- Per questo il DELETE è bloccato dalla RLS (sezione D).
-- ================================================================

create table if not exists sinottico_alert (
  id                  uuid        primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),

  -- Codice breve per riferimento interno (es: 'A01', 'A05')
  codice_alert        text        not null,

  -- Titolo breve (max ~60 caratteri per compatibilità con l'UI)
  titolo              text        not null,

  -- Descrizione estesa del problema rilevato
  descrizione         text        not null,

  -- Livello di urgenza
  severita            text        not null
                        check (severita in ('CRITICA', 'ALTA', 'MEDIA')),

  -- Stato corrente dell'alert nel suo ciclo di vita
  stato               text        not null default 'aperto'
                        check (stato in ('aperto', 'in_gestione', 'risolto', 'ignorato')),

  -- KPI che ha originato l'alert (può essere null per alert manuali)
  kpi_code_trigger    text,
  valore_kpi          numeric(12,4),

  -- Azione suggerita al Direttore per risolvere l'alert
  azione_suggerita    text,

  data_attivazione    timestamptz not null default now(),
  data_risoluzione    timestamptz,    -- valorizzato quando stato = 'risolto' o 'ignorato'

  -- Nota lasciata dal Direttore al momento della gestione/risoluzione
  nota_decisionale    text,

  -- Persona a cui l'alert è stato assegnato (libero, non FK)
  assegnato_a         text
);

-- Indice per la query principale della dashboard (alert aperti per severità)
create index if not exists idx_alert_stato_severita
  on sinottico_alert (stato, severita);

-- Indice per ordinamento cronologico degli alert
create index if not exists idx_alert_data
  on sinottico_alert (data_attivazione desc);


-- ================================================================
-- (C) VISTA vw_sinottico_overview
-- ================================================================
-- Vista di sola lettura usata dal modulo SINOTTICO per popolare
-- i 7 tile KPI e calcolare l'ISCE (Indice di Salute Clinica Economica).
--
-- Restituisce UNA riga per KPI con:
--   - valore e stato del mese più recente disponibile
--   - valore_prec: valore del mese precedente (null se non disponibile)
--   - delta_assoluto: differenza assoluta tra mese corrente e precedente
--   - delta_pct: variazione percentuale (null se precedente = 0 o assente)
--
-- Nota: la CTE "ultimo" usa DISTINCT ON (PostgreSQL-specific) per
-- ottenere in modo efficiente l'ultimo snapshot per ciascun KPI.
-- ================================================================

create or replace view vw_sinottico_overview as
with ultimo as (
  -- Snapshot più recente per ciascun KPI
  -- ORDER BY obbligatorio per DISTINCT ON
  select distinct on (kpi_code)
    kpi_code,
    periodo_riferimento,
    valore,
    unita,
    soglia_ottimale,
    soglia_warning,
    soglia_critica,
    direzione_positiva,
    stato
  from sinottico_kpi_snapshot
  order by kpi_code, periodo_riferimento desc
),
precedente as (
  -- Valore del mese immediatamente precedente all'ultimo rilevato
  select s.kpi_code, s.valore as valore_prec
  from sinottico_kpi_snapshot s
  join ultimo u on u.kpi_code = s.kpi_code
  where s.periodo_riferimento = u.periodo_riferimento - interval '1 month'
)
select
  u.*,
  p.valore_prec,

  -- Delta assoluto: 0 se il mese precedente non è disponibile
  -- (COALESCE evita NULL nel calcolo dell'ISCE lato frontend)
  (u.valore - coalesce(p.valore_prec, u.valore)) as delta_assoluto,

  -- Delta percentuale: NULL se mese precedente assente o uguale a zero
  case
    when p.valore_prec is null or p.valore_prec = 0 then null
    else round(
      ((u.valore - p.valore_prec) / p.valore_prec * 100)::numeric,
      2
    )
  end as delta_pct

from ultimo u
left join precedente p on p.kpi_code = u.kpi_code;


-- ================================================================
-- (D) ROW LEVEL SECURITY
-- ================================================================
-- Il Cruscotto usa la anon key di Supabase (chiave pubblica).
-- Senza Auth attiva, tutti gli accessi arrivano con ruolo "anon".
--
-- Filosofia di questa fase:
--   - Lettura aperta: i dati del SINOTTICO non contengono dati
--     personali dei pazienti; il gate è gestito lato React.
--   - Scrittura bloccata per kpi_snapshot (dati storici immutabili).
--   - UPDATE aperto su sinottico_alert per permettere la gestione
--     del ciclo di vita degli alert dall'interfaccia.
--   - DELETE sempre bloccato: si usa lo stato 'ignorato' al posto
--     della cancellazione fisica.
-- ================================================================

alter table sinottico_kpi_snapshot enable row level security;
alter table sinottico_alert         enable row level security;


-- -------- Policy su sinottico_kpi_snapshot --------

-- SELECT aperto a tutti
-- Razionale: gli snapshot KPI sono indicatori aggregati, non dati
-- personali. Il gate di accesso alla pagina SINOTTICO è già
-- gestito nel componente React (controllo su session.email).
create policy "kpi_snapshot_select_anon"
  on sinottico_kpi_snapshot for select
  using (true);

-- INSERT bloccato dalla anon key
-- Razionale: gli snapshot vengono inseriti manualmente via SQL Editor
-- o (Fase 2) da un ETL che userà la service role, non la anon key.
-- Impedisce scritture accidentali o malevole dal frontend.
create policy "kpi_snapshot_insert_blocked"
  on sinottico_kpi_snapshot for insert
  with check (false);

-- UPDATE bloccato
-- Razionale: gli snapshot sono record storici immutabili.
-- Una volta registrato il valore di un KPI per un mese, non deve
-- cambiare (eventuale correzione = nuovo snapshot con nota).
create policy "kpi_snapshot_update_blocked"
  on sinottico_kpi_snapshot for update
  using (false);

-- DELETE bloccato
-- Razionale: i dati storici dei KPI non vanno mai cancellati.
-- Sono la base per trend, benchmark e confronti futuri.
create policy "kpi_snapshot_delete_blocked"
  on sinottico_kpi_snapshot for delete
  using (false);


-- -------- Policy su sinottico_alert --------

-- SELECT aperto a tutti
-- Razionale: stesso ragionamento dei KPI snapshot. Gli alert non
-- contengono dati sanitari individuali, solo indicatori clinici aggregati.
create policy "alert_select_anon"
  on sinottico_alert for select
  using (true);

-- INSERT bloccato dalla anon key
-- Razionale: gli alert vengono creati manualmente in questa fase.
-- Bloccare INSERT dalla anon key impedisce che un bug del frontend
-- o un attacco XSS possa iniettare alert falsi nella dashboard.
create policy "alert_insert_blocked"
  on sinottico_alert for insert
  with check (false);

-- UPDATE aperto (con limitazioni documentate)
-- Razionale: il Direttore Sanitario deve poter cambiare lo stato di
-- un alert (aperto → in_gestione → risolto/ignorato) e aggiungere
-- una nota decisionale, direttamente dall'interfaccia SINOTTICO.
-- Supabase RLS non supporta restrizioni per colonna: la policy è
-- necessariamente permissiva. Il rischio è mitigato da:
--   1. Il modulo SINOTTICO è visibile solo a session.email del Direttore
--   2. Il proxy api/sinottico.js valida il payload prima di fare PATCH
--
-- TODO (Fase 2): quando si introduce autenticazione server-side,
-- sostituire questa policy con un check sul JWT o migrare l'UPDATE
-- a una serverless function con service role che validi i campi.
create policy "alert_update_anon"
  on sinottico_alert for update
  using (true)
  with check (true);

-- DELETE bloccato
-- Razionale: gli alert risolti o ignorati vanno conservati per l'audit
-- trail e la futura reportistica. La cancellazione fisica è sempre
-- sostituita dal cambio di stato ('risolto' o 'ignorato').
create policy "alert_delete_blocked"
  on sinottico_alert for delete
  using (false);


-- ================================================================
-- (E) SEED DATI DEMO
-- ================================================================
-- Dati di esempio per il test immediato del modulo SINOTTICO.
-- Coprono 3 mesi (feb-mar-apr 2026) per i 7 KPI chiave.
--
-- IDEMPOTENZA:
--   - INSERT KPI: ON CONFLICT DO NOTHING (safe da rieseguire)
--   - INSERT ALERT: NON idempotente (sinottico_alert non ha unique
--     constraint). Verificare con SELECT count(*) FROM sinottico_alert
--     PRIMA di rieseguire per evitare duplicati.
-- ================================================================

-- KPI snapshot — 7 KPI × 3 mesi = 21 righe
insert into sinottico_kpi_snapshot
  (kpi_code, periodo_riferimento, valore, unita,
   soglia_ottimale, soglia_warning, soglia_critica, direzione_positiva)
values

  -- EBITDA_MARGIN: margine operativo. Più alto = meglio.
  -- Trend: lento deterioramento (22.8% → 21.3%). Stato atteso: giallo.
  ('EBITDA_MARGIN', '2026-02-01', 22.8, 'pct', 25, 20, 15, 'alto'),
  ('EBITDA_MARGIN', '2026-03-01', 22.1, 'pct', 25, 20, 15, 'alto'),
  ('EBITDA_MARGIN', '2026-04-01', 21.3, 'pct', 25, 20, 15, 'alto'),

  -- IRA_MEDIO: saturazione economica (valore prodotto / capacità).
  -- Trend: oscillante in zona gialla. Stato atteso apr: giallo.
  ('IRA_MEDIO', '2026-02-01', 78, 'pct', 80, 65, 50, 'alto'),
  ('IRA_MEDIO', '2026-03-01', 75, 'pct', 80, 65, 50, 'alto'),
  ('IRA_MEDIO', '2026-04-01', 77, 'pct', 80, 65, 50, 'alto'),

  -- CONVERSION_3K: preventivi > 3.000€ accettati entro 60 gg.
  -- Trend: discendente preoccupante (54% → 46%). Stato atteso apr: giallo.
  ('CONVERSION_3K', '2026-02-01', 54, 'pct', 55, 40, 25, 'alto'),
  ('CONVERSION_3K', '2026-03-01', 49, 'pct', 55, 40, 25, 'alto'),
  ('CONVERSION_3K', '2026-04-01', 46, 'pct', 55, 40, 25, 'alto'),

  -- NPS: Net Promoter Score. Più alto = meglio.
  -- Trend: lieve calo, appena sotto il target ottimale. Stato atteso apr: giallo.
  ('NPS', '2026-02-01', 62, 'numero', 60, 40, 20, 'alto'),
  ('NPS', '2026-03-01', 59, 'numero', 60, 40, 20, 'alto'),
  ('NPS', '2026-04-01', 58, 'numero', 60, 40, 20, 'alto'),

  -- NO_SHOW_RATE: appuntamenti non onorati. Meno = meglio (direzione 'basso').
  -- Trend: peggioramento (6.2% → 8.4%). Stato atteso apr: giallo (tra warning 8 e critica 12).
  ('NO_SHOW_RATE', '2026-02-01',  6.2, 'pct', 5, 8, 12, 'basso'),
  ('NO_SHOW_RATE', '2026-03-01',  7.1, 'pct', 5, 8, 12, 'basso'),
  ('NO_SHOW_RATE', '2026-04-01',  8.4, 'pct', 5, 8, 12, 'basso'),

  -- RICALL_ADHERENCE: richiami pianificati onorati entro 45 gg.
  -- Trend: lieve calo in zona gialla. Stato atteso apr: giallo.
  ('RICALL_ADHERENCE', '2026-02-01', 71, 'pct', 75, 60, 45, 'alto'),
  ('RICALL_ADHERENCE', '2026-03-01', 69, 'pct', 75, 60, 45, 'alto'),
  ('RICALL_ADHERENCE', '2026-04-01', 68, 'pct', 75, 60, 45, 'alto'),

  -- CHURN_IMPLICITO: pazienti di lungo termine silenziosamente persi.
  -- Meno = meglio (direzione 'basso'). Trend: peggioramento (18% → 21%).
  -- Stato atteso apr: giallo (tra ottimale 15 e warning 25).
  ('CHURN_IMPLICITO', '2026-02-01', 18, 'pct', 15, 25, 35, 'basso'),
  ('CHURN_IMPLICITO', '2026-03-01', 19, 'pct', 15, 25, 35, 'basso'),
  ('CHURN_IMPLICITO', '2026-04-01', 21, 'pct', 15, 25, 35, 'basso')

on conflict (kpi_code, periodo_riferimento) do nothing;


-- Alert demo — 3 alert attivi, tutti severità ALTA
-- ATTENZIONE: eseguire UNA SOLA VOLTA. Non c'è ON CONFLICT perché
-- sinottico_alert non ha una unique constraint (due alert con lo stesso
-- codice in momenti diversi sono scenari legittimi in produzione).
insert into sinottico_alert
  (codice_alert, titolo, descrizione, severita,
   kpi_code_trigger, valore_kpi, azione_suggerita)
values
  (
    'A05',
    'No-show rate in zona warning',
    'Il no-show rate di aprile (8,4%) ha superato la soglia warning di 8%. '
    'Analisi per fascia oraria indica concentrazione sul venerdì pomeriggio.',
    'ALTA',
    'NO_SHOW_RATE',
    8.4,
    'Attivare reminder automatici H-48 e H-24 su tutte le fasce. '
    'Valutare caparra simbolica sulle prime visite dei nuovi pazienti.'
  ),
  (
    'A01',
    'EBITDA in erosione lenta',
    'EBITDA margin in calo da 22,8% a 21,3% in due mesi con fatturato stabile. '
    'Probabile erosione di mix di branca o politica di pricing non ottimale.',
    'ALTA',
    'EBITDA_MARGIN',
    21.3,
    'Aprire audit PDR e margine orario per branca clinica. '
    'Confronto con CFO entro 7 giorni per identificare le leve di intervento.'
  ),
  (
    'A04',
    'Conversion piani > 3k€ in calo',
    'La conversione preventivi sopra 3.000€ è scesa dal 54% al 46% in due mesi. '
    'Il fenomeno interessa prevalentemente implantologia e protesi complessa.',
    'ALTA',
    'CONVERSION_3K',
    46,
    'Training sulla presentazione dei piani di cura. '
    'Revisione del formato preventivo scritto. '
    'Introduzione di un secondo appuntamento dedicato alla decisione del paziente.'
  );


-- ================================================================
-- (F) QUERY DI VERIFICA
-- ================================================================
-- Eseguire queste query DOPO aver completato le sezioni A-E.
-- Copiare e incollare direttamente nell'SQL Editor di Supabase.
-- ================================================================

/*

-- F1. Conteggio snapshot KPI: deve essere 21
SELECT count(*) AS totale_snapshot
FROM sinottico_kpi_snapshot;

-- F2. Conteggio alert aperti: deve essere 3
SELECT count(*) AS alert_aperti
FROM sinottico_alert
WHERE stato = 'aperto';

-- F3. Vista overview completa: deve restituire 7 righe.
--     Verificare: valore, stato (calcolato), delta_assoluto, delta_pct tutti non-null.
SELECT
  kpi_code,
  periodo_riferimento,
  valore,
  unita,
  stato,
  valore_prec,
  delta_assoluto,
  delta_pct
FROM vw_sinottico_overview
ORDER BY kpi_code;

-- F4. Controllo stati attesi per aprile 2026 — tutti devono essere 'giallo'
--     EBITDA_MARGIN    21.3  giallo  (20 ≤ 21.3 < 25)
--     IRA_MEDIO        77    giallo  (65 ≤ 77 < 80)
--     CONVERSION_3K    46    giallo  (40 ≤ 46 < 55)
--     NPS              58    giallo  (40 ≤ 58 < 60)
--     NO_SHOW_RATE     8.4   giallo  (8 < 8.4 ≤ 12, direzione basso)
--     RICALL_ADHERENCE 68    giallo  (60 ≤ 68 < 75)
--     CHURN_IMPLICITO  21    giallo  (15 < 21 ≤ 25, direzione basso)
SELECT kpi_code, valore, stato
FROM vw_sinottico_overview
ORDER BY kpi_code;

-- F5. Controllo alert con dettaglio completo
SELECT codice_alert, titolo, severita, stato, kpi_code_trigger, valore_kpi
FROM sinottico_alert
ORDER BY codice_alert;

-- F6. Verifica che RLS non blocchi la lettura (se questo funziona, SELECT è aperto)
--     Questa query è identica a F1, ma utile da rieseguire dopo aver abilitato RLS
--     per confermare che la policy "select anon" è attiva e corretta.
SELECT count(*) AS snapshot_visibili_con_anon
FROM sinottico_kpi_snapshot;

*/
