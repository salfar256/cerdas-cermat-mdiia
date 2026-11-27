import {
  auth, db, ref, onValue, get, set, update, remove, push, serverTimestamp, increment, signOut,
  serverNow, SESI_NAMA, SESI_PENDEK, TEAM_COLORS, TEAM_IDS, OPTIONS, DEFAULT_SETTINGS,
  settingsOf, esc, teamList, secondsLeft, preloadSounds, unlockSounds, playSound, fmtScore
} from "./common.js";
import { requireAdmin, toast } from "./admin-auth.js";

const $ = (id) => document.getElementById(id);
let bank = {};
let code = null;
let room = null;
let unsubRoom = null;
const busy = new Set();          // mencegah aksi otomatis berjalan dua kali
let lastSfx = null;
let soalSig = "";

preloadSounds();
$("suaraOp").checked = localStorage.getItem("cc_suara_op") === "1";
$("suaraOp").onchange = (e) => { localStorage.setItem("cc_suara_op", e.target.checked ? "1" : "0"); if (e.target.checked) unlockSounds(); };
$("keluar").onclick = () => signOut(auth).then(() => location.reload());
$("keLobi").onclick = () => { localStorage.removeItem("cc_op_room"); location.href = "operator.html"; };

requireAdmin($("login"), () => {
  onValue(ref(db, "bank"), (s) => { bank = s.val() || {}; renderPaketLobi(); if (room) render(); });
  const saved = new URLSearchParams(location.search).get("r") || localStorage.getItem("cc_op_room");
  if (saved) openRoom(saved); else showLobi();
});

// =================================================================
// LOBI
// =================================================================
function showLobi() {
  $("lobi").classList.remove("hidden"); $("game").classList.add("hidden"); $("keLobi").classList.add("hidden");
  renderTimInputs(); loadRooms();
}
function renderPaketLobi() {
  const pakets = [...new Set(Object.values(bank).map((q) => q.paket || "").filter(Boolean))].sort();
  $("rPaket").innerHTML = `<option value="">Semua paket</option>` + pakets.map((p) => `<option>${esc(p)}</option>`).join("");
}
function renderTimInputs() {
  const n = Number($("rJumlah").value);
  const old = [...$("rTim").querySelectorAll("input")].map((i) => i.value);
  $("rTim").innerHTML = Array.from({ length: n }, (_, i) => `
    <div class="row"><span class="team-dot" style="background:${TEAM_COLORS[i]}"></span>
    <input type="text" class="grow" required value="${esc(old[i] || "Kelompok " + (i + 1))}"></div>`).join("");
}
$("rJumlah").onchange = renderTimInputs;

async function loadRooms() {
  const s = await get(ref(db, "rooms"));
  const rooms = Object.entries(s.val() || {}).sort((a, b) => (b[1].meta?.createdAt || 0) - (a[1].meta?.createdAt || 0));
  $("daftarRuang").innerHTML = rooms.length ? rooms.map(([c, r]) => `
    <div class="row between" style="border-bottom:1px solid var(--garis);padding-bottom:.6rem">
      <div><b>${esc(r.meta?.name || "Lomba")}</b> <span class="pill">${c}</span>
        <div class="small muted">${new Date(r.meta?.createdAt || 0).toLocaleString("id-ID")} · ${teamList(r).map((t) => esc(t.name) + " " + fmtScore(t.score)).join(" · ")}</div></div>
      <div class="row"><button class="btn kecil" data-open="${c}">Buka</button><button class="btn merah kecil" data-hapus="${c}">Hapus</button></div>
    </div>`).join("") : `<p class="muted">Belum ada ruang lomba.</p>`;
}
$("daftarRuang").onclick = async (e) => {
  if (e.target.dataset.open) openRoom(e.target.dataset.open);
  if (e.target.dataset.hapus && confirm(`Hapus ruang ${e.target.dataset.hapus} beserta skornya?`)) {
    await remove(ref(db, `rooms/${e.target.dataset.hapus}`)); loadRooms();
  }
};

