/* ============================ FIREBASE ============================ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, deleteDoc, onSnapshot, runTransaction, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const fbApp = initializeApp(firebaseConfig);
const auth  = getAuth(fbApp);
// Cache tempatan kekal: app boleh dibuka dan digunakan tanpa internet,
// tulisan beratur dalam telefon dan dihantar sendiri bila talian pulih.
const db = initializeFirestore(fbApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

/* ============================ KEADAAN ============================ */
let S = { borrowers:[], loans:[], payments:[], settings:{pemberi:"",telefon:""} };
let USER = null;
let SYNC = { pending:false, online:navigator.onLine };
let unsubs = [];

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const col = name => collection(db, "users", USER.uid, name);
const ref = (name,id) => doc(db, "users", USER.uid, name, id);

/* ============================ SYNC ============================ */
function watch(){
  stopWatch();
  const bind = (name, key) => onSnapshot(col(name),
    snap => {
      S[key] = snap.docs.map(d => Object.assign({id:d.id}, d.data()));
      SYNC.pending = snap.metadata.hasPendingWrites;
      render();
    },
    err => { console.error(name, err); toast("Sync gagal: " + err.code); }
  );
  unsubs.push(bind("borrowers","borrowers"));
  unsubs.push(bind("loans","loans"));
  unsubs.push(bind("payments","payments"));
  unsubs.push(onSnapshot(doc(db,"users",USER.uid,"meta","settings"),
    d => { S.settings = d.exists() ? d.data() : {pemberi:"",telefon:""}; render(); },
    err => console.error("settings", err)
  ));
}
function stopWatch(){ unsubs.forEach(u=>{try{u()}catch(e){}}); unsubs=[]; }

addEventListener("online",  ()=>{ SYNC.online=true;  render(); });
addEventListener("offline", ()=>{ SYNC.online=false; render(); });

/* ============================ TULIS ============================ */
// Firestore menulis ke cache tempatan dahulu dan menjawab serta-merta,
// jadi UI tidak perlu menunggu talian. Ralat sebenar hanya muncul kalau
// peraturan keselamatan menolak tulisan itu.
async function put(name, id, data){
  try { await setDoc(ref(name, id), data, {merge:false}); }
  catch(e){ console.error(e); toast("Gagal simpan: " + e.code); throw e; }
}
async function drop(name, id){
  try { await deleteDoc(ref(name, id)); }
  catch(e){ console.error(e); toast("Gagal padam: " + e.code); throw e; }
}
async function dropMany(items){          // [[name,id], ...]
  const b = writeBatch(db);
  items.forEach(([n,i]) => b.delete(ref(n,i)));
  try { await b.commit(); }
  catch(e){ console.error(e); toast("Gagal padam: " + e.code); throw e; }
}
async function putSettings(data){
  try { await setDoc(doc(db,"users",USER.uid,"meta","settings"), data, {merge:true}); }
  catch(e){ console.error(e); toast("Gagal simpan: " + e.code); throw e; }
}

// Nombor resit berjujukan. Transaction memastikan dua bayaran serentak
// (contoh: dua peranti) tidak mendapat nombor yang sama.
async function nextResit(tarikh){
  const cref = doc(db,"users",USER.uid,"meta","counters");
  const n = await runTransaction(db, async tx => {
    const snap = await tx.get(cref);
    const kini = (snap.exists() ? snap.data().resit : 0) || 0;
    tx.set(cref, {resit: kini+1}, {merge:true});
    return kini+1;
  });
  return `RSN-${tarikh.replace(/-/g,"")}-${String(n).padStart(4,"0")}`;
}

/* ============================ HELPERS ============================ */
const N = n => (isFinite(n)?n:0);
const money = n => "RM " + N(n).toLocaleString("ms-MY",{minimumFractionDigits:2, maximumFractionDigits:2});
const plain = n => N(n).toFixed(2);
const today = () => new Date().toISOString().slice(0,10);
function dmy(iso){ if(!iso) return "-"; const [y,m,d]=iso.split("-"); return `${d}/${m}/${y}`; }
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function monthsSince(iso){
  if(!iso) return 1;
  const a=new Date(iso+"T00:00:00"), b=new Date();
  let m=(b.getFullYear()-a.getFullYear())*12 + (b.getMonth()-a.getMonth());
  if(b.getDate() < a.getDate()) m--;
  return Math.max(1, m);
}
function hariLewat(iso){
  if(!iso) return 0;
  const d=new Date(iso+"T00:00:00"), t=new Date(); t.setHours(0,0,0,0);
  return Math.floor((t-d)/86400000);
}
function lewatLabel(h){
  if(h>=30){ const b=Math.floor(h/30); return `lewat ${b} bulan ${h-b*30} hari`; }
  return `lewat ${h} hari`;
}
// keadaan carian & tapisan (tidak disimpan — reset bila app ditutup)
const UI = { qOrang:"", qPinjam:"", fOrang:"semua", fPinjam:"aktif" };
const match = (s,q) => String(s||"").toLowerCase().includes(q.toLowerCase());

function toast(msg){
  const t=document.getElementById("toast"); t.textContent=msg; t.classList.add("on");
  clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove("on"),2200);
}

