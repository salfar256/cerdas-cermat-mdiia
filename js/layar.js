import {
  ensureAnon, watchPublicRoom, SESI_NAMA, OPTIONS, esc, teamList, sortedTeams, secondsLeft,
  isPaused, getParam, preloadSounds, unlockSounds, playSound, fmtScore, settingsOf
} from "./common.js?v=20261127232326";

const $ = (id) => document.getElementById(id);
let room = null, lastSfx = undefined, renderSig = "", unwatch = null;
const totals = {};

preloadSounds();
$("kode").value = getParam("r") || localStorage.getItem("cc_layar_kode") || "";

$("formKode").onsubmit = async (e) => {
  e.preventDefault();
  unlockSounds();
  const c = $("kode").value.trim();
  try { await ensureAnon(); } catch (ex) { $("err").textContent = "Gagal terhubung: " + (ex.code || ex.message); return; }
  if (unwatch) unwatch();
  unwatch = watchPublicRoom(c, (r, err) => {
    if (err || !r || !r.meta) { $("err").textContent = "Ruang tidak ditemukan."; $("overlay").classList.remove("hidden"); return; }
    localStorage.setItem("cc_layar_kode", c);
    $("overlay").classList.add("hidden");
    $("kodeTampil").textContent = c;
    room = r;
    const sfx = room.state?.sfx;
    if (lastSfx === undefined) lastSfx = sfx?.id || null;
    else if (sfx && sfx.id !== lastSfx) { lastSfx = sfx.id; playSound(sfx.kind); }
    render();
  });
  try { document.documentElement.requestFullscreen?.(); } catch (e) {}
};

const ATURAN = {
  1: ["Kelompok menjawab jatah soalnya secara berurutan, mulai dari kelompok pertama.", "Jawab benar mendapat poin. Jawaban salah: soal hangus."],
  2: ["Semua kelompok menjawab soal yang sama.", "Makin cepat dan benar, makin besar poinnya. Salah = 0."],
  3: ["Tekan tombol ANGKAT TANGAN paling cepat untuk menjawab.", "Benar menambah poin, salah mengurangi poin dan soal dibuka lagi untuk kelompok lain."]
};

function render() {
  if (!room) return;
  const s = room.state || {}, c = room.current, st = settingsOf(room);
  $("judul").innerHTML = `${esc(room.meta?.name || "Cerdas Cermat")}<small>Ma'had Dirosah Islamiyah Ibnu Aqil</small>`;
  $("sesi").textContent = SESI_NAMA[s.session || 1];

  const sig = JSON.stringify([s, c, room.reveal, room.teams]);
  if (sig !== renderSig) {
    renderSig = sig;
    renderMain(s, c, st);
    renderScore(s);
  }
  tick();
}

