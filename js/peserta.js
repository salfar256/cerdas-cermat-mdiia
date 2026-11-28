import {
  db, ref, onValue, set, update, serverTimestamp, increment, onDisconnect, ensureAnon, watchPublicRoom,
  SESI_NAMA, OPTIONS, isPaused, mediaJenis, mediaUrl, esc, teamList, sortedTeams, secondsLeft, getParam, fmtScore
} from "./common.js?v=20261128202713";

const $ = (id) => document.getElementById(id);
let code = null, uid = null, room = null, me = null, unwatch = null;
let myAns = {};            // qid -> pilihan yang sudah terkirim
let ansSub = null, ansQid = null;
let buzzResult = {};       // `${qid}|${buzzKey}` -> 'menang' | 'kalah'
let renderSig = "";

const show = (v) => ["vMasuk", "vTim", "vSiap", "vMain"].forEach((id) => $(id).classList.toggle("hidden", id !== v));

$("kode").value = getParam("r") || localStorage.getItem("cc_kode") || "";
$("formKode").onsubmit = (e) => { e.preventDefault(); join($("kode").value.trim()); };
$("gantiKode").onclick = () => { if (unwatch) unwatch(); localStorage.removeItem("cc_kode"); code = null; show("vMasuk"); };
if ($("kode").value && (getParam("r") || localStorage.getItem("cc_tim_" + $("kode").value))) join($("kode").value);

async function join(c) {
  $("errKode").textContent = "";
  if (!/^\d{4,6}$/.test(c)) { $("errKode").textContent = "Kode ruang berupa angka."; return; }
  try { uid = (await ensureAnon()).uid; } catch (e) {
    $("errKode").textContent = "Gagal terhubung: " + (e.code || e.message); show("vMasuk"); return;
  }
  code = c;
  if (unwatch) unwatch();
  unwatch = watchPublicRoom(c, (r, err) => {
    if (err || !r || !r.meta) {
      $("errKode").textContent = "Ruang tidak ditemukan. Periksa kode."; show("vMasuk"); if (unwatch) unwatch(); return;
    }
    localStorage.setItem("cc_kode", c);
    room = r;
    me = localStorage.getItem("cc_tim_" + c);
    if (!me || room.teams?.[me]?.uid !== uid) {
      // cari apakah HP ini sudah tercatat di salah satu kelompok
      const found = teamList(room).find((t) => t.uid === uid);
      me = found ? found.id : null;
      if (me) localStorage.setItem("cc_tim_" + c, me);
    }
    if (!me) { renderPick(); show("vTim"); return; }
    if (!room.status?.[me]?.ready) { renderSiap(); show("vSiap"); return; }
    mulaiPantau();
    if (!$("modalPergi").classList.contains("hidden")) $("jmlPergi").textContent = room.status[me].pelanggaran || 1;
    show("vMain");
    subAnswer();
    render();
  });
}

function renderPick() {
  $("timPick").innerHTML = teamList(room).map((t) => `
    <button data-t="${t.id}" style="background:${t.color}" ${t.uid ? "disabled" : ""}>
      ${esc(t.name)}${t.uid ? " · sudah dipakai" : ""}</button>`).join("");
}
$("timPick").onclick = async (e) => {
  const t = e.target.closest("button")?.dataset.t;
  if (!t) return;
  try {
    await set(ref(db, `rooms/${code}/teams/${t}/uid`), uid);
    localStorage.setItem("cc_tim_" + code, t);
  } catch (ex) {
    alert("Kelompok ini sudah dipakai HP lain. Minta operator menekan 'Lepas HP' jika perlu.");
  }
};

// ---------- Tombol SIAP & pemantauan keluar halaman ----------
function renderSiap() {
  const t = room.teams[me];
  $("siapNama").textContent = t.name;
  $("siapHead").style.background = t.color;
}
$("btnSiap").onclick = async () => {
  $("btnSiap").disabled = true;
  try {
    await update(ref(db, `rooms/${code}/status/${me}`), { ready: true, readyAt: serverTimestamp(), away: false, online: true });
  } catch (ex) { alert("Gagal: " + (ex.code || ex.message)); }
  $("btnSiap").disabled = false;
};
$("gantiTim").onclick = async () => {
  // lepaskan kelompok ini agar bisa memilih kelompok lain (hanya sebelum siap)
  try { await set(ref(db, `rooms/${code}/teams/${me}/uid`), null); } catch (ex) {
    alert("Minta operator menekan 'Lepas HP' untuk kelompok ini.");
  }
  localStorage.removeItem("cc_tim_" + code); me = null;
};