/* ============================ KIRAAN ============================ */
// bunga: "sekali" = pokok x kadar% (sekali sahaja)
//        "bulanan" = pokok x kadar% x bilangan bulan penuh sejak tarikh pinjam (minimum 1 bulan)
function calcLoan(loan){
  const pays = S.payments.filter(p=>p.loanId===loan.id);
  const bulan = loan.jenisBunga==="bulanan" ? monthsSince(loan.tarikh) : 1;
  const bungaTerakru = N(loan.pokok) * N(loan.kadar)/100 * bulan;
  const bungaDibayar = pays.reduce((s,p)=>s+N(p.alokBunga),0);
  const pokokDibayar = pays.reduce((s,p)=>s+N(p.alokPokok),0);
  const bakiPokok = Math.max(0, N(loan.pokok) - pokokDibayar);
  const bakiBunga = Math.max(0, bungaTerakru - bungaDibayar);
  const baki = bakiPokok + bakiBunga;
  return { pays, bulan, bungaTerakru, bungaDibayar, pokokDibayar, bakiPokok, bakiBunga, baki,
           jumlahDibayar: bungaDibayar+pokokDibayar, lunas: baki < 0.005 };
}
function totals(){
  let pokokKeluar=0,bakiPokok=0,bungaTerakru=0,bungaDibayar=0,pokokDibayar=0,bakiBunga=0,aktif=0,lunas=0;
  S.loans.forEach(l=>{
    const c=calcLoan(l);
    pokokKeluar+=N(l.pokok); bakiPokok+=c.bakiPokok; bungaTerakru+=c.bungaTerakru;
    bungaDibayar+=c.bungaDibayar; pokokDibayar+=c.pokokDibayar; bakiBunga+=c.bakiBunga;
    c.lunas ? lunas++ : aktif++;
  });
  const orangAktif = new Set(S.loans.filter(l=>!calcLoan(l).lunas).map(l=>l.borrowerId)).size;
  const orangLunas = new Set(S.borrowers.map(b=>b.id)).size - orangAktif;
  return { pokokKeluar,bakiPokok,bungaTerakru,bungaDibayar,pokokDibayar,bakiBunga,
           baki:bakiPokok+bakiBunga, jumlahDibayar:bungaDibayar+pokokDibayar,
           aktif,lunas,orangAktif,orangLunas:Math.max(0,orangLunas) };
}
const namaOf = id => (S.borrowers.find(b=>b.id===id)||{}).nama || "(dipadam)";

/* ============================ SHEET ============================ */
function openSheet(html){
  document.getElementById("sheetbody").innerHTML = html;
  document.getElementById("sheet").classList.add("on");
  document.getElementById("scrim").classList.add("on");
  document.getElementById("sheet").scrollTop = 0;
}
function closeSheet(){
  document.getElementById("sheet").classList.remove("on");
  document.getElementById("scrim").classList.remove("on");
}
document.getElementById("scrim").onclick = closeSheet;

/* ============================ NAV ============================ */
const ICONS = {
  dash:'<path d="M3 12h4l3 7 4-14 3 7h4"/>',
  orang:'<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M17 11h4M19 9v4"/>',
  pinjam:'<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
  resit:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  set:'<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>'
};
const TABS = [["dash","Ringkasan","dash"],["orang","Peminjam","orang"],["pinjam","Pinjaman","pinjam"],["resit","Resit","resit"],["set","Tetapan","set"]];
let TAB = "dash";
function renderTabs(){
  document.getElementById("tabs").innerHTML = TABS.map(([id,label,ic])=>
    `<button data-tab="${id}" aria-current="${TAB===id}">
       <svg viewBox="0 0 24 24">${ICONS[ic]}</svg><span>${label}</span></button>`).join("");
  document.querySelectorAll("#tabs button").forEach(b=>b.onclick=()=>{ TAB=b.dataset.tab; render(); window.scrollTo(0,0); });
}


/* ============================ VIEW: RINGKASAN ============================ */
function lateLoans(){
  return S.loans.map(l=>({l, c:calcLoan(l), h:hariLewat(l.tarikhJanji)}))
    .filter(x=> !x.c.lunas && x.l.tarikhJanji && x.h>0)
    .sort((a,b)=> b.h - a.h);
}
function lateSection(){
  const late = lateLoans();
  const ada = S.loans.some(l=>l.tarikhJanji);
  if(!late.length){
    return `<h2 class="sec-title">Lewat bayar</h2>
      <div class="empty">${ada?"Tiada siapa lewat bayar setakat ini.":"Belum ada tarikh sepatutnya bayar ditetapkan. Edit pinjaman dan isi tarikh itu untuk guna bahagian ini."}</div>`;
  }
  const jum = late.reduce((s,x)=>s+x.c.baki,0);
  return `<h2 class="sec-title">Lewat bayar</h2>
    <p class="count">${late.length} pinjaman · ${money(jum)} tertunggak. Tekan nama untuk terus rekod bayaran.</p>
    <div>${late.map(x=>`
      <button class="item late" data-act="addPay" data-id="${x.l.id}">
        <span><span class="nm">${esc(namaOf(x.l.borrowerId))}</span>
          <span class="meta">Sepatutnya bayar ${dmy(x.l.tarikhJanji)}</span>
          <span class="days">${lewatLabel(x.h)}</span></span>
        <span class="amt red">${money(x.c.baki)}</span></button>`).join("")}</div>`;
}

function vDash(){
  const t = totals();
  if(!S.loans.length){
    return `<div class="empty">Belum ada rekod.<br><br>Mula dengan menambah peminjam, kemudian rekod pinjaman pertama.</div>
      <div class="btnrow"><button class="btn block" data-act="addBorrower">Tambah peminjam</button></div>`;
  }
  return `
  <div class="ledger">
    <div class="label">Baki hutang belum dikutip</div>
    <div class="headline"><span class="cur">RM</span>${plain(t.baki).replace(/\B(?=(\d{3})+(?!\d))/g,",")}</div>
    <div class="label">${t.aktif} pinjaman aktif daripada ${t.orangAktif} orang</div>
  </div>

  <div class="split">
    <div><div class="label">Baki pokok</div><div class="val">${money(t.bakiPokok)}</div></div>
    <div><div class="label">Baki bunga</div><div class="val">${money(t.bakiBunga)}</div></div>
  </div>

  ${lateSection()}

  <h2 class="sec-title">Wang keluar &amp; masuk</h2>
  <div class="rows">
    <div class="row"><span class="k">Jumlah pokok dikeluarkan</span><span class="v">${money(t.pokokKeluar)}</span></div>
    <div class="row"><span class="k">Jumlah telah dibayar balik</span><span class="v">${money(t.jumlahDibayar)}</span></div>
    <div class="row"><span class="k">— daripadanya pokok</span><span class="v">${money(t.pokokDibayar)}</span></div>
    <div class="row"><span class="k">— daripadanya bunga</span><span class="v">${money(t.bungaDibayar)}</span></div>
  </div>

  <h2 class="sec-title">Bunga</h2>
  <div class="rows">
    <div class="row"><span class="k">Bunga terkumpul sehingga kini</span><span class="v">${money(t.bungaTerakru)}</span></div>
    <div class="row"><span class="k green">Untung sudah diterima</span><span class="v green">${money(t.bungaDibayar)}</span></div>
    <div class="row"><span class="k">Untung belum diterima</span><span class="v">${money(t.bakiBunga)}</span></div>
  </div>

  <h2 class="sec-title">Orang</h2>
  <div class="rows">
    <div class="row"><span class="k">Jumlah peminjam direkodkan</span><span class="v">${S.borrowers.length}</span></div>
    <div class="row"><span class="k">Masih berhutang</span><span class="v red">${t.orangAktif}</span></div>
    <div class="row"><span class="k">Sudah habis bayar</span><span class="v green">${t.orangLunas}</span></div>
    <div class="row"><span class="k">Pinjaman selesai</span><span class="v">${t.lunas}</span></div>
  </div>

  <div class="btnrow">
    <button class="btn" data-act="addLoan">Rekod pinjaman</button>
    <button class="btn ghost" data-act="addBorrower">Tambah peminjam</button>
  </div>`;
}