$("formRuang").onsubmit = async (e) => {
  e.preventDefault();
  let c;
  for (let i = 0; i < 20; i++) {
    c = String(Math.floor(1000 + Math.random() * 9000));
    if (!(await get(ref(db, `rooms/${c}/meta`))).exists()) break;
  }
  const names = [...$("rTim").querySelectorAll("input")].map((i) => i.value.trim());
  const teams = {};
  names.forEach((n, i) => teams[TEAM_IDS[i]] = { name: n, color: TEAM_COLORS[i], score: 0 });
  await set(ref(db, `rooms/${c}`), {
    meta: { name: $("rNama").value.trim(), paket: $("rPaket").value, createdAt: serverTimestamp(), turnIdx: -1 },
    settings: DEFAULT_SETTINGS,
    teams,
    state: { session: 1, phase: "idle", msg: "" }
  });
  openRoom(c);
};

// =================================================================
// RUANG LOMBA
// =================================================================
function openRoom(c) {
  code = c; localStorage.setItem("cc_op_room", c);
  $("lobi").classList.add("hidden"); $("game").classList.remove("hidden"); $("keLobi").classList.remove("hidden");
  const base = location.href.replace(/operator\.html.*$/, "");
  $("kode").textContent = c;
  $("linkLayar").href = `${base}layar.html?r=${c}`;
  $("linkPeserta").href = `${base}peserta.html?r=${c}`;
  $("salinPeserta").onclick = () => { navigator.clipboard.writeText(`${base}peserta.html?r=${c}`); toast("Link peserta disalin"); };
  let first = true;
  if (unsubRoom) unsubRoom();
  unsubRoom = onValue(ref(db, `rooms/${c}`), (s) => {
    room = s.val();
    if (!room) { toast("Ruang tidak ditemukan"); localStorage.removeItem("cc_op_room"); showLobi(); return; }
    $("namaLomba").textContent = room.meta?.name || "Cerdas Cermat";
    if (first) { fillSettings(); first = false; lastSfx = room.state?.sfx?.id || null; }
    handleSfx();
    render();
    engine();
  });
}

const R = () => ref(db, `rooms/${code}`);
const S = () => (room && room.state) || {};
const keyOf = (qid) => room?.private?.[qid] || bank[qid]?.kunci;

function logEntry(upd, text) {
  upd[`log/${push(ref(db, `rooms/${code}/log`)).key}`] = { t: Date.now(), text };
}
function sfx(upd, kind) { upd["state/sfx"] = { id: Date.now() + Math.random(), kind }; }

function handleSfx() {
  const s = S().sfx;
  if (s && s.id !== lastSfx) {
    lastSfx = s.id;
    if ($("suaraOp").checked) playSound(s.kind);
  }
}

// ---------- Pengaturan ----------
const SET_KEYS = Object.keys(DEFAULT_SETTINGS);
function fillSettings() {
  const st = settingsOf(room);
  SET_KEYS.forEach((k) => $(k).value = st[k]);
}
$("formSet").onsubmit = async (e) => {
  e.preventDefault();
  const v = {};
  SET_KEYS.forEach((k) => v[k] = k === "s2Points" ? $(k).value.replace(/\s/g, "") : Math.max(0, Number($(k).value) || 0));
  await set(ref(db, `rooms/${code}/settings`), v); toast("Pengaturan disimpan");
};
$("setDefault").onclick = () => { SET_KEYS.forEach((k) => $(k).value = DEFAULT_SETTINGS[k]); };

// ---------- Sesi ----------
$("sesiTabs").onclick = async (e) => {
  const sesi = Number(e.target.dataset.sesi);
  if (!sesi || sesi === S().session && S().phase === "idle") return;
  if (isActive() && !confirm("Soal sedang berjalan. Pindah sesi sekarang?")) return;
  await update(R(), { state: { session: sesi, phase: "idle", msg: "" }, current: null, reveal: null });
};
function isActive() { return ["open", "ready", "buzz", "answering"].includes(S().phase); }