let pantauAktif = false, pergiSekarang = false, blurTimer = null, putusSub = null;
function mulaiPantau() {
  if (pantauAktif) return;
  pantauAktif = true;
  document.addEventListener("visibilitychange", () => { if (document.hidden) pergi(); else kembali(); });
  window.addEventListener("pagehide", pergi);
  // laptop: pindah ke jendela/aplikasi lain tanpa menyembunyikan tab
  window.addEventListener("blur", () => {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => { if (!document.hasFocus()) pergi(); }, 1500);
  });
  window.addEventListener("focus", () => { clearTimeout(blurTimer); if (!document.hidden) kembali(); });
  // tanda terhubung / terputus
  putusSub = onValue(ref(db, ".info/connected"), (s) => {
    if (s.val() !== true || !me) return;
    const r = ref(db, `rooms/${code}/status/${me}`);
    onDisconnect(r).update({ online: false });
    update(r, { online: true, ready: true }).catch(() => {});
  });
}
function statusRef() { return ref(db, `rooms/${code}/status/${me}`); }
function pergi() {
  if (pergiSekarang || !me || !room?.status?.[me]?.ready) return;
  pergiSekarang = true;
  update(statusRef(), { ready: true, away: true, awayAt: serverTimestamp(), pelanggaran: increment(1) }).catch(() => {});
}
function kembali() {
  if (!pergiSekarang) return;
  pergiSekarang = false;
  update(statusRef(), { ready: true, away: false, backAt: serverTimestamp() }).catch(() => {});
  $("jmlPergi").textContent = room?.status?.[me]?.pelanggaran || 1;
  $("modalPergi").classList.remove("hidden");
  navigator.vibrate?.([200, 100, 200]);
}
$("tutupPergi").onclick = () => $("modalPergi").classList.add("hidden");

function subAnswer() {
  const qid = room.state?.qid;
  if (qid === ansQid) return;
  if (ansSub) ansSub();
  ansQid = qid; ansSub = null;
  if (!qid) return;
  ansSub = onValue(ref(db, `rooms/${code}/answers/${qid}/${me}`), (s) => {
    if (s.exists()) { const v = s.val(); myAns[qid] = v.choice ?? v.text; render(); }
  }, () => {});
}

