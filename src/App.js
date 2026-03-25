import React, { useState, useEffect, useCallback, useRef } from "react";
import { dbGet, dbUpsert } from './supabase';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const STORAGE_KEY = "innova_v4";
const BANNER_KEY  = "innova_gdpr_v1";

const IT_MONTHS = {
  gen:0, feb:1, mar:2, apr:3, mag:4, giu:5,
  lug:6, ago:7, set:8, ott:9, nov:10, dic:11
};

const DISC_STATUS = {
  completata:     { dot:"#10b981", bg:"#ecfdf5", text:"#065f46", label:"Completata" },
  "in-corso":     { dot:"#3b82f6", bg:"#eff6ff", text:"#1e40af", label:"In corso" },
  "non-iniziata": { dot:"#94a3b8", bg:"#f8fafc", text:"#475569", label:"Non iniziata" },
  sospesa:        { dot:"#f59e0b", bg:"#fffbeb", text:"#92400e", label:"Sospesa" },
  "in-ritardo":   { dot:"#ef4444", bg:"#fef2f2", text:"#991b1b", label:"In ritardo" },
};

const SEM = {
  verde:   { color:"#10b981", bg:"#d1fae5", label:"On track" },
  arancio: { color:"#f59e0b", bg:"#fef3c7", label:"Attenzione" },
  rosso:   { color:"#ef4444", bg:"#fee2e2", label:"Critico" },
};

const AL = {
  rosso:   { color:"#ef4444", bg:"#fef2f2", border:"#fca5a5" },
  arancio: { color:"#f59e0b", bg:"#fffbeb", border:"#fcd34d" },
  giallo:  { color:"#d97706", bg:"#fefce8", border:"#fde68a" },
};

const CLINICIANS = ["Dr. Rossi","Dott.ssa Bianchi","Dr. Ferrari","Dott.ssa Martini"];

const DISC_OPTIONS = [
  "Diagnostica","Igiene","Parodontologia","Conservativa","Endodonzia",
  "Implantologia","Osseointegrazione","Chirurgia","Protesi provvisoria",
  "Protesi definitiva","Ortodonzia","Gnatologia","Mantenimento SPT"
];

const CONSENTS = [
  { key:"consensoSanitario", label:"Trattamento dati sanitari", required:true,  legal:"Art. 9 GDPR" },
  { key:"consensoWhatsApp",  label:"Comunicazioni WhatsApp",   required:false, legal:"Art. 6 GDPR lett. a" },
  { key:"consensoMarketing", label:"Marketing e promozioni",   required:false, legal:"Art. 6 GDPR lett. a" },
  { key:"consensoTerzi",     label:"Trasmissione a terzi",     required:false, legal:"Art. 6 GDPR lett. a" },
];

const SUGGESTED = [
  "Come apro un percorso paziente?",
  "Cosa significa il semaforo rosso?",
  "Come funziona la timeline?",
  "Come gestisco il consenso GDPR?",
  "Quando scatta un alert arancio?",
  "Cosa fare se il paziente è fermo?",
];

const SYSTEM_PROMPT = `Sei l'assistente del Cruscotto Paziente 360° di Innova Clinique, studio odontoiatrico a Domodossola (VCO).
Rispondi SOLO su: utilizzo del sistema, gestione flusso paziente, protocolli clinico-organizzativi, GDPR odontoiatrico.
Italiano, diretto, max 180 parole.

SEMAFORI TIMELINE: Verde=completata/nei tempi | Blu=in corso ok | Arancio=ritardo 15-30% | Rosso=ritardo>30%/scaduta | Grigio=non iniziata.
PROTOCOLLI: Igiene ogni 3 mesi durante implantologia | Osseointegrazione 3-6 mesi | Paro rivalutazione 8-12 settimane | Post-chirurgia entro 10 giorni.
GDPR: Art.9 consenso scritto obbligatorio | Conservazione 10 anni D.Lgs.229/1999 | WhatsApp solo con consenso.
ALERT: Rosso=24h | Arancio=3gg | Giallo=7gg.`;

// ─── STORAGE (localStorage) ───────────────────────────────────────────────────
const storage = {
  get: (key) => {
    try { const v = localStorage.getItem(key); return v ? { value: v } : null; } catch { return null; }
  },
  set: (key, value) => {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  },
  delete: (key) => {
    try { localStorage.removeItem(key); return true; } catch { return false; }
  },
};

// ─── UTILS ────────────────────────────────────────────────────────────────────
function getToday() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}
function getTodayFull() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function parseMonthYear(str) {
  if (!str || str === "—" || str.toLowerCase() === "ongoing") return null;
  const parts = str.trim().toLowerCase().split(/\s+/);
  if (parts.length < 2) return null;
  const m = IT_MONTHS[parts[0]]; const y = parseInt(parts[1]);
  if (m === undefined || isNaN(y)) return null;
  return new Date(y, m, 1);
}
function fmtMonthYear(d) {
  const ms = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];
  return `${ms[d.getMonth()]} ${d.getFullYear()}`;
}
function addMonths(d, n) { const r = new Date(d); r.setMonth(r.getMonth() + n); return r; }
function monthDiff(a, b) { return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()); }
function retentionDate(s) {
  try { const [d, m, y] = s.split('/'); return `${d}/${m}/${parseInt(y) + 10}`; } catch { return "—"; }
}
function makeAuditEntry(azione, dettaglio, operatore) {
  return { id: Date.now() + Math.random(), ts: getTodayFull(), azione, dettaglio, operatore: operatore || "Operatore" };
}
function defaultGdpr(d) {
  return {
    consensoSanitario: { granted:false, date:null, method:"firma_modulo" },
    consensoWhatsApp:  { granted:false, date:null, method:"firma_modulo" },
    consensoMarketing: { granted:false, date:null, method:"firma_modulo" },
    consensoTerzi:     { granted:false, date:null, method:"firma_modulo" },
    dataCreazione: d, scadenzaRetenzione: retentionDate(d), note: "",
  };
}
function sessionProgress(sess) {
  if (!sess || sess === "—" || sess.includes("∞")) return null;
  const p = sess.split('/'); if (p.length < 2) return null;
  const done = parseInt(p[0]), tot = parseInt(p[1]);
  if (isNaN(done) || isNaN(tot) || tot === 0) return null;
  return Math.min(done / tot, 1);
}
function timelineColor(disc, today) {
  const start = parseMonthYear(disc.start), end = parseMonthYear(disc.end);
  const ongoing = disc.end && disc.end.toLowerCase() === "ongoing";
  const prog = sessionProgress(disc.sessions);
  if (disc.status === "completata")  return { bar:"#10b981", label:"Completata" };
  if (disc.status === "sospesa")     return { bar:"#94a3b8", label:"Sospesa" };
  if (disc.status === "in-ritardo")  return { bar:"#ef4444", label:"In ritardo" };
  if (disc.status === "non-iniziata") {
    if (!start) return { bar:"#94a3b8", label:"Non pianif." };
    if (today > start) { const o = monthDiff(start, today); if (o > 2) return { bar:"#ef4444", label:"Avvio ritard." }; return { bar:"#f59e0b", label:"Avvio ritard." }; }
    return { bar:"#94a3b8", label:"Non iniziata" };
  }
  if (!end && !ongoing) return { bar:"#3b82f6", label:"In corso" };
  if (ongoing) return { bar:"#3b82f6", label:"Continua" };
  if (today > end) return { bar:"#ef4444", label:"Scaduta" };
  const totalM = monthDiff(start || today, end), elapsedM = monthDiff(start || today, today);
  const timePct = totalM > 0 ? elapsedM / totalM : 0;
  if (prog !== null) { const gap = timePct - prog; if (gap > 0.3) return { bar:"#ef4444", label:"In ritardo" }; if (gap > 0.15) return { bar:"#f59e0b", label:"Lieve ritardo" }; }
  return { bar:"#3b82f6", label:"Nei tempi" };
}
function calcStatus(disciplines, alerts) {
  const open = (alerts || []).filter(a => a.open);
  if (open.some(a => a.level === "rosso") || (disciplines || []).some(d => d.status === "in-ritardo")) return "rosso";
  if (open.some(a => a.level === "arancio")) return "arancio";
  return "verde";
}
function makeNewId(patients) { return `PAZ-${String((patients || []).length + 1).padStart(3, "0")}`; }

// ─── SEED DATA ────────────────────────────────────────────────────────────────
function makeSeed() {
  function gd(d) { return { consensoSanitario:{granted:true,date:d,method:"firma_modulo"}, consensoWhatsApp:{granted:true,date:d,method:"firma_modulo"}, consensoMarketing:{granted:false,date:null,method:"firma_modulo"}, consensoTerzi:{granted:false,date:null,method:"firma_modulo"}, dataCreazione:d, scadenzaRetenzione:retentionDate(d), note:"" }; }
  function log(d, n) { return [ {id:1,ts:`${d} 09:00`,azione:"Apertura percorso",dettaglio:`Piano accettato — ${n}`,operatore:"Segreteria"}, {id:2,ts:`${d} 09:05`,azione:"Consenso sanitario",dettaglio:"Firmato",operatore:"Segreteria"} ]; }
  return [
    { id:"FER-001", name:"Marco Ferri", age:52, phone:"+39 338 123 4567", acceptedDate:"17/03/2026", clinician:"Dr. Rossi", planValue:18400, invoiced:1200, status:"arancio", tags:["full-mouth","impianti"], currentPhase:"Parodontologia — SRP fase iniziale", lastVisit:"17/03/2026", nextVisit:"24/03/2026", progress:8, totalMonths:28,
      disciplines:[ {id:1,name:"Diagnostica",status:"completata",start:"Mar 2026",end:"Mar 2026",sessions:"1/1",notes:"CBCT, OPT, wax-up"}, {id:2,name:"Parodontologia",status:"in-corso",start:"Mar 2026",end:"Giu 2026",sessions:"1/4",notes:"SRP 4 quadranti"}, {id:3,name:"Igiene",status:"in-corso",start:"Mar 2026",end:"Ongoing",sessions:"0/∞",notes:"⚠ Ogni 3 mesi obbligatoria"}, {id:4,name:"Implantologia",status:"non-iniziata",start:"Giu 2026",end:"Ago 2026",sessions:"0/4",notes:"4 impianti"}, {id:5,name:"Osseointegrazione",status:"non-iniziata",start:"Ago 2026",end:"Feb 2027",sessions:"—",notes:"6 mesi attesa"}, {id:6,name:"Protesi definitiva",status:"non-iniziata",start:"Mar 2027",end:"Mar 2028",sessions:"0/4",notes:""} ],
      alerts:[ {id:1,level:"arancio",text:"Rivalutazione parodontale — prenotare",due:"10/06/2026",open:true}, {id:2,level:"rosso",text:"Igiene mese 3: blocca iter implantare se saltata",due:"24/06/2026",open:true} ],
      gdpr:gd("17/03/2026"), auditLog:log("17/03/2026","Marco Ferri") },
    { id:"MAN-002", name:"Roberto Mancini", age:61, phone:"+39 333 456 7890", acceptedDate:"15/10/2025", clinician:"Dr. Rossi", planValue:7200, invoiced:3600, status:"rosso", tags:["impianti","critico"], currentPhase:"⚠ FERMO — 48 giorni fa", lastVisit:"29/01/2026", nextVisit:"Non fissata", progress:50, totalMonths:12,
      disciplines:[ {id:1,name:"Diagnostica",status:"completata",start:"Ott 2025",end:"Ott 2025",sessions:"1/1",notes:""}, {id:2,name:"Implantologia",status:"completata",start:"Nov 2025",end:"Dic 2025",sessions:"2/2",notes:"2 impianti arcata inf."}, {id:3,name:"Osseointegrazione",status:"in-corso",start:"Dic 2025",end:"Giu 2026",sessions:"—",notes:"Mese 3 — nessun rx"}, {id:4,name:"Igiene",status:"in-ritardo",start:"Nov 2025",end:"Ongoing",sessions:"1/∞",notes:"⚠ 4 mesi fa — rischio perimplantite"}, {id:5,name:"Protesi",status:"non-iniziata",start:"Giu 2026",end:"Set 2026",sessions:"0/3",notes:""} ],
      alerts:[ {id:1,level:"rosso",text:"Igiene non eseguita 4+ mesi",due:"SCADUTO",open:true}, {id:2,level:"rosso",text:"Terapia ferma 48 giorni",due:"URGENTE",open:true} ],
      gdpr:gd("15/10/2025"), auditLog:log("15/10/2025","Roberto Mancini") },
    { id:"COL-003", name:"Anna Colombo", age:34, phone:"+39 345 987 6543", acceptedDate:"02/01/2026", clinician:"Dott.ssa Bianchi", planValue:4800, invoiced:1600, status:"verde", tags:["ortodonzia"], currentPhase:"Ortodonzia — mese 5", lastVisit:"10/03/2026", nextVisit:"22/04/2026", progress:21, totalMonths:26,
      disciplines:[ {id:1,name:"Igiene pre-bonding",status:"completata",start:"Gen 2026",end:"Gen 2026",sessions:"2/2",notes:""}, {id:2,name:"Ortodonzia",status:"in-corso",start:"Feb 2026",end:"Feb 2028",sessions:"5/24",notes:"Ogni 6 settimane"}, {id:3,name:"Igiene mantenimento",status:"in-corso",start:"Feb 2026",end:"Ongoing",sessions:"2/∞",notes:"Ogni 3 mesi"} ],
      alerts:[ {id:1,level:"giallo",text:"Igiene in scadenza",due:"05/04/2026",open:true} ],
      gdpr:gd("02/01/2026"), auditLog:log("02/01/2026","Anna Colombo") },
    { id:"FER-005", name:"Giulia Ferretti", age:41, phone:"+39 347 234 5678", acceptedDate:"10/02/2026", clinician:"Dott.ssa Bianchi", planValue:3200, invoiced:1100, status:"verde", tags:["conservativa"], currentPhase:"Conservativa — secondo quadrante", lastVisit:"14/03/2026", nextVisit:"28/03/2026", progress:35, totalMonths:6,
      disciplines:[ {id:1,name:"Diagnostica",status:"completata",start:"Feb 2026",end:"Feb 2026",sessions:"1/1",notes:""}, {id:2,name:"Endodonzia",status:"completata",start:"Feb 2026",end:"Mar 2026",sessions:"2/2",notes:""}, {id:3,name:"Conservativa",status:"in-corso",start:"Feb 2026",end:"Giu 2026",sessions:"2/6",notes:""}, {id:4,name:"Igiene",status:"in-corso",start:"Feb 2026",end:"Ongoing",sessions:"1/∞",notes:"Ogni 2 mesi"} ],
      alerts:[], gdpr:{...defaultGdpr("10/02/2026"),consensoSanitario:{granted:true,date:"10/02/2026",method:"firma_modulo"}},
      auditLog:[{id:1,ts:"10/02/2026 09:00",azione:"Apertura percorso",dettaglio:"Piano accettato",operatore:"Segreteria"}] },
  ];
}
const SEED = makeSeed();

const inputStyle = { width:"100%", padding:"7px 9px", fontSize:12, border:"1px solid #e2e8f0", borderRadius:6, outline:"none", fontFamily:"inherit", background:"#fff", color:"#0f172a", boxSizing:"border-box" };
const labelStyle = { display:"block", fontSize:10, fontWeight:600, color:"#475569", marginBottom:3, textTransform:"uppercase", letterSpacing:"0.06em" };