/* ============================ VIEW: PEMINJAM ============================ */
function toolsHTML(scope, q, f, opts){
  return `
  <div class="tools">
    <input type="search" id="q_${scope}" value="${esc(q)}" placeholder="Cari nama${scope==="pinjam"?" atau catatan":" atau telefon"}...">
    ${q?`<button class="clr" data-clear="${scope}">Kosong</button>`:""}
  </div>
  <div class="chips">
    ${opts.map(([v,label])=>`<button data-filter="${scope}" data-val="${v}" aria-pressed="${f===v}">${label}</button>`).join("")}
  </div>
  <div id="listBox"></div>`;
}

function listOrang(){
  const q=UI.qOrang, f=UI.fOrang;
  const rows = S.borrowers.map(b=>{
    const ls = S.loans.filter(l=>l.borrowerId===b.id);
    const baki = ls.reduce((s,l)=>s+calcLoan(l).baki,0);
    const aktif = ls.filter(l=>!calcLoan(l).lunas).length;
    const lewat = ls.some(l=>!calcLoan(l).lunas && l.tarikhJanji && hariLewat(l.tarikhJanji)>0);
    return {b,ls,baki,aktif,lewat};
  })
  .filter(r=> !q || match(r.b.nama,q) || match(r.b.telefon,q))
  .filter(r=>{
    if(f==="aktif") return r.aktif>0;
    if(f==="lunas") return r.ls.length>0 && r.aktif===0;
    if(f==="lewat") return r.lewat;
    return true;
  })
  .sort((a,b)=> b.baki-a.baki || a.b.nama.localeCompare(b.b.nama));

  if(!rows.length) return `<div class="empty">Tiada peminjam sepadan dengan tapisan ini.</div>`;
  const jum = rows.reduce((s,r)=>s+r.baki,0);
  return `<p class="count">${rows.length} orang · baki ${money(jum)}</p>` + rows.map(r=>
    `<button class="item${r.lewat?" late":""}" data-open-borrower="${r.b.id}">
      <span><span class="nm">${esc(r.b.nama)}</span>
        <span class="meta">${r.ls.length} pinjaman${r.b.telefon?" · "+esc(r.b.telefon):""}</span>
        ${r.lewat?`<span class="days">ada bayaran lewat</span>`:""}</span>
      <span class="amt ${r.baki>0.005?"red":"green"}">${r.baki>0.005?money(r.baki):"Lunas"}
        <div class="meta">${r.aktif?r.aktif+" aktif":"selesai"}</div></span></button>`).join("");
}

function vOrang(){
  if(!S.borrowers.length) return `<div class="empty">Belum ada peminjam.</div>
    <div class="btnrow"><button class="btn block" data-act="addBorrower">Tambah peminjam</button></div>`;
  return toolsHTML("orang", UI.qOrang, UI.fOrang,
      [["semua","Semua"],["aktif","Masih berhutang"],["lewat","Lewat"],["lunas","Sudah lunas"]])
    + `<div class="btnrow"><button class="btn block" data-act="addBorrower">Tambah peminjam</button></div>`;
}

/* ============================ VIEW: PINJAMAN ============================ */
function listPinjam(){
  const q=UI.qPinjam, f=UI.fPinjam;
  const rows = S.loans.map(l=>({l, c:calcLoan(l), nama:namaOf(l.borrowerId), h:hariLewat(l.tarikhJanji)}))
    .filter(r=> !q || match(r.nama,q) || match(r.l.nota,q))
    .filter(r=> f==="semua" || (f==="aktif" ? !r.c.lunas : f==="lunas" ? r.c.lunas : true))
    .filter(r=> f!=="lewat" || (!r.c.lunas && r.l.tarikhJanji && r.h>0))
    .sort((a,b)=> (b.l.tarikh||"").localeCompare(a.l.tarikh||""));

  if(!rows.length) return `<div class="empty">Tiada pinjaman sepadan dengan tapisan ini.</div>`;
  const jum = rows.reduce((s,r)=>s+r.c.baki,0);
  return `<p class="count">${rows.length} pinjaman · baki ${money(jum)}</p>` + rows.map(r=>{
    const lewat = !r.c.lunas && r.l.tarikhJanji && r.h>0;
    return `<button class="item${lewat?" late":""}" data-open-loan="${r.l.id}">
      <span><span class="nm">${esc(r.nama)}</span>
        <span class="meta">${dmy(r.l.tarikh)} · pokok ${money(r.l.pokok)} · ${r.l.kadar}%${r.l.jenisBunga==="bulanan"?"/bulan":" sekali"}</span>
        ${lewat?`<span class="days">${lewatLabel(r.h)}</span>`
               :(r.l.tarikhJanji&&!r.c.lunas?`<span class="meta">perlu bayar ${dmy(r.l.tarikhJanji)}</span>`:"")}</span>
      <span class="amt ${r.c.lunas?"green":"red"}">${r.c.lunas?"Lunas":money(r.c.baki)}
        <div class="meta">${r.c.pays.length} bayaran</div></span></button>`;
  }).join("");
}