// ---------- Render ----------
function render() {
  if (!room || !me) return;
  const s = room.state || {}, c = room.current, t = room.teams[me];
  const ranks = sortedTeams(room);
  const pos = ranks.findIndex((x) => x.id === me) + 1;
  $("head").style.background = t.color || "var(--hijau)";
  $("hNama").textContent = t.name;
  $("hSesi").textContent = `${SESI_NAMA[s.session || 1]} · peringkat ${pos}`;
  $("hSkor").textContent = fmtScore(t.score);

  const qid = s.qid;
  const sudah = qid && myAns[qid];
  const bkey = `${qid}|${s.buzzKey}`;
  const sig = JSON.stringify([isPaused(s), s.phase, s.session, qid, c?.qid, s.msg, s.turnTeam, s.answeringTeam, s.buzzKey, s.locked?.[me], sudah, buzzResult[bkey], room.reveal?.key, ranks.map((x) => x.score)]);
  if (sig === renderSig) return;
  renderSig = sig;

  let h = "";
  const mj = mediaJenis(c?.media);
  const soalBox = c ? `<div class="hp-soal"><div class="small muted">Soal no. ${c.number}</div>${esc(c.soal)}
    ${mj === "gambar" ? `<img src="${esc(mediaUrl(c.media))}" alt="" class="hp-gambar">` : mj === "audio" ? `<div class="small" style="margin-top:.5rem;color:var(--hijau)">🔊 Dengarkan audio soal di layar</div>` : ""}</div>` : "";
  const lisan = c?.tipe === "lisan";
  const tanpaOpsi = !!c && !c.a && !c.b && !c.c && !c.d;            // pengaman: soal tanpa opsi bukan PG
  const isian = c?.tipe === "isian" || lisan || tanpaOpsi;   // isian & lisan: kunci berupa teks
  const opsiPG = (enabled, ringkas = false) => `<div class="hp-opsi${ringkas ? " ringkas" : ""}">${OPTIONS.map((o) => `
      <button data-o="${o}" ${enabled ? "" : "disabled"} class="${sudah === o ? "dipilih" : ""}"><b>${o}</b><span>${esc(c[o.toLowerCase()])}</span></button>`).join("")}</div>`;
  // Soal isian: kolom ketik; pilihan ganda: tombol A-D
  const opsi = (enabled, ringkas = false) => lisan
    ? (enabled ? (s.session === 2
        ? `<button class="buzz-btn" id="jawabLisan">SAYA<br>JAWAB</button><div class="center muted">Tekan secepatnya, lalu ucapkan jawaban saat dipanggil juri</div>`
        : msg("🗣️", "Ucapkan jawaban Anda kepada juri")) : "")
    : isian
    ? (enabled ? `<form class="hp-isian" id="fIsian"><input id="isianTxt" maxlength="200" autocomplete="off" placeholder="Ketik jawaban..."><button class="btn besar">Kirim jawaban</button></form>` : "")
    : opsiPG(enabled, ringkas);
  const msg = (ico, text, sub = "") => `<div class="hp-msg"><span class="big">${ico}</span>${text}${sub ? `<div class="small muted" style="font-weight:500;margin-top:.4rem">${sub}</div>` : ""}</div>`;
  const nm = (id) => esc(room.teams[id]?.name || "");

  if (s.phase === "intro") {
    h = msg("🎬", SESI_NAMA[s.session || 1], "Simak pembukaan sesi di layar");
  } else if (s.phase === "recap") {
    h = msg("📊", `Rekap ${SESI_NAMA[s.recapSesi || s.session || 1]}`, `Anda peringkat ${pos} · skor ${fmtScore(t.score)}`);
  } else if (s.phase === "countdown") {
    h = `<div class="center muted">Soal no. ${c?.number || ""} segera tampil</div><div class="hp-hitung" id="hpHitung"></div>`;
  } else if (s.phase === "idle" || !s.phase) {
    h = msg("⏳", "Menunggu soal berikutnya", SESI_NAMA[s.session || 1]);
  } else if (s.phase === "final") {
    h = msg(pos === 1 ? "🏆" : "🎖️", `Peringkat ${pos}`, `Skor akhir ${fmtScore(t.score)}`) +
      `<div class="card">${ranks.map((x, i) => `<div class="row between"><span>${i + 1}. ${esc(x.name)}</span><b>${fmtScore(x.score)}</b></div>`).join("")}</div>`;
  } else if (!c) {
    h = msg("⏳", "Menunggu soal...");
  } else if (s.phase === "open" && s.session === 1) {
    if (s.turnTeam === me && lisan) h = msg("🙋", "Giliran Anda!") + soalBox + opsi(true);
    else if (s.turnTeam === me) h = sudah ? soalBox + msg("📨", `Jawaban terkirim: ${esc(sudah)}`, "Menunggu hasil...") : soalBox + opsi(true);
    else h = msg("👀", `Giliran ${nm(s.turnTeam)}`, isian ? "Simak jawaban kelompok yang mendapat giliran" : "Pilihan jawaban hanya bisa dipilih kelompok yang mendapat giliran") + soalBox + opsi(false);
  } else if (s.phase === "open" && s.session === 2) {
    h = soalBox + (sudah ? (sudah === "(lisan)" ? msg("✋", "Urutan Anda tercatat", "Ucapkan jawaban saat dipanggil juri") : msg("📨", `Jawaban terkirim: ${esc(sudah)}`, "Menunggu kelompok lain...")) : opsi(true));
  } else if (s.phase === "ready") {
    h = soalBox + opsi(false, true) + `<button class="buzz-btn" disabled>TUNGGU</button>` +
      (s.locked?.[me] ? msg("🔒", "Kelompok Anda sudah menjawab salah") : `<div class="center muted">Buzzer segera dibuka...</div>`);
  } else if (s.phase === "buzz") {
    const lk = s.locked?.[me];
    const kalah = buzzResult[bkey] === "kalah";
    h = soalBox + opsi(false, true) + `<button class="buzz-btn" id="buzz" ${lk || kalah ? "disabled" : ""}>ANGKAT<br>TANGAN</button>` +
      (lk ? msg("🔒", "Kelompok Anda sudah menjawab salah") : kalah ? `<div class="center muted">Kalah cepat...</div>` : "");
  } else if (s.phase === "answering") {
    if (s.answeringTeam === me && lisan) h = msg("🙋", "Anda tercepat!", "Ucapkan jawaban Anda kepada juri sekarang") + soalBox;
    else if (s.answeringTeam === me) h = msg("🙋", isian ? "Anda tercepat! Jawab:" : "Anda tercepat! Pilih jawaban:", isian ? "Ketik jawaban, atau jawab lisan kepada juri" : "") + soalBox + (sudah ? msg("📨", `Jawaban terkirim: ${esc(sudah)}`) : opsi(true));
    else h = msg("🙋", `${nm(s.answeringTeam)} sedang menjawab`) + soalBox + opsi(false);
  } else if (s.phase === "judging") {
    h = soalBox + (sudah && sudah !== "(lisan)" ? msg("📨", `Jawaban terkirim: ${esc(sudah)}`, "Juri sedang menilai...") : msg("⚖️", "Juri sedang menilai..."));
  } else if (s.phase === "reveal") {
    const r = room.reveal?.results?.[me];
    const key = room.reveal?.key;
    let hasil;
    if (r && r.choice) hasil = r.correct
      ? msg("✅", `Benar! +${r.points}`, r.rank ? `Urutan benar ke-${r.rank}` : "")
      : msg("❌", r.points < 0 ? `Salah (${r.points})` : "Salah", r.choice === "(lisan)" ? "" : `Jawaban Anda: ${esc(r.choice)}`);
    else if (s.session === 1 && s.turnTeam !== me) hasil = msg("📋", `Jawaban benar: ${key}`, esc(s.msg || ""));
    else hasil = msg("⌛", "Tidak menjawab", s.session === 3 ? "" : "Waktu habis");
    h = hasil + `<div class="center"><span class="pill">Kunci: ${isian ? esc(key) : `${key} · ${esc(c[String(key).toLowerCase()] || "")}`}</span></div>`;
  }
  const ketik = $("isianTxt")?.value || "";
  if (isPaused(s)) h = `<div class="jeda-banner">⏸ Waktu dijeda oleh juri</div><div class="dijeda">${h}</div>`;
  $("body").innerHTML = h;
  if ($("isianTxt")) { $("isianTxt").value = ketik; }
  tick();
}