// ─── CHAT PANEL ───────────────────────────────────────────────────────────────
function ChatPanel({ patients, currentPatient }) {
  const [msgs, setMsgs] = useState([{ role:"assistant", content:"Ciao! Sono l'assistente di Innova Clinique.\n\nPosso aiutarti con il cruscotto, la timeline, il GDPR e i protocolli clinici.\n\nCosa ti serve?", ts:getTodayFull() }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => { setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 100); }, []);
  useEffect(() => { if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior:"smooth" }); }, [msgs, loading]);

  function buildContext() {
    const pts = patients || [];
    let ctx = `\n\n[CONTESTO] Pazienti:${pts.length} Critici:${pts.filter(p => p.status === "rosso").length} Alert:${pts.reduce((s,p) => s + (p.alerts||[]).filter(a => a.open).length, 0)}`;
    if (currentPatient) {
      const p = currentPatient;
      ctx += `\nPAZIENTE: ${p.name} [${p.status}] ${p.currentPhase}`;
      ctx += `\nDisc: ${(p.disciplines||[]).map(d => `${d.name}[${d.status}]`).join(',')}`;
      const oa = (p.alerts||[]).filter(a => a.open);
      ctx += `\nAlert: ${oa.map(a => `[${a.level}]${a.text}`).join(' | ') || 'nessuno'}`;
    }
    return ctx;
  }

  async function send(text) {
    const q = (text || input).trim(); if (!q || loading) return;
    setInput("");
    const userMsg = { role:"user", content:q, ts:getTodayFull() };
    const newMsgs = [...msgs, userMsg]; setMsgs(newMsgs); setLoading(true);
    try {
      const apiMsgs = newMsgs.slice(-10).map((m, i) => ({ role:m.role, content: i === newMsgs.length - 1 && m.role === "user" ? m.content + buildContext() : m.content }));
      const res = await fetch("https://api.anthropic.com/v1/messages", { method:"POST", headers:{"Content-Type":"application/json","anthropic-dangerous-direct-browser-access":"true"}, body:JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:500, system:SYSTEM_PROMPT, messages:apiMsgs }) });
      const data = await res.json();
      const reply = data.content ? data.content.filter(b => b.type === "text").map(b => b.text).join("") : "Errore nella risposta.";
      setMsgs(prev => [...prev, { role:"assistant", content:reply, ts:getTodayFull() }]);
    } catch (e) { setMsgs(prev => [...prev, { role:"assistant", content:"Errore di connessione.", ts:getTodayFull() }]); }
    setLoading(false);
  }

  function renderMsgContent(text) {
    return text.split('\n').map((line, i) => {
      if (!line.trim()) return <div key={i} style={{ height:4 }} />;
      if (line.startsWith("- ") || line.startsWith("• ")) return <div key={i} style={{ display:"flex", gap:5, marginBottom:3 }}><span style={{ color:"#7c3aed", flexShrink:0, fontWeight:700 }}>›</span><span style={{ fontSize:12, lineHeight:1.5 }}>{line.substring(2)}</span></div>;
      return <div key={i} style={{ fontSize:12, lineHeight:1.5, marginBottom:2 }}>{line}</div>;
    });
  }

  return (
    <React.Fragment>
      <div style={{ background:"linear-gradient(135deg,#7c3aed,#4f46e5)", padding:"10px 13px", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:28, height:28, borderRadius:"50%", background:"rgba(255,255,255,0.2)", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div>
            <div style={{ fontSize:12, fontWeight:700, color:"#fff" }}>Assistente</div>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.75)", display:"flex", alignItems:"center", gap:3 }}><span style={{ width:5, height:5, borderRadius:"50%", background:"#4ade80", display:"inline-block" }}/>Online</div>
          </div>
        </div>
      </div>
      {currentPatient && <div style={{ padding:"5px 11px", background:"#f0fdf4", borderBottom:"1px solid #bbf7d0", fontSize:10, color:"#15803d", flexShrink:0 }}><b>{currentPatient.name}</b> — contesto attivo</div>}
      <div style={{ flex:1, overflowY:"auto", padding:"10px 11px", display:"flex", flexDirection:"column", gap:8, minHeight:0 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ display:"flex", flexDirection:"column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{ maxWidth:"90%", padding:"8px 11px", borderRadius: m.role === "user" ? "12px 12px 3px 12px" : "12px 12px 12px 3px", background: m.role === "user" ? "linear-gradient(135deg,#7c3aed,#4f46e5)" : "#f8fafc", color: m.role === "user" ? "#fff" : "#0f172a", border: m.role === "assistant" ? "1px solid #e2e8f0" : "none" }}>
              {m.role === "user" ? <div style={{ fontSize:12, lineHeight:1.5 }}>{m.content}</div> : renderMsgContent(m.content)}
            </div>
            <div style={{ fontSize:9, color:"#94a3b8", marginTop:2, paddingLeft: m.role === "user" ? 0 : 3, paddingRight: m.role === "user" ? 3 : 0 }}>{m.ts}</div>
          </div>
        ))}
        {loading && <div style={{ display:"flex" }}><div style={{ background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:"12px 12px 12px 3px", padding:"10px 14px", display:"flex", gap:4 }}>{[0,1,2].map(i => <div key={i} style={{ width:6, height:6, borderRadius:"50%", background:"#7c3aed", animation:`chatbounce 1.2s ${i*0.2}s ease-in-out infinite` }}/>)}</div></div>}
        <div ref={bottomRef} />
      </div>
      <div style={{ padding:"5px 10px", borderTop:"1px solid #f1f5f9", display:"flex", flexDirection:"column", gap:3, flexShrink:0 }}>
        {msgs.length <= 2 && <div style={{ fontSize:9, color:"#94a3b8", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:2 }}>Domande frequenti</div>}
        {(msgs.length <= 2 ? SUGGESTED.slice(0,3) : SUGGESTED.slice(0,2)).map(q => <button key={q} onClick={() => send(q)} style={{ padding:"4px 8px", border:"1px solid #e2e8f0", borderRadius:7, background:"#fafbfc", color:"#374151", fontSize:10, cursor:"pointer", fontFamily:"inherit", textAlign:"left" }}>{q.length > 30 ? q.slice(0,29) + "…" : q}</button>)}
      </div>
      <div style={{ padding:"8px 10px", borderTop:"1px solid #e2e8f0", display:"flex", gap:6, alignItems:"flex-end", flexShrink:0 }}>
        <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Scrivi… (Invio per inviare)" rows={1}
          style={{ flex:1, padding:"7px 9px", fontSize:12, border:"1px solid #e2e8f0", borderRadius:8, outline:"none", fontFamily:"inherit", resize:"none", color:"#0f172a", lineHeight:1.4, maxHeight:60, overflowY:"auto", boxSizing:"border-box" }}
          onFocus={e => { e.target.style.borderColor = "#7c3aed"; }} onBlur={e => { e.target.style.borderColor = "#e2e8f0"; }}
          onInput={e => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 60) + "px"; }}/>
        <button onClick={() => send()} disabled={!input.trim() || loading} style={{ width:32, height:32, borderRadius:8, background: input.trim() && !loading ? "linear-gradient(135deg,#7c3aed,#4f46e5)" : "#e2e8f0", border:"none", cursor: input.trim() && !loading ? "pointer" : "default", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={input.trim() && !loading ? "#fff" : "#94a3b8"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
      <style>{`@keyframes chatbounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}`}</style>
    </React.Fragment>
  );
}

// ─── TIMELINE ─────────────────────────────────────────────────────────────────
function Timeline({ patient }) {
  const containerRef = useRef(null); const [W, setW] = useState(500); const [tooltip, setTooltip] = useState(null);
  useEffect(() => { if (!containerRef.current) return; const ro = new ResizeObserver(entries => { for (const e of entries) setW(e.contentRect.width); }); ro.observe(containerRef.current); setW(containerRef.current.offsetWidth || 500); return () => ro.disconnect(); }, []);
  const disciplines = patient.disciplines || []; if (!disciplines.length) return <div style={{ padding:28, textAlign:"center", color:"#94a3b8", fontSize:12 }}>Nessuna disciplina.</div>;
  const td = new Date(); let minD = null, maxD = null;
  disciplines.forEach(d => { const s = parseMonthYear(d.start), e = parseMonthYear(d.end); if (s && (!minD || s < minD)) minD = s; if (e && (!maxD || e > maxD)) maxD = e; });
  if (!minD) minD = addMonths(td, -1); if (!maxD || maxD < td) maxD = addMonths(td, 6);
  minD = addMonths(minD, -1); maxD = addMonths(maxD, 2);
  const TM = Math.max(monthDiff(minD, maxD), 3), LW = 132, BW = 78, CW = Math.max(W - LW - BW - 4, 120), RH = 34, HH = 28, FH = 20, TH = 14, H = HH + disciplines.length * RH + FH;
  function toX(d) { return LW + (monthDiff(minD, d) / TM) * CW; }
  const tdX = toX(td); const gridMonths = []; let cur = new Date(minD); while (cur <= maxD) { gridMonths.push(new Date(cur)); cur = addMonths(cur, 1); }
  const labelEvery = CW < 180 ? 4 : CW < 320 ? 3 : CW < 480 ? 2 : 1;
  return (
    <div ref={containerRef} style={{ background:"#fff", borderRadius:9, overflow:"hidden", boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}>
      <div style={{ padding:"7px 12px", borderBottom:"1px solid #f1f5f9", display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
        {[{c:"#10b981",l:"Completata"},{c:"#3b82f6",l:"Nei tempi"},{c:"#f59e0b",l:"Ritardo lieve"},{c:"#ef4444",l:"Critica"},{c:"#94a3b8",l:"Non iniziata"}].map(x => <span key={x.l} style={{ display:"flex", alignItems:"center", gap:3, fontSize:10, color:"#475569" }}><span style={{ width:9, height:9, borderRadius:2, background:x.c, display:"inline-block" }}/>{x.l}</span>)}
        <span style={{ marginLeft:"auto", fontSize:9, color:"#94a3b8" }}>Linea blu = oggi</span>
      </div>
      <div style={{ overflowX:"auto" }}>
        <svg width={Math.max(W, LW + 120)} height={H} style={{ display:"block" }}>
          <rect x={LW} y={0} width={CW} height={H} fill="#fafbfc"/>
          {gridMonths.map((m, i) => { const x = toX(m); return <g key={i}><line x1={x} y1={HH} x2={x} y2={H-FH} stroke="#f1f5f9" strokeWidth={1}/>{i % labelEvery === 0 && <text x={x+2} y={HH-5} fontSize={7} fill="#94a3b8" fontFamily="system-ui">{fmtMonthYear(m)}</text>}</g>; })}
          {disciplines.map((_, i) => <line key={i} x1={0} y1={HH + i*RH} x2={LW+CW+BW} y2={HH + i*RH} stroke="#f1f5f9" strokeWidth={1}/>)}
          {tdX >= LW && tdX <= LW+CW && <g><line x1={tdX} y1={HH-2} x2={tdX} y2={H-FH} stroke="#2563eb" strokeWidth={1.5} strokeDasharray="4 3"/><rect x={tdX-12} y={HH-14} width={24} height={11} rx={2} fill="#2563eb"/><text x={tdX} y={HH-4} fontSize={7} fill="#fff" textAnchor="middle" fontFamily="system-ui" fontWeight="700">OGGI</text></g>}
          {disciplines.map((d, i) => {
            const y0 = HH + i * RH, ty = y0 + (RH - TH) / 2, col = timelineColor(d, td);
            const sD = parseMonthYear(d.start), eD = d.end && d.end.toLowerCase() === "ongoing" ? addMonths(maxD, -1) : parseMonthYear(d.end), prog = sessionProgress(d.sessions);
            let x1 = sD ? toX(sD) : LW, x2 = eD ? toX(addMonths(eD, 1)) : LW + CW; x1 = Math.max(x1, LW); x2 = Math.min(x2, LW + CW);
            const bw = Math.max(x2 - x1, 3), pw = prog !== null ? bw * prog : (d.status === "completata" ? bw : 0);
            return <g key={d.id || i} onMouseEnter={e => setTooltip({ name:d.name, label:col.label, x:e.clientX, y:e.clientY })} onMouseLeave={() => setTooltip(null)} style={{ cursor:"pointer" }}>
              <rect x={0} y={y0} width={LW+CW+BW} height={RH} fill="transparent"/>
              <text x={LW-5} y={y0+RH/2+1} fontSize={10} fill="#374151" textAnchor="end" dominantBaseline="central" fontFamily="system-ui" fontWeight={d.status === "in-corso" ? "600" : "400"}>{d.name.length > 16 ? d.name.slice(0,15) + "…" : d.name}</text>
              <rect x={LW} y={ty} width={CW} height={TH} rx={3} fill="#f1f5f9"/>
              {sD && <rect x={x1} y={ty} width={bw} height={TH} rx={3} fill={col.bar} opacity={0.18}/>}
              {pw > 0 && <rect x={x1} y={ty} width={Math.max(pw, 3)} height={TH} rx={3} fill={col.bar} opacity={0.85}/>}
              {d.status === "completata" && prog === null && <rect x={x1} y={ty} width={bw} height={TH} rx={3} fill={col.bar} opacity={0.85}/>}
              {d.end && d.end.toLowerCase() === "ongoing" && d.status !== "non-iniziata" && <line x1={LW+CW-2} y1={ty+2} x2={LW+CW-2} y2={ty+TH-2} stroke={col.bar} strokeWidth={1.5} strokeDasharray="2 2"/>}
              <rect x={LW+CW+2} y={y0+RH/2-7} width={74} height={14} rx={7} fill={col.bar} opacity={0.12}/>
              <text x={LW+CW+39} y={y0+RH/2+1} fontSize={8} fill={col.bar} textAnchor="middle" dominantBaseline="central" fontFamily="system-ui" fontWeight="700">{col.label.toUpperCase()}</text>
              {d.sessions && d.sessions !== "—" && bw > 30 && <text x={x1+bw/2} y={ty+TH/2+1} fontSize={8} fill={prog !== null && prog > 0.3 ? "#fff" : "#374151"} textAnchor="middle" dominantBaseline="central" fontFamily="system-ui" fontWeight="600">{d.sessions}</text>}
            </g>;
          })}
          <line x1={LW} y1={H-FH} x2={LW+CW} y2={H-FH} stroke="#e2e8f0" strokeWidth={1}/>
          {gridMonths.map((m, i) => { if (i % labelEvery !== 0) return null; return <text key={i} x={toX(m)+2} y={H-FH+10} fontSize={7} fill="#94a3b8" fontFamily="system-ui">{fmtMonthYear(m)}</text>; })}
        </svg>
      </div>
      <div style={{ padding:"7px 12px", borderTop:"1px solid #f1f5f9", display:"flex", gap:4, flexWrap:"wrap" }}>
        <span style={{ fontSize:10, color:"#64748b", marginRight:3 }}>Compliance:</span>
        {disciplines.map(d => { const col = timelineColor(d, new Date()); return <div key={d.id || d.name} style={{ display:"flex", alignItems:"center", gap:3, padding:"2px 6px", borderRadius:9, background:col.bar+"18", border:`1px solid ${col.bar}33` }}><span style={{ width:6, height:6, borderRadius:"50%", background:col.bar, display:"inline-block" }}/><span style={{ fontSize:9, fontWeight:700, color:col.bar }}>{d.name.length > 12 ? d.name.slice(0,11) + "…" : d.name}</span></div>; })}
      </div>
      {tooltip && <div style={{ position:"fixed", background:"#0f172a", color:"#f1f5f9", fontSize:11, padding:"5px 9px", borderRadius:5, pointerEvents:"none", zIndex:9999, left:tooltip.x+12, top:tooltip.y-8, boxShadow:"0 4px 16px rgba(0,0,0,0.4)" }}><b style={{ color:"#93c5fd" }}>{tooltip.name}</b> — {tooltip.label}</div>}
    </div>
  );
}

// ─── MODAL ────────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children, wide }) {
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position:"fixed", inset:0, background:"rgba(15,23,42,0.65)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:999, padding:14 }}>
      <div style={{ background:"#fff", borderRadius:10, width: wide ? 640 : 440, maxHeight:"88vh", overflowY:"auto", boxShadow:"0 24px 64px rgba(0,0,0,0.35)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 18px", borderBottom:"1px solid #e2e8f0", position:"sticky", top:0, background:"#fff", zIndex:1 }}>
          <span style={{ fontWeight:700, fontSize:13, color:"#0f172a" }}>{title}</span>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:17, cursor:"pointer", color:"#94a3b8" }}>✕</button>
        </div>
        <div style={{ padding:"16px 18px" }}>{children}</div>
      </div>
    </div>
  );
}

// ─── PATIENT FORM ─────────────────────────────────────────────────────────────
function PatientForm({ initial, onSave, onClose, onDelete }) {
  const isNew = !initial;
  const blank = { name:"", age:"", phone:"", acceptedDate:"", clinician:CLINICIANS[0], planValue:"", invoiced:"0", lastVisit:"", nextVisit:"", totalMonths:"12", tags:"", currentPhase:"" };
  const [f, setF] = useState(initial ? { ...initial, tags:initial.tags.join(", "), planValue:String(initial.planValue), invoiced:String(initial.invoiced), totalMonths:String(initial.totalMonths) } : blank);
  const [err, setErr] = useState({});
  function set(k, v) { setF(p => ({ ...p, [k]:v })); }
  function validate() { const e = {}; if (!f.name.trim()) e.name = "Obbligatorio"; if (!f.age || isNaN(+f.age)) e.age = "Non valida"; if (!f.acceptedDate.trim()) e.acceptedDate = "Obbligatoria"; if (!f.planValue || isNaN(+f.planValue)) e.planValue = "Non valido"; setErr(e); return Object.keys(e).length === 0; }
  function submit() {
    if (!validate()) return;
    const base = isNew ? { id:"", disciplines:[], alerts:[], progress:0, status:"verde", gdpr:defaultGdpr(f.acceptedDate.trim() || getToday()), auditLog:[] } : initial;
    const saved = { ...base, name:f.name.trim(), age:+f.age, phone:f.phone.trim(), acceptedDate:f.acceptedDate.trim(), clinician:f.clinician, planValue:+f.planValue, invoiced:+f.invoiced||0, lastVisit:f.lastVisit.trim(), nextVisit:f.nextVisit.trim()||"Non fissata", totalMonths:+f.totalMonths||12, tags:f.tags.split(",").map(t => t.trim()).filter(Boolean), currentPhase:f.currentPhase.trim()||"Percorso in apertura" };
    if (!isNew) saved.status = calcStatus(saved.disciplines, saved.alerts); else saved.auditLog = [makeAuditEntry("Creazione", saved.name)];
    onSave(saved);
  }
  function field(k, label, type, options) {
    return <div><label style={labelStyle}>{label}</label>{options ? <select value={f[k]} onChange={e => set(k, e.target.value)} style={inputStyle}>{options.map(o => <option key={o}>{o}</option>)}</select> : <input type={type||"text"} value={f[k]} onChange={e => set(k, e.target.value)} style={{ ...inputStyle, borderColor:err[k]?"#ef4444":"#e2e8f0" }}/>}{err[k] && <div style={{ fontSize:10, color:"#ef4444", marginTop:2 }}>{err[k]}</div>}</div>;
  }
  const r2 = { display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 };
  return <div><div style={{ display:"flex", flexDirection:"column", gap:10 }}>{field("name","Nome e Cognome")}<div style={r2}>{field("age","Età","number")}{field("phone","Telefono")}</div><div style={r2}>{field("acceptedDate","Data accettazione")}{field("clinician","Clinico",null,CLINICIANS)}</div><div style={r2}>{field("planValue","Valore piano €","number")}{field("invoiced","Già fatturato €","number")}</div><div style={r2}>{field("lastVisit","Ultima visita")}{field("nextVisit","Prossima visita")}</div><div style={r2}>{field("totalMonths","Durata (mesi)","number")}{field("tags","Tag (virgola)")}</div>{field("currentPhase","Fase attuale")}</div><div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:16, paddingTop:12, borderTop:"1px solid #e2e8f0" }}>{(!isNew&&onDelete)?<button onClick={onDelete} style={{ padding:"5px 10px", border:"1px solid #fca5a5", borderRadius:5, background:"#fef2f2", color:"#dc2626", cursor:"pointer", fontSize:11, fontFamily:"inherit" }}>🗑 Elimina</button>:<span/>}<div style={{ display:"flex", gap:8 }}><button onClick={onClose} style={{ padding:"6px 14px", border:"1px solid #e2e8f0", borderRadius:5, background:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:12 }}>Annulla</button><button onClick={submit} style={{ padding:"6px 14px", border:"none", borderRadius:5, background:"#1e40af", color:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:600 }}>{isNew?"Crea":"Salva"}</button></div></div></div>;
}

function DisciplineForm({ initial, onSave, onClose }) {
  const [f, setF] = useState(initial || { name:DISC_OPTIONS[0], status:"non-iniziata", start:"", end:"", sessions:"", notes:"" });
  function set(k, v) { setF(p => ({ ...p, [k]:v })); }
  return <div><div style={{ background:"#eff6ff", border:"1px solid #bfdbfe", borderRadius:5, padding:"6px 10px", marginBottom:10, fontSize:11, color:"#1e40af" }}>Date: "Mar 2026" · Fine continua: "Ongoing"</div><div style={{ display:"flex", flexDirection:"column", gap:10 }}><div><label style={labelStyle}>Disciplina</label><select value={f.name} onChange={e => set("name",e.target.value)} style={inputStyle}>{DISC_OPTIONS.map(o => <option key={o}>{o}</option>)}</select></div><div><label style={labelStyle}>Stato</label><select value={f.status} onChange={e => set("status",e.target.value)} style={inputStyle}>{Object.entries(DISC_STATUS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}</select></div><div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}><div><label style={labelStyle}>Inizio</label><input value={f.start} onChange={e => set("start",e.target.value)} style={inputStyle} placeholder="Mar 2026"/></div><div><label style={labelStyle}>Fine</label><input value={f.end} onChange={e => set("end",e.target.value)} style={inputStyle} placeholder="Giu 2026 / Ongoing"/></div></div><div><label style={labelStyle}>Sedute (2/6 · 0/∞)</label><input value={f.sessions} onChange={e => set("sessions",e.target.value)} style={inputStyle}/></div><div><label style={labelStyle}>Note</label><textarea value={f.notes} onChange={e => set("notes",e.target.value)} style={{ ...inputStyle, minHeight:55, resize:"vertical" }}/></div></div><div style={{ display:"flex", justifyContent:"flex-end", gap:8, marginTop:16, paddingTop:12, borderTop:"1px solid #e2e8f0" }}><button onClick={onClose} style={{ padding:"6px 14px", border:"1px solid #e2e8f0", borderRadius:5, background:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:12 }}>Annulla</button><button onClick={() => { if (f.name) onSave({ ...f, id:initial?initial.id:Date.now() }); }} style={{ padding:"6px 14px", border:"none", borderRadius:5, background:"#1e40af", color:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:600 }}>{initial?"Salva":"Aggiungi"}</button></div></div>;
}