function vPinjam(){
  if(!S.loans.length) return `<div class="empty">Belum ada pinjaman direkodkan.</div>
    <div class="btnrow"><button class="btn block" data-act="addLoan">Rekod pinjaman</button></div>`;
  return toolsHTML("pinjam", UI.qPinjam, UI.fPinjam,
      [["aktif","Aktif"],["lewat","Lewat"],["lunas","Lunas"],["semua","Semua"]])
    + `<div class="btnrow"><button class="btn block" data-act="addLoan">Rekod pinjaman</button></div>`;
}

/* ============================ VIEW: RESIT ============================ */
function vResit(){
  if(!S.payments.length) return `<div class="empty">Belum ada bayaran direkodkan. Setiap bayaran menjana resit secara automatik.</div>`;
  const sorted=[...S.payments].sort((a,b)=>b.createdAt-a.createdAt);
  return `<div>${sorted.map(p=>{
    const l=S.loans.find(x=>x.id===p.loanId);
    return `<button class="item" data-open-resit="${p.id}">
      <span><span class="nm">${esc(p.resitNo)}</span>
        <span class="meta">${esc(l?namaOf(l.borrowerId):"(pinjaman dipadam)")} · ${dmy(p.tarikh)} · ${jenisLabel(p.jenis)}</span></span>
      <span class="amt">${money(p.jumlah)}</span></button>`;
  }).join("")}</div>`;
}
function jenisLabel(j){ return {penuh:"Bayar penuh",bunga:"Bunga sahaja",pokok:"Pokok sahaja",campur:"Bunga + pokok"}[j]||j; }

/* ============================ BORANG: PEMINJAM ============================ */
function formBorrower(id){
  const b = id ? S.borrowers.find(x=>x.id===id) : null;
  openSheet(`
    <h2>${b?"Kemas kini peminjam":"Peminjam baharu"}</h2>
    <div class="sh-sub">Nama wajib. Lain-lain boleh kosong.</div>
    <label for="bNama">Nama penuh</label><input id="bNama" value="${esc(b?b.nama:"")}" placeholder="Contoh: Ahmad bin Ali">
    <label for="bTel">Nombor telefon</label><input id="bTel" value="${esc(b?b.telefon:"")}" placeholder="013-XXXXXXX">
    <label for="bNota">Catatan</label><textarea id="bNota" placeholder="Rujukan, alamat, hubungan...">${esc(b?b.nota:"")}</textarea>
    <div class="btnrow">
      <button class="btn" data-act="saveBorrower" data-id="${b?b.id:""}">Simpan</button>
      <button class="btn ghost" data-act="close">Batal</button>
    </div>`);
}

/* ============================ BORANG: PINJAMAN ============================ */
function formLoan(id, preBorrower){
  if(!S.borrowers.length){ toast("Tambah peminjam dahulu"); formBorrower(); return; }
  const l = id ? S.loans.find(x=>x.id===id) : null;
  const sel = l ? l.borrowerId : (preBorrower||S.borrowers[0].id);
  openSheet(`
    <h2>${l?"Kemas kini pinjaman":"Pinjaman baharu"}</h2>
    <div class="sh-sub">${l?"Mengubah pokok atau kadar akan mengubah semula baki.":"Rekod wang yang dikeluarkan."}</div>
    <label for="lOrang">Peminjam</label>
    <select id="lOrang">${S.borrowers.map(b=>`<option value="${b.id}"${b.id===sel?" selected":""}>${esc(b.nama)}</option>`).join("")}</select>
    <div class="grid2">
      <div><label for="lPokok">Jumlah pokok (RM)</label><input id="lPokok" type="number" inputmode="decimal" step="0.01" min="0" value="${l?l.pokok:""}" placeholder="500.00"></div>
      <div><label for="lKadar">Kadar bunga (%)</label><input id="lKadar" type="number" inputmode="decimal" step="0.01" min="0" value="${l?l.kadar:"0"}" placeholder="0"></div>
    </div>
    <label for="lJenis">Bunga dikira</label>
    <select id="lJenis">
      <option value="sekali"${!l||l.jenisBunga==="sekali"?" selected":""}>Sekali sahaja atas pokok</option>
      <option value="bulanan"${l&&l.jenisBunga==="bulanan"?" selected":""}>Setiap bulan atas pokok</option>
    </select>
    <div class="grid2">
      <div><label for="lTarikh">Tarikh pinjaman</label><input id="lTarikh" type="date" value="${l?l.tarikh:today()}"></div>
      <div><label for="lJanji">Sepatutnya bayar</label><input id="lJanji" type="date" value="${l&&l.tarikhJanji?l.tarikhJanji:""}"></div>
    </div>
    <div class="hint">Isi “Sepatutnya bayar” supaya pinjaman ini muncul dalam senarai Lewat bayar bila tarikh itu berlalu. Boleh kosongkan.</div>
    <label for="lNota">Catatan</label><textarea id="lNota" placeholder="Tujuan, janji bayar balik...">${esc(l?l.nota:"")}</textarea>
    <div class="btnrow">
      <button class="btn" data-act="saveLoan" data-id="${l?l.id:""}">Simpan</button>
      <button class="btn ghost" data-act="close">Batal</button>
    </div>`);
}