$("body").addEventListener("submit", async (e) => {
  if (e.target.id !== "fIsian") return;
  e.preventDefault();
  const text = $("isianTxt").value.trim().slice(0, 200);
  if (!text) { $("isianTxt").focus(); return; }
  const qid = room.state?.qid;
  e.target.querySelectorAll("input,button").forEach((x) => x.disabled = true);
  try {
    await set(ref(db, `rooms/${code}/answers/${qid}/${me}`), { text, ts: serverTimestamp() });
    myAns[qid] = text; navigator.vibrate?.(60);
  } catch (ex) {
    alert("Jawaban tidak diterima (waktu habis atau bukan giliran).");
  }
  renderSig = ""; render();
});

$("body").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn || btn.disabled) return;
  const s = room.state || {};
  if (btn.id === "jawabLisan") {
    btn.disabled = true;
    try {
      await set(ref(db, `rooms/${code}/answers/${s.qid}/${me}`), { text: "(lisan)", ts: serverTimestamp() });
      myAns[s.qid] = "(lisan)"; navigator.vibrate?.([80, 40, 80]);
    } catch (ex) { alert("Tidak tercatat (waktu habis)."); }
    renderSig = ""; render(); return;
  }
  if (btn.dataset.o) {
    const choice = btn.dataset.o, qid = s.qid;
    document.querySelectorAll(".hp-opsi button").forEach((b) => b.disabled = true);
    btn.classList.add("dipilih");
    try {
      await set(ref(db, `rooms/${code}/answers/${qid}/${me}`), { choice, ts: serverTimestamp() });
      myAns[qid] = choice; navigator.vibrate?.(60);
    } catch (ex) {
      alert("Jawaban tidak diterima (waktu habis atau bukan giliran).");
    }
    renderSig = ""; render();
  }
  if (btn.id === "buzz") {
    const key = `${s.qid}|${s.buzzKey}`;
    btn.disabled = true;
    try {
      await set(ref(db, `rooms/${code}/buzz/${s.qid}/${s.buzzKey}`), { team: me, ts: serverTimestamp() });
      buzzResult[key] = "menang"; navigator.vibrate?.([80, 40, 80]);
    } catch (ex) {
      buzzResult[key] = "kalah";
    }
    renderSig = ""; render();
  }
});

function tick() {
  const s = room?.state;
  if (!s) return;
  const aktif = ["open", "ready", "buzz", "answering"].includes(s.phase);
  if (s.phase === "countdown" && $("hpHitung")) $("hpHitung").textContent = isPaused(s) ? "⏸" : Math.max(1, Math.ceil(secondsLeft(s)));
  $("timer").textContent = s.phase === "countdown" ? "" : aktif ? `${isPaused(s) ? "⏸" : "⏱"} ${Math.ceil(secondsLeft(s))}` : "";
}
setInterval(tick, 150);

// Jaga layar HP tetap menyala selama lomba
async function keepAwake() { try { await navigator.wakeLock?.request("screen"); } catch (e) {} }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") keepAwake(); });
document.addEventListener("click", keepAwake, { once: true });
keepAwake();
