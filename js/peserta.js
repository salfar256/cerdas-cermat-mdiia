import {
  db, ref, onValue, set, serverTimestamp, ensureAnon, watchPublicRoom,
  SESI_NAMA, OPTIONS, esc, teamList, sortedTeams, secondsLeft, getParam, fmtScore
} from "./common.js";

const $ = (id) => document.getElementById(id);
let code = null, uid = null, room = null, me = null, unwatch = null;
let myAns = {};            // qid -> pilihan yang sudah terkirim
let ansSub = null, ansQid = null;
let buzzResult = {};       // `${qid}|${buzzKey}` -> 'menang' | 'kalah'
let renderSig = "";

const show = (v) => ["vMasuk", "vTim", "vMain"].forEach((id) => $(id).classList.toggle("hidden", id !== v));

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

function subAnswer() {
  const qid = room.state?.qid;
  if (qid === ansQid) return;
  if (ansSub) ansSub();
  ansQid = qid; ansSub = null;
  if (!qid) return;
  ansSub = onValue(ref(db, `rooms/${code}/answers/${qid}/${me}`), (s) => {
    if (s.exists()) { myAns[qid] = s.val().choice; render(); }
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
  const sig = JSON.stringify([s.phase, s.session, qid, c?.qid, s.msg, s.turnTeam, s.answeringTeam, s.buzzKey, s.locked?.[me], sudah, buzzResult[bkey], room.reveal?.key, ranks.map((x) => x.score)]);
  if (sig === renderSig) return;
  renderSig = sig;

  let h = "";
  const soalBox = c ? `<div class="hp-soal"><div class="small muted">Soal no. ${c.number}</div>${esc(c.soal)}</div>` : "";
  const opsi = (enabled) => `<div class="hp-opsi">${OPTIONS.map((o) => `
      <button data-o="${o}" ${enabled ? "" : "disabled"} class="${sudah === o ? "dipilih" : ""}"><b>${o}</b><span>${esc(c[o.toLowerCase()])}</span></button>`).join("")}</div>`;
  const msg = (ico, text, sub = "") => `<div class="hp-msg"><span class="big">${ico}</span>${text}${sub ? `<div class="small muted" style="font-weight:500;margin-top:.4rem">${sub}</div>` : ""}</div>`;
  const nm = (id) => esc(room.teams[id]?.name || "");

  if (s.phase === "idle" || !s.phase) {
    h = msg("⏳", "Menunggu soal berikutnya", SESI_NAMA[s.session || 1]);
  } else if (s.phase === "final") {
    h = msg(pos === 1 ? "🏆" : "🎖️", `Peringkat ${pos}`, `Skor akhir ${fmtScore(t.score)}`) +
      `<div class="card">${ranks.map((x, i) => `<div class="row between"><span>${i + 1}. ${esc(x.name)}</span><b>${fmtScore(x.score)}</b></div>`).join("")}</div>`;
  } else if (!c) {
    h = msg("⏳", "Menunggu soal...");
  } else if (s.phase === "open" && s.session === 1) {
    if (s.turnTeam === me) h = sudah ? soalBox + msg("📨", `Jawaban terkirim: ${sudah}`, "Menunggu hasil...") : soalBox + opsi(true);
    else h = msg("👀", `Giliran ${nm(s.turnTeam)}`, "Simak soalnya di layar") + soalBox;
  } else if (s.phase === "open" && s.session === 2) {
    h = soalBox + (sudah ? msg("📨", `Jawaban terkirim: ${sudah}`, "Menunggu kelompok lain...") : opsi(true));
  } else if (s.phase === "ready") {
    h = soalBox + `<button class="buzz-btn" disabled>TUNGGU</button>` +
      (s.locked?.[me] ? msg("🔒", "Kelompok Anda sudah menjawab salah") : `<div class="center muted">Buzzer segera dibuka...</div>`);
  } else if (s.phase === "buzz") {
    const lk = s.locked?.[me];
    const kalah = buzzResult[bkey] === "kalah";
    h = soalBox + `<button class="buzz-btn" id="buzz" ${lk || kalah ? "disabled" : ""}>ANGKAT<br>TANGAN</button>` +
      (lk ? msg("🔒", "Kelompok Anda sudah menjawab salah") : kalah ? `<div class="center muted">Kalah cepat...</div>` : "");
  } else if (s.phase === "answering") {
    if (s.answeringTeam === me) h = msg("🙋", "Anda tercepat! Pilih jawaban:") + soalBox + (sudah ? msg("📨", `Jawaban terkirim: ${sudah}`) : opsi(true));
    else h = msg("🙋", `${nm(s.answeringTeam)} sedang menjawab`) + soalBox;
  } else if (s.phase === "reveal") {
    const r = room.reveal?.results?.[me];
    const key = room.reveal?.key;
    let hasil;
    if (r && r.choice) hasil = r.correct
      ? msg("✅", `Benar! +${r.points}`, r.rank ? `Urutan benar ke-${r.rank}` : "")
      : msg("❌", r.points < 0 ? `Salah (${r.points})` : "Salah", `Jawaban Anda ${r.choice}`);
    else if (s.session === 1 && s.turnTeam !== me) hasil = msg("📋", `Jawaban benar: ${key}`, esc(s.msg || ""));
    else hasil = msg("⌛", "Tidak menjawab", s.session === 3 ? "" : "Waktu habis");
    h = hasil + `<div class="center"><span class="pill">Kunci: ${key} · ${esc(c[String(key).toLowerCase()] || "")}</span></div>`;
  }
  $("body").innerHTML = h;
  tick();
}

$("body").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn || btn.disabled) return;
  const s = room.state || {};
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
  $("timer").textContent = aktif ? `⏱ ${Math.ceil(secondsLeft(s))}` : "";
}
setInterval(tick, 250);

// Jaga layar HP tetap menyala selama lomba
async function keepAwake() { try { await navigator.wakeLock?.request("screen"); } catch (e) {} }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") keepAwake(); });
document.addEventListener("click", keepAwake, { once: true });
keepAwake();