// ---------- Daftar soal ----------
function soalUntukSesi(sesi) {
  const paket = room?.meta?.paket || "";
  const used = room?.used || {};
  return Object.entries(bank)
    .filter(([, q]) => Number(q.sesi) === sesi && (!paket || (q.paket || "") === paket))
    .sort((a, b) => (a[1].dibuat || 0) - (b[1].dibuat || 0))
    .map(([id, q]) => ({ id, ...q, used: !!used[id] }));
}

function renderPilihSoal() {
  const sesi = S().session || 1;
  const list = soalUntukSesi(sesi);
  const sig = sesi + "|" + list.map((q) => q.id + (q.used ? "u" : "")).join(",");
  if (sig === soalSig) return;
  soalSig = sig;
  const unused = list.filter((q) => !q.used), used = list.filter((q) => q.used);
  const cur = $("pilihSoal").value;
  const opt = (q) => `<option value="${q.id}">${q.used ? "✓ " : ""}${esc((q.soal || "").slice(0, 90))}</option>`;
  $("pilihSoal").innerHTML =
    (list.length ? "" : `<option value="">— Belum ada soal untuk sesi ini —</option>`) +
    (unused.length ? `<optgroup label="Belum dipakai (${unused.length})">${unused.map(opt).join("")}</optgroup>` : "") +
    (used.length ? `<optgroup label="Sudah dipakai (${used.length})">${used.map(opt).join("")}</optgroup>` : "");
  if (cur && list.some((q) => q.id === cur && !q.used)) $("pilihSoal").value = cur;
  else if (unused[0]) $("pilihSoal").value = unused[0].id;
}

function renderGiliran() {
  const s = S();
  $("giliranWrap").classList.toggle("hidden", (s.session || 1) !== 1);
  const teams = teamList(room);
  const next = teams[((room.meta?.turnIdx ?? -1) + 1) % teams.length];
  const cur = $("pilihGiliran").dataset.auto === "0" ? $("pilihGiliran").value : next?.id;
  $("pilihGiliran").innerHTML = teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("");
  if (cur) $("pilihGiliran").value = cur;
}
$("pilihGiliran").onchange = () => { $("pilihGiliran").dataset.auto = "0"; };

// ---------- Mulai soal ----------
$("btnMulai").onclick = async () => {
  const qid = $("pilihSoal").value;
  if (!qid || !bank[qid]) { toast("Pilih soal terlebih dahulu"); return; }
  if (isActive() && !confirm("Soal sebelumnya masih berjalan. Ganti dengan soal baru?")) return;
  const q = bank[qid];
  const sesi = S().session || 1;
  const st = settingsOf(room);
  const n = (room.meta?.count?.["s" + sesi] || 0) + 1;
  const teams = teamList(room);
  const state = { session: sesi, qid, number: n, runId: push(ref(db, "x")).key, openedAt: serverTimestamp(), buzzKey: "b1", msg: "" };
  const upd = {};
  if (sesi === 1) {
    const turn = $("pilihGiliran").value || teams[0].id;
    state.phase = "open"; state.turnTeam = turn; state.endsAt = serverNow() + st.s1Time * 1000;
    state.msg = `Giliran ${room.teams[turn].name}`;
    upd["meta/turnIdx"] = teams.findIndex((t) => t.id === turn);
    $("pilihGiliran").dataset.auto = "1";
  } else if (sesi === 2) {
    state.phase = "open"; state.endsAt = serverNow() + st.s2Time * 1000;
    state.msg = "Semua kelompok jawab secepatnya!";
  } else {
    state.phase = "ready"; state.endsAt = serverNow() + st.s3Delay * 1000;
    state.msg = "Baca soal... buzzer segera dibuka";
  }
  Object.assign(upd, {
    state,
    current: { qid, soal: q.soal, a: q.a, b: q.b, c: q.c, d: q.d, session: sesi, number: n },
    reveal: null,
    [`private/${qid}`]: q.kunci,
    [`used/${qid}`]: true,
    [`answers/${qid}`]: null,
    [`buzz/${qid}`]: null,
    [`meta/count/s${sesi}`]: n
  });
  await update(R(), upd);
};