/* ============================ DETAIL: PEMINJAM ============================ */
function detailBorrower(id){
  const b=S.borrowers.find(x=>x.id===id); if(!b) return;
  const ls=S.loans.filter(l=>l.borrowerId===id);
  let bakiP=0,bakiB=0,bayar=0;
  const rows = ls.length ? ls.map(l=>{ const c=calcLoan(l); bakiP+=c.bakiPokok; bakiB+=c.bakiBunga; bayar+=c.jumlahDibayar;
    return `<button class="item" data-open-loan="${l.id}">
      <span><span class="nm">${dmy(l.tarikh)}</span><span class="meta">pokok ${money(l.pokok)} · ${l.kadar}%${l.jenisBunga==="bulanan"?"/bulan":""}</span></span>
      <span class="amt ${c.lunas?"green":"red"}">${c.lunas?"Lunas":money(c.baki)}</span></button>`;
  }).join("") : `<div class="empty">Belum ada pinjaman untuk ${esc(b.nama)}.</div>`;
  openSheet(`
    <h2>${esc(b.nama)}</h2>
    <div class="sh-sub">${b.telefon?esc(b.telefon)+" · ":""}${ls.length} pinjaman</div>
    ${b.nota?`<p class="hint">${esc(b.nota)}</p>`:""}
    <div class="rows">
      <div class="row"><span class="k">Baki pokok</span><span class="v">${money(bakiP)}</span></div>
      <div class="row"><span class="k">Baki bunga</span><span class="v">${money(bakiB)}</span></div>
      <div class="row"><span class="k">Jumlah perlu dibayar</span><span class="v ${bakiP+bakiB>0.005?"red":"green"}">${money(bakiP+bakiB)}</span></div>
      <div class="row"><span class="k">Sudah dibayar</span><span class="v green">${money(bayar)}</span></div>
    </div>
    <h2 class="sec-title">Senarai pinjaman</h2>${rows}
    <div class="btnrow">
      <button class="btn" data-act="addLoan" data-id="${b.id}">Pinjaman baharu</button>
      <button class="btn ghost" data-act="editBorrower" data-id="${b.id}">Edit</button>
      <button class="btn danger" data-act="delBorrower" data-id="${b.id}">Padam</button>
    </div>`);
}

/* ============================ DETAIL: PINJAMAN ============================ */
function detailLoan(id){
  const l=S.loans.find(x=>x.id===id); if(!l) return;
  const c=calcLoan(l);
  const pays = c.pays.sort((a,b)=>(b.tarikh||"").localeCompare(a.tarikh||"")).map(p=>
    `<button class="item" data-open-resit="${p.id}">
      <span><span class="nm">${dmy(p.tarikh)} · ${jenisLabel(p.jenis)}</span>
        <span class="meta">${esc(p.resitNo)} · bunga ${money(p.alokBunga)} + pokok ${money(p.alokPokok)}</span></span>
      <span class="amt">${money(p.jumlah)}</span></button>`).join("")
    || `<div class="empty">Belum ada bayaran.</div>`;
  openSheet(`
    <h2>${esc(namaOf(l.borrowerId))}</h2>
    <div class="sh-sub">Pinjaman ${dmy(l.tarikh)}${c.lunas?' · <span class="pill green">Lunas</span>':""}</div>
    ${l.nota?`<p class="hint">${esc(l.nota)}</p>`:""}
    <div class="rows">
      ${l.tarikhJanji?`<div class="row"><span class="k">Sepatutnya bayar</span><span class="v ${(!c.lunas&&hariLewat(l.tarikhJanji)>0)?"red":""}">${dmy(l.tarikhJanji)}${(!c.lunas&&hariLewat(l.tarikhJanji)>0)?` · ${lewatLabel(hariLewat(l.tarikhJanji))}`:""}</span></div>`:""}
      <div class="row"><span class="k">Pokok asal</span><span class="v">${money(l.pokok)}</span></div>
      <div class="row"><span class="k">Kadar bunga</span><span class="v">${l.kadar}%${l.jenisBunga==="bulanan"?" sebulan":" sekali"}</span></div>
      <div class="row"><span class="k">Bunga terkumpul${l.jenisBunga==="bulanan"?` (${c.bulan} bulan)`:""}</span><span class="v">${money(c.bungaTerakru)}</span></div>
      <div class="row"><span class="k">Pokok sudah dibayar</span><span class="v green">${money(c.pokokDibayar)}</span></div>
      <div class="row"><span class="k">Bunga sudah dibayar</span><span class="v green">${money(c.bungaDibayar)}</span></div>
      <div class="row"><span class="k">Baki pokok</span><span class="v ${c.bakiPokok>0.005?"red":""}">${money(c.bakiPokok)}</span></div>
      <div class="row"><span class="k">Baki bunga</span><span class="v ${c.bakiBunga>0.005?"red":""}">${money(c.bakiBunga)}</span></div>
      <div class="row"><span class="k"><b>Jumlah perlu dijelaskan</b></span><span class="v ${c.lunas?"green":"red"}">${money(c.baki)}</span></div>
    </div>
    <div class="btnrow">
      ${c.lunas?"":`<button class="btn" data-act="addPay" data-id="${l.id}">Rekod bayaran</button>`}
      <button class="btn ghost" data-act="editLoan" data-id="${l.id}">Edit</button>
      <button class="btn danger" data-act="delLoan" data-id="${l.id}">Padam</button>
    </div>
    <h2 class="sec-title">Sejarah bayaran</h2>${pays}`);
}