function renderMain(s, c, st) {
  const main = $("main");
  main.classList.remove("padat");
  if (s.phase === "final") {
    const r = sortedTeams(room);
    const urut = [r[1], r[0], r[2]].filter(Boolean);
    const tinggi = { 0: "34vh", 1: "24vh", 2: "17vh" };
    main.innerHTML = `<div class="layar-besar"><h1>🏆 Juara Cerdas Cermat</h1>
      <div class="podium">${urut.map((t) => { const i = r.indexOf(t); return `
        <div class="p"><div class="nm">${esc(t.name)}</div><div class="sk">${fmtScore(t.score)} poin</div>
        <div class="blok" style="height:${tinggi[i]};background:${t.color}">${i + 1}</div></div>`; }).join("")}</div>
      ${r[3] ? `<p>Peringkat 4: ${esc(r[3].name)} · ${fmtScore(r[3].score)} poin</p>` : ""}</div>`;
    return;
  }
  if (s.phase === "idle" || !c || !s.phase) {
    const ses = s.session || 1;
    const poin = ses === 1 ? `Benar +${st.s1Correct}` : ses === 2 ? `Benar ke-1/2/3/4: ${String(st.s2Points).split(",").map((x) => "+" + x).join(" / ")}` : `Benar +${st.s3Correct} · Salah −${st.s3Wrong}`;
    main.innerHTML = `<div class="layar-besar"><p style="margin:0">Bersiap untuk</p><h1>${SESI_NAMA[ses]}</h1>
      <div class="garis-emas"></div>${ATURAN[ses].map((a) => `<p style="margin:.6vh 0">${a}</p>`).join("")}
      <p><span class="pill emas" style="font-size:1.5vw">${poin}</span></p></div>`;
    return;
  }

  const rev = s.phase === "reveal" ? room.reveal : null;
  const key = rev?.key;
  let pesan = esc(s.msg || "");
  let banner = "";
  if (s.phase === "answering") {
    const t = room.teams[s.answeringTeam];
    banner = `<div class="buzz-banner" style="background:${t?.color}">🙋 ${esc(t?.name)}</div>`;
    pesan = "Menjawab...";
  }
  if (s.phase === "buzz") pesan = "🔔 " + esc(s.msg || "Buzzer dibuka!");
  if (s.phase === "ready") pesan = esc(s.msg || "Baca soal...");
  if (isPaused(s)) pesan = "⏸ Waktu dijeda";

  let hasil = "";
  if (rev && s.session === 2) {
    const rows = teamList(room).map((t) => ({ t, r: rev.results?.[t.id] || {} }))
      .sort((a, b) => (a.r.rank ?? 99) - (b.r.rank ?? 99) || (a.r.ms ?? 1e9) - (b.r.ms ?? 1e9));
    hasil = `<div class="hasil-tabel"><table><thead><tr><th>Kelompok</th><th>Jawaban</th><th>Waktu</th><th>Poin</th></tr></thead><tbody>
      ${rows.map(({ t, r }) => `<tr><td>${esc(t.name)}</td><td>${r.choice ? (r.choice === "(lisan)" ? "🗣️ lisan" : esc(r.choice)) + (r.correct ? " ✔" : " ✘") : "—"}</td>
        <td>${r.ms != null ? (r.ms / 1000).toFixed(2) + " dtk" : "—"}</td><td>${r.points ? "+" + r.points : "0"}</td></tr>`).join("")}</tbody></table></div>`;
  }

  main.classList.toggle("padat", !!hasil);
  main.innerHTML = `
    <div class="layar-info"><div class="pesan">${pesan}</div>
      <div class="timer-ring" id="ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" stroke="rgba(255,255,255,.2)" stroke-width="9" fill="none"/>
        <circle id="ringArc" cx="50" cy="50" r="44" stroke="#d4a017" stroke-width="9" fill="none" stroke-linecap="round" stroke-dasharray="276.5" stroke-dashoffset="0"/></svg>
        <div class="angka" id="ringNum"></div></div></div>
    ${banner}
    <div class="layar-soal" style="${banner ? "margin-top:2vh" : ""}"><span class="nomor">Soal no. ${c.number}</span>${esc(c.soal)}</div>
    ${["isian", "lisan"].includes(c.tipe) || (!c.a && !c.b && !c.c && !c.d)
      ? (key ? `<div class="layar-kunci">✔ Jawaban: ${esc(key)}</div>` : s.phase === "judging" ? `<div class="layar-tunggu">⚖️ Juri sedang menilai...</div>` : `<div class="layar-tunggu">${c.tipe === "lisan" ? "🗣️ Jawab secara lisan" : "✍️ Soal isian singkat"}</div>`)
      : `<div class="layar-opsi">${OPTIONS.map((o) => `<div class="${key ? (o === key ? "benar" : "redup") : ""}"><b>${o}</b><span>${esc(c[o.toLowerCase()])}</span></div>`).join("")}</div>`}
    ${hasil}`;
}

function renderScore(s) {
  const teams = teamList(room);
  const res = s.phase === "reveal" ? room.reveal?.results || {} : {};
  $("skor").style.gridTemplateColumns = `repeat(${teams.length}, 1fr)`;
  $("skor").innerHTML = teams.map((t) => {
    const sorot = (["open", "judging"].includes(s.phase) && s.session === 1 && s.turnTeam === t.id) || (["answering", "judging"].includes(s.phase) && s.session === 3 && s.answeringTeam === t.id);
    const redup = ["ready", "buzz", "answering"].includes(s.phase) && s.locked?.[t.id];
    const r = res[t.id];
    const delta = r && r.points ? `<span class="delta">${r.points > 0 ? "+" : ""}${r.points}</span>` : "";
    const tag = sorot ? `<span class="tag">${s.phase === "answering" ? "menjawab" : "giliran"}</span>` : redup ? `<span class="tag">terkunci</span>` : "";
    return `<div class="tim ${sorot ? "sorot" : ""} ${redup ? "redup" : ""}" style="background:${t.color}">${tag}
      <span class="nm">${esc(t.name)}</span><span class="sk">${fmtScore(t.score)}${delta}</span></div>`;
  }).join("");
}

function tick() {
  const s = room?.state;
  const ring = $("ring");
  if (!s || !ring) return;
  const aktif = ["open", "ready", "buzz", "answering"].includes(s.phase);
  ring.style.visibility = aktif ? "visible" : "hidden";
  if (!aktif) return;
  const left = secondsLeft(s);
  const k = `${s.runId}|${s.phase}|${s.buzzKey}`;
  totals[k] = Math.max(totals[k] || 0, left);
  const frac = totals[k] ? left / totals[k] : 0;
  $("ringArc").setAttribute("stroke-dashoffset", String(276.5 * (1 - frac)));
  $("ringNum").textContent = Math.ceil(left);
  ring.classList.toggle("kritis", left <= 5 && !isPaused(s));
  ring.classList.toggle("jeda", isPaused(s));
}
setInterval(tick, 200);
