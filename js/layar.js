import {
  ensureAnon, watchPublicRoom, SESI_NAMA, SESI_PENDEK, OPTIONS, esc, teamList, sortedTeams, secondsLeft,
  isPaused, mediaJenis, mediaUrl, getParam, preloadSounds, unlockSounds, playSound, fmtScore, settingsOf
} from "./common.js?v=20261128202713";

const $ = (id) => document.getElementById(id);
let room = null, lastSfx = undefined, renderSig = "", unwatch = null;
const totals = {};

preloadSounds();
$("kode").value = getParam("r") || localStorage.getItem("cc_layar_kode") || "";

$("formKode").onsubmit = async (e) => {
  e.preventDefault();
  unlockSounds();
  initAudio();
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
    else if (sfx && sfx.id !== lastSfx) { lastSfx = sfx.id; playSound(sfx.kind); duck(); }
    render();
    updateMusic();
    audioSoal();
  });
  try { document.documentElement.requestFullscreen?.(); } catch (e) {}
};

// =================================================================
// AUDIO: musik latar (Web Audio agar pengulangan mulus) & bunyi timer
// =================================================================
let actx = null, master = null, fx = null;
const buffers = {};
let track = null;            // { key, src, g }
let introFor = null, finalFor = null;
const MUSIK = { pembukaan: "sounds/pembukaan.mp3", sesi1: "sounds/sesi1.mp3", sesi2: "sounds/sesi2.mp3", sesi3: "sounds/sesi3.mp3" };

function initAudio() {
  if (actx) { actx.resume?.(); return; }
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain(); master.gain.value = 0; master.connect(actx.destination);
    fx = actx.createGain(); fx.gain.value = 0.5; fx.connect(actx.destination);
    for (const [k, url] of Object.entries(MUSIK)) {
      fetch(url).then((r) => r.arrayBuffer()).then((b) => actx.decodeAudioData(b))
        .then((buf) => { buffers[k] = buf; updateMusic(); }).catch(() => {});
    }
  } catch (e) { actx = null; }
}

function musikVol() {
  const st = settingsOf(room);
  return st.musik === false ? 0 : Math.max(0, Math.min(100, Number(st.musikVol) || 0)) / 100;
}
let ducking = false;
function setMaster(v, t = 0.4) {
  if (!actx) return;
  const now = actx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(v, now + t);
}
function duck() {
  // kecilkan musik sebentar saat bunyi buzzer/benar/salah
  if (!actx) return;
  ducking = true; setMaster(musikVol() * 0.2, 0.08);
  clearTimeout(duck._t);
  duck._t = setTimeout(() => { ducking = false; setMaster(audioBerbunyi ? 0 : musikVol(), 0.8); }, 2200);
}

function stopTrack(fade = 0.8) {
  if (!track) return;
  const { src, g } = track;
  const now = actx.currentTime;
  g.gain.cancelScheduledValues(now); g.gain.setValueAtTime(g.gain.value, now); g.gain.linearRampToValueAtTime(0, now + fade);
  try { src.stop(now + fade + 0.05); } catch (e) {}
  track = null;
}
function playTrack(key, loop, onEnd) {
  if (!actx || !buffers[key]) return false;
  stopTrack(0.6);
  const src = actx.createBufferSource(), g = actx.createGain();
  src.buffer = buffers[key]; src.loop = loop;
  g.gain.value = 0; src.connect(g); g.connect(master);
  const now = actx.currentTime;
  g.gain.linearRampToValueAtTime(1, now + (loop ? 1.2 : 0.05));
  src.start();
  const t = { key, src, g, loop };
  src.onended = () => { if (track === t) { track = null; onEnd?.(); } };
  track = t;
  return true;
}