/* ============================ BORANG: BAYARAN ============================ */
function formPay(loanId){
  const l=S.loans.find(x=>x.id===loanId); if(!l) return;
  const c=calcLoan(l);
  openSheet(`
    <h2>Rekod bayaran</h2>
    <div class="sh-sub">${esc(namaOf(l.borrowerId))} · baki ${money(c.baki)}</div>
    <div class="rows" style="margin-bottom:4px">
      <div class="row"><span class="k">Bunga tertunggak</span><span class="v">${money(c.bakiBunga)}</span></div>
      <div class="row"><span class="k">Baki pokok</span><span class="v">${money(c.bakiPokok)}</span></div>
    </div>
    <label for="pJenis">Jenis bayaran</label>
    <select id="pJenis">
      <option value="penuh">Bayar penuh — jelaskan semua</option>
      <option value="bunga">Bunga sahaja</option>
      <option value="pokok">Pokok sahaja</option>
      <option value="campur" selected>Bayar sebahagian — bunga dahulu, baki ke pokok</option>
    </select>
    <label for="pJumlah">Jumlah dibayar (RM)</label>
    <input id="pJumlah" type="number" inputmode="decimal" step="0.01" min="0" value="" placeholder="${plain(c.baki)}">
    <div class="hint" id="pHint">Biar kosong untuk “Bayar penuh” — sistem akan isi ${money(c.baki)}.</div>
    <label for="pTarikh">Tarikh bayaran</label><input id="pTarikh" type="date" value="${today()}">
    <label for="pNota">Catatan</label><textarea id="pNota" placeholder="Tunai, transfer, saksi..."></textarea>
    <div class="btnrow">
      <button class="btn" data-act="savePay" data-id="${l.id}">Simpan dan jana resit</button>
      <button class="btn ghost" data-act="close">Batal</button>
    </div>`);
  const js=document.getElementById("pJenis"), ji=document.getElementById("pJumlah"), hint=document.getElementById("pHint");
  js.onchange=()=>{
    if(js.value==="penuh"){ ji.value=plain(c.baki); hint.textContent=`Menjelaskan bunga ${money(c.bakiBunga)} + pokok ${money(c.bakiPokok)}.`; }
    else if(js.value==="bunga"){ ji.value=plain(c.bakiBunga); hint.textContent="Lebihan daripada bunga tertunggak akan ditolak ke pokok."; }
    else if(js.value==="pokok"){ ji.value=""; hint.textContent="Ditolak terus ke pokok. Bunga tertunggak kekal."; }
    else { ji.value=""; hint.textContent="Bunga tertunggak ditolak dahulu, baki ke pokok."; }
  };
}

/* ============================ RESIT ============================ */
function resitHTML(p){
  const l=S.loans.find(x=>x.id===p.loanId);
  const nama = l?namaOf(l.borrowerId):"(rekod dipadam)";
  const pemberi = S.settings.pemberi || "Pemberi pinjaman";
  return `
  <div id="resit">
    <div class="rhead">
      <div class="rtitle">Resit Bayaran</div>
      <div class="rno">${esc(p.resitNo)}</div>
    </div>
    <div class="rrow"><span>Diterima daripada</span><span class="rv">${esc(nama)}</span></div>
    <div class="rrow"><span>Tarikh</span><span class="rv">${dmy(p.tarikh)}</span></div>
    <div class="rrow"><span>Jenis bayaran</span><span class="rv">${jenisLabel(p.jenis)}</span></div>
    <div class="rrow"><span>Ditolak ke bunga</span><span class="rv">${money(p.alokBunga)}</span></div>
    <div class="rrow"><span>Ditolak ke pokok</span><span class="rv">${money(p.alokPokok)}</span></div>
    <div class="rrow"><span>Baki hutang selepas bayaran</span><span class="rv">${money(p.bakiSelepas)}</span></div>
    ${p.nota?`<div class="rrow"><span>Catatan</span><span class="rv">${esc(p.nota)}</span></div>`:""}
    <div class="rtotal"><span>Jumlah diterima</span><span class="rv">${money(p.jumlah)}</span></div>
    <div class="rfoot">
      Diterima oleh ${esc(pemberi)}${S.settings.telefon?" · "+esc(S.settings.telefon):""}<br>
      Resit dijana pada ${new Date(p.createdAt).toLocaleString("ms-MY")}
    </div>
  </div>`;
}
function resitTeks(p){
  const l=S.loans.find(x=>x.id===p.loanId);
  const nama=l?namaOf(l.borrowerId):"-";
  return [
    "RESIT BAYARAN",
    p.resitNo,
    "------------------------------",
    "Daripada    : "+nama,
    "Tarikh      : "+dmy(p.tarikh),
    "Jenis       : "+jenisLabel(p.jenis),
    "Jumlah      : "+money(p.jumlah),
    "  ke bunga  : "+money(p.alokBunga),
    "  ke pokok  : "+money(p.alokPokok),
    "Baki hutang : "+money(p.bakiSelepas),
    p.nota?("Catatan     : "+p.nota):null,
    "------------------------------",
    "Diterima oleh "+(S.settings.pemberi||"-")+(S.settings.telefon?" ("+S.settings.telefon+")":"")
  ].filter(Boolean).join("\n");
}
function showResit(id){
  const p=S.payments.find(x=>x.id===id); if(!p) return;
  openSheet(`
    <h2>Resit</h2>
    <div class="sh-sub">Dijana automatik semasa bayaran direkodkan.</div>
    ${resitHTML(p)}
    <div class="btnrow">
      <button class="btn" data-act="shareResit" data-id="${p.id}">Kongsi</button>
      <button class="btn ghost" data-act="printResit">Cetak / simpan PDF</button>
      <button class="btn danger" data-act="delPay" data-id="${p.id}">Batalkan bayaran</button>
    </div>`);
}


function fillList(){
  const box=document.getElementById("listBox"); if(!box) return;
  box.innerHTML = TAB==="orang" ? listOrang() : listPinjam();
  bindRows();
}
function bindRows(){
  document.querySelectorAll("[data-open-borrower]").forEach(b=>b.onclick=()=>detailBorrower(b.dataset.openBorrower));
  document.querySelectorAll("[data-open-loan]").forEach(b=>b.onclick=()=>detailLoan(b.dataset.openLoan));
  document.querySelectorAll("[data-open-resit]").forEach(b=>b.onclick=()=>showResit(b.dataset.openResit));
}
function bindTools(){
  const inp=document.getElementById("q_orang")||document.getElementById("q_pinjam");
  if(inp){
    inp.oninput=()=>{ if(TAB==="orang") UI.qOrang=inp.value; else UI.qPinjam=inp.value; fillList(); };
    const clr=document.querySelector("[data-clear]");
    if(clr) clr.onclick=()=>{ if(TAB==="orang") UI.qOrang=""; else UI.qPinjam=""; render(); };
  }
  document.querySelectorAll("[data-filter]").forEach(b=>b.onclick=()=>{
    if(b.dataset.filter==="orang") UI.fOrang=b.dataset.val; else UI.fPinjam=b.dataset.val;
    document.querySelectorAll("[data-filter]").forEach(x=>x.setAttribute("aria-pressed", x===b));
    fillList();
  });
  fillList();
}