function AlertForm({ onSave, onClose }) {
  const [f, setF] = useState({ level:"arancio", text:"", due:"" });
  function set(k, v) { setF(p => ({ ...p, [k]:v })); }
  return <div><div style={{ display:"flex", flexDirection:"column", gap:10 }}><div><label style={labelStyle}>Livello</label><select value={f.level} onChange={e => set("level",e.target.value)} style={inputStyle}><option value="rosso">🔴 Rosso — entro 24h</option><option value="arancio">🟠 Arancio — entro 3 giorni</option><option value="giallo">🟡 Giallo — entro 7 giorni</option></select></div><div><label style={labelStyle}>Descrizione</label><textarea value={f.text} onChange={e => set("text",e.target.value)} style={{ ...inputStyle, minHeight:55, resize:"vertical" }}/></div><div><label style={labelStyle}>Scadenza</label><input value={f.due} onChange={e => set("due",e.target.value)} style={inputStyle} placeholder="dd/mm/yyyy o URGENTE"/></div></div><div style={{ display:"flex", justifyContent:"flex-end", gap:8, marginTop:16, paddingTop:12, borderTop:"1px solid #e2e8f0" }}><button onClick={onClose} style={{ padding:"6px 14px", border:"1px solid #e2e8f0", borderRadius:5, background:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:12 }}>Annulla</button><button onClick={() => { if (f.text.trim()) onSave({ ...f, id:Date.now(), open:true }); }} style={{ padding:"6px 14px", border:"none", borderRadius:5, background:"#dc2626", color:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:600 }}>Aggiungi</button></div></div>;
}

// ─── PAGAMENTI TAB ────────────────────────────────────────────────────────────
function PagamentiTab({ patient, onUpdate }) {
  const pag = patient.pagamenti || { voci:[], pagamenti:[] };
  const [showVoceForm, setShowVoceForm] = useState(false);
  const [showPagForm,  setShowPagForm]  = useState(false);
  const [voce,  setVoce]  = useState({ descrizione:"", importo:"", fase:"" });
  const [pForm, setPForm] = useState({ data:getToday(), importo:"", metodo:"Bonifico", note:"" });

  const totPreventivo = pag.voci.reduce((s,v) => s + (+v.importo||0), 0);
  const totPagato     = pag.pagamenti.reduce((s,p) => s + (+p.importo||0), 0);
  const residuo       = totPreventivo - totPagato;
  const percPagato    = totPreventivo > 0 ? Math.min(totPagato / totPreventivo, 1) : 0;

  function saveVoce() {
    if (!voce.descrizione.trim() || !voce.importo) return;
    const nuove = [...pag.voci, { id:Date.now(), ...voce, importo:+voce.importo }];
    onUpdate({ ...patient, pagamenti:{ ...pag, voci:nuove }, auditLog:[...(patient.auditLog||[]), makeAuditEntry("Voce preventivo aggiunta", `${voce.descrizione} — €${voce.importo}`)] });
    setVoce({ descrizione:"", importo:"", fase:"" });
    setShowVoceForm(false);
  }

  function savePag() {
    if (!pForm.importo) return;
    const nuovi = [...pag.pagamenti, { id:Date.now(), ...pForm, importo:+pForm.importo }];
    onUpdate({ ...patient, pagamenti:{ ...pag, pagamenti:nuovi }, auditLog:[...(patient.auditLog||[]), makeAuditEntry("Pagamento registrato", `€${pForm.importo} — ${pForm.metodo}`)] });
    setPForm({ data:getToday(), importo:"", metodo:"Bonifico", note:"" });
    setShowPagForm(false);
  }

  function deleteVoce(id) {
    if (!window.confirm("Eliminare questa voce?")) return;
    onUpdate({ ...patient, pagamenti:{ ...pag, voci:pag.voci.filter(v => v.id!==id) } });
  }

  function deletePag(id) {
    if (!window.confirm("Eliminare questo pagamento?")) return;
    onUpdate({ ...patient, pagamenti:{ ...pag, pagamenti:pag.pagamenti.filter(p => p.id!==id) } });
  }

  const statoColor = residuo <= 0 ? "#10b981" : percPagato > 0 ? "#f59e0b" : "#ef4444";
  const statoLabel = residuo <= 0 ? "Saldato" : percPagato > 0 ? "Parziale" : "Non iniziato";
  const METODI = ["Bonifico","Contanti","POS/Carta","Assegno","Finanziamento","Altro"];

  return (
    <div style={{ maxWidth:720 }}>
      <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap" }}>
        {[
          ["Preventivo",`€${totPreventivo.toLocaleString()}`,"#0f172a"],
          ["Incassato",`€${totPagato.toLocaleString()}`,"#10b981"],
          ["Residuo",`€${residuo.toLocaleString()}`,residuo>0?"#ef4444":"#10b981"],
          ["Stato",statoLabel,statoColor],
        ].map(([lab,val,c]) => (
          <div key={lab} style={{ background:"#fff", borderRadius:8, padding:"10px 14px", boxShadow:"0 1px 3px rgba(0,0,0,0.06)", flex:1, minWidth:110 }}>
            <div style={{ fontSize:9, color:"#94a3b8", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:2 }}>{lab}</div>
            <div style={{ fontSize:16, fontWeight:700, color:c }}>{val}</div>
          </div>
        ))}
      </div>

      <div style={{ background:"#fff", borderRadius:8, padding:"12px 16px", marginBottom:14, boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"#64748b", marginBottom:6 }}>
          <span>Avanzamento pagamenti</span>
          <span style={{ fontWeight:600, color:statoColor }}>{Math.round(percPagato*100)}%</span>
        </div>
        <div style={{ height:8, background:"#e2e8f0", borderRadius:4 }}>
          <div style={{ height:"100%", width:`${percPagato*100}%`, background:statoColor, borderRadius:4 }}/>
        </div>
      </div>

      <div style={{ background:"#fff", borderRadius:8, overflow:"hidden", boxShadow:"0 1px 3px rgba(0,0,0,0.06)", marginBottom:14 }}>
        <div style={{ padding:"10px 14px", borderBottom:"1px solid #e2e8f0", background:"#f8fafc", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:12, fontWeight:600, color:"#0f172a" }}>Voci preventivo</span>
          <button onClick={() => setShowVoceForm(v => !v)} style={{ padding:"4px 10px", border:"1px solid #bfdbfe", borderRadius:5, background:"#eff6ff", color:"#1e40af", cursor:"pointer", fontSize:11, fontWeight:600, fontFamily:"inherit" }}>+ Aggiungi voce</button>
        </div>
        {showVoceForm && (
          <div style={{ padding:"12px 14px", borderBottom:"1px solid #e2e8f0", background:"#f0f9ff", display:"flex", gap:8, flexWrap:"wrap", alignItems:"flex-end" }}>
            <div style={{ flex:2, minWidth:140 }}><label style={labelStyle}>Descrizione</label><input value={voce.descrizione} onChange={e => setVoce(p=>({...p,descrizione:e.target.value}))} style={inputStyle} placeholder="es. Implantologia arcata superiore"/></div>
            <div style={{ flex:1, minWidth:90 }}><label style={labelStyle}>Importo €</label><input type="number" value={voce.importo} onChange={e => setVoce(p=>({...p,importo:e.target.value}))} style={inputStyle} placeholder="0"/></div>
            <div style={{ flex:1, minWidth:100 }}><label style={labelStyle}>Fase</label><input value={voce.fase} onChange={e => setVoce(p=>({...p,fase:e.target.value}))} style={inputStyle} placeholder="es. Implantologia"/></div>
            <div style={{ display:"flex", gap:6 }}>
              <button onClick={() => setShowVoceForm(false)} style={{ padding:"7px 12px", border:"1px solid #e2e8f0", borderRadius:5, background:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:11 }}>Annulla</button>
              <button onClick={saveVoce} style={{ padding:"7px 12px", border:"none", borderRadius:5, background:"#1e40af", color:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:11, fontWeight:600 }}>Salva</button>
            </div>
          </div>
        )}
        {pag.voci.length === 0
          ? <div style={{ padding:"20px", textAlign:"center", color:"#94a3b8", fontSize:11 }}>Nessuna voce. Aggiungi le voci del preventivo per tracciare i pagamenti.</div>
          : <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead><tr style={{ background:"#f8fafc" }}>{["Descrizione","Fase","Importo",""].map(h => <th key={h} style={{ padding:"7px 12px", textAlign:"left", fontSize:9, fontWeight:600, color:"#475569", textTransform:"uppercase", borderBottom:"1px solid #e2e8f0" }}>{h}</th>)}</tr></thead>
              <tbody>
                {pag.voci.map((v,i) => <tr key={v.id} style={{ borderBottom:"1px solid #f1f5f9", background:i%2===0?"#fff":"#fafbfc" }}><td style={{ padding:"9px 12px", fontSize:12, color:"#0f172a", fontWeight:500 }}>{v.descrizione}</td><td style={{ padding:"9px 12px", fontSize:11, color:"#64748b" }}>{v.fase||"—"}</td><td style={{ padding:"9px 12px", fontSize:12, fontWeight:600, color:"#0f172a" }}>€{(+v.importo).toLocaleString()}</td><td style={{ padding:"9px 12px" }}><button onClick={() => deleteVoce(v.id)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:11, color:"#fca5a5" }}>✕</button></td></tr>)}
                <tr style={{ background:"#f8fafc", borderTop:"2px solid #e2e8f0" }}><td colSpan={2} style={{ padding:"9px 12px", fontSize:11, fontWeight:700, color:"#475569" }}>TOTALE PREVENTIVO</td><td style={{ padding:"9px 12px", fontSize:13, fontWeight:700, color:"#0f172a" }}>€{totPreventivo.toLocaleString()}</td><td/></tr>
              </tbody>
            </table>
        }
      </div>

      <div style={{ background:"#fff", borderRadius:8, overflow:"hidden", boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}>
        <div style={{ padding:"10px 14px", borderBottom:"1px solid #e2e8f0", background:"#f8fafc", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:12, fontWeight:600, color:"#0f172a" }}>Registro pagamenti</span>
          <button onClick={() => setShowPagForm(v => !v)} style={{ padding:"4px 10px", border:"1px solid #bbf7d0", borderRadius:5, background:"#f0fdf4", color:"#15803d", cursor:"pointer", fontSize:11, fontWeight:600, fontFamily:"inherit" }}>+ Registra pagamento</button>
        </div>
        {showPagForm && (
          <div style={{ padding:"12px 14px", borderBottom:"1px solid #e2e8f0", background:"#f0fdf4", display:"flex", gap:8, flexWrap:"wrap", alignItems:"flex-end" }}>
            <div style={{ flex:1, minWidth:100 }}><label style={labelStyle}>Data</label><input value={pForm.data} onChange={e => setPForm(p=>({...p,data:e.target.value}))} style={inputStyle} placeholder="dd/mm/yyyy"/></div>
            <div style={{ flex:1, minWidth:90 }}><label style={labelStyle}>Importo €</label><input type="number" value={pForm.importo} onChange={e => setPForm(p=>({...p,importo:e.target.value}))} style={inputStyle} placeholder="0"/></div>
            <div style={{ flex:1, minWidth:110 }}><label style={labelStyle}>Metodo</label><select value={pForm.metodo} onChange={e => setPForm(p=>({...p,metodo:e.target.value}))} style={inputStyle}>{METODI.map(m => <option key={m}>{m}</option>)}</select></div>
            <div style={{ flex:2, minWidth:120 }}><label style={labelStyle}>Note</label><input value={pForm.note} onChange={e => setPForm(p=>({...p,note:e.target.value}))} style={inputStyle} placeholder="Acconto, rata 1, saldo…"/></div>
            <div style={{ display:"flex", gap:6 }}>
              <button onClick={() => setShowPagForm(false)} style={{ padding:"7px 12px", border:"1px solid #e2e8f0", borderRadius:5, background:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:11 }}>Annulla</button>
              <button onClick={savePag} style={{ padding:"7px 12px", border:"none", borderRadius:5, background:"#10b981", color:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:11, fontWeight:600 }}>Registra</button>
            </div>
          </div>
        )}
        {pag.pagamenti.length === 0
          ? <div style={{ padding:"20px", textAlign:"center", color:"#94a3b8", fontSize:11 }}>Nessun pagamento registrato.</div>
          : <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead><tr style={{ background:"#f8fafc" }}>{["Data","Importo","Metodo","Note",""].map(h => <th key={h} style={{ padding:"7px 12px", textAlign:"left", fontSize:9, fontWeight:600, color:"#475569", textTransform:"uppercase", borderBottom:"1px solid #e2e8f0" }}>{h}</th>)}</tr></thead>
              <tbody>
                {pag.pagamenti.slice().sort((a,b) => a.data>b.data?-1:1).map((p,i) => <tr key={p.id} style={{ borderBottom:"1px solid #f1f5f9", background:i%2===0?"#fff":"#fafbfc" }}><td style={{ padding:"9px 12px", fontSize:11, color:"#475569", fontFamily:"monospace" }}>{p.data}</td><td style={{ padding:"9px 12px", fontSize:12, fontWeight:700, color:"#10b981" }}>+€{(+p.importo).toLocaleString()}</td><td style={{ padding:"9px 12px", fontSize:11, color:"#64748b" }}>{p.metodo}</td><td style={{ padding:"9px 12px", fontSize:11, color:"#64748b" }}>{p.note||"—"}</td><td style={{ padding:"9px 12px" }}><button onClick={() => deletePag(p.id)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:11, color:"#fca5a5" }}>✕</button></td></tr>)}
                <tr style={{ background:"#f8fafc", borderTop:"2px solid #e2e8f0" }}><td style={{ padding:"9px 12px", fontSize:11, fontWeight:700, color:"#475569" }}>TOTALE INCASSATO</td><td style={{ padding:"9px 12px", fontSize:13, fontWeight:700, color:"#10b981" }}>€{totPagato.toLocaleString()}</td><td colSpan={3} style={{ padding:"9px 12px", fontSize:11, color:residuo>0?"#ef4444":"#10b981", fontWeight:600 }}>{residuo>0?`Residuo: €${residuo.toLocaleString()}`:"✓ Saldato"}</td></tr>
              </tbody>
            </table>
        }
      </div>
    </div>
  );
}