$("btnTutup").onclick = async () => {
  const s = S();
  if (!["open", "buzz", "answering"].includes(s.phase)) return;
  await update(R(), { "state/endsAt": serverNow() - 5000 });
};

$("btnLewati").onclick = async () => {
  const s = S();
  if (!s.qid || s.phase === "reveal") return;
  if (!confirm("Hanguskan soal ini tanpa poin?")) return;
  const upd = {
    "state/phase": "reveal", "state/msg": "Soal dihanguskan",
    reveal: { qid: s.qid, key: keyOf(s.qid), results: s.s3log || {} }
  };
  logEntry(upd, `${SESI_PENDEK[s.session]} no.${s.number}: dihanguskan operator`);
  await update(R(), upd);
};

$("btnIdle").onclick = () => update(R(), { "state/phase": "idle", "state/msg": "", current: null, reveal: null });
$("btnJuara").onclick = () => update(R(), { "state/phase": "final", "state/msg": "" });

$("btnResetSkor").onclick = async () => {
  if (!confirm("Reset lomba? Semua skor jadi 0, tanda soal terpakai dihapus, dan catatan dikosongkan.")) return;
  const upd = { used: null, answers: null, buzz: null, log: null, current: null, reveal: null, "meta/count": null, "meta/turnIdx": -1, state: { session: 1, phase: "idle", msg: "" } };
  teamList(room).forEach((t) => upd[`teams/${t.id}/score`] = 0);
  await update(R(), upd);
};

// ---------- Kelompok ----------
$("tim").onclick = async (e) => {
  const d = e.target.dataset;
  if (d.adj) {
    const [t, v] = d.adj.split("|"); const val = Number(v);
    const upd = { [`teams/${t}/score`]: increment(val) };
    logEntry(upd, `Koreksi manual ${room.teams[t].name}: ${val > 0 ? "+" : ""}${val}`);
    await update(R(), upd);
  }
  if (d.rename) {
    const nm = prompt("Nama kelompok:", room.teams[d.rename].name);
    if (nm && nm.trim()) await update(R(), { [`teams/${d.rename}/name`]: nm.trim() });
  }
  if (d.lepas && confirm(`Lepas HP ${room.teams[d.lepas].name}? Kelompok harus masuk ulang dari HP.`)) {
    await update(R(), { [`teams/${d.lepas}/uid`]: null });
  }
};

// =================================================================
// MESIN LOMBA (berjalan otomatis di perangkat operator)
// =================================================================
const GRACE_ANSWER = 1600; // ms, sedikit di atas batas aturan database (1500)
const GRACE_BUZZ = 700;

function act(key, fn) {
  if (busy.has(key)) return;
  busy.add(key);
  Promise.resolve().then(fn).catch((e) => { console.error(e); toast("Gagal memproses: " + e.message); busy.delete(key); });
}