/* ============================ SKRIN LOG MASUK ============================ */
function vLogin(){
  return `
  <div class="ledger">
    <div class="label">Buku Hutang</div>
    <div class="headline" style="font-size:30px">Log masuk</div>
    <div class="label">Rekod anda disimpan dalam akaun ini dan boleh dibuka dari mana-mana peranti.</div>
  </div>
  <label for="aEmel">E-mel</label>
  <input id="aEmel" type="email" autocomplete="username" inputmode="email" placeholder="nama@contoh.com">
  <label for="aKata">Kata laluan</label>
  <input id="aKata" type="password" autocomplete="current-password" placeholder="Kata laluan">
  <div class="btnrow"><button class="btn block" data-act="login">Log masuk</button></div>
  <p class="hint">Akaun dibuat sekali sahaja melalui Firebase Console. Tiada pendaftaran terbuka, jadi orang lain tidak boleh cipta akaun pada app ini.</p>`;
}

function syncBadge(){
  if(!SYNC.online) return `<span class="sync off">Luar talian — rekod disimpan, akan sync nanti</span>`;
  if(SYNC.pending) return `<span class="sync wait">Menyimpan…</span>`;
  return `<span class="sync ok">Tersimpan</span>`;
}

/* ============================ VIEW: TETAPAN ============================ */
function vSet(){
  return `
  <h2 class="sec-title">Akaun</h2>
  <div class="rows">
    <div class="row"><span class="k">Log masuk sebagai</span><span class="v" style="font-size:14px">${esc(USER?USER.email:"-")}</span></div>
    <div class="row"><span class="k">Status sync</span><span class="v" style="font-size:14px">${syncBadge()}</span></div>
    <div class="row"><span class="k">Rekod</span><span class="v" style="font-size:14px">${S.borrowers.length} peminjam · ${S.loans.length} pinjaman · ${S.payments.length} resit</span></div>
  </div>
  <div class="btnrow"><button class="btn ghost block" data-act="logout">Log keluar</button></div>

  <h2 class="sec-title">Maklumat pada resit</h2>
  <label for="setNama">Nama pemberi pinjaman</label>
  <input id="setNama" value="${esc(S.settings.pemberi)}" placeholder="Nama anda atau nama kedai">
  <label for="setTel">Nombor telefon</label>
  <input id="setTel" value="${esc(S.settings.telefon)}" placeholder="011-XXXXXXX">
  <div class="btnrow"><button class="btn" data-act="saveSettings">Simpan maklumat</button></div>

  <h2 class="sec-title">Salinan keselamatan</h2>
  <p class="hint">Data anda ada di pelayan Firebase dan takkan hilang kalau telefon rosak. Tetapi Firebase tidak menyimpan salinan sejarah pada pelan percuma — kalau rekod terpadam, ia terpadam. Salin teks ini sebulan sekali dan simpan di tempat lain.</p>
  <label for="expBox">Data anda (JSON)</label>
  <textarea id="expBox" readonly>${esc(JSON.stringify({borrowers:S.borrowers,loans:S.loans,payments:S.payments,settings:S.settings,eksport:new Date().toISOString()}))}</textarea>
  <div class="btnrow"><button class="btn" data-act="copyData">Salin data</button></div>

  <h2 class="sec-title">Cara bunga dikira</h2>
  <p class="hint">
    <b>Sekali sahaja</b> — bunga = pokok × kadar%. Dikira sekali, tak bertambah walau lambat bayar.<br><br>
    <b>Bulanan</b> — bunga = pokok × kadar% × bilangan bulan penuh sejak tarikh pinjam (minimum 1 bulan). Bunga dikira atas pokok asal, bukan baki berkurang.<br><br>
    Setiap bayaran menolak bunga tertunggak dahulu, kemudian pokok — kecuali anda pilih “Pokok sahaja”.
  </p>`;
}

/* ============================ RENDER ============================ */
function render(){
  const sub = document.getElementById("topsub");
  if(!USER){
    document.getElementById("tabs").innerHTML = "";
    sub.textContent = "";
    document.getElementById("view").innerHTML = vLogin();
    return;
  }
  sub.innerHTML = syncBadge();
  renderTabs();
  document.getElementById("view").innerHTML =
    ({dash:vDash,orang:vOrang,pinjam:vPinjam,resit:vResit,set:vSet})[TAB]();
  bindView();
}

/* ============================ ACTIONS ============================ */
function bindView(){
  bindTools();
  bindRows();
}