function GDPRTab({ patient, onUpdate }) {
  const g = patient.gdpr || defaultGdpr(patient.acceptedDate);
  function updateConsent(key, field, value) { const cur = g[key]||{granted:false,date:null,method:"firma_modulo"}; const cons = CONSENTS.find(c => c.key===key); const entry = makeAuditEntry(value?"Consenso concesso":"Consenso revocato", cons?cons.label:key); onUpdate({ ...patient, gdpr:{ ...g, [key]:{ ...cur, [field]:value } }, auditLog:[...(patient.auditLog||[]), entry] }); }
  function exportData() { const obj={tipo:"Export GDPR Art.20",paziente:patient.id,nome:patient.name,gdpr:g}; const b=new Blob([JSON.stringify(obj,null,2)],{type:"application/json"}); const u=URL.createObjectURL(b); const a=document.createElement("a"); a.href=u; a.download=`${patient.id}_gdpr.json`; a.click(); URL.revokeObjectURL(u); }
  return <div>{!g.consensoSanitario.granted&&<div style={{ background:"#fef2f2", border:"1px solid #fca5a5", borderRadius:7, padding:"8px 12px", marginBottom:11, fontSize:11, color:"#991b1b" }}><b>⚠ Consenso sanitario mancante</b></div>}<div style={{ background:"#fff", borderRadius:8, overflow:"hidden", boxShadow:"0 1px 3px rgba(0,0,0,0.06)", marginBottom:11 }}><table style={{ width:"100%", borderCollapse:"collapse" }}><thead><tr style={{ background:"#f8fafc" }}>{["Finalità","Req.","Stato","Data"].map(h => <th key={h} style={{ padding:"7px 10px", textAlign:"left", fontSize:9, fontWeight:600, color:"#475569", textTransform:"uppercase", letterSpacing:"0.05em", borderBottom:"1px solid #e2e8f0" }}>{h}</th>)}</tr></thead><tbody>{CONSENTS.map((c,i) => { const con=g[c.key]||{granted:false,date:"",method:"firma_modulo"}; return <tr key={c.key} style={{ borderBottom:"1px solid #f1f5f9", background:i%2===0?"#fff":"#fafbfc" }}><td style={{ padding:"8px 10px" }}><div style={{ fontSize:11, fontWeight:500, color:"#0f172a" }}>{c.label}</div><div style={{ fontSize:9, color:"#94a3b8" }}>{c.legal}</div></td><td style={{ padding:"8px 10px" }}><span style={{ padding:"1px 5px", borderRadius:6, fontSize:9, fontWeight:600, background:c.required?"#fef2f2":"#f1f5f9", color:c.required?"#dc2626":"#64748b" }}>{c.required?"Sì":"No"}</span></td><td style={{ padding:"8px 10px" }}><button onClick={() => updateConsent(c.key,"granted",!con.granted)} style={{ padding:"2px 8px", border:"none", borderRadius:8, fontSize:10, fontWeight:700, cursor:"pointer", fontFamily:"inherit", background:con.granted?"#d1fae5":"#fee2e2", color:con.granted?"#065f46":"#991b1b" }}>{con.granted?"✓ Sì":"✗ No"}</button></td><td style={{ padding:"8px 10px" }}><input value={con.date||""} onChange={e => updateConsent(c.key,"date",e.target.value)} style={{ ...inputStyle, width:88, padding:"3px 6px", fontSize:10 }} placeholder="dd/mm/yyyy"/></td></tr>; })}</tbody></table></div><div style={{ display:"flex", gap:6, marginBottom:11, flexWrap:"wrap" }}><button onClick={exportData} style={{ padding:"5px 10px", border:"1px solid #bfdbfe", borderRadius:5, background:"#eff6ff", color:"#1e40af", cursor:"pointer", fontSize:11, fontFamily:"inherit", fontWeight:600 }}>↓ Export Art. 20</button><button onClick={() => window.alert("Cancellazione limitata: obbligo conservazione 10 anni D.Lgs.229/1999")} style={{ padding:"5px 10px", border:"1px solid #fca5a5", borderRadius:5, background:"#fef2f2", color:"#dc2626", cursor:"pointer", fontSize:11, fontFamily:"inherit" }}>🗑 Art. 17*</button><span style={{ fontSize:10, color:"#94a3b8", alignSelf:"center" }}>Conservazione: {g.scadenzaRetenzione}</span></div><div style={{ background:"#fff", borderRadius:8, overflow:"hidden", boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}><div style={{ padding:"9px 13px", borderBottom:"1px solid #e2e8f0", background:"#f8fafc", display:"flex", justifyContent:"space-between" }}><span style={{ fontSize:12, fontWeight:600, color:"#0f172a" }}>Audit trail</span><span style={{ fontSize:10, color:"#94a3b8" }}>{(patient.auditLog||[]).length} operazioni</span></div><div style={{ maxHeight:160, overflowY:"auto" }}>{(patient.auditLog||[]).slice().reverse().map((e,i) => <div key={e.id||i} style={{ padding:"7px 13px", borderBottom:"1px solid #f1f5f9", display:"flex", gap:10 }}><span style={{ fontSize:9, color:"#94a3b8", fontFamily:"monospace", whiteSpace:"nowrap", minWidth:108 }}>{e.ts}</span><div><div style={{ fontSize:11, fontWeight:600, color:"#0f172a" }}>{e.azione}</div>{e.dettaglio&&<div style={{ fontSize:10, color:"#64748b", marginTop:1 }}>{e.dettaglio}</div>}</div></div>)}{!(patient.auditLog||[]).length&&<div style={{ padding:16, textAlign:"center", color:"#94a3b8", fontSize:11 }}>Nessuna operazione</div>}</div></div></div>;
}

// ─── BUSINESS MONITOR ─────────────────────────────────────────────────────────
function BusinessMonitor({ patients, onSelectPatient }) {
  const totPiani     = patients.reduce((s,p) => s + p.planValue, 0);
  const totFatturato = patients.reduce((s,p) => s + p.invoiced, 0);
  const totResiduo   = totPiani - totFatturato;

  const pazientiPerStato = [
    { label:"Critici 🔴",  val:patients.filter(p=>p.status==="rosso").length,   color:"#ef4444" },
    { label:"Attenzione 🟠",val:patients.filter(p=>p.status==="arancio").length, color:"#f59e0b" },
    { label:"On track 🟢", val:patients.filter(p=>p.status==="verde").length,    color:"#10b981" },
  ];

  const clinici = [...new Set(patients.map(p => p.clinician))];
  const pazientiPerClinco = clinici.map(c => ({
    label: c,
    val: patients.filter(p => p.clinician === c).length,
    residuo: patients.filter(p => p.clinician === c).reduce((s,p) => s + (p.planValue - p.invoiced), 0),
  }));

  const discCount = {};
  patients.forEach(p => (p.disciplines||[]).forEach(d => {
    if (d.status === "in-corso") discCount[d.name] = (discCount[d.name]||0) + 1;
  }));
  const topDisc = Object.entries(discCount).sort((a,b)=>b[1]-a[1]).slice(0,6);

  const alertsPerLiv = [
    { label:"🔴 Rossi",   val:patients.reduce((s,p) => s+(p.alerts||[]).filter(a=>a.open&&a.level==="rosso").length,0),   color:"#ef4444" },
    { label:"🟠 Arancio", val:patients.reduce((s,p) => s+(p.alerts||[]).filter(a=>a.open&&a.level==="arancio").length,0), color:"#f59e0b" },
    { label:"🟡 Gialli",  val:patients.reduce((s,p) => s+(p.alerts||[]).filter(a=>a.open&&a.level==="giallo").length,0),  color:"#d97706" },
  ];

  const percRiscossione = totPiani > 0 ? Math.round(totFatturato / totPiani * 100) : 0;

  function BarChart({ data, colorKey }) {
    const max = Math.max(...data.map(d => d.val), 1);
    return (
      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        {data.map((d,i) => (
          <div key={i}>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"#475569", marginBottom:3 }}>
              <span>{d.label}</span>
              <span style={{ fontWeight:700, color: d.color || colorKey }}>{d.val}</span>
            </div>
            <div style={{ height:8, background:"#f1f5f9", borderRadius:4 }}>
              <div style={{ height:"100%", width:`${(d.val/max)*100}%`, background: d.color || colorKey, borderRadius:4, minWidth: d.val>0?4:0 }}/>
            </div>
          </div>
        ))}
      </div>
    );
  }

  function exportReport() {
    const lines = [
      "INNOVA CLINIQUE — REPORT BUSINESS",
      `Data: ${getToday()}`,
      "",
      "── KPI FINANZIARI ──",
      `Valore piani totale: €${totPiani.toLocaleString()}`,
      `Fatturato totale: €${totFatturato.toLocaleString()}`,
      `Residuo da incassare: €${totResiduo.toLocaleString()}`,
      `% riscossione: ${percRiscossione}%`,
      "",
      "── PAZIENTI PER STATO ──",
      ...pazientiPerStato.map(x => `${x.label}: ${x.val}`),
      "",
      "── PER CLINICO ──",
      ...pazientiPerClinco.map(x => `${x.label}: ${x.val} pazienti | residuo €${x.residuo.toLocaleString()}`),
      "",
      "── DISCIPLINE IN CORSO (TOP) ──",
      ...topDisc.map(([d,n]) => `${d}: ${n} pazienti`),
      "",
      "── ALERT APERTI ──",
      ...alertsPerLiv.map(x => `${x.label}: ${x.val}`),
    ];
    const blob = new Blob([lines.join("\n")], { type:"text/plain" });
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u; a.download = `innova_report_${getToday().replace(/\//g,"-")}.txt`; a.click();
    URL.revokeObjectURL(u);
  }

  const card = (children, extraStyle) => (
    <div style={{ background:"#fff", borderRadius:9, padding:"14px 16px", boxShadow:"0 1px 3px rgba(0,0,0,0.06)", ...extraStyle }}>
      {children}
    </div>
  );

  const cardTitle = (t) => <div style={{ fontSize:11, fontWeight:700, color:"#475569", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:12 }}>{t}</div>;

  return (
    <div>
      {/* KPI row */}
      <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap" }}>
        {[
          ["Valore piani",    `€${(totPiani/1000).toFixed(1)}k`,      "#0f172a"],
          ["Fatturato",       `€${(totFatturato/1000).toFixed(1)}k`,  "#10b981"],
          ["Residuo",         `€${(totResiduo/1000).toFixed(1)}k`,    totResiduo>0?"#ef4444":"#10b981"],
          ["% Riscossione",   `${percRiscossione}%`,                   percRiscossione>=70?"#10b981":percRiscossione>=40?"#f59e0b":"#ef4444"],
          ["Pazienti attivi", patients.length,                         "#0f172a"],
          ["Alert aperti",    patients.reduce((s,p)=>s+(p.alerts||[]).filter(a=>a.open).length,0), "#f59e0b"],
        ].map(([lab,val,c]) => (
          <div key={lab} style={{ background:"#fff", borderRadius:8, padding:"10px 14px", boxShadow:"0 1px 3px rgba(0,0,0,0.06)", flex:1, minWidth:100 }}>
            <div style={{ fontSize:9, color:"#94a3b8", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:2 }}>{lab}</div>
            <div style={{ fontSize:18, fontWeight:700, color:c }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Barra riscossione */}
      {card(<>
        {cardTitle("Avanzamento riscossione globale")}
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"#64748b", marginBottom:6 }}>
          <span>Fatturato <b style={{ color:"#10b981" }}>€{totFatturato.toLocaleString()}</b></span>
          <span>Residuo <b style={{ color:"#ef4444" }}>€{totResiduo.toLocaleString()}</b></span>
          <span>Totale <b style={{ color:"#0f172a" }}>€{totPiani.toLocaleString()}</b></span>
        </div>
        <div style={{ height:12, background:"#f1f5f9", borderRadius:6, overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${percRiscossione}%`, background:"#10b981", borderRadius:6 }}/>
        </div>
        <div style={{ textAlign:"center", fontSize:11, fontWeight:700, color:"#10b981", marginTop:6 }}>{percRiscossione}% riscosso</div>
      </>, { marginBottom:14 })}

      {/* Grafici a barre */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
        {card(<>
          {cardTitle("Pazienti per stato")}
          <BarChart data={pazientiPerStato}/>
        </>)}
        {card(<>
          {cardTitle("Alert aperti per livello")}
          <BarChart data={alertsPerLiv}/>
        </>)}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
        {card(<>
          {cardTitle("Discipline in corso (top)")}
          {topDisc.length === 0
            ? <div style={{ color:"#94a3b8", fontSize:11 }}>Nessuna disciplina in corso.</div>
            : <BarChart data={topDisc.map(([d,n]) => ({ label:d, val:n, color:"#3b82f6" }))}/>
          }
        </>)}
        {card(<>
          {cardTitle("Per clinico — pazienti e residuo")}
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {pazientiPerClinco.map((c,i) => (
              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 10px", background:"#f8fafc", borderRadius:6 }}>
                <div>
                  <div style={{ fontSize:11, fontWeight:600, color:"#0f172a" }}>{c.label}</div>
                  <div style={{ fontSize:10, color:"#64748b" }}>{c.val} pazienti</div>
                </div>
                <div style={{ fontSize:12, fontWeight:700, color: c.residuo > 0 ? "#ef4444" : "#10b981" }}>
                  €{c.residuo.toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </>)}
      </div>

      {/* Top residui */}
      {card(<>
        {cardTitle("Pazienti con maggior residuo")}
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead><tr style={{ background:"#f8fafc" }}>{["Paziente","Clinico","Piano","Fatturato","Residuo","Stato",""].map(h => <th key={h} style={{ padding:"6px 10px", textAlign:"left", fontSize:9, fontWeight:600, color:"#475569", textTransform:"uppercase", borderBottom:"1px solid #e2e8f0" }}>{h}</th>)}</tr></thead>
          <tbody>
            {patients.slice().sort((a,b) => (b.planValue-b.invoiced)-(a.planValue-a.invoiced)).slice(0,5).map((p,i) => {
              const res = p.planValue - p.invoiced;
              const s = SEM[p.status];
              return (
                <tr key={p.id} style={{ borderBottom:"1px solid #f1f5f9", background:i%2===0?"#fff":"#fafbfc", cursor:"pointer" }} onClick={() => onSelectPatient(p)}>
                  <td style={{ padding:"8px 10px", fontSize:12, fontWeight:600, color:"#0f172a" }}>{p.name}</td>
                  <td style={{ padding:"8px 10px", fontSize:11, color:"#64748b" }}>{p.clinician}</td>
                  <td style={{ padding:"8px 10px", fontSize:11, color:"#0f172a" }}>€{p.planValue.toLocaleString()}</td>
                  <td style={{ padding:"8px 10px", fontSize:11, color:"#10b981" }}>€{p.invoiced.toLocaleString()}</td>
                  <td style={{ padding:"8px 10px", fontSize:12, fontWeight:700, color:res>0?"#ef4444":"#10b981" }}>€{res.toLocaleString()}</td>
                  <td style={{ padding:"8px 10px" }}><span style={{ padding:"2px 7px", borderRadius:8, fontSize:10, fontWeight:600, background:s.bg, color:s.color }}>{s.label}</span></td>
                  <td style={{ padding:"8px 10px", fontSize:11, color:"#3b82f6", fontWeight:600 }}>→</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </>, { marginBottom:14 })}

      {/* Export */}
      <div style={{ display:"flex", justifyContent:"flex-end" }}>
        <button onClick={exportReport} style={{ padding:"8px 16px", border:"1px solid #bfdbfe", borderRadius:7, background:"#eff6ff", color:"#1e40af", cursor:"pointer", fontSize:12, fontWeight:600, fontFamily:"inherit" }}>
          ↓ Esporta report .txt
        </button>
      </div>
    </div>
  );
}

}

// ─── PREVENTIVI MODULE ────────────────────────────────────────────────────────

const PREV_STORAGE_KEY = "innova_preventivi_v1";

const PREV_CONFIG = {
  giorniValidita: 30,
  giorniPrimoRecall: 3,
  giorniAlertScadenza: 5,
};

const PREV_STATI = {
  waiting_response:   { label:"In attesa",      color:"#3b82f6", bg:"#eff6ff",  icon:"⏳" },
  pending_more_time:  { label:"Più tempo",       color:"#f59e0b", bg:"#fffbeb",  icon:"🕐" },
  followup_scheduled: { label:"Follow-up prog.", color:"#8b5cf6", bg:"#f5f3ff",  icon:"📅" },
  followup_due:       { label:"Follow-up scad.", color:"#f97316", bg:"#fff7ed",  icon:"⚠️" },
  expiring_soon:      { label:"In scadenza",     color:"#f97316", bg:"#fff7ed",  icon:"🔔" },
  expired:            { label:"Scaduto",         color:"#ef4444", bg:"#fef2f2",  icon:"❌" },
  accepted:           { label:"Accettato",       color:"#10b981", bg:"#ecfdf5",  icon:"✅" },
  refused:            { label:"Rifiutato",       color:"#64748b", bg:"#f8fafc",  icon:"🚫" },
};

const MOTIVI_RIFIUTO = ["Prezzo troppo alto","Ha scelto altro studio","Ha rimandato a data indefinita","Problemi personali/economici","Non interessato","Altro"];
const TIPI_FOLLOWUP = ["Telefonata","WhatsApp","Email","Visita in studio","Recall interno"];
const PREV_FILTRI = [
  { id:"tutti",              label:"Tutti" },
  { id:"attivi",             label:"In corso" },
  { id:"followup_oggi",      label:"Follow-up oggi" },
  { id:"followup_scaduti",   label:"Follow-up scaduti" },
  { id:"expiring_soon",      label:"In scadenza" },
  { id:"expired",            label:"Scaduti" },
  { id:"accepted",           label:"Accettati" },
  { id:"refused",            label:"Rifiutati" },
];

// ── Utility preventivi ────────────────────────────────────────────────────────
function parseDMY(str) {
  if (!str) return null;
  const [d,m,y] = str.split('/'); return new Date(+y, +m-1, +d);
}
function addDays(str, n) {
  const d = parseDMY(str); if (!d) return str;
  d.setDate(d.getDate() + n);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}
function daysDiff(str) {
  const d = parseDMY(str); if (!d) return null;
  return Math.round((d - new Date()) / 86400000);
}
function newPrevId(list) { return `PREV-${String((list||[]).length+1).padStart(3,'0')}`; }

function calcolaStatoAuto(prev) {
  if (prev.stato === "accepted" || prev.stato === "refused") return prev.stato;
  const today = new Date(); today.setHours(0,0,0,0);
  const scad = parseDMY(prev.dataScadenza);
  const diffScad = scad ? Math.round((scad - today) / 86400000) : null;
  if (diffScad !== null && diffScad < 0) return "expired";
  if (diffScad !== null && diffScad <= PREV_CONFIG.giorniAlertScadenza) return "expiring_soon";
  if (prev.stato === "followup_scheduled" || prev.stato === "pending_more_time") {
    const fu = prev.prossimFollowup ? parseDMY(prev.prossimFollowup) : null;
    if (fu && fu < today) return "followup_due";
    return prev.stato;
  }
  if (prev.stato === "waiting_response") {
    const consegna = parseDMY(prev.dataConsegna);
    if (consegna) {
      const diffCons = Math.round((today - consegna) / 86400000);
      if (diffCons >= PREV_CONFIG.giorniPrimoRecall) return "followup_due";
    }
  }
  return prev.stato;
}

function aggiornaTuttiStati(list) {
  return (list||[]).map(p => ({ ...p, stato: calcolaStatoAuto(p) }));
}

const PREV_SEED = [
  {
    id:"PREV-001", patientName:"Giovanni Bianchi", patientPhone:"+39 333 111 2222",
    clinician:"Dr. Rossi", codice:"PC-2026-001",
    dataConsegna: addDays(getToday(), -5), dataScadenza: addDays(getToday(), 25),
    importoTotale:8500, opzioni:["Piano A — Impianti + Protesi €8500","Piano B — Solo protesi rimovibile €2800"],
    opzioneAccettata:null, stato:"followup_due", motivoRifiuto:"", noteInterne:"Paziente molto interessato, ha chiesto tempo per valutare",
    prossimFollowup: addDays(getToday(), -1), operatoreAssegnato:"segreteria@innovaclinique.it",
    followups:[ {id:1, data: addDays(getToday(), -5), tipo:"Email", esito:"Preventivo inviato via email", operatore:"Segreteria", completato:true} ],
    tasks:[ {id:1, tipo:"Primo recall", dataScadenza: addDays(getToday(), -2), priorita:"alta", stato:"pending", origine:"auto"} ],
    auditLog:[ {ts: addDays(getToday(), -5)+" 10:00", azione:"Preventivo consegnato", statoPrec:"-", statoNuovo:"waiting_response", operatore:"Segreteria"} ],
    createdAt: addDays(getToday(), -5), updatedAt: addDays(getToday(), -5),
  },
  {
    id:"PREV-002", patientName:"Lucia Ferrero", patientPhone:"+39 347 555 6666",
    clinician:"Dott.ssa Bianchi", codice:"PC-2026-002",
    dataConsegna: addDays(getToday(), -2), dataScadenza: addDays(getToday(), 28),
    importoTotale:3200, opzioni:[], opzioneAccettata:null,
    stato:"waiting_response", motivoRifiuto:"", noteInterne:"",
    prossimFollowup:null, operatoreAssegnato:"segreteria@innovaclinique.it",
    followups:[], tasks:[], auditLog:[],
    createdAt: addDays(getToday(), -2), updatedAt: addDays(getToday(), -2),
  },
  {
    id:"PREV-003", patientName:"Mario Russo", patientPhone:"+39 320 777 8888",
    clinician:"Dr. Rossi", codice:"PC-2026-003",
    dataConsegna: addDays(getToday(), -28), dataScadenza: addDays(getToday(), 2),
    importoTotale:12000, opzioni:[], opzioneAccettata:null,
    stato:"expiring_soon", motivoRifiuto:"", noteInterne:"Sta raccogliendo più preventivi",
    prossimFollowup: addDays(getToday(), 1), operatoreAssegnato:"segreteria@innovaclinique.it",
    followups:[
      {id:1, data: addDays(getToday(), -28), tipo:"Telefonata", esito:"Preventivo illustrato", operatore:"Segreteria", completato:true},
      {id:2, data: addDays(getToday(), -14), tipo:"WhatsApp", esito:"Paziente sta valutando", operatore:"Segreteria", completato:true},
    ],
    tasks:[],
    auditLog:[],
    createdAt: addDays(getToday(), -28), updatedAt: addDays(getToday(), -14),
  },
];

// ── Preventivo Form ───────────────────────────────────────────────────────────
function PreventivoForm({ initial, onSave, onClose }) {
  const isNew = !initial;
  const blank = { patientName:"", patientPhone:"", clinician:CLINICIANS[0], codice:"", dataConsegna:getToday(), importoTotale:"", opzioni:"", noteInterne:"", operatoreAssegnato:"segreteria@innovaclinique.it" };
  const [f, setF] = useState(initial ? { ...initial, opzioni:(initial.opzioni||[]).join("\n"), importoTotale:String(initial.importoTotale) } : blank);
  const [err, setErr] = useState({});
  function set(k,v) { setF(p=>({...p,[k]:v})); }

  function submit() {
    const e = {};
    if (!f.patientName.trim()) e.patientName="Obbligatorio";
    if (!f.importoTotale || isNaN(+f.importoTotale)) e.importoTotale="Non valido";
    if (!f.dataConsegna) e.dataConsegna="Obbligatoria";
    setErr(e);
    if (Object.keys(e).length) return;

    const dataScadenza = addDays(f.dataConsegna, PREV_CONFIG.giorniValidita);
    const opzioni = f.opzioni.split('\n').map(o=>o.trim()).filter(Boolean);
    const saved = {
      ...(initial||{}),
      patientName:f.patientName.trim(), patientPhone:f.patientPhone.trim(),
      clinician:f.clinician, codice:f.codice.trim()||`PC-${Date.now()}`,
      dataConsegna:f.dataConsegna, dataScadenza,
      importoTotale:+f.importoTotale, opzioni,
      opzioneAccettata:initial?.opzioneAccettata||null,
      stato:initial?.stato||"waiting_response",
      motivoRifiuto:initial?.motivoRifiuto||"",
      noteInterne:f.noteInterne.trim(),
      prossimFollowup:initial?.prossimFollowup||null,
      operatoreAssegnato:f.operatoreAssegnato,
      followups:initial?.followups||[],
      tasks:initial?.tasks||[{ id:Date.now(), tipo:"Primo recall", dataScadenza:addDays(f.dataConsegna, PREV_CONFIG.giorniPrimoRecall), priorita:"alta", stato:"pending", origine:"auto" }],
      auditLog:[...(initial?.auditLog||[]), {ts:getTodayFull(), azione:isNew?"Preventivo creato":"Preventivo modificato", statoPrec:initial?.stato||"-", statoNuovo:initial?.stato||"waiting_response", operatore:"Operatore"}],
      createdAt:initial?.createdAt||getToday(),
      updatedAt:getToday(),
    };
    onSave(saved);
  }

  return (
    <div>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <div><label style={labelStyle}>Nome paziente *</label><input value={f.patientName} onChange={e=>set("patientName",e.target.value)} style={{...inputStyle, borderColor:err.patientName?"#ef4444":"#e2e8f0"}} placeholder="Mario Rossi"/>{err.patientName&&<div style={{fontSize:10,color:"#ef4444",marginTop:2}}>{err.patientName}</div>}</div>
          <div><label style={labelStyle}>Telefono</label><input value={f.patientPhone} onChange={e=>set("patientPhone",e.target.value)} style={inputStyle}/></div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
          <div><label style={labelStyle}>Clinico</label><select value={f.clinician} onChange={e=>set("clinician",e.target.value)} style={inputStyle}>{CLINICIANS.map(c=><option key={c}>{c}</option>)}</select></div>
          <div><label style={labelStyle}>Codice preventivo</label><input value={f.codice} onChange={e=>set("codice",e.target.value)} style={inputStyle} placeholder="PC-2026-001"/></div>
          <div><label style={labelStyle}>Data consegna *</label><input value={f.dataConsegna} onChange={e=>set("dataConsegna",e.target.value)} style={{...inputStyle, borderColor:err.dataConsegna?"#ef4444":"#e2e8f0"}} placeholder="dd/mm/yyyy"/></div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <div><label style={labelStyle}>Importo totale € *</label><input type="number" value={f.importoTotale} onChange={e=>set("importoTotale",e.target.value)} style={{...inputStyle, borderColor:err.importoTotale?"#ef4444":"#e2e8f0"}}/>{err.importoTotale&&<div style={{fontSize:10,color:"#ef4444",marginTop:2}}>{err.importoTotale}</div>}</div>
          <div><label style={labelStyle}>Operatore assegnato</label><input value={f.operatoreAssegnato} onChange={e=>set("operatoreAssegnato",e.target.value)} style={inputStyle}/></div>
        </div>
        <div><label style={labelStyle}>Opzioni piano (una per riga, lascia vuoto se unico piano)</label><textarea value={f.opzioni} onChange={e=>set("opzioni",e.target.value)} rows={3} style={{...inputStyle,resize:"vertical",minHeight:60}} placeholder={"Piano A — Impianti completi €8500\nPiano B — Solo protesi rimovibile €2800"}/></div>
        <div><label style={labelStyle}>Note interne segreteria</label><textarea value={f.noteInterne} onChange={e=>set("noteInterne",e.target.value)} rows={2} style={{...inputStyle,resize:"vertical",minHeight:50}}/></div>
        <div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:5,padding:"6px 10px",fontSize:11,color:"#1e40af"}}>
          Scadenza automatica: <b>{addDays(f.dataConsegna||getToday(), PREV_CONFIG.giorniValidita)}</b> · Primo recall automatico: <b>{addDays(f.dataConsegna||getToday(), PREV_CONFIG.giorniPrimoRecall)}</b>
        </div>
      </div>
      <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16,paddingTop:12,borderTop:"1px solid #e2e8f0"}}>
        <button onClick={onClose} style={{padding:"6px 14px",border:"1px solid #e2e8f0",borderRadius:5,background:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:12}}>Annulla</button>
        <button onClick={submit} style={{padding:"6px 14px",border:"none",borderRadius:5,background:"#1e40af",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600}}>{isNew?"Crea preventivo":"Salva modifiche"}</button>
      </div>
    </div>
  );
}

// ── Scheda dettaglio preventivo ───────────────────────────────────────────────
function PreventivoDettaglio({ prev, onUpdate, onClose, onAccetta, onRifiuta, onSpostaInCruscotto }) {
  const [showFollowupForm, setShowFollowupForm] = useState(false);
  const [fuForm, setFuForm] = useState({ data:getToday(), tipo:"Telefonata", esito:"", note:"" });
  const [showNuovaData, setShowNuovaData] = useState(false);
  const [nuovaData, setNuovaData] = useState("");
  const [showRifiuto, setShowRifiuto] = useState(false);
  const [motivoRif, setMotivoRif] = useState(MOTIVI_RIFIUTO[0]);
  const [showAccettazione, setShowAccettazione] = useState(false);
  const [opzioneAcc, setOpzioneAcc] = useState(prev.opzioni[0]||"");

  const s = PREV_STATI[prev.stato] || PREV_STATI.waiting_response;
  const diff = daysDiff(prev.dataScadenza);
  const isActive = !["accepted","refused"].includes(prev.stato);

  function addFollowup() {
    if (!fuForm.esito.trim()) return;
    const updated = {
      ...prev,
      followups:[...(prev.followups||[]), {id:Date.now(), ...fuForm, operatore:"Operatore", completato:true}],
      updatedAt:getToday(),
      auditLog:[...(prev.auditLog||[]), {ts:getTodayFull(), azione:"Follow-up registrato", statoPrec:prev.stato, statoNuovo:prev.stato, operatore:"Operatore"}],
    };
    onUpdate(updated);
    setFuForm({ data:getToday(), tipo:"Telefonata", esito:"", note:"" });
    setShowFollowupForm(false);
  }

  function impostaNuovaData() {
    if (!nuovaData) return;
    const updated = {
      ...prev,
      stato:"followup_scheduled",
      prossimFollowup:nuovaData,
      updatedAt:getToday(),
      tasks:[...(prev.tasks||[]), {id:Date.now(), tipo:"Follow-up programmato", dataScadenza:nuovaData, priorita:"media", stato:"pending", origine:"manuale"}],
      auditLog:[...(prev.auditLog||[]), {ts:getTodayFull(), azione:"Nuova data follow-up", statoPrec:prev.stato, statoNuovo:"followup_scheduled", operatore:"Operatore"}],
    };
    onUpdate(updated);
    setShowNuovaData(false);
    setNuovaData("");
  }

  return (
    <div>
      {/* Header stato */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,padding:"10px 14px",background:s.bg,borderRadius:8,border:`1px solid ${s.color}33`}}>
        <span style={{fontSize:18}}>{s.icon}</span>
        <div style={{flex:1}}>
          <div style={{fontSize:13,fontWeight:700,color:s.color}}>{s.label}</div>
          <div style={{fontSize:11,color:"#64748b"}}>{prev.codice} · {prev.clinician} · €{prev.importoTotale.toLocaleString()}</div>
        </div>
        {diff !== null && isActive && (
          <div style={{textAlign:"center",padding:"6px 12px",background:"#fff",borderRadius:6,border:"1px solid #e2e8f0"}}>
            <div style={{fontSize:16,fontWeight:700,color:diff<0?"#ef4444":diff<=5?"#f97316":"#0f172a"}}>{diff<0?`${Math.abs(diff)}gg fa`:`${diff}gg`}</div>
            <div style={{fontSize:9,color:"#94a3b8"}}>alla scadenza</div>
          </div>
        )}
      </div>

      {/* Info base */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
        {[["Consegna",prev.dataConsegna],["Scadenza",prev.dataScadenza],["Telefono",prev.patientPhone||"—"],["Prossimo follow-up",prev.prossimFollowup||"—"],["Operatore",prev.operatoreAssegnato],["Note",prev.noteInterne||"—"]].map(([k,v])=>(
          <div key={k} style={{padding:"8px 10px",background:"#f8fafc",borderRadius:6}}>
            <div style={{fontSize:9,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>{k}</div>
            <div style={{fontSize:12,color:"#0f172a",fontWeight:500}}>{v}</div>
          </div>
        ))}
      </div>

      {/* Opzioni piano */}
      {(prev.opzioni||[]).length > 0 && (
        <div style={{marginBottom:14}}>
          <div style={{fontSize:10,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Opzioni preventivo</div>
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            {prev.opzioni.map((o,i)=>(
              <div key={i} style={{padding:"6px 10px",background:prev.opzioneAccettata===o?"#d1fae5":"#f8fafc",border:`1px solid ${prev.opzioneAccettata===o?"#10b981":"#e2e8f0"}`,borderRadius:6,fontSize:12,color:prev.opzioneAccettata===o?"#065f46":"#0f172a"}}>
                {prev.opzioneAccettata===o?"✓ ":""}{o}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Azioni rapide */}
      {isActive && (
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14,padding:"10px",background:"#f8fafc",borderRadius:8,border:"1px solid #e2e8f0"}}>
          <div style={{fontSize:10,fontWeight:700,color:"#475569",width:"100%",marginBottom:4}}>AZIONI RAPIDE</div>
          <button onClick={()=>setShowAccettazione(v=>!v)} style={{padding:"6px 12px",border:"1px solid #bbf7d0",borderRadius:6,background:"#f0fdf4",color:"#15803d",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>✅ Accetta</button>
          <button onClick={()=>setShowRifiuto(v=>!v)} style={{padding:"6px 12px",border:"1px solid #e2e8f0",borderRadius:6,background:"#f8fafc",color:"#475569",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>🚫 Rifiuta</button>
          <button onClick={()=>setShowNuovaData(v=>!v)} style={{padding:"6px 12px",border:"1px solid #fde68a",borderRadius:6,background:"#fffbeb",color:"#92400e",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>📅 Nuova data</button>
          <button onClick={()=>setShowFollowupForm(v=>!v)} style={{padding:"6px 12px",border:"1px solid #bfdbfe",borderRadius:6,background:"#eff6ff",color:"#1e40af",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>📝 Registra follow-up</button>
        </div>
      )}

      {/* Form accettazione */}
      {showAccettazione && (
        <div style={{marginBottom:12,padding:"12px",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8}}>
          <div style={{fontSize:12,fontWeight:600,color:"#15803d",marginBottom:8}}>Conferma accettazione</div>
          {(prev.opzioni||[]).length > 0 && (
            <div style={{marginBottom:8}}>
              <label style={labelStyle}>Opzione accettata</label>
              <select value={opzioneAcc} onChange={e=>setOpzioneAcc(e.target.value)} style={inputStyle}>
                {prev.opzioni.map(o=><option key={o}>{o}</option>)}
              </select>
            </div>
          )}
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>onAccetta(prev, opzioneAcc)} style={{padding:"6px 14px",border:"none",borderRadius:5,background:"#10b981",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600}}>Conferma ✅</button>
            <button onClick={()=>setShowAccettazione(false)} style={{padding:"6px 14px",border:"1px solid #e2e8f0",borderRadius:5,background:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:12}}>Annulla</button>
          </div>
        </div>
      )}

      {/* Form rifiuto */}
      {showRifiuto && (
        <div style={{marginBottom:12,padding:"12px",background:"#fef9f9",border:"1px solid #fca5a5",borderRadius:8}}>
          <div style={{fontSize:12,fontWeight:600,color:"#991b1b",marginBottom:8}}>Registra rifiuto</div>
          <div style={{marginBottom:8}}>
            <label style={labelStyle}>Motivo</label>
            <select value={motivoRif} onChange={e=>setMotivoRif(e.target.value)} style={inputStyle}>{MOTIVI_RIFIUTO.map(m=><option key={m}>{m}</option>)}</select>
          </div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>onRifiuta(prev, motivoRif)} style={{padding:"6px 14px",border:"none",borderRadius:5,background:"#ef4444",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600}}>Conferma rifiuto</button>
            <button onClick={()=>setShowRifiuto(false)} style={{padding:"6px 14px",border:"1px solid #e2e8f0",borderRadius:5,background:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:12}}>Annulla</button>
          </div>
        </div>
      )}

      {/* Form nuova data */}
      {showNuovaData && (
        <div style={{marginBottom:12,padding:"12px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8}}>
          <div style={{fontSize:12,fontWeight:600,color:"#92400e",marginBottom:8}}>Imposta nuova data follow-up</div>
          <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
            <div style={{flex:1}}><label style={labelStyle}>Data richiamo</label><input value={nuovaData} onChange={e=>setNuovaData(e.target.value)} style={inputStyle} placeholder="dd/mm/yyyy"/></div>
            <button onClick={impostaNuovaData} style={{padding:"7px 14px",border:"none",borderRadius:5,background:"#f59e0b",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600}}>Salva</button>
            <button onClick={()=>setShowNuovaData(false)} style={{padding:"7px 10px",border:"1px solid #e2e8f0",borderRadius:5,background:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:12}}>✕</button>
          </div>
        </div>
      )}

      {/* Form follow-up */}
      {showFollowupForm && (
        <div style={{marginBottom:12,padding:"12px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8}}>
          <div style={{fontSize:12,fontWeight:600,color:"#1e40af",marginBottom:8}}>Registra follow-up</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
            <div><label style={labelStyle}>Data</label><input value={fuForm.data} onChange={e=>setFuForm(p=>({...p,data:e.target.value}))} style={inputStyle}/></div>
            <div><label style={labelStyle}>Tipo</label><select value={fuForm.tipo} onChange={e=>setFuForm(p=>({...p,tipo:e.target.value}))} style={inputStyle}>{TIPI_FOLLOWUP.map(t=><option key={t}>{t}</option>)}</select></div>
          </div>
          <div style={{marginBottom:8}}><label style={labelStyle}>Esito / Note</label><textarea value={fuForm.esito} onChange={e=>setFuForm(p=>({...p,esito:e.target.value}))} rows={2} style={{...inputStyle,resize:"vertical"}}/></div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={addFollowup} style={{padding:"6px 14px",border:"none",borderRadius:5,background:"#1e40af",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600}}>Salva follow-up</button>
            <button onClick={()=>setShowFollowupForm(false)} style={{padding:"6px 10px",border:"1px solid #e2e8f0",borderRadius:5,background:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:12}}>Annulla</button>
          </div>
        </div>
      )}

      {/* Sposta in cruscotto (se accettato) */}
      {prev.stato === "accepted" && !prev.spostatoInCruscotto && (
        <div style={{marginBottom:12,padding:"10px 14px",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:12,color:"#15803d",fontWeight:500}}>✅ Preventivo accettato — vuoi creare il paziente nel cruscotto clinico?</span>
          <button onClick={()=>onSpostaInCruscotto(prev)} style={{padding:"6px 14px",border:"none",borderRadius:5,background:"#10b981",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600}}>→ Apri nel cruscotto</button>
        </div>
      )}

      {/* Storico follow-up */}
      {(prev.followups||[]).length > 0 && (
        <div style={{marginBottom:14}}>
          <div style={{fontSize:10,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Storico follow-up</div>
          <div style={{background:"#fff",borderRadius:8,overflow:"hidden",boxShadow:"0 1px 3px rgba(0,0,0,0.06)"}}>
            {(prev.followups||[]).slice().reverse().map((f,i)=>(
              <div key={f.id||i} style={{padding:"8px 12px",borderBottom:"1px solid #f1f5f9",display:"flex",gap:10}}>
                <span style={{fontSize:9,color:"#94a3b8",fontFamily:"monospace",whiteSpace:"nowrap",minWidth:80}}>{f.data}</span>
                <div>
                  <div style={{fontSize:11,fontWeight:600,color:"#0f172a"}}>{f.tipo}</div>
                  <div style={{fontSize:11,color:"#64748b"}}>{f.esito}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Audit trail */}
      {(prev.auditLog||[]).length > 0 && (
        <div>
          <div style={{fontSize:10,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Audit trail</div>
          <div style={{background:"#fff",borderRadius:8,overflow:"hidden",boxShadow:"0 1px 3px rgba(0,0,0,0.06)"}}>
            {(prev.auditLog||[]).slice().reverse().map((e,i)=>(
              <div key={i} style={{padding:"7px 12px",borderBottom:"1px solid #f1f5f9",display:"flex",gap:10}}>
                <span style={{fontSize:9,color:"#94a3b8",fontFamily:"monospace",whiteSpace:"nowrap",minWidth:108}}>{e.ts}</span>
                <div>
                  <div style={{fontSize:11,fontWeight:600,color:"#0f172a"}}>{e.azione}</div>
                  <div style={{fontSize:10,color:"#64748b"}}>{e.statoPrec} → {e.statoNuovo}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Vista principale Preventivi ───────────────────────────────────────────────
function PreventiviView({ preventivi, onUpdate, onNew, onAccetta, onRifiuta, onSpostaInCruscotto }) {
  const [filtro, setFiltro] = useState("tutti");
  const [selPrev, setSelPrev] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editPrev, setEditPrev] = useState(null);

  const today = getToday();

  function applyFiltro(list) {
    const d = new Date(); d.setHours(0,0,0,0);
    return list.filter(p => {
      if (filtro === "tutti") return true;
      if (filtro === "attivi") return !["accepted","refused","expired"].includes(p.stato);
      if (filtro === "followup_oggi") {
        if (!p.prossimFollowup) return false;
        const fu = parseDMY(p.prossimFollowup);
        return fu && fu.toDateString() === d.toDateString();
      }
      if (filtro === "followup_scaduti") return p.stato === "followup_due";
      if (filtro === "expiring_soon") return p.stato === "expiring_soon";
      if (filtro === "expired") return p.stato === "expired";
      if (filtro === "accepted") return p.stato === "accepted";
      if (filtro === "refused") return p.stato === "refused";
      return true;
    });
  }

  const lista = applyFiltro(preventivi).sort((a,b) => {
    const ord = {followup_due:0, expiring_soon:1, waiting_response:2, pending_more_time:3, followup_scheduled:4, expired:5, accepted:6, refused:7};
    return (ord[a.stato]||99) - (ord[b.stato]||99);
  });

  // KPI
  const attivi = preventivi.filter(p=>!["accepted","refused"].includes(p.stato));
  const fuOggi = preventivi.filter(p=>{ if(!p.prossimFollowup) return false; const d2=new Date(); d2.setHours(0,0,0,0); const fu=parseDMY(p.prossimFollowup); return fu&&fu.toDateString()===d2.toDateString(); });
  const inScad = preventivi.filter(p=>p.stato==="expiring_soon");
  const scaduti = preventivi.filter(p=>p.stato==="expired");
  const accettati = preventivi.filter(p=>p.stato==="accepted");
  const tassoAcc = preventivi.filter(p=>["accepted","refused"].includes(p.stato)).length > 0
    ? Math.round(accettati.length / preventivi.filter(p=>["accepted","refused"].includes(p.stato)).length * 100) : 0;

  if (selPrev) {
    return (
      <React.Fragment>
        <div style={{background:"#fff",borderBottom:"1px solid #e2e8f0",padding:"10px 16px",display:"flex",alignItems:"center",gap:10}}>
          <button onClick={()=>setSelPrev(null)} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#3b82f6",fontFamily:"inherit",padding:0}}>← Preventivi</button>
          <span style={{color:"#94a3b8"}}>·</span>
          <span style={{fontSize:14,fontWeight:700,color:"#0f172a"}}>{selPrev.patientName}</span>
        </div>
        <div style={{overflowY:"auto",padding:16,flex:1}}>
          <PreventivoDettaglio
            prev={selPrev}
            onUpdate={upd => { onUpdate(upd); setSelPrev(upd); }}
            onClose={()=>setSelPrev(null)}
            onAccetta={(p,opz) => { onAccetta(p,opz); setSelPrev(null); }}
            onRifiuta={(p,motivo) => { onRifiuta(p,motivo); setSelPrev(null); }}
            onSpostaInCruscotto={p => { onSpostaInCruscotto(p); setSelPrev(null); }}
          />
        </div>
      </React.Fragment>
    );
  }

  return (
    <React.Fragment>
      <div style={{background:"#fff",borderBottom:"1px solid #e2e8f0",padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <h1 style={{margin:0,fontSize:15,fontWeight:700,color:"#0f172a"}}>📋 Preventivi in attesa</h1>
        <button onClick={()=>setShowForm(true)} style={{padding:"6px 14px",border:"none",borderRadius:6,background:"#1e40af",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit"}}>+ Nuovo preventivo</button>
      </div>

      <div style={{overflowY:"auto",padding:14,flex:1}}>

        {/* KPI */}
        <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
          {[
            ["In attesa",    attivi.length,      "#3b82f6"],
            ["Follow-up oggi", fuOggi.length,    fuOggi.length>0?"#f97316":"#10b981"],
            ["In scadenza",  inScad.length,      inScad.length>0?"#f97316":"#10b981"],
            ["Scaduti",      scaduti.length,     scaduti.length>0?"#ef4444":"#10b981"],
            ["Accettati",    accettati.length,   "#10b981"],
            ["Tasso acc.",   `${tassoAcc}%`,     tassoAcc>=60?"#10b981":tassoAcc>=30?"#f59e0b":"#ef4444"],
          ].map(([lab,val,c])=>(
            <div key={lab} style={{background:"#fff",borderRadius:8,padding:"10px 14px",boxShadow:"0 1px 3px rgba(0,0,0,0.06)",flex:1,minWidth:90}}>
              <div style={{fontSize:9,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>{lab}</div>
              <div style={{fontSize:18,fontWeight:700,color:c}}>{val}</div>
            </div>
          ))}
        </div>

        {/* Filtri */}
        <div style={{display:"flex",gap:4,marginBottom:12,flexWrap:"wrap"}}>
          {PREV_FILTRI.map(f=>(
            <button key={f.id} onClick={()=>setFiltro(f.id)} style={{padding:"4px 10px",border:"1px solid",borderRadius:16,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",background:filtro===f.id?"#1e40af":"#fff",color:filtro===f.id?"#fff":"#475569",borderColor:filtro===f.id?"#1e40af":"#e2e8f0"}}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Tabella */}
        <div style={{background:"#fff",borderRadius:9,overflow:"hidden",boxShadow:"0 1px 3px rgba(0,0,0,0.06)"}}>
          {lista.length === 0 ? (
            <div style={{padding:32,textAlign:"center",color:"#94a3b8",fontSize:12}}>Nessun preventivo per il filtro selezionato.</div>
          ) : (
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead>
                <tr style={{background:"#f8fafc"}}>
                  {["Stato","Paziente","Codice","Consegna","Scadenza","Gg","Prossimo FU","Importo","Operatore",""].map(h=>(
                    <th key={h} style={{padding:"7px 10px",textAlign:"left",fontSize:9,fontWeight:600,color:"#475569",textTransform:"uppercase",letterSpacing:"0.04em",borderBottom:"1px solid #e2e8f0"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lista.map((p,i) => {
                  const s = PREV_STATI[p.stato] || PREV_STATI.waiting_response;
                  const diff = daysDiff(p.dataScadenza);
                  const fuDiff = p.prossimFollowup ? daysDiff(p.prossimFollowup) : null;
                  return (
                    <tr key={p.id} style={{borderBottom:"1px solid #f1f5f9",background:i%2===0?"#fff":"#fafbfc",cursor:"pointer"}} onClick={()=>setSelPrev(p)}>
                      <td style={{padding:"8px 10px"}}>
                        <span style={{padding:"2px 7px",borderRadius:8,fontSize:10,fontWeight:600,background:s.bg,color:s.color,whiteSpace:"nowrap"}}>{s.icon} {s.label}</span>
                      </td>
                      <td style={{padding:"8px 10px"}}>
                        <div style={{fontSize:12,fontWeight:600,color:"#0f172a"}}>{p.patientName}</div>
                        <div style={{fontSize:9,color:"#94a3b8"}}>{p.clinician}</div>
                      </td>
                      <td style={{padding:"8px 10px",fontSize:11,color:"#64748b",fontFamily:"monospace"}}>{p.codice}</td>
                      <td style={{padding:"8px 10px",fontSize:11,color:"#475569"}}>{p.dataConsegna}</td>
                      <td style={{padding:"8px 10px",fontSize:11,color:diff!==null&&diff<=5?"#f97316":"#475569",fontWeight:diff!==null&&diff<=5?600:400}}>{p.dataScadenza}</td>
                      <td style={{padding:"8px 10px",fontSize:12,fontWeight:700,color:diff===null?"#94a3b8":diff<0?"#ef4444":diff<=5?"#f97316":"#0f172a"}}>
                        {diff===null?"—":diff<0?`-${Math.abs(diff)}`:`${diff}`}
                      </td>
                      <td style={{padding:"8px 10px",fontSize:11,color:fuDiff!==null&&fuDiff<=0?"#ef4444":"#475569",fontWeight:fuDiff!==null&&fuDiff===0?700:400}}>
                        {p.prossimFollowup ? (fuDiff===0?"OGGI":fuDiff<0?`${Math.abs(fuDiff)}gg fa`:p.prossimFollowup) : "—"}
                      </td>
                      <td style={{padding:"8px 10px",fontSize:12,fontWeight:600,color:"#0f172a"}}>€{p.importoTotale.toLocaleString()}</td>
                      <td style={{padding:"8px 10px",fontSize:10,color:"#64748b"}}>{p.operatoreAssegnato.split('@')[0]}</td>
                      <td style={{padding:"8px 10px",fontSize:11,color:"#3b82f6",fontWeight:600}}>→</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showForm && (
        <Modal title={editPrev?"Modifica preventivo":"Nuovo preventivo"} onClose={()=>{setShowForm(false);setEditPrev(null);}} wide>
          <PreventivoForm
            initial={editPrev}
            onSave={p => { onNew(p); setShowForm(false); setEditPrev(null); }}
            onClose={()=>{setShowForm(false);setEditPrev(null);}}
          />
        </Modal>
      )}
    </React.Fragment>
  );
}

function PrivacyBanner({ onAccept }) {
  return <div style={{ position:"fixed", inset:0, background:"rgba(15,23,42,0.92)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:999, padding:14 }}><div style={{ background:"#fff", borderRadius:10, maxWidth:520, width:"100%", overflow:"hidden", maxHeight:"88vh", overflowY:"auto" }}><div style={{ background:"#1e40af", padding:"14px 20px" }}><div style={{ fontSize:9, color:"#93c5fd", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:2 }}>Innova Clinique · Domodossola</div><div style={{ fontSize:14, color:"#fff", fontWeight:700 }}>Informativa trattamento dati personali</div><div style={{ fontSize:9, color:"#bfdbfe", marginTop:2 }}>Art. 13 GDPR 679/2016 · D.Lgs. 196/2003</div></div><div style={{ padding:"14px 20px", display:"flex", flexDirection:"column", gap:8 }}>{[["Titolare","Innova Clinique S.r.l. · Domodossola (VCO)"],["Finalità","Gestione clinica (Art.9 lett.h) · Contratto (Art.6 lett.b) · Obblighi legali (Art.6 lett.c) · Consenso (Art.6 lett.a)"],["Conservazione","Cartella clinica: 10 anni (D.Lgs.229/1999)"],["Diritti","Art.15 Accesso · Art.16 Rettifica · Art.17 Cancellazione* · Art.20 Portabilità · Art.21 Opposizione"]].map(([t,tx]) => <div key={t}><div style={{ fontSize:9, fontWeight:700, color:"#1e40af", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:1 }}>{t}</div><div style={{ fontSize:11, color:"#374151", lineHeight:1.5 }}>{tx}</div></div>)}</div><div style={{ padding:"12px 20px", borderTop:"1px solid #e2e8f0", background:"#f8fafc" }}><button onClick={onAccept} style={{ width:"100%", padding:"10px", background:"#1e40af", color:"#fff", border:"none", borderRadius:7, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>Ho letto e confermo — Accedi</button></div></div></div>;
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
// ─── LOGIN SCREEN ─────────────────────────────────────────────────────────────
// ─── UTENTI SISTEMA ───────────────────────────────────────────────────────────
const USERS = [
  { email:"stefanoromeggio@innovaclinique.it", password:"Innova2026!", ruolo:"Direttore Sanitario" },
  { email:"mara.micotti@innovaclinique.it",    password:"Innova2026!", ruolo:"CEO" },
  { email:"segreteria@innovaclinique.it",      password:"Innova2026!", ruolo:"Segreteria" },
];

function LoginScreen({ onLogin }) {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");

  function handleLogin(e) {
    e.preventDefault();
    const user = USERS.find(u => u.email === email.trim() && u.password === password);
    if (user) { onLogin({ email: user.email, ruolo: user.ruolo }); }
    else { setError("Email o password non corretti."); }
  }

  return (
    <div style={{ minHeight:"100vh", background:"#0f172a", display:"flex", alignItems:"center", justifyContent:"center", padding:16, fontFamily:"'DM Sans',system-ui,sans-serif" }}>
      <div style={{ width:"100%", maxWidth:400 }}>
        {/* Logo */}
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#60a5fa", letterSpacing:"0.15em", textTransform:"uppercase", marginBottom:6 }}>Innova Clinique</div>
          <div style={{ fontSize:24, fontWeight:700, color:"#f1f5f9" }}>Cruscotto 360°</div>
          <div style={{ fontSize:12, color:"#475569", marginTop:6 }}>Domodossola · Accesso riservato agli operatori</div>
        </div>

        {/* Card */}
        <div style={{ background:"#1e293b", borderRadius:12, padding:"28px 28px 24px", boxShadow:"0 24px 64px rgba(0,0,0,0.4)", border:"1px solid #334155" }}>
          <div style={{ fontSize:14, fontWeight:600, color:"#e2e8f0", marginBottom:20 }}>Accedi al sistema</div>

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom:14 }}>
              <label style={{ display:"block", fontSize:11, fontWeight:600, color:"#94a3b8", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:5 }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="nome@innovaclinique.it"
                autoFocus
                style={{ width:"100%", padding:"10px 12px", fontSize:13, background:"#0f172a", border:"1px solid #334155", borderRadius:7, color:"#f1f5f9", outline:"none", fontFamily:"inherit", boxSizing:"border-box" }}
                onFocus={e => e.target.style.borderColor="#3b82f6"}
                onBlur={e => e.target.style.borderColor="#334155"}
              />
            </div>

            <div style={{ marginBottom:20 }}>
              <label style={{ display:"block", fontSize:11, fontWeight:600, color:"#94a3b8", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:5 }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{ width:"100%", padding:"10px 12px", fontSize:13, background:"#0f172a", border:"1px solid #334155", borderRadius:7, color:"#f1f5f9", outline:"none", fontFamily:"inherit", boxSizing:"border-box" }}
                onFocus={e => e.target.style.borderColor="#3b82f6"}
                onBlur={e => e.target.style.borderColor="#334155"}
              />
            </div>

            {error && (
              <div style={{ background:"#fef2f2", border:"1px solid #fca5a5", borderRadius:6, padding:"8px 12px", fontSize:12, color:"#991b1b", marginBottom:14 }}>
                ⚠ {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!email.trim() || !password.trim()}
              style={{ width:"100%", padding:"11px", background:"#1e40af", color:"#fff", border:"none", borderRadius:7, fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}
            >
              Accedi
            </button>
          </form>
        </div>

        <div style={{ textAlign:"center", marginTop:16, fontSize:10, color:"#334155" }}>
          Art. 13 GDPR 679/2016 · Accesso tracciato · Dati sanitari categoria speciale Art. 9
        </div>
      </div>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function Root() {
  const [session, setSession] = useState(null);
  function handleLogin(user) { setSession(user); }
  function handleLogout() { setSession(null); }
  if (!session) return <LoginScreen onLogin={handleLogin}/>;
  return <App session={session} onLogout={handleLogout}/>;
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
function App({ session, onLogout }) {
  const [patients,   setPatients]   = useState([]);
  const [sel,        setSel]        = useState(null);
  const [view,       setView]       = useState("paziente");
  const [tab,        setTab]        = useState("timeline");
  const [aiText,     setAiText]     = useState({});
  const [aiLoading,  setAiLoading]  = useState(false);
  const [modal,      setModal]      = useState(null);
  const [editDisc,   setEditDisc]   = useState(null);
  const [stStatus,   setStStatus]   = useState("loading");
  const [showBanner, setShowBanner] = useState(false);
  const [chatOpen,   setChatOpen]   = useState(false);
  const [preventivi, setPreventivi] = useState([]);

  async function logout() { onLogout(); }
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("tutti");
  const [filterExtra, setFilterExtra] = useState("tutti"); // tutti | alert | gdpr | noappt

  useEffect(() => {
    (async () => {
      try {
        const b = storage.get(BANNER_KEY);
        if (!b) setShowBanner(true);
        const { data, error: sbError } = await dbGet();
        if (sbError) {
          console.error('DB load error:', sbError.message || sbError);
          setStStatus("error_sb");
        }
        if (data && data.data) {
          const d = data.data;
          setPatients(d);
          setSel(d.find(x => x.status === "rosso") || d[0] || null);
          console.log('Supabase OK — pazienti caricati:', d.length);
        } else if (!sbError) {
          setPatients(SEED);
          setSel(SEED.find(x => x.status === "rosso") || SEED[0]);
          const { error: upsertErr } = await dbUpsert({ id:'innova-clinique', data:SEED });
          if (upsertErr) console.error('DB upsert error:', upsertErr);
          else console.log('DB — seed inserito');
        }
      } catch (e) {
        console.error('Supabase exception:', e.message);
        const p = storage.get(STORAGE_KEY);
        if (p && p.value) {
          const d = JSON.parse(p.value);
          setPatients(d); setSel(d.find(x => x.status === "rosso") || d[0] || null);
        } else {
          setPatients(SEED); setSel(SEED.find(x => x.status === "rosso") || SEED[0]);
        }
      }
      // Load preventivi
      try {
        const pv = storage.get(PREV_STORAGE_KEY);
        if (pv && pv.value) {
          const d = aggiornaTuttiStati(JSON.parse(pv.value));
          setPreventivi(d);
        } else {
          const seed = aggiornaTuttiStati(PREV_SEED);
          setPreventivi(seed);
          storage.set(PREV_STORAGE_KEY, JSON.stringify(seed));
        }
      } catch (e) {
        setPreventivi(aggiornaTuttiStati(PREV_SEED));
      }
      setStStatus("idle");
    })();
  }, []);

  const persist = useCallback(async data => {
    setStStatus("saving");
    try {
      await dbUpsert({ id:'innova-clinique', data, updated_at: new Date().toISOString() });
      storage.set(STORAGE_KEY, JSON.stringify(data)); // backup locale
      setStStatus("saved");
      setTimeout(() => setStStatus("idle"), 2000);
    } catch (e) {
      storage.set(STORAGE_KEY, JSON.stringify(data));
      setStStatus("error");
    }
  }, []);

  const commit = useCallback((list, ns) => { setPatients(list); if (ns !== undefined) setSel(ns); persist(list); }, [persist]);
  const updateSel = useCallback(upd => { commit(patients.map(p => p.id === upd.id ? upd : p), upd); }, [patients, commit]);

  function persistPreventivi(list) {
    storage.set(PREV_STORAGE_KEY, JSON.stringify(list));
  }

  function savePrev(p) {
    const exists = preventivi.find(x=>x.id===p.id);
    let newList;
    if (exists) {
      newList = preventivi.map(x=>x.id===p.id?p:x);
    } else {
      const id = newPrevId(preventivi);
      newList = [...preventivi, {...p, id}];
    }
    const updated = aggiornaTuttiStati(newList);
    setPreventivi(updated);
    persistPreventivi(updated);
  }

  function accettaPrev(p, opzioneAccettata) {
    const updated = {
      ...p, stato:"accepted", opzioneAccettata,
      updatedAt:getToday(),
      tasks:(p.tasks||[]).map(t=>({...t,stato:"done"})),
      auditLog:[...(p.auditLog||[]), {ts:getTodayFull(), azione:"Preventivo accettato", statoPrec:p.stato, statoNuovo:"accepted", operatore:"Operatore"}],
    };
    const newList = preventivi.map(x=>x.id===p.id?updated:x);
    setPreventivi(newList);
    persistPreventivi(newList);
  }

  function rifiutaPrev(p, motivo) {
    const updated = {
      ...p, stato:"refused", motivoRifiuto:motivo,
      updatedAt:getToday(),
      tasks:(p.tasks||[]).map(t=>({...t,stato:"done"})),
      auditLog:[...(p.auditLog||[]), {ts:getTodayFull(), azione:"Preventivo rifiutato", statoPrec:p.stato, statoNuovo:"refused", operatore:"Operatore"}],
    };
    const newList = preventivi.map(x=>x.id===p.id?updated:x);
    setPreventivi(newList);
    persistPreventivi(newList);
  }

  function spostaInCruscotto(prev) {
    const nuovoPaz = {
      id: makeNewId(patients),
      name: prev.patientName,
      age: 0,
      phone: prev.patientPhone || "",
      acceptedDate: getToday(),
      clinician: prev.clinician,
      planValue: prev.importoTotale,
      invoiced: 0,
      status: "verde",
      tags: ["da-preventivo"],
      currentPhase: "Percorso in apertura",
      lastVisit: getToday(),
      nextVisit: "Non fissata",
      progress: 0,
      totalMonths: 12,
      disciplines: [],
      alerts: [],
      gdpr: defaultGdpr(getToday()),
      pagamenti: { voci:[{ id:Date.now(), descrizione:`Piano accettato: ${prev.opzioneAccettata||"Piano unico"}`, importo:prev.importoTotale, fase:"" }], pagamenti:[] },
      auditLog:[{ id:1, ts:getTodayFull(), azione:"Creato da preventivo", dettaglio:`Prev. ${prev.codice} — ${prev.patientName}`, operatore:"Segreteria" }],
    };
    const updatedPrev = {...prev, spostatoInCruscotto:true};
    const newPrevList = preventivi.map(x=>x.id===prev.id?updatedPrev:x);
    commit([...patients, nuovoPaz], nuovoPaz);
    setPreventivi(newPrevList);
    persistPreventivi(newPrevList);
    setView("paziente");
    setTab("timeline");
  }

  // Badge preventivi da fare oggi
  const prevBadge = preventivi.filter(p=>["followup_due","expiring_soon"].includes(p.stato)||
    (p.prossimFollowup&&daysDiff(p.prossimFollowup)===0)).length;

  function saveNewPatient(p)  { const id = makeNewId(patients); commit([...patients, {...p,id}], {...p,id}); setModal(null); }
  function saveEditPatient(p) { updateSel({...p, auditLog:[...(p.auditLog||[]), makeAuditEntry("Modifica dati","Aggiornato")]}); setModal(null); }
  function deletePatient()    { if (!window.confirm(`Eliminare ${sel.name}?`)) return; const r = patients.filter(p => p.id !== sel.id); commit(r, r[0]||null); setModal(null); }
  function saveNewDisc(d)     { const up={...sel,disciplines:[...(sel.disciplines||[]),d],auditLog:[...(sel.auditLog||[]),makeAuditEntry("Disciplina aggiunta",d.name)]}; up.status=calcStatus(up.disciplines,up.alerts); updateSel(up); setModal(null); }
  function saveEditDisc(d)    { const up={...sel,disciplines:(sel.disciplines||[]).map(x=>x.id===d.id?d:x),auditLog:[...(sel.auditLog||[]),makeAuditEntry("Disciplina modificata",d.name)]}; up.status=calcStatus(up.disciplines,up.alerts); updateSel(up); setModal(null); setEditDisc(null); }
  function deleteDisc(dId)    { const d=(sel.disciplines||[]).find(x=>x.id===dId); const up={...sel,disciplines:(sel.disciplines||[]).filter(x=>x.id!==dId),auditLog:[...(sel.auditLog||[]),makeAuditEntry("Disciplina eliminata",d?d.name:"")]}; up.status=calcStatus(up.disciplines,up.alerts); updateSel(up); }
  function saveNewAlert(a)    { const up={...sel,alerts:[...(sel.alerts||[]),a],auditLog:[...(sel.auditLog||[]),makeAuditEntry(`Alert ${a.level}`,a.text)]}; up.status=calcStatus(up.disciplines,up.alerts); updateSel(up); setModal(null); }
  function closeAlert(aId)    { const a=(sel.alerts||[]).find(x=>x.id===aId); const up={...sel,alerts:(sel.alerts||[]).map(x=>x.id===aId?{...x,open:false}:x),auditLog:[...(sel.auditLog||[]),makeAuditEntry("Alert chiuso",a?a.text:"")]}; up.status=calcStatus(up.disciplines,up.alerts); updateSel(up); }

  function resetStorage() {
    if (!window.confirm("Ripristinare dati demo?")) return;
    storage.delete(STORAGE_KEY);
    commit(SEED, SEED.find(x => x.status === "rosso") || SEED[0]);
    setAiText({});
  }

  async function runAI(patient) {
    const p = patient || sel; setTab("analisi"); if (aiText[p.id]) return; setAiLoading(true);
    const sum = `Paziente: ${p.name}, ${p.age}a\nFase: ${p.currentPhase}\nDisc: ${(p.disciplines||[]).map(d=>`${d.name}[${d.status}] ${d.sessions}`).join(', ')}\nAlert: ${(p.alerts||[]).filter(a=>a.open).map(a=>`[${a.level}] ${a.text}`).join(' | ')||'nessuno'}`;
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method:"POST", headers:{"Content-Type":"application/json","anthropic-dangerous-direct-browser-access":"true"}, body:JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:700, system:"Consulente operativo odontoiatrico (Innova Clinique, Domodossola). 4 sezioni bold:\n**Stato generale:**\n**Rischi 4 settimane:**\n**Azioni segreteria:**\n**Segnali lungo termine:**\nBullet '- '. Italiano. Max 220 parole.", messages:[{role:"user",content:sum}] }) });
      const data = await r.json();
      const txt = data.content ? data.content.filter(b=>b.type==="text").map(b=>b.text).join("") : "Errore.";
      setAiText(prev => ({ ...prev, [p.id]:txt }));
    } catch (e) { setAiText(prev => ({ ...prev, [p.id]:"Errore connessione." })); }
    setAiLoading(false);
  }

  function renderAI(text) {
    return text.split('\n').map((l, i) => {
      if (/^\*\*(.+)\*\*$/.test(l)) return <div key={i} style={{ fontWeight:700, color:"#0f172a", marginTop:i>0?10:0, marginBottom:2, fontSize:12 }}>{l.replace(/\*\*/g,"")}</div>;
      if (l.startsWith("- ") || l.startsWith("• ")) return <div key={i} style={{ display:"flex", gap:6, marginBottom:3, paddingLeft:2 }}><span style={{ color:"#3b82f6", flexShrink:0, fontWeight:700 }}>›</span><span style={{ color:"#334155", fontSize:12 }}>{l.substring(2)}</span></div>;
      if (!l.trim()) return <div key={i} style={{ height:3 }}/>;
      return <div key={i} style={{ color:"#334155", marginBottom:2, fontSize:12 }}>{l}</div>;
    });
  }

  if (stStatus === "loading") return <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", background:"#0f172a", flexDirection:"column", gap:12 }}><div style={{ width:22, height:22, border:"2px solid #1e293b", borderTopColor:"#60a5fa", borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/><span style={{ color:"#475569", fontSize:12, fontFamily:"system-ui" }}>Caricamento…</span><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>;

  const openAlerts = (sel ? sel.alerts||[] : []).filter(a => a.open);
  const redAlerts  = openAlerts.filter(a => a.level === "rosso").length;
  const totalRed   = patients.reduce((s,p) => s + (p.alerts||[]).filter(a=>a.open&&a.level==="rosso").length, 0);
  const critPts    = patients.filter(p => p.status === "rosso").length;
  const missCons   = patients.filter(p => !p.gdpr||!p.gdpr.consensoSanitario||!p.gdpr.consensoSanitario.granted).length;
  const gdprBadge  = sel && (!sel.gdpr||!sel.gdpr.consensoSanitario||!sel.gdpr.consensoSanitario.granted);
  const stLabel    = stStatus==="saving"?"Salvataggio…":stStatus==="saved"?"Salvato ✓":stStatus==="error"?"Errore":"";
  const stColor    = stStatus==="saved"?"#10b981":stStatus==="error"?"#ef4444":"#475569";

  function ChatBtn({ label }) {
    return <button onClick={() => setChatOpen(o => !o)} style={{ padding:"5px 10px", border:"1px solid", borderRadius:6, cursor:"pointer", fontSize:11, fontWeight:600, fontFamily:"inherit", background:chatOpen?"#7c3aed":"#fff", color:chatOpen?"#fff":"#7c3aed", borderColor:"#7c3aed", display:"inline-flex", alignItems:"center", gap:4 }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>{chatOpen?"Chiudi":(label||"Assistente")}</button>;
  }

  return (
    <div style={{ display:"flex", flexDirection:"row", fontFamily:"'DM Sans',system-ui,sans-serif", background:"#0f172a", minHeight:"100vh" }}>
      {showBanner && <PrivacyBanner onAccept={() => { setShowBanner(false); storage.set(BANNER_KEY, "accepted"); }}/>}

      {/* SIDEBAR */}
      <div style={{ width:222, background:"#0f172a", borderRight:"1px solid #1e293b", flexShrink:0, display:"flex", flexDirection:"column", minHeight:"100vh" }}>
        <div style={{ padding:"13px 13px 8px", borderBottom:"1px solid #1e293b" }}>
          <div style={{ fontSize:10, fontWeight:700, color:"#60a5fa", letterSpacing:"0.1em", textTransform:"uppercase" }}>Innova Clinique</div>
          <div style={{ fontSize:11, fontWeight:600, color:"#e2e8f0", marginTop:1 }}>Cruscotto 360°</div>
          <div style={{ marginTop:3, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ fontSize:9, color:stColor }}>{stLabel}</span>
            <div style={{ display:"flex", gap:6, alignItems:"center" }}>
              <span style={{ fontSize:8, color:"#475569", maxWidth:80, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{session.email}</span>
              <button onClick={logout} title="Esci" style={{ background:"none", border:"none", fontSize:9, color:"#ef4444", cursor:"pointer", fontFamily:"inherit", padding:0 }}>⏻</button>
              <button onClick={resetStorage} style={{ background:"none", border:"none", fontSize:8, color:"#334155", cursor:"pointer", fontFamily:"inherit", padding:0 }}>reset</button>
            </div>
          </div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", borderBottom:"1px solid #1e293b" }}>
          {[{l:"Attivi",v:patients.length,c:"#e2e8f0"},{l:"🔴",v:critPts,c:"#ef4444"},{l:"Alert",v:totalRed,c:"#f59e0b"},{l:"GDPR",v:missCons,c:missCons>0?"#ef4444":"#10b981"}].map(s => <div key={s.l} style={{ padding:"7px 0", textAlign:"center", borderRight:"1px solid #1e293b" }}><div style={{ fontSize:13, fontWeight:700, color:s.c }}>{s.v}</div><div style={{ fontSize:7, color:"#475569", textTransform:"uppercase", letterSpacing:"0.04em" }}>{s.l}</div></div>)}
        </div>
        <div style={{ padding:"6px 8px", borderBottom:"1px solid #1e293b", display:"flex", flexDirection:"column", gap:4 }}>
          {[["📊","Panoramica","panoramica"],["📈","Business Monitor","business"],["📋","Preventivi","preventivi"],["🔒","GDPR","gdpr-view"]].map(([ic,lab,vid]) => <button key={lab} onClick={() => setView(vid)} style={{ width:"100%", padding:"5px 8px", background:view===vid?"#0f4c81":"#1e293b", color:view===vid?"#93c5fd":"#94a3b8", border:"none", borderRadius:5, fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit", textAlign:"left", display:"flex", gap:5, alignItems:"center" }}><span style={{ fontSize:12 }}>{ic}</span>{lab}{vid==="preventivi"&&prevBadge>0&&<span style={{marginLeft:"auto",background:"#f97316",color:"#fff",borderRadius:8,fontSize:8,fontWeight:700,padding:"0 5px"}}>{prevBadge}</span>}</button>)}
          <button onClick={() => setModal("new-patient")} style={{ width:"100%", padding:"5px", background:"#1e40af", color:"#fff", border:"none", borderRadius:5, fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>+ Nuovo paziente</button>
          <button onClick={() => setChatOpen(o => !o)} style={{ width:"100%", padding:"5px 8px", background:chatOpen?"#7c3aed":"#1e293b", color:chatOpen?"#fff":"#94a3b8", border:`1px solid ${chatOpen?"#7c3aed":"#334155"}`, borderRadius:5, fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit", textAlign:"left", display:"flex", gap:5, alignItems:"center" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            {chatOpen?"✕ Chiudi assistente":"💬 Assistente AI"}
          </button>
        </div>
        <div style={{ overflowY:"auto", flex:1 }}>
          {/* SEARCH */}
          <div style={{ padding:"6px 8px 4px", borderBottom:"1px solid #1e293b" }}>
            <div style={{ position:"relative" }}>
              <svg style={{ position:"absolute", left:7, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Cerca paziente, clinico, tag…"
                style={{ width:"100%", padding:"5px 22px 5px 22px", fontSize:10, background:"#1e293b", border:"1px solid #334155", borderRadius:5, color:"#e2e8f0", outline:"none", fontFamily:"inherit", boxSizing:"border-box" }}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} style={{ position:"absolute", right:6, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:"#475569", cursor:"pointer", fontSize:12, lineHeight:1, padding:0 }}>✕</button>
              )}
            </div>
          </div>

          {/* FILTERS */}
          <div style={{ padding:"4px 8px", borderBottom:"1px solid #1e293b", display:"flex", flexDirection:"column", gap:3 }}>
            <div style={{ display:"flex", gap:2 }}>
              {[["tutti","Tutti"],["rosso","🔴"],["arancio","🟠"],["verde","🟢"]].map(([val, lab]) => (
                <button key={val} onClick={() => setFilterStatus(val)}
                  style={{ flex:1, padding:"3px 2px", fontSize:9, fontWeight:600, fontFamily:"inherit", cursor:"pointer", borderRadius:4, border:"none",
                    background: filterStatus===val ? (val==="rosso"?"#ef4444":val==="arancio"?"#f59e0b":val==="verde"?"#10b981":"#3b82f6") : "#1e293b",
                    color: filterStatus===val ? "#fff" : "#64748b" }}>
                  {lab}
                </button>
              ))}
            </div>
            <div style={{ display:"flex", gap:2 }}>
              {[["tutti","Tutti"],["alert","🔔 Alert"],["gdpr","⚠ GDPR"],["noappt","📅 No appt"]].map(([val, lab]) => (
                <button key={val} onClick={() => setFilterExtra(val)}
                  style={{ flex:1, padding:"3px 2px", fontSize:9, fontWeight:600, fontFamily:"inherit", cursor:"pointer", borderRadius:4, border:"none",
                    background: filterExtra===val ? "#7c3aed" : "#1e293b",
                    color: filterExtra===val ? "#fff" : "#64748b" }}>
                  {lab}
                </button>
              ))}
            </div>
          </div>

          {/* PATIENT LIST — filtered */}
          <div style={{ padding:"4px 12px 3px", fontSize:8, color:"#334155", textTransform:"uppercase", letterSpacing:"0.1em", fontWeight:600, display:"flex", justifyContent:"space-between" }}>
            <span>Pazienti</span>
            <span style={{ color:"#475569" }}>
              {patients.filter(p => {
                const q = searchQuery.toLowerCase();
                const matchQ = !q || p.name.toLowerCase().includes(q) || p.clinician.toLowerCase().includes(q) || (p.tags||[]).some(t => t.toLowerCase().includes(q)) || p.currentPhase.toLowerCase().includes(q);
                const matchS = filterStatus==="tutti" || p.status===filterStatus;
                const matchE = filterExtra==="tutti" || (filterExtra==="alert" && (p.alerts||[]).some(a=>a.open)) || (filterExtra==="gdpr" && (!p.gdpr||!p.gdpr.consensoSanitario||!p.gdpr.consensoSanitario.granted)) || (filterExtra==="noappt" && p.nextVisit==="Non fissata");
                return matchQ && matchS && matchE;
              }).length}/{patients.length}
            </span>
          </div>
          {patients.filter(p => {
            const q = searchQuery.toLowerCase();
            const matchQ = !q || p.name.toLowerCase().includes(q) || p.clinician.toLowerCase().includes(q) || (p.tags||[]).some(t => t.toLowerCase().includes(q)) || p.currentPhase.toLowerCase().includes(q);
            const matchS = filterStatus==="tutti" || p.status===filterStatus;
            const matchE = filterExtra==="tutti" || (filterExtra==="alert" && (p.alerts||[]).some(a=>a.open)) || (filterExtra==="gdpr" && (!p.gdpr||!p.gdpr.consensoSanitario||!p.gdpr.consensoSanitario.granted)) || (filterExtra==="noappt" && p.nextVisit==="Non fissata");
            return matchQ && matchS && matchE;
          }).map(p => {
            const s = SEM[p.status]; const isSel = sel&&sel.id===p.id&&view==="paziente"; const n=(p.alerts||[]).filter(a=>a.open).length; const noG=!p.gdpr||!p.gdpr.consensoSanitario||!p.gdpr.consensoSanitario.granted;
            return <div key={p.id} onClick={() => { setSel(p); setView("paziente"); setTab("timeline"); }} style={{ padding:"8px 12px", cursor:"pointer", background:isSel?"#1e293b":"transparent", borderLeft:`3px solid ${isSel?s.color:"transparent"}` }}><div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}><span style={{ fontSize:11, fontWeight:isSel?600:400, color:isSel?"#f1f5f9":"#94a3b8" }}>{p.name}</span><div style={{ display:"flex", alignItems:"center", gap:3 }}>{noG&&<span style={{ fontSize:7, color:"#ef4444", fontWeight:700 }}>GDPR</span>}{n>0&&<div style={{ background:p.status==="rosso"?"#ef4444":"#f59e0b", color:"#fff", borderRadius:7, fontSize:8, fontWeight:700, padding:"0 4px" }}>{n}</div>}<div style={{ width:6, height:6, borderRadius:"50%", background:s.color }}/></div></div><div style={{ fontSize:9, color:"#475569", marginTop:1 }}>{p.currentPhase.length>27?p.currentPhase.slice(0,27)+"…":p.currentPhase}</div></div>;
          })}
          {patients.filter(p => {
            const q = searchQuery.toLowerCase();
            const matchQ = !q || p.name.toLowerCase().includes(q) || p.clinician.toLowerCase().includes(q) || (p.tags||[]).some(t => t.toLowerCase().includes(q)) || p.currentPhase.toLowerCase().includes(q);
            const matchS = filterStatus==="tutti" || p.status===filterStatus;
            const matchE = filterExtra==="tutti" || (filterExtra==="alert" && (p.alerts||[]).some(a=>a.open)) || (filterExtra==="gdpr" && (!p.gdpr||!p.gdpr.consensoSanitario||!p.gdpr.consensoSanitario.granted)) || (filterExtra==="noappt" && p.nextVisit==="Non fissata");
            return matchQ && matchS && matchE;
          }).length === 0 && (
            <div style={{ padding:"16px 12px", textAlign:"center", color:"#334155", fontSize:11 }}>
              Nessun paziente trovato
              <br/>
              <button onClick={() => { setSearchQuery(""); setFilterStatus("tutti"); setFilterExtra("tutti"); }} style={{ marginTop:6, background:"none", border:"none", color:"#3b82f6", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>
                Reimposta filtri
              </button>
            </div>
          )}
        </div>
      </div>

      {/* CENTER */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", background:"#f8fafc", minWidth:0 }}>

        {view==="panoramica" && <React.Fragment>
          <div style={{ background:"#fff", borderBottom:"1px solid #e2e8f0", padding:"10px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}><h1 style={{ margin:0, fontSize:15, fontWeight:700, color:"#0f172a" }}>Panoramica</h1><ChatBtn/></div>
          <div style={{ overflowY:"auto", padding:14, flex:1 }}>
            <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap" }}>
              {[["Attivi",patients.length,"#0f172a"],["Critici",critPts,critPts>0?"#ef4444":"#10b981"],["Alert 🔴",totalRed,totalRed>0?"#ef4444":"#10b981"],["Residuo €",`${((patients.reduce((s,p)=>s+p.planValue,0)-patients.reduce((s,p)=>s+p.invoiced,0))/1000).toFixed(0)}k`,"#0f172a"]].map(([lab,val,c]) => <div key={lab} style={{ background:"#fff", borderRadius:8, padding:"10px 14px", boxShadow:"0 1px 3px rgba(0,0,0,0.06)", flex:1 }}><div style={{ fontSize:9, color:"#94a3b8", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:2 }}>{lab}</div><div style={{ fontSize:17, fontWeight:700, color:c }}>{val}</div></div>)}
            </div>
            <div style={{ background:"#fff", borderRadius:9, overflow:"hidden", boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}><thead><tr style={{ background:"#f8fafc" }}>{["Stato","Paziente","Fase","Alert","Residuo","Prossimo",""].map(h => <th key={h} style={{ padding:"7px 10px", textAlign:"left", fontSize:9, fontWeight:600, color:"#475569", textTransform:"uppercase", letterSpacing:"0.04em", borderBottom:"1px solid #e2e8f0" }}>{h}</th>)}</tr></thead>
              <tbody>{patients.slice().sort((a,b)=>({rosso:0,arancio:1,verde:2})[a.status]-({rosso:0,arancio:1,verde:2})[b.status]).map((p,i) => { const s=SEM[p.status]; const oA=(p.alerts||[]).filter(a=>a.open); const rA=oA.filter(a=>a.level==="rosso").length; return <tr key={p.id} style={{ borderBottom:"1px solid #f1f5f9", background:i%2===0?"#fff":"#fafbfc", cursor:"pointer" }} onClick={() => { setSel(p); setView("paziente"); setTab("timeline"); }}><td style={{ padding:"8px 10px" }}><div style={{ display:"flex", alignItems:"center", gap:4 }}><div style={{ width:7, height:7, borderRadius:"50%", background:s.color }}/><span style={{ fontSize:10, fontWeight:600, color:s.color }}>{s.label}</span></div></td><td style={{ padding:"8px 10px", fontSize:12, fontWeight:600, color:"#0f172a" }}>{p.name}</td><td style={{ padding:"8px 10px", fontSize:11, color:"#475569", maxWidth:110 }}><div style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.currentPhase}</div></td><td style={{ padding:"8px 10px" }}>{rA>0?<span style={{ padding:"1px 5px", borderRadius:5, fontSize:10, fontWeight:700, background:"#fee2e2", color:"#ef4444" }}>🔴{rA}</span>:oA.length>0?<span style={{ fontSize:10, color:"#f59e0b" }}>🟠{oA.length}</span>:<span style={{ fontSize:10, color:"#10b981" }}>✓</span>}</td><td style={{ padding:"8px 10px", fontSize:11, fontWeight:600, color:(p.planValue-p.invoiced)>5000?"#dc2626":"#0f172a" }}>€{(p.planValue-p.invoiced).toLocaleString()}</td><td style={{ padding:"8px 10px", fontSize:11, color:p.nextVisit==="Non fissata"?"#ef4444":"#0f172a" }}>{p.nextVisit==="Non fissata"?"⚠ —":p.nextVisit||"—"}</td><td style={{ padding:"8px 10px", fontSize:11, color:"#3b82f6", fontWeight:600 }}>→</td></tr>; })}</tbody>
              </table>
            </div>
          </div>
        </React.Fragment>}

        {view==="business" && <React.Fragment>
          <div style={{ background:"#fff", borderBottom:"1px solid #e2e8f0", padding:"10px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <h1 style={{ margin:0, fontSize:15, fontWeight:700, color:"#0f172a" }}>📈 Business Monitor</h1>
            <ChatBtn/>
          </div>
          <div style={{ overflowY:"auto", padding:14, flex:1 }}>
            <BusinessMonitor patients={patients} onSelectPatient={(p) => { setSel(p); setView("paziente"); setTab("timeline"); }}/>
          </div>
        </React.Fragment>}

        {view==="preventivi" && (
          <PreventiviView
            preventivi={preventivi}
            onUpdate={upd => { const nl=preventivi.map(x=>x.id===upd.id?upd:x); setPreventivi(nl); persistPreventivi(nl); }}
            onNew={savePrev}
            onAccetta={accettaPrev}
            onRifiuta={rifiutaPrev}
            onSpostaInCruscotto={spostaInCruscotto}
          />
        )}

        {view==="gdpr-view" && <React.Fragment>
          <div style={{ background:"#fff", borderBottom:"1px solid #e2e8f0", padding:"10px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}><h1 style={{ margin:0, fontSize:15, fontWeight:700, color:"#0f172a" }}>Compliance GDPR</h1><ChatBtn/></div>
          <div style={{ overflowY:"auto", padding:14, flex:1 }}>
            {missCons>0&&<div style={{ background:"#fef2f2", border:"1px solid #fca5a5", borderRadius:7, padding:"8px 12px", marginBottom:12, fontSize:11, color:"#991b1b" }}><b>⚠ {missCons} paziente/i senza consenso sanitario</b> — {patients.filter(p=>!p.gdpr||!p.gdpr.consensoSanitario||!p.gdpr.consensoSanitario.granted).map(p=>p.name).join(", ")}.</div>}
            <div style={{ background:"#fff", borderRadius:9, overflow:"hidden", boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}><thead><tr style={{ background:"#f8fafc" }}>{["Paziente","San","WA","Mkt","Terzi","Scadenza",""].map(h => <th key={h} style={{ padding:"7px 10px", textAlign:"left", fontSize:9, fontWeight:600, color:"#475569", textTransform:"uppercase", borderBottom:"1px solid #e2e8f0" }}>{h}</th>)}</tr></thead>
              <tbody>{patients.map((p,i) => { const g=p.gdpr||{}; return <tr key={p.id} onClick={() => { setSel(p); setView("paziente"); setTab("gdpr"); }} style={{ borderBottom:"1px solid #f1f5f9", background:(!g.consensoSanitario||!g.consensoSanitario.granted)?"#fef9f9":i%2===0?"#fff":"#fafbfc", cursor:"pointer" }}><td style={{ padding:"8px 10px", fontSize:12, fontWeight:600, color:"#0f172a" }}>{p.name}</td>{["consensoSanitario","consensoWhatsApp","consensoMarketing","consensoTerzi"].map(k => <td key={k} style={{ padding:"8px 10px", textAlign:"center" }}><span style={{ color:g[k]&&g[k].granted?"#10b981":"#ef4444", fontSize:13 }}>{g[k]&&g[k].granted?"✓":"✗"}</span></td>)}<td style={{ padding:"8px 10px", fontSize:10, color:"#f59e0b" }}>{g.scadenzaRetenzione||"—"}</td><td style={{ padding:"8px 10px", fontSize:10, color:"#3b82f6", fontWeight:600 }}>→</td></tr>; })}</tbody>
              </table>
            </div>
          </div>
        </React.Fragment>}

        {view==="paziente" && sel && <React.Fragment>
          <div style={{ background:"#fff", borderBottom:"1px solid #e2e8f0", padding:"10px 16px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                  <h1 style={{ margin:0, fontSize:15, fontWeight:700, color:"#0f172a" }}>{sel.name}</h1>
                  <span style={{ padding:"2px 8px", borderRadius:14, fontSize:10, fontWeight:700, background:SEM[sel.status].bg, color:SEM[sel.status].color }}>{SEM[sel.status].label}</span>
                  {gdprBadge?<span style={{ padding:"2px 6px", borderRadius:10, fontSize:9, fontWeight:700, background:"#fee2e2", color:"#dc2626" }}>⚠ GDPR</span>:<span style={{ padding:"2px 6px", borderRadius:10, fontSize:9, fontWeight:600, background:"#d1fae5", color:"#065f46" }}>✓ GDPR</span>}
                  {(sel.tags||[]).map(t => <span key={t} style={{ padding:"1px 5px", borderRadius:7, fontSize:9, background:"#f1f5f9", color:"#64748b" }}>{t}</span>)}
                </div>
                <div style={{ marginTop:3, fontSize:11, color:"#64748b", display:"flex", gap:10, flexWrap:"wrap" }}>
                  <span>{sel.age}a · {sel.clinician}</span>
                  <span>Piano: <b style={{ color:"#0f172a" }}>€{sel.planValue.toLocaleString()}</b></span>
                  <span>Fatturato: <b style={{ color:"#10b981" }}>€{sel.invoiced.toLocaleString()}</b></span>
                  <span>Residuo: <b style={{ color:"#f59e0b" }}>€{(sel.planValue-sel.invoiced).toLocaleString()}</b></span>
                </div>
              </div>
              <div style={{ display:"flex", gap:5, flexShrink:0, alignItems:"center" }}>
                <ChatBtn/>
                <button onClick={() => setModal("edit-patient")} style={{ padding:"5px 9px", border:"1px solid #e2e8f0", borderRadius:5, background:"#fff", cursor:"pointer", fontSize:11, fontFamily:"inherit", color:"#374151" }}>✏</button>
                <button onClick={() => runAI(sel)} style={{ background:"#1e40af", color:"#fff", border:"none", borderRadius:5, padding:"5px 9px", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>✦ AI</button>
              </div>
            </div>
            <div style={{ marginTop:7 }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, color:"#94a3b8", marginBottom:2 }}><span>{sel.currentPhase}</span><span>{sel.progress}% · {sel.totalMonths}m · ultima:{sel.lastVisit||"—"} · prossima:<span style={{ color:sel.nextVisit==="Non fissata"?"#ef4444":"inherit" }}> {sel.nextVisit||"—"}</span></span></div>
              <div style={{ height:3, background:"#e2e8f0", borderRadius:2 }}><div style={{ height:"100%", width:`${sel.progress}%`, background:SEM[sel.status].color, borderRadius:2 }}/></div>
            </div>
          </div>
          {redAlerts>0&&<div style={{ background:"#fef2f2", borderBottom:"1px solid #fca5a5", padding:"5px 16px", display:"flex", alignItems:"center", gap:6 }}><span style={{ color:"#ef4444" }}>⚠</span><span style={{ fontSize:11, color:"#991b1b" }}><b>{redAlerts} alert rossi</b> — entro 24h</span></div>}
          <div style={{ background:"#fff", borderBottom:"1px solid #e2e8f0", padding:"0 16px", display:"flex", overflowX:"auto" }}>
            {[{id:"timeline",label:"📅 Timeline"},{id:"discipline",label:"Discipline"},{id:"alert",label:`Alert${openAlerts.length>0?` (${openAlerts.length})`:""}`},{id:"pagamenti",label:"💰 Pagamenti"},{id:"analisi",label:"✦ AI"},{id:"gdpr",label:`🔒${gdprBadge?" ⚠":""}`}].map(t => <button key={t.id} onClick={() => { setTab(t.id); if(t.id==="analisi") runAI(sel); }} style={{ padding:"8px 12px", border:"none", borderBottom:tab===t.id?"2px solid #3b82f6":"2px solid transparent", background:"none", color:tab===t.id?"#1e40af":(t.id==="gdpr"&&gdprBadge)?"#ef4444":"#64748b", fontWeight:tab===t.id?600:400, fontSize:11, cursor:"pointer", marginBottom:-1, fontFamily:"inherit", whiteSpace:"nowrap" }}>{t.label}</button>)}
          </div>
          <div style={{ overflowY:"auto", padding:tab==="timeline"?"12px":"16px", flex:1 }}>
            {tab==="timeline" && <Timeline patient={sel}/>}
            {tab==="discipline" && <div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}><span style={{ fontSize:11, color:"#64748b" }}>{(sel.disciplines||[]).length} discipline</span><button onClick={() => setModal("new-disc")} style={{ padding:"5px 10px", border:"1px solid #bfdbfe", borderRadius:5, background:"#eff6ff", color:"#1e40af", cursor:"pointer", fontSize:11, fontWeight:600, fontFamily:"inherit" }}>+ Aggiungi</button></div>
              <div style={{ background:"#fff", borderRadius:8, overflow:"hidden", boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}>
                {(sel.disciplines||[]).length===0?<div style={{ padding:28, textAlign:"center", color:"#94a3b8", fontSize:11 }}>Nessuna disciplina.</div>:
                <table style={{ width:"100%", borderCollapse:"collapse" }}><thead><tr style={{ background:"#f8fafc" }}>{["","Disciplina","Stato","Inizio","Fine","Sedute","Note",""].map(h => <th key={h} style={{ padding:"7px 10px", textAlign:"left", fontSize:9, fontWeight:600, color:"#475569", textTransform:"uppercase", borderBottom:"1px solid #e2e8f0" }}>{h}</th>)}</tr></thead>
                <tbody>{(sel.disciplines||[]).map((d,i) => { const sc=DISC_STATUS[d.status]||DISC_STATUS["non-iniziata"]; const col=timelineColor(d,new Date()); return <tr key={d.id} style={{ borderBottom:"1px solid #f1f5f9", background:i%2===0?"#fff":"#fafbfc" }}><td style={{ padding:"8px 10px" }}><div style={{ width:8, height:8, borderRadius:2, background:col.bar }}/></td><td style={{ padding:"8px 10px", fontSize:11, fontWeight:600, color:"#0f172a" }}>{d.name}</td><td style={{ padding:"8px 10px" }}><span style={{ padding:"2px 7px", borderRadius:8, fontSize:10, fontWeight:600, background:sc.bg, color:sc.text, display:"inline-flex", alignItems:"center", gap:3 }}><span style={{ width:5, height:5, borderRadius:"50%", background:sc.dot, display:"inline-block" }}/>{sc.label}</span></td><td style={{ padding:"8px 10px", fontSize:11, color:"#475569" }}>{d.start||"—"}</td><td style={{ padding:"8px 10px", fontSize:11, color:"#475569" }}>{d.end||"—"}</td><td style={{ padding:"8px 10px", fontSize:11, color:"#475569", fontFamily:"monospace" }}>{d.sessions||"—"}</td><td style={{ padding:"8px 10px", fontSize:11, color:(d.notes||"").includes("⚠")?"#ef4444":"#64748b", maxWidth:140 }}>{d.notes||"—"}</td><td style={{ padding:"8px 10px", whiteSpace:"nowrap" }}><button onClick={() => { setEditDisc(d); setModal("edit-disc"); }} style={{ background:"none", border:"none", cursor:"pointer", fontSize:11, color:"#94a3b8", padding:"2px 4px" }}>✏</button><button onClick={() => { if (window.confirm("Eliminare?")) deleteDisc(d.id); }} style={{ background:"none", border:"none", cursor:"pointer", fontSize:11, color:"#fca5a5", padding:"2px 4px" }}>✕</button></td></tr>; })}</tbody>
                </table>}
              </div>
            </div>}
            {tab==="alert" && <div style={{ maxWidth:620 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}><span style={{ fontSize:11, color:"#64748b" }}>{openAlerts.length} alert aperti</span><button onClick={() => setModal("new-alert")} style={{ padding:"5px 10px", border:"1px solid #fca5a5", borderRadius:5, background:"#fef2f2", color:"#dc2626", cursor:"pointer", fontSize:11, fontWeight:600, fontFamily:"inherit" }}>+ Aggiungi</button></div>
              {openAlerts.length===0&&<div style={{ padding:28, textAlign:"center", color:"#10b981", fontSize:12, background:"#fff", borderRadius:8 }}>✓ Nessun alert aperto</div>}
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>{openAlerts.map(a => { const al=AL[a.level]; return <div key={a.id} style={{ background:al.bg, border:`1px solid ${al.border}`, borderRadius:7, padding:"10px 13px", display:"flex", justifyContent:"space-between", alignItems:"center", gap:10 }}><div style={{ flex:1 }}><div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3 }}><span style={{ width:7, height:7, borderRadius:"50%", background:al.color, display:"inline-block" }}/><span style={{ fontSize:10, fontWeight:700, color:al.color, textTransform:"uppercase" }}>{a.level}</span><span style={{ fontSize:10, color:"#64748b" }}>Scad: {a.due}</span></div><div style={{ fontSize:12, color:"#0f172a", fontWeight:500 }}>{a.text}</div></div><button onClick={() => closeAlert(a.id)} style={{ background:"none", border:`1px solid ${al.border}`, borderRadius:5, padding:"4px 8px", fontSize:10, cursor:"pointer", color:al.color, fontWeight:600, whiteSpace:"nowrap", fontFamily:"inherit" }}>Gestito ✓</button></div>; })}</div>
              {(sel.alerts||[]).filter(a=>!a.open).length>0&&<div style={{ marginTop:10 }}><div style={{ fontSize:10, color:"#94a3b8", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:5 }}>Risolti</div>{(sel.alerts||[]).filter(a=>!a.open).map(a => <div key={a.id} style={{ padding:"5px 10px", background:"#f8fafc", borderRadius:5, marginBottom:3, fontSize:11, color:"#94a3b8", textDecoration:"line-through" }}>{a.text}</div>)}</div>}
            </div>}
            {tab==="analisi" && <div style={{ maxWidth:580 }}>
              {aiLoading&&<div style={{ display:"flex", alignItems:"center", gap:10, padding:24, color:"#3b82f6" }}><div style={{ width:16, height:16, border:"2px solid #bfdbfe", borderTopColor:"#3b82f6", borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/><span style={{ fontSize:12 }}>Analisi in corso…</span></div>}
              {!aiLoading&&aiText[sel.id]&&<div style={{ background:"#fff", borderRadius:8, padding:18, boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}><div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:12, paddingBottom:10, borderBottom:"1px solid #e2e8f0" }}><span style={{ color:"#3b82f6", fontSize:14 }}>✦</span><span style={{ fontSize:12, fontWeight:600, color:"#1e40af" }}>Analisi AI — {sel.name}</span><button onClick={() => { setAiText(p => { const n={...p}; delete n[sel.id]; return n; }); runAI(sel); }} style={{ marginLeft:"auto", background:"none", border:"1px solid #bfdbfe", borderRadius:5, padding:"2px 8px", fontSize:10, cursor:"pointer", color:"#1e40af", fontFamily:"inherit" }}>↺</button></div><div style={{ fontSize:12, lineHeight:1.7 }}>{renderAI(aiText[sel.id])}</div></div>}
              {!aiLoading&&!aiText[sel.id]&&<div style={{ textAlign:"center", padding:28, background:"#fff", borderRadius:8 }}><div style={{ fontSize:22, marginBottom:10, color:"#3b82f6" }}>✦</div><div style={{ fontSize:13, color:"#64748b", marginBottom:12 }}>Analisi percorso di {sel.name}</div><button onClick={() => runAI(sel)} style={{ background:"#1e40af", color:"#fff", border:"none", borderRadius:7, padding:"8px 16px", fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Avvia analisi</button></div>}
            </div>}
            {tab==="pagamenti" && <PagamentiTab patient={sel} onUpdate={upd => updateSel(upd)}/>}
            {tab==="gdpr" && <GDPRTab patient={sel} onUpdate={upd => updateSel(upd)}/>}
          </div>
        </React.Fragment>}

        {view==="paziente"&&!sel&&<div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:12 }}><div style={{ fontSize:13, color:"#94a3b8" }}>Seleziona un paziente dalla sidebar</div><button onClick={() => setModal("new-patient")} style={{ background:"#1e40af", color:"#fff", border:"none", borderRadius:7, padding:"8px 16px", cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>+ Nuovo paziente</button></div>}
      </div>

      {/* CHAT PANEL */}
      <div style={{ width:chatOpen?290:0, minWidth:chatOpen?290:0, overflow:"hidden", transition:"width 0.2s ease, min-width 0.2s ease", background:"#fff", borderLeft:chatOpen?"2px solid #7c3aed":"none", display:"flex", flexDirection:"column", flexShrink:0 }}>
        {chatOpen && <ChatPanel patients={patients} currentPatient={view==="paziente"?sel:null}/>}
      </div>

      {modal==="new-patient"&&<Modal title="Nuovo paziente" onClose={() => setModal(null)} wide><PatientForm onSave={saveNewPatient} onClose={() => setModal(null)}/></Modal>}
      {modal==="edit-patient"&&sel&&<Modal title={`Modifica — ${sel.name}`} onClose={() => setModal(null)} wide><PatientForm initial={sel} onSave={saveEditPatient} onClose={() => setModal(null)} onDelete={deletePatient}/></Modal>}
      {modal==="new-disc"&&<Modal title="Aggiungi disciplina" onClose={() => setModal(null)}><DisciplineForm onSave={saveNewDisc} onClose={() => setModal(null)}/></Modal>}
      {modal==="edit-disc"&&editDisc&&<Modal title={`Modifica — ${editDisc.name}`} onClose={() => { setModal(null); setEditDisc(null); }}><DisciplineForm initial={editDisc} onSave={saveEditDisc} onClose={() => { setModal(null); setEditDisc(null); }}/></Modal>}
      {modal==="new-alert"&&<Modal title="Aggiungi alert" onClose={() => setModal(null)}><AlertForm onSave={saveNewAlert} onClose={() => setModal(null)}/></Modal>}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}*{box-sizing:border-box}select:focus,input:focus,textarea:focus{outline:none;border-color:#3b82f6!important;box-shadow:0 0 0 3px rgba(59,130,246,0.1)}`}</style>
    </div>
  );
}