function engine() {
  if (!room) return;
  const s = S();
  if (!s.qid) return;
  const base = `${s.qid}|${s.runId}`;
  const ans = room.answers?.[s.qid] || {};
  const now = serverNow();
  if (s.phase === "open") {
    const expired = now > s.endsAt + GRACE_ANSWER;
    if (s.session === 1 && (ans[s.turnTeam] || expired)) act(base + "|fin", finalizeS1);
    if (s.session === 2) {
      const aktif = teamList(room).filter((t) => t.uid);
      const semua = aktif.length > 0 && aktif.every((t) => ans[t.id]);
      if (semua || expired) act(base + "|fin", finalizeS2);
    }
  }
  if (s.phase === "ready" && now >= s.endsAt) act(`${base}|${s.buzzKey}|open`, openBuzz);
  if (s.phase === "buzz") {
    const b = room.buzz?.[s.qid]?.[s.buzzKey];
    if (b) act(`${base}|${s.buzzKey}|win`, () => setAnswering(b.team));
    else if (now > s.endsAt + GRACE_BUZZ) act(`${base}|${s.buzzKey}|none`, noBuzz);
  }
  if (s.phase === "answering") {
    if (ans[s.answeringTeam] || now > s.endsAt + GRACE_ANSWER) act(`${base}|${s.buzzKey}|grade`, gradeS3);
  }
}
setInterval(() => { engine(); renderStatus(); }, 250);

async function finalizeS1() {
  const s = S(), st = settingsOf(room), key = keyOf(s.qid);
  const a = room.answers?.[s.qid]?.[s.turnTeam];
  const correct = !!a && a.choice === key;
  const pts = correct ? st.s1Correct : 0;
  const nm = room.teams[s.turnTeam].name;
  const upd = {
    "state/phase": "reveal",
    "state/msg": correct ? `${nm} BENAR! +${pts}` : (a ? `${nm} salah. Soal hangus.` : `Waktu habis. Soal hangus.`),
    reveal: { qid: s.qid, key, results: { [s.turnTeam]: { choice: a?.choice || null, correct, points: pts } } }
  };
  if (pts) upd[`teams/${s.turnTeam}/score`] = increment(pts);
  sfx(upd, correct ? "benar" : "salah");
  logEntry(upd, `S1 no.${s.number} · ${nm}: ${a ? a.choice : "tidak menjawab"} → ${correct ? "+" + pts : "0"}`);
  await update(R(), upd);
}

function s2Table(st) {
  const arr = String(st.s2Points).split(/[,;]/).map(Number).filter((n) => !isNaN(n));
  return arr.length ? arr : [100, 80, 60, 40];
}

async function finalizeS2() {
  const s = S(), st = settingsOf(room), key = keyOf(s.qid);
  const ans = room.answers?.[s.qid] || {};
  const table = s2Table(st);
  const list = Object.entries(ans).map(([t, a]) => ({ t, ...a })).sort((x, y) => x.ts - y.ts);
  const results = {};
  let rank = 0;
  const upd = {};
  const ringkas = [];
  list.forEach((a) => {
    const correct = a.choice === key;
    let pts = 0, r = null;
    if (correct) { pts = table[rank] ?? table[table.length - 1]; rank++; r = rank; }
    results[a.t] = { choice: a.choice, correct, points: pts, rank: r, ms: Math.max(0, a.ts - (s.openedAt || a.ts)) };
    if (pts) upd[`teams/${a.t}/score`] = increment(pts);
    ringkas.push(`${room.teams[a.t]?.name}: ${a.choice}${correct ? " +" + pts : " ✗"}`);
  });
  teamList(room).forEach((t) => { if (!results[t.id]) results[t.id] = { choice: null, correct: false, points: 0, rank: null }; });
  upd["state/phase"] = "reveal";
  upd["state/msg"] = rank ? `${rank} kelompok menjawab benar` : "Tidak ada yang benar";
  upd.reveal = { qid: s.qid, key, results };
  sfx(upd, rank ? "benar" : "salah");
  logEntry(upd, `S2 no.${s.number} · ${ringkas.join(", ") || "tidak ada jawaban"}`);
  await update(R(), upd);
}

async function openBuzz() {
  const st = settingsOf(room);
  await update(R(), { "state/phase": "buzz", "state/endsAt": serverNow() + st.s3BuzzTime * 1000, "state/msg": "Buzzer dibuka! Tekan secepatnya" });
}