function updateMusic() {
  if (!actx || !room) return;
  if (!ducking) setMaster(audioBerbunyi ? 0 : musikVol());
  const s = room.state || {};
  const sesiKey = "sesi" + (s.session || 1);
  if (s.phase === "intro") {
    if (introFor !== s.introId) {
      if (playTrack("pembukaan", false, () => updateMusic())) introFor = s.introId;
      return;
    }
    if (track?.key === "pembukaan") return;           // pembukaan masih berbunyi
  }
  if (s.phase === "final") {
    if (finalFor !== s.runId + "|final") {
      if (playTrack("pembukaan", false)) finalFor = s.runId + "|final";
    }
    return;
  }
  finalFor = null;
  if (track?.key === "pembukaan" && !track.loop && s.phase === "intro") return;
  if (track?.key !== sesiKey) playTrack(sesiKey, true);
}

// ---------- Audio soal (misal: lanjutkan ayat) ----------
let audioEl = null, audioSrc = "", audioRun = null, audioReplay = null, audioBerbunyi = false;
const FASE_SOAL = ["open", "ready", "buzz", "answering"];
function audioSoal() {
  const s = room.state || {}, c = room.current;
  const url = c?.media && mediaJenis(c.media) === "audio" ? mediaUrl(c.media) : "";
  if (url !== audioSrc) {                    // soal berganti: hentikan audio lama, siapkan yang baru
    if (audioEl) { audioEl.pause(); audioEl = null; }
    audioSrc = url; audioRun = null; audioReplay = s.audioPlay || null;
    setBerbunyi(false);
    if (url) { audioEl = new Audio(url); audioEl.preload = "auto";
      audioEl.onplay = () => setBerbunyi(true);
      audioEl.onended = audioEl.onpause = () => setBerbunyi(false); }
  }
  if (!audioEl) return;
  // putar otomatis sekali ketika soal benar-benar tampil (setelah hitung mundur)
  if (FASE_SOAL.includes(s.phase) && !isPaused(s) && audioRun !== s.runId) { audioRun = s.runId; putarAudio(); }
  // tombol "Putar audio di layar" dari operator
  if (s.audioPlay && s.audioPlay !== audioReplay) { audioReplay = s.audioPlay; putarAudio(); }
  if (["reveal", "idle", "intro", "recap", "final"].includes(s.phase) && !audioEl.paused) audioEl.pause();
}
function putarAudio() {
  try { audioEl.currentTime = 0; audioEl.play().catch(() => {}); } catch (e) {}
}
function setBerbunyi(v) {
  audioBerbunyi = v;
  if (actx && !ducking) setMaster(v ? 0 : musikVol(), v ? 0.3 : 1.2);
  const ind = $("indAudio");
  if (ind) ind.classList.toggle("bunyi", v), ind.textContent = v ? "🔊 Audio soal diputar..." : "🔊 Audio soal";
}