document.addEventListener("click", e=>{
  const el=e.target.closest("[data-act]"); if(!el) return;
  const id=el.dataset.id||"";
  const A={
    close:()=>closeSheet(),
    addBorrower:()=>formBorrower(),
    editBorrower:()=>formBorrower(id),
    addLoan:()=>formLoan(null,id||null),
    editLoan:()=>formLoan(id),
    addPay:()=>formPay(id),

    login:async()=>{
      const em=document.getElementById("aEmel").value.trim();
      const kt=document.getElementById("aKata").value;
      if(!em||!kt){ toast("Isi e-mel dan kata laluan"); return; }
      el.disabled=true; el.textContent="Sedang log masuk…";
      try{ await signInWithEmailAndPassword(auth, em, kt); }
      catch(err){
        el.disabled=false; el.textContent="Log masuk";
        const m={"auth/invalid-credential":"E-mel atau kata laluan salah",
                 "auth/invalid-email":"Format e-mel tidak sah",
                 "auth/user-disabled":"Akaun ini dinyahaktifkan",
                 "auth/too-many-requests":"Terlalu banyak cubaan. Tunggu sebentar.",
                 "auth/network-request-failed":"Tiada internet. Log masuk pertama kali perlukan talian."};
        toast(m[err.code] || ("Gagal log masuk: "+err.code));
      }
    },
    logout:async()=>{
      if(!confirm("Log keluar? Rekod kekal dalam akaun dan boleh dibuka semula.")) return;
      stopWatch(); await signOut(auth);
    },

    saveBorrower:async()=>{
      const nama=document.getElementById("bNama").value.trim();
      if(!nama){ toast("Isi nama peminjam"); return; }
      const data={nama,
        telefon:document.getElementById("bTel").value.trim(),
        nota:document.getElementById("bNota").value.trim(),
        createdAt: id ? (S.borrowers.find(b=>b.id===id)||{}).createdAt || Date.now() : Date.now()};
      closeSheet();
      await put("borrowers", id||uid(), data);
      toast("Peminjam disimpan");
    },
    delBorrower:async()=>{
      const ls=S.loans.filter(l=>l.borrowerId===id);
      if(!confirm(`Padam peminjam ini${ls.length?` beserta ${ls.length} pinjaman dan semua resitnya`:""}? Tindakan ini tidak boleh dibatalkan.`)) return;
      const loanIds=ls.map(l=>l.id);
      const items=[["borrowers",id], ...loanIds.map(i=>["loans",i]),
        ...S.payments.filter(p=>loanIds.includes(p.loanId)).map(p=>["payments",p.id])];
      closeSheet();
      await dropMany(items);
      toast("Peminjam dipadam");
    },

    saveLoan:async()=>{
      const pokok=parseFloat(document.getElementById("lPokok").value);
      if(!(pokok>0)){ toast("Isi jumlah pokok"); return; }
      const lama = id ? S.loans.find(l=>l.id===id) : null;
      const data={
        borrowerId:document.getElementById("lOrang").value,
        pokok:Math.round(pokok*100)/100,
        kadar:Math.max(0,parseFloat(document.getElementById("lKadar").value)||0),
        jenisBunga:document.getElementById("lJenis").value,
        tarikh:document.getElementById("lTarikh").value||today(),
        tarikhJanji:document.getElementById("lJanji").value||"",
        nota:document.getElementById("lNota").value.trim(),
        createdAt: lama ? lama.createdAt||Date.now() : Date.now()
      };
      closeSheet();
      await put("loans", id||uid(), data);
      toast("Pinjaman disimpan");
    },
    delLoan:async()=>{
      const ps=S.payments.filter(p=>p.loanId===id);
      if(!confirm(`Padam pinjaman ini${ps.length?` dan ${ps.length} resit bayarannya`:""}?`)) return;
      closeSheet();
      await dropMany([["loans",id], ...ps.map(p=>["payments",p.id])]);
      toast("Pinjaman dipadam");
    },

    savePay:async()=>{
      const l=S.loans.find(x=>x.id===id); if(!l) return;
      const c=calcLoan(l);
      const jenis=document.getElementById("pJenis").value;
      let jumlah=parseFloat(document.getElementById("pJumlah").value);
      if(jenis==="penuh") jumlah=c.baki;
      if(!(jumlah>0)){ toast("Isi jumlah bayaran"); return; }
      jumlah=Math.round(jumlah*100)/100;
      if(jumlah > c.baki + 0.005 && !confirm(`Bayaran ${money(jumlah)} melebihi baki ${money(c.baki)}. Teruskan?`)) return;

      let alokBunga=0, alokPokok=0;
      if(jenis==="pokok"){ alokPokok=Math.min(jumlah,c.bakiPokok); alokBunga=Math.min(jumlah-alokPokok,c.bakiBunga); }
      else { alokBunga=Math.min(jumlah,c.bakiBunga); alokPokok=Math.min(jumlah-alokBunga,c.bakiPokok); }
      const r2=v=>Math.round(v*100)/100;
      alokBunga=r2(alokBunga); alokPokok=r2(alokPokok);

      const tarikh=document.getElementById("pTarikh").value||today();
      const nota=document.getElementById("pNota").value.trim();
      const btn=el; btn.disabled=true; btn.textContent="Menjana resit…";
      let resitNo;
      try{ resitNo = await nextResit(tarikh); }
      catch(err){
        btn.disabled=false; btn.textContent="Simpan dan jana resit";
        toast("Nombor resit perlukan internet. Cuba semula bila ada talian.");
        return;
      }
      const pid=uid();
      const pay={ loanId:l.id, tarikh, jumlah, jenis, alokBunga, alokPokok, nota, resitNo,
                  createdAt:Date.now(), bakiSelepas:r2(Math.max(0,c.baki-(alokBunga+alokPokok))) };
      closeSheet();
      await put("payments", pid, pay);
      toast("Bayaran direkod · resit dijana");
      setTimeout(()=>showResit(pid), 120);
    },
    delPay:async()=>{
      if(!confirm("Batalkan bayaran ini dan padam resitnya? Baki hutang akan dikira semula.")) return;
      closeSheet();
      await drop("payments", id);
      toast("Bayaran dibatalkan");
    },

    shareResit:async()=>{
      const p=S.payments.find(x=>x.id===id); if(!p) return;
      const txt=resitTeks(p);
      try{
        if(navigator.share){ await navigator.share({title:p.resitNo,text:txt}); return; }
        await navigator.clipboard.writeText(txt); toast("Resit disalin");
      }catch(err){ try{ await navigator.clipboard.writeText(txt); toast("Resit disalin"); }catch(e2){ toast("Tidak dapat berkongsi di peranti ini"); } }
    },
    printResit:()=>{ window.print(); },

    saveSettings:async()=>{
      await putSettings({
        pemberi:document.getElementById("setNama").value.trim(),
        telefon:document.getElementById("setTel").value.trim()
      });
      toast("Maklumat resit disimpan");
    },
    copyData:async()=>{
      const box=document.getElementById("expBox");
      try{ await navigator.clipboard.writeText(box.value); toast("Data disalin"); }
      catch(e){ box.select(); toast("Tekan lama dan pilih Salin"); }
    }
  };
  if(A[el.dataset.act]){ e.preventDefault(); A[el.dataset.act](); }
});

/* ============================ MULA ============================ */
onAuthStateChanged(auth, u=>{
  USER = u;
  if(u){ TAB="dash"; watch(); }
  else { stopWatch(); S={borrowers:[],loans:[],payments:[],settings:{pemberi:"",telefon:""}}; }
  render();
});
render();