async function setAnswering(team) {
  const st = settingsOf(room);
  const upd = {
    "state/phase": "answering", "state/answeringTeam": team,
    "state/endsAt": serverNow() + st.s3AnswerTime * 1000,
    "state/msg": `${room.teams[team].name} tercepat! Silakan menjawab`
  };
  sfx(upd, "buzzer");
  await update(R(), upd);
}

async function noBuzz() {
  const s = S();
  const upd = {
    "state/phase": "reveal", "state/msg": "Tidak ada yang menekan buzzer. Soal hangus.",
    reveal: { qid: s.qid, key: keyOf(s.qid), results: s.s3log || {} }
  };
  logEntry(upd, `S3 no.${s.number} · tidak ada yang menekan`);
  await update(R(), upd);
}

async function gradeS3() {
  const s = S(), st = settingsOf(room), key = keyOf(s.qid);
  const team = s.answeringTeam, nm = room.teams[team].name;
  const a = room.answers?.[s.qid]?.[team];
  const correct = !!a && a.choice === key;
  const s3log = { ...(s.s3log || {}) };
  const upd = {};
  if (correct) {
    s3log[team] = { choice: a.choice, correct: true, points: st.s3Correct };
    upd[`teams/${team}/score`] = increment(st.s3Correct);
    upd["state/phase"] = "reveal";
    upd["state/msg"] = `${nm} BENAR! +${st.s3Correct}`;
    upd["state/s3log"] = s3log;
    upd.reveal = { qid: s.qid, key, results: s3log };
    sfx(upd, "benar");
    logEntry(upd, `S3 no.${s.number} · ${nm}: ${a.choice} → +${st.s3Correct}`);
  } else {
    const pen = st.s3Wrong;
    s3log[team] = { choice: a?.choice || null, correct: false, points: -pen };
    if (pen) upd[`teams/${team}/score`] = increment(-pen);
    const locked = { ...(s.locked || {}), [team]: true };
    const sisa = teamList(room).filter((t) => t.uid && !locked[t.id]);
    upd["state/s3log"] = s3log;
    upd["state/locked"] = locked;
    upd["state/answeringTeam"] = null;
    sfx(upd, "salah");
    logEntry(upd, `S3 no.${s.number} · ${nm}: ${a ? a.choice : "tidak menjawab"} → -${pen}`);
    if (sisa.length) {
      const n = Number(String(s.buzzKey).slice(1)) + 1;
      upd["state/phase"] = "ready";
      upd["state/buzzKey"] = "b" + n;
      upd["state/endsAt"] = serverNow() + 2000;
      upd["state/msg"] = `${nm} salah (−${pen}). Rebutan dibuka lagi!`;
    } else {
      upd["state/phase"] = "reveal";
      upd["state/msg"] = `${nm} salah (−${pen}). Soal hangus.`;
      upd.reveal = { qid: s.qid, key, results: s3log };
    }
  }
  await update(R(), upd);
}

// =================================================================
// TAMPILAN OPERATOR
// =================================================================
function render() {
  const s = S();
  document.querySelectorAll("#sesiTabs button").forEach((b) => b.classList.toggle("aktif", Number(b.dataset.sesi) === (s.session || 1)));
  renderPilihSoal();
  renderGiliran();
  renderStatus();
  renderPreview();
  renderTeams();
  renderLog();
  $("btnTutup").disabled = !["open", "buzz", "answering"].includes(s.phase);
  $("btnLewati").disabled = !s.qid || ["reveal", "idle", "final"].includes(s.phase);
}

const FASE = {
  idle: "Menunggu — layar menampilkan skor",
  open: "Soal tampil, menunggu jawaban",
  ready: "Jeda baca soal",
  buzz: "Buzzer dibuka",
  answering: "Menunggu jawaban penekan buzzer",
  reveal: "Jawaban ditampilkan",
  final: "Layar menampilkan juara"
};