function beep(freq, dur = 0.12, vol = 0.6, type = "sine") {
  if (!actx) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = freq;
  const now = actx.currentTime;
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(vol, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  o.connect(g); g.connect(fx); o.start(now); o.stop(now + dur + 0.02);
}

// =================================================================
// TAMPILAN
// =================================================================
const ATURAN = {
  1: ["Kelompok menjawab jatah soalnya secara berurutan, mulai dari kelompok pertama.", "Jawab benar mendapat poin. Jawaban salah: soal hangus."],
  2: ["Semua kelompok menjawab soal yang sama.", "Makin cepat dan benar, makin besar poinnya. Salah = 0."],
  3: ["Tekan tombol ANGKAT TANGAN paling cepat untuk menjawab.", "Benar menambah poin, salah mengurangi poin dan soal dibuka lagi untuk kelompok lain."]
};

function poinTeks(ses, st) {
  return ses === 1 ? `Benar +${st.s1Correct}` : ses === 2 ? `Benar ke-1/2/3/4: ${String(st.s2Points).split(",").map((x) => "+" + x).join(" / ")}` : `Benar +${st.s3Correct} · Salah −${st.s3Wrong}`;
}

function render() {
  if (!room) return;
  const s = room.state || {}, c = room.current, st = settingsOf(room);
  $("judul").innerHTML = `${esc(room.meta?.name || "Cerdas Cermat")}<small>Ma'had Dirosah Islamiyah Ibnu Aqil</small>`;
  $("sesi").textContent = SESI_NAMA[s.session || 1];

  const sig = JSON.stringify([s, c, room.reveal, room.teams, st]);
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
  const ses = s.session || 1;
  if (s.phase === "final") {
    const r = sortedTeams(room);
    const urut = [r[1], r[0], r[2]].filter(Boolean);
    const tinggi = { 0: "34vh", 1: "24vh", 2: "17vh" };
    main.innerHTML = `<div class="layar-besar"><h1 class="muncul">🏆 Juara Cerdas Cermat</h1>
      <div class="podium">${urut.map((t) => { const i = r.indexOf(t); return `
        <div class="p naik-podium" style="animation-delay:${(2 - i) * 0.6}s"><div class="nm">${esc(t.name)}</div><div class="sk">${fmtScore(t.score)} poin</div>
        <div class="blok" style="height:${tinggi[i]};background:${t.color}">${i + 1}</div></div>`; }).join("")}</div>
      ${r[3] ? `<p>Peringkat 4: ${esc(r[3].name)} · ${fmtScore(r[3].score)} poin</p>` : ""}</div>`;
    return;
  }
  if (s.phase === "intro") {
    main.innerHTML = `<div class="layar-besar intro">
      <div class="intro-sesi">SESI ${ses}</div>
      <h1 class="intro-judul">${esc(SESI_PENDEK[ses])}</h1>
      <div class="garis-emas lebar"></div>
      ${ATURAN[ses].map((a, i) => `<p class="intro-aturan" style="animation-delay:${1.4 + i * 0.5}s">${a}</p>`).join("")}
      <p class="intro-aturan" style="animation-delay:2.6s"><span class="pill emas" style="font-size:1.5vw">${poinTeks(ses, st)}</span></p></div>`;
    return;
  }
  if (s.phase === "recap") {
    const rs = s.recapSesi || ses;
    const teams = sortedTeams(room);
    main.innerHTML = `<div class="layar-besar"><p style="margin:0">Rekap</p><h1 class="muncul">${SESI_NAMA[rs]} selesai</h1>
      <div class="hasil-tabel rekap"><table><thead><tr><th>#</th><th>Kelompok</th><th>Sesi 1</th><th>Sesi 2</th><th>Sesi 3</th><th>Total</th></tr></thead><tbody>
      ${teams.map((t, i) => `<tr class="baris-rekap" style="animation-delay:${0.3 + i * 0.25}s"><td>${i + 1}</td><td><span class="team-dot" style="display:inline-block;background:${t.color}"></span> ${esc(t.name)}</td>
        ${[1, 2, 3].map((n) => `<td class="${n === rs ? "kolom-aktif" : ""}">${fmtScore(t.per?.["s" + n] || 0)}</td>`).join("")}
        <td><b>${fmtScore(t.score)}</b></td></tr>`).join("")}</tbody></table></div></div>`;
    return;
  }
  if (s.phase === "countdown") {
    main.innerHTML = `<div class="layar-besar"><p style="margin:0">${SESI_NAMA[ses]} · Soal no. ${c?.number || ""}</p>
      <div class="hitung" id="hitung"></div><p id="hitungSub">Bersiap...</p></div>`;
    return;
  }
  if (s.phase === "idle" || !c || !s.phase) {
    main.innerHTML = `<div class="layar-besar"><p style="margin:0">Bersiap untuk</p><h1>${SESI_NAMA[ses]}</h1>
      <div class="garis-emas"></div>${ATURAN[ses].map((a) => `<p style="margin:.6vh 0">${a}</p>`).join("")}
      <p><span class="pill emas" style="font-size:1.5vw">${poinTeks(ses, st)}</span></p></div>`;
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

  const gambar = c.media && mediaJenis(c.media) === "gambar";
  const audio = c.media && mediaJenis(c.media) === "audio";
  main.classList.toggle("padat", !!hasil || !!gambar);
  main.innerHTML = `
    <div class="layar-info"><div class="pesan">${pesan}</div>
      <div class="timer-ring" id="ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" stroke="rgba(255,255,255,.2)" stroke-width="9" fill="none"/>
        <circle id="ringArc" cx="50" cy="50" r="44" stroke="#d4a017" stroke-width="9" fill="none" stroke-linecap="round" stroke-dasharray="276.5" stroke-dashoffset="0"/></svg>
        <div class="angka" id="ringNum"></div></div></div>
    ${banner}
    <div class="layar-soal muncul ${gambar ? "punya-gambar" : ""}" style="${banner ? "margin-top:2vh" : ""}"><span class="nomor">Soal no. ${c.number}</span>
      <div class="teks-soal">${esc(c.soal)}${audio ? `<div class="ind-audio ${audioBerbunyi ? "bunyi" : ""}" id="indAudio">${audioBerbunyi ? "🔊 Audio soal diputar..." : "🔊 Audio soal"}</div>` : ""}</div>
      ${gambar ? `<img class="gambar-soal" src="${esc(mediaUrl(c.media))}" alt="">` : ""}</div>
    ${["isian", "lisan"].includes(c.tipe) || (!c.a && !c.b && !c.c && !c.d)
      ? (key ? `<div class="layar-kunci muncul">✔ Jawaban: ${esc(key)}</div>` : s.phase === "judging" ? `<div class="layar-tunggu">⚖️ Juri sedang menilai...</div>` : `<div class="layar-tunggu">${c.tipe === "lisan" ? "🗣️ Jawab secara lisan" : "✍️ Soal isian singkat"}</div>`)
      : `<div class="layar-opsi">${OPTIONS.map((o, i) => `<div class="${key ? (o === key ? "benar" : "redup") : "opsi-masuk"}" style="animation-delay:${0.15 + i * 0.12}s"><b>${o}</b><span>${esc(c[o.toLowerCase()])}</span></div>`).join("")}</div>`}
    ${hasil}`;
}

// ---------- Papan skor beranimasi ----------
const shown = {};           // skor yang sedang tampil per kelompok
let leaderPrev = undefined;

function leaderOf() {
  const r = sortedTeams(room);
  if (!r.length || !(r[0].score > 0)) return null;
  if (r[1] && r[1].score === r[0].score) return null;   // seri: tidak ada pemimpin
  return r[0].id;
}

function renderScore(s) {
  const teams = teamList(room);
  const res = s.phase === "reveal" ? room.reveal?.results || {} : {};
  const rank = Object.fromEntries(sortedTeams(room).map((t, i) => [t.id, i + 1]));
  const lead = leaderOf();
  $("skor").style.gridTemplateColumns = `repeat(${teams.length}, 1fr)`;
  $("skor").innerHTML = teams.map((t) => {
    const sorot = (["open", "judging"].includes(s.phase) && s.session === 1 && s.turnTeam === t.id) || (["answering", "judging"].includes(s.phase) && s.session === 3 && s.answeringTeam === t.id);
    const redup = ["ready", "buzz", "answering"].includes(s.phase) && s.locked?.[t.id];
    const r = res[t.id];
    const delta = r && r.points ? `<span class="delta ${r.points > 0 ? "plus" : "minus"}">${r.points > 0 ? "+" : ""}${r.points}</span>` : "";
    const tag = sorot ? `<span class="tag">${s.phase === "answering" ? "menjawab" : "giliran"}</span>` : redup ? `<span class="tag">terkunci</span>` : "";
    const awal = shown[t.id] ?? (t.score || 0);
    return `<div class="tim ${sorot ? "sorot" : ""} ${redup ? "redup" : ""}" data-t="${t.id}" style="background:${t.color}">${tag}
      <span class="nm">${lead === t.id ? "👑 " : ""}<span class="rank">#${rank[t.id]}</span> ${esc(t.name)}</span>
      <span class="sk"><span class="angka-skor">${fmtScore(awal)}</span>${delta}</span></div>`;
  }).join("");
  animateScores();
  if (leaderPrev !== undefined && lead && lead !== leaderPrev) flash(`🔥 ${esc(room.teams[lead].name)} memimpin!`);
  leaderPrev = lead;
}

function animateScores() {
  for (const t of teamList(room)) {
    const el = document.querySelector(`.tim[data-t="${t.id}"]`);
    if (!el) continue;
    const to = t.score || 0, from = shown[t.id] ?? to;
    shown[t.id] = to;
    if (from === to) continue;
    el.classList.add(to > from ? "naik" : "turun");
    setTimeout(() => el.classList.remove("naik", "turun"), 1400);
    const num = el.querySelector(".angka-skor"), t0 = performance.now(), dur = 1100;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      num.textContent = fmtScore(Math.round(from + (to - from) * e));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

function flash(html) {
  const f = $("flash");
  f.innerHTML = html;
  f.classList.remove("tampil"); void f.offsetWidth; f.classList.add("tampil");
}

// ---------- Timer, hitung mundur & detak ----------
let lastCount = null, lastTick = null, prevPhaseKey = null;
function tick() {
  const s = room?.state;
  if (!s) return;
  const phaseKey = `${s.runId}|${s.phase}|${s.buzzKey}`;

  if (s.phase === "countdown") {
    const n = Math.ceil(secondsLeft(s));
    const el = $("hitung");
    if (el && n > 0 && (el.textContent !== String(n))) {
      el.textContent = isPaused(s) ? "⏸" : n;
      el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop");
    }
    const k = `${s.runId}|${n}`;
    if (!isPaused(s) && n > 0 && lastCount !== k) { lastCount = k; beep(660, 0.18, 0.7); }
  } else if (prevPhaseKey && prevPhaseKey.split("|")[1] === "countdown" && prevPhaseKey.split("|")[0] === s.runId) {
    beep(990, 0.45, 0.8);        // MULAI!
  }
  prevPhaseKey = phaseKey;

  const ring = $("ring");
  if (!ring) return;
  const aktif = ["open", "ready", "buzz", "answering"].includes(s.phase);
  ring.style.visibility = aktif ? "visible" : "hidden";
  if (!aktif) return;
  const left = secondsLeft(s);
  totals[phaseKey] = Math.max(totals[phaseKey] || 0, left);
  const frac = totals[phaseKey] ? left / totals[phaseKey] : 0;
  $("ringArc").setAttribute("stroke-dashoffset", String(276.5 * (1 - frac)));
  $("ringNum").textContent = Math.ceil(left);
  ring.classList.toggle("kritis", left <= 5 && !isPaused(s));
  ring.classList.toggle("jeda", isPaused(s));
  // detak di 5 detik terakhir (bukan saat jeda baca soal sesi 3)
  const n = Math.ceil(left);
  if (s.phase !== "ready" && !isPaused(s) && n >= 1 && n <= 5) {
    const k = `${phaseKey}|${n}`;
    if (lastTick !== k) { lastTick = k; beep(n === 1 ? 1200 : 1000, 0.06, 0.45, "square"); }
  }
}
setInterval(tick, 100);

// untuk pemeriksaan: lagu yang sedang diputar
window.__cc = { musik: () => track?.key || null, vol: () => master?.gain.value };
window.__cc.audio = () => ({ src: audioSrc, main: !!audioEl && !audioEl.paused, t: audioEl ? +audioEl.currentTime.toFixed(1) : null, bunyi: audioBerbunyi });