function renderStatus() {
  if (!room) return;
  const s = S();
  const sisa = ["open", "ready", "buzz", "answering"].includes(s.phase) ? ` · ⏱ ${Math.ceil(secondsLeft(s))} dtk` : "";
  let extra = "";
  if (s.phase === "open" && s.qid) {
    const ans = room.answers?.[s.qid] || {};
    if (s.session === 1) extra = ans[s.turnTeam] ? " · jawaban masuk" : "";
    if (s.session === 2) extra = ` · ${Object.keys(ans).length}/${teamList(room).filter((t) => t.uid).length} menjawab`;
  }
  $("status").innerHTML = `<div class="small muted">${SESI_NAMA[s.session || 1]}${s.number ? " · Soal no. " + s.number : ""}</div>
    ${esc(FASE[s.phase] || s.phase)}${sisa}${extra}${s.msg ? `<div class="small" style="font-weight:500;margin-top:.2rem">${esc(s.msg)}</div>` : ""}`;
}

function renderPreview() {
  const c = room.current, s = S();
  if (!c) { $("preview").innerHTML = `<span class="muted">Belum ada soal yang ditampilkan.</span>`; $("hasil").innerHTML = ""; return; }
  const key = keyOf(c.qid);
  $("preview").innerHTML = `<div class="small muted">Soal tampil · no. ${c.number}</div>
    <div style="font-weight:700;white-space:pre-wrap">${esc(c.soal)}</div>
    <div class="opsi">${OPTIONS.map((o) => `<div class="${o === key ? "kunci" : ""}">${o}. ${esc(c[o.toLowerCase()])}</div>`).join("")}</div>`;
  const ans = room.answers?.[c.qid] || {};
  const res = room.reveal?.results || {};
  const rows = teamList(room).map((t) => {
    const a = ans[t.id], r = res[t.id];
    let ket = "";
    if (r) ket = r.choice ? `${r.choice} ${r.correct ? "✔" : "✘"} (${r.points > 0 ? "+" : ""}${r.points})${r.rank ? " · urutan " + r.rank : ""}${r.ms != null ? " · " + (r.ms / 1000).toFixed(2) + " dtk" : ""}` : "—";
    else if (a) ket = `menjawab ${a.choice}`;
    else if (s.locked?.[t.id]) ket = "terkunci (sudah salah)";
    if (!ket) ket = isActive() ? "<span class='muted'>belum</span>" : "<span class='muted'>—</span>";
    return `<tr><td><span class="team-dot" style="display:inline-block;background:${t.color}"></span> ${esc(t.name)}</td><td>${ket}</td></tr>`;
  }).join("");
  $("hasil").innerHTML = `<table><tbody>${rows}</tbody></table>`;
}

function renderTeams() {
  $("tim").innerHTML = teamList(room).map((t) => `
    <div class="team-row">
      <span class="team-dot" style="background:${t.color}"></span>
      <div class="nama"><a href="javascript:void 0" data-rename="${t.id}">${esc(t.name)}</a>
        <div class="small muted">${t.uid ? "📱 HP terhubung" : "HP belum masuk"}${t.uid ? ` · <a href="javascript:void 0" data-lepas="${t.id}">Lepas HP</a>` : ""}</div></div>
      <div class="row" style="gap:.25rem">
        <button class="btn abu kecil" data-adj="${t.id}|-50">−50</button>
        <button class="btn abu kecil" data-adj="${t.id}|-10">−10</button>
        <button class="btn abu kecil" data-adj="${t.id}|10">+10</button>
        <button class="btn abu kecil" data-adj="${t.id}|50">+50</button>
      </div>
      <div class="skor">${fmtScore(t.score)}</div>
    </div>`).join("");
}

function renderLog() {
  const items = Object.values(room.log || {}).sort((a, b) => b.t - a.t).slice(0, 40);
  $("log").innerHTML = items.map((l) => `<div><span class="muted">${new Date(l.t).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span> ${esc(l.text)}</div>`).join("") || `<span class="muted small">Belum ada catatan.</span>`;
}
