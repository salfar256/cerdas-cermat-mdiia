import {
  auth, db, ref, onValue, get, set, update, remove, push, serverTimestamp, increment, signOut,
  serverNow, SESI_NAMA, SESI_PENDEK, TEAM_COLORS, TEAM_IDS, OPTIONS, DEFAULT_SETTINGS,
  settingsOf, esc, teamList, secondsLeft, preloadSounds, unlockSounds, playSound, fmtScore
} from "./common.js?v=20261128170247";
import { requireAdmin, toast } from "./admin-auth.js?v=20261128170247";

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
  SET_KEYS.forEach((k) => { if (k === "musik") $(k).checked = st[k] !== false; else $(k).value = st[k]; });
  $("volTeks").textContent = $("musikVol").value;
}
$("formSet").onsubmit = async (e) => {
  e.preventDefault();
  const v = {};
  SET_KEYS.forEach((k) => v[k] = k === "musik" ? $(k).checked : k === "s2Points" ? $(k).value.replace(/\s/g, "") : Math.max(0, Number($(k).value) || 0));
  await set(ref(db, `rooms/${code}/settings`), v); toast("Pengaturan disimpan");
};
$("setDefault").onclick = () => { SET_KEYS.forEach((k) => { if (k === "musik") $(k).checked = DEFAULT_SETTINGS[k]; else $(k).value = DEFAULT_SETTINGS[k]; }); $("volTeks").textContent = $("musikVol").value; };
// musik: langsung tersimpan tanpa menekan Simpan, agar bisa diatur saat lomba berjalan
$("musikVol").oninput = () => { $("volTeks").textContent = $("musikVol").value; };
$("musikVol").onchange = () => update(ref(db, `rooms/${code}/settings`), { musikVol: Number($("musikVol").value) });
$("musik").onchange = () => update(ref(db, `rooms/${code}/settings`), { musik: $("musik").checked });

// ---------- Sesi ----------
$("sesiTabs").onclick = async (e) => {
  const sesi = Number(e.target.dataset.sesi);
  if (!sesi || sesi === S().session && ["idle", "intro"].includes(S().phase)) return;
  if (isActive() && !confirm("Soal sedang berjalan. Pindah sesi sekarang?")) return;
  await update(R(), { state: { session: sesi, phase: "intro", introId: Date.now(), msg: "" }, current: null, reveal: null });
};
function isActive() { return ["countdown", "open", "ready", "buzz", "answering", "judging"].includes(S().phase); }
$("btnIntro").onclick = async () => {
  if (isActive() && !confirm("Soal sedang berjalan. Tampilkan pembukaan sesi sekarang?")) return;
  await update(R(), { state: { session: S().session || 1, phase: "intro", introId: Date.now(), msg: "" }, current: null, reveal: null });
};
$("btnRekap").onclick = async () => {
  if (isActive() && !confirm("Soal sedang berjalan. Tampilkan rekap sekarang?")) return;
  await update(R(), { "state/phase": "recap", "state/recapSesi": S().session || 1, "state/msg": "", "state/paused": null });
};

// ---------- Daftar soal ----------
const normSoal = (t) => String(t || "").toLowerCase().replace(/\s+/g, " ").trim();

// Soal dianggap sudah dipakai jika ID-nya sudah dipakai ATAU teks soalnya sama dengan soal yang sudah dipakai
// (mencegah soal kembar, misalnya karena paket terimpor dua kali).
function soalUntukSesi(sesi) {
  const paket = room?.meta?.paket || "";
  const used = room?.used || {};
  const usedText = new Set(Object.keys(used).map((id) => normSoal(bank[id]?.soal)).filter(Boolean));
  const seen = new Set();
  return Object.entries(bank)
    .filter(([, q]) => Number(q.sesi) === sesi && (!paket || (q.paket || "") === paket))
    .filter(([, q]) => !(sesi === 2 && q.tipe === "lisan"))   // sesi 2 tidak memakai soal lisan
    .sort((a, b) => (a[1].dibuat || 0) - (b[1].dibuat || 0))
    .map(([id, q]) => ({ id, ...q }))
    .filter((q) => { const k = normSoal(q.soal); if (seen.has(k)) return false; seen.add(k); return true; })
    .map((q) => ({ ...q, used: !!used[q.id] || usedText.has(normSoal(q.soal)) }));
}

function renderPilihSoal() {
  const sesi = S().session || 1;
  const list = soalUntukSesi(sesi);
  const unused = list.filter((q) => !q.used);
  const sig = sesi + "|" + unused.map((q) => q.id).join(",") + "|" + list.length;
  if (sig === soalSig) return;
  soalSig = sig;
  const cur = $("pilihSoal").value;
  const dipakai = list.length - unused.length;
  $("pilihSoal").innerHTML = unused.length
    ? `<optgroup label="Sisa ${unused.length} soal · ${dipakai} sudah dipakai">${unused.map((q, i) => `<option value="${q.id}">${i + 1}. ${esc((q.soal || "").slice(0, 90))}</option>`).join("")}</optgroup>`
    : `<option value="">${list.length ? `— Semua ${list.length} soal sesi ini sudah dipakai —` : "— Belum ada soal untuk sesi ini —"}</option>`;
  if (cur && unused.some((q) => q.id === cur)) $("pilihSoal").value = cur;
  else if (unused[0]) $("pilihSoal").value = unused[0].id;
  $("btnMulai").disabled = !unused.length;
}

function renderGiliran() {
  const s = S();
  $("giliranWrap").classList.toggle("hidden", (s.session || 1) !== 1);
  const next = nextTurn();
  const cur = $("pilihGiliran").dataset.auto === "0" ? $("pilihGiliran").value : next?.id;
  const cnt = room.meta?.s1count || {}, quota = settingsOf(room).s1PerTeam;
  $("pilihGiliran").innerHTML = teamList(room).map((t) => `<option value="${t.id}">${esc(t.name)} (${cnt[t.id] || 0}/${quota})</option>`).join("");
  if (cur) $("pilihGiliran").value = cur;
}

// Sesi 1: kelompok pertama menghabiskan jatahnya dulu, baru kelompok berikutnya.
function nextTurn() {
  const teams = teamList(room);
  const cnt = room.meta?.s1count || {}, quota = settingsOf(room).s1PerTeam;
  return teams.find((t) => (cnt[t.id] || 0) < quota) ||
    teams.reduce((m, t) => ((cnt[t.id] || 0) < (cnt[m.id] || 0) ? t : m), teams[0]);
}
$("pilihGiliran").onchange = () => { $("pilihGiliran").dataset.auto = "0"; };

// ---------- Mulai soal ----------
$("btnMulai").onclick = async () => {
  const qid = $("pilihSoal").value;
  if (!qid || !bank[qid]) { toast("Pilih soal terlebih dahulu"); return; }
  if (soalUntukSesi(S().session || 1).find((q) => q.id === qid)?.used) { toast("Soal ini sudah pernah ditampilkan"); return; }
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
    const ke = (room.meta?.s1count?.[turn] || 0) + 1;
    state.phase = "open"; state.turnTeam = turn; state.endsAt = serverNow() + st.s1Time * 1000;
    state.msg = `Giliran ${room.teams[turn].name} · soal ke-${ke} dari ${st.s1PerTeam}`;
    upd[`meta/s1count/${turn}`] = ke;
    $("pilihGiliran").dataset.auto = "1";
  } else if (sesi === 2) {
    state.phase = "open"; state.endsAt = serverNow() + st.s2Time * 1000;
    state.msg = "Semua kelompok jawab secepatnya!";
  } else {
    state.phase = "ready"; state.endsAt = serverNow() + st.s3Delay * 1000;
    state.msg = "Baca soal... buzzer segera dibuka";
  }
  if (st.hitungMundur > 0) {
    // tahan dulu di fase hitung mundur; mesin akan membuka fase berikutnya
    state.nextPhase = state.phase;
    state.nextDur = Math.round((state.endsAt - serverNow()) / 1000);
    state.phase = "countdown";
    state.endsAt = serverNow() + st.hitungMundur * 1000;
  }
  Object.assign(upd, {
    state,
    current: isIsian(q)
      ? { qid, soal: q.soal, tipe: q.tipe, session: sesi, number: n }
      : { qid, soal: q.soal, tipe: "pg", a: q.a, b: q.b, c: q.c, d: q.d, session: sesi, number: n },
    [`judge/${qid}`]: null,
    reveal: null,
    [`private/${qid}`]: q.kunci,
    [`used/${qid}`]: true,
    [`answers/${qid}`]: null,
    [`buzz/${qid}`]: null,
    [`meta/count/s${sesi}`]: n
  });
  await update(R(), upd);
};

// ---------- Jeda waktu ----------
// Saat dijeda: sisa waktu disimpan, endsAt digeser jauh ke depan agar tidak ada yang kedaluwarsa.
$("btnJeda").onclick = async () => {
  const s = S();
  if (!["countdown", "open", "ready", "buzz", "answering"].includes(s.phase)) return;
  if (!s.paused) {
    const left = Math.max(0, s.endsAt - serverNow());
    const upd = { "state/paused": true, "state/pausedLeft": left, "state/endsAt": serverNow() + 6 * 3600 * 1000 };
    logEntry(upd, `Waktu dijeda (sisa ${Math.ceil(left / 1000)} dtk)`);
    await update(R(), upd);
  } else {
    const upd = { "state/paused": null, "state/pausedLeft": null, "state/endsAt": serverNow() + (s.pausedLeft || 0) };
    logEntry(upd, "Waktu dilanjutkan");
    await update(R(), upd);
  }
};

$("btnTutup").onclick = async () => {
  const s = S();
  if (!["open", "buzz", "answering"].includes(s.phase)) return;
  await update(R(), { "state/endsAt": serverNow() - 5000, "state/paused": null, "state/pausedLeft": null });
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
  const upd = { used: null, answers: null, buzz: null, log: null, current: null, reveal: null, "meta/count": null, "meta/s1count": null, judge: null, state: { session: 1, phase: "idle", msg: "" } };
  teamList(room).forEach((t) => { upd[`teams/${t.id}/score`] = 0; upd[`teams/${t.id}/per`] = null; if (room.status?.[t.id]) upd[`status/${t.id}/pelanggaran`] = 0; });
  await update(R(), upd);
};

// ---------- Kelompok ----------
$("tim").onclick = async (e) => {
  const d = e.target.dataset;
  if (d.adj) {
    const [t, v] = d.adj.split("|"); const val = Number(v);
    const upd = { [`teams/${t}/score`]: increment(val), [`teams/${t}/per/s${S().session || 1}`]: increment(val) };
    logEntry(upd, `Koreksi manual ${room.teams[t].name}: ${val > 0 ? "+" : ""}${val}`);
    await update(R(), upd);
  }
  if (d.rename) {
    const nm = prompt("Nama kelompok:", room.teams[d.rename].name);
    if (nm && nm.trim()) await update(R(), { [`teams/${d.rename}/name`]: nm.trim() });
  }
  if (d.lepas && confirm(`Lepas HP ${room.teams[d.lepas].name}? Kelompok harus masuk ulang dari HP.`)) {
    await update(R(), { [`teams/${d.lepas}/uid`]: null, [`status/${d.lepas}`]: null });
  }
  if (d.nolpel) await update(R(), { [`status/${d.nolpel}/pelanggaran`]: 0 });
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
  const now = s.paused ? -Infinity : serverNow();
  if (s.phase === "open") {
    const expired = now > s.endsAt + GRACE_ANSWER;
    const isian = dinilaiJuri(room.current);
    if (s.session === 1 && (ans[s.turnTeam] || expired)) {
      if (isian) act(base + "|judge", toJudging); else act(base + "|fin", () => finalizeS1());
    }
    if (s.session === 2) {
      const aktif = teamList(room).filter((t) => t.uid);
      const semua = aktif.length > 0 && aktif.every((t) => ans[t.id]);
      if (semua || expired) { if (isian) act(base + "|judge", toJudging); else act(base + "|fin", () => finalizeS2()); }
    }
  }
  if (s.phase === "countdown" && now >= s.endsAt) act(`${base}|cd`, afterCountdown);
  if (s.phase === "ready" && now >= s.endsAt) act(`${base}|${s.buzzKey}|open`, openBuzz);
  if (s.phase === "buzz") {
    const b = room.buzz?.[s.qid]?.[s.buzzKey];
    if (b) act(`${base}|${s.buzzKey}|win`, () => setAnswering(b.team));
    else if (now > s.endsAt + GRACE_BUZZ) act(`${base}|${s.buzzKey}|none`, noBuzz);
  }
  if (s.phase === "answering") {
    if (ans[s.answeringTeam] || now > s.endsAt + GRACE_ANSWER) {
      if (dinilaiJuri(room.current)) act(`${base}|${s.buzzKey}|judge`, toJudging);
      else act(`${base}|${s.buzzKey}|grade`, () => gradeS3());
    }
  }
}
setInterval(() => { engine(); renderStatus(); }, 250);

// Soal isian & lisan dinilai juri; pilihan ganda dinilai otomatis.
const dinilaiJuri = (q) => ["isian", "lisan"].includes(q?.tipe);
const isIsian = dinilaiJuri;
const TIPE_LABEL = { pg: "Pilihan ganda", isian: "Isian singkat", lisan: "Jawab lisan" };
const ansStr = (a) => (a ? (a.choice ?? a.text ?? null) : null);

async function afterCountdown() {
  const s = S();
  await update(R(), { "state/phase": s.nextPhase || "open", "state/endsAt": serverNow() + (s.nextDur || 30) * 1000,
    "state/openedAt": serverTimestamp(), "state/paused": null, "state/pausedLeft": null });
}

async function toJudging() {
  await update(R(), { "state/paused": null, "state/pausedLeft": null, "state/phase": "judging", "state/msg": "Menunggu keputusan juri..." });
}

async function finalizeS1(verdict) {
  const s = S(), st = settingsOf(room), key = keyOf(s.qid);
  const a = room.answers?.[s.qid]?.[s.turnTeam];
  const correct = verdict !== undefined ? verdict : (!!a && a.choice === key);
  const isian = dinilaiJuri(room.current);
  const pts = correct ? st.s1Correct : 0;
  const nm = room.teams[s.turnTeam].name;
  const upd = {
    "state/phase": "reveal",
    "state/msg": correct ? `${nm} BENAR! +${pts}` : (a || isian ? `${nm} salah. Soal hangus.` : `Waktu habis. Soal hangus.`),
    reveal: { qid: s.qid, key, results: { [s.turnTeam]: { choice: ansStr(a) || (isian ? "(lisan)" : null), correct, points: pts } } }
  };
  if (pts) { upd[`teams/${s.turnTeam}/score`] = increment(pts); upd[`teams/${s.turnTeam}/per/s${S().session || 1}`] = increment(pts); }
  sfx(upd, correct ? "benar" : "salah");
  logEntry(upd, `S1 no.${s.number} · ${nm}: ${ansStr(a) || (isian ? "lisan" : "tidak menjawab")} → ${correct ? "+" + pts : "0"}`);
  upd["state/paused"] = null; upd["state/pausedLeft"] = null;
  await update(R(), upd);
}

function s2Table(st) {
  const arr = String(st.s2Points).split(/[,;]/).map(Number).filter((n) => !isNaN(n));
  return arr.length ? arr : [100, 80, 60, 40];
}

async function finalizeS2(judged) {
  const s = S(), st = settingsOf(room), key = keyOf(s.qid);
  const ans = room.answers?.[s.qid] || {};
  const table = s2Table(st);
  const list = Object.entries(ans).map(([t, a]) => ({ t, ...a })).sort((x, y) => x.ts - y.ts);
  const results = {};
  let rank = 0;
  const upd = {};
  const ringkas = [];
  list.forEach((a) => {
    const correct = judged ? judged[a.t] === true : a.choice === key;
    let pts = 0, r = null;
    if (correct) { pts = table[rank] ?? table[table.length - 1]; rank++; r = rank; }
    results[a.t] = { choice: ansStr(a), correct, points: pts, rank: r, ms: Math.max(0, a.ts - (s.openedAt || a.ts)) };
    if (pts) { upd[`teams/${a.t}/score`] = increment(pts); upd[`teams/${a.t}/per/s${S().session || 1}`] = increment(pts); }
    ringkas.push(`${room.teams[a.t]?.name}: ${ansStr(a)}${correct ? " +" + pts : " ✗"}`);
  });
  teamList(room).forEach((t) => { if (!results[t.id]) results[t.id] = { choice: null, correct: false, points: 0, rank: null }; });
  upd["state/phase"] = "reveal";
  upd["state/msg"] = rank ? `${rank} kelompok menjawab benar` : "Tidak ada yang benar";
  upd.reveal = { qid: s.qid, key, results };
  sfx(upd, rank ? "benar" : "salah");
  logEntry(upd, `S2 no.${s.number} · ${ringkas.join(", ") || "tidak ada jawaban"}`);
  upd["state/paused"] = null; upd["state/pausedLeft"] = null;
  await update(R(), upd);
}

async function openBuzz() {
  const st = settingsOf(room);
  await update(R(), { "state/paused": null, "state/pausedLeft": null, "state/phase": "buzz", "state/endsAt": serverNow() + st.s3BuzzTime * 1000, "state/msg": "Buzzer dibuka! Tekan secepatnya" });
}

async function setAnswering(team) {
  const st = settingsOf(room);
  const upd = {
    "state/phase": "answering", "state/answeringTeam": team,
    "state/endsAt": serverNow() + st.s3AnswerTime * 1000,
    "state/msg": `${room.teams[team].name} tercepat! Silakan menjawab`
  };
  sfx(upd, "buzzer");
  upd["state/paused"] = null; upd["state/pausedLeft"] = null;
  await update(R(), upd);
}

async function noBuzz() {
  const s = S();
  const upd = {
    "state/phase": "reveal", "state/msg": "Tidak ada yang menekan buzzer. Soal hangus.",
    reveal: { qid: s.qid, key: keyOf(s.qid), results: s.s3log || {} }
  };
  logEntry(upd, `S3 no.${s.number} · tidak ada yang menekan`);
  upd["state/paused"] = null; upd["state/pausedLeft"] = null;
  await update(R(), upd);
}

async function gradeS3(verdict) {
  const s = S(), st = settingsOf(room), key = keyOf(s.qid);
  const team = s.answeringTeam, nm = room.teams[team].name;
  const a = room.answers?.[s.qid]?.[team];
  const correct = verdict !== undefined ? verdict : (!!a && a.choice === key);
  const lisan = dinilaiJuri(room.current) ? "(lisan)" : null;
  const s3log = { ...(s.s3log || {}) };
  const upd = {};
  if (correct) {
    s3log[team] = { choice: ansStr(a) || lisan, correct: true, points: st.s3Correct };
    { upd[`teams/${team}/score`] = increment(st.s3Correct); upd[`teams/${team}/per/s${S().session || 1}`] = increment(st.s3Correct); }
    upd["state/phase"] = "reveal";
    upd["state/msg"] = `${nm} BENAR! +${st.s3Correct}`;
    upd["state/s3log"] = s3log;
    upd.reveal = { qid: s.qid, key, results: s3log };
    sfx(upd, "benar");
    logEntry(upd, `S3 no.${s.number} · ${nm}: ${ansStr(a) || "lisan"} → +${st.s3Correct}`);
  } else {
    const pen = st.s3Wrong;
    s3log[team] = { choice: ansStr(a) || lisan, correct: false, points: -pen };
    if (pen) { upd[`teams/${team}/score`] = increment(-pen); upd[`teams/${team}/per/s${S().session || 1}`] = increment(-pen); }
    const locked = { ...(s.locked || {}), [team]: true };
    const sisa = teamList(room).filter((t) => t.uid && !locked[t.id]);
    upd["state/s3log"] = s3log;
    upd["state/locked"] = locked;
    upd["state/answeringTeam"] = null;
    sfx(upd, "salah");
    logEntry(upd, `S3 no.${s.number} · ${nm}: ${ansStr(a) || (lisan ? "lisan" : "tidak menjawab")} → -${pen}`);
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
  upd["state/paused"] = null; upd["state/pausedLeft"] = null;
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
  cekPeringatan();
  renderLog();
  $("btnTutup").disabled = !["open", "buzz", "answering"].includes(s.phase);
  const bisaJeda = ["countdown", "open", "ready", "buzz", "answering"].includes(s.phase);
  $("btnJeda").disabled = !bisaJeda;
  $("btnJeda").textContent = bisaJeda && s.paused ? "▶ Lanjutkan waktu" : "⏸ Jeda waktu";
  $("btnJeda").className = "btn " + (bisaJeda && s.paused ? "" : "emas");
  $("btnLewati").disabled = !s.qid || ["reveal", "idle", "final", "intro", "recap"].includes(s.phase);
}

const FASE = {
  idle: "Menunggu — layar menampilkan skor",
  open: "Soal tampil, menunggu jawaban",
  ready: "Jeda baca soal",
  buzz: "Buzzer dibuka",
  answering: "Menunggu jawaban penekan buzzer",
  intro: "Pembukaan sesi (musik pembukaan diputar di layar)",
  countdown: "Hitung mundur sebelum soal",
  recap: "Layar menampilkan rekap sesi",
  judging: "Menunggu keputusan juri (klik Benar/Salah)",
  reveal: "Jawaban ditampilkan",
  final: "Layar menampilkan juara"
};

function renderStatus() {
  if (!room) return;
  const s = S();
  const sisa = ["countdown", "open", "ready", "buzz", "answering"].includes(s.phase) ? ` · ${s.paused ? "⏸ DIJEDA, sisa" : "⏱"} ${Math.ceil(secondsLeft(s))} dtk` : "";
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
  if (!c) { $("preview").innerHTML = `<span class="muted">Belum ada soal yang ditampilkan.</span>`; $("hasil").innerHTML = ""; $("juri").innerHTML = ""; return; }
  const key = keyOf(c.qid);
  const isian = dinilaiJuri(c);
  $("preview").innerHTML = `<div class="row between"><span class="small muted">Soal tampil · no. ${c.number}</span>
      <span class="pill ${isian ? "emas" : ""}">${TIPE_LABEL[c.tipe] || "Pilihan ganda"}</span></div>
    <div style="font-weight:700;white-space:pre-wrap;font-size:1.05rem;margin-top:.3rem">${esc(c.soal)}</div>
    ${isian ? "" : `<div class="opsi">${OPTIONS.map((o) => `<div class="${o === key ? "kunci" : ""}">${o}. ${esc(c[o.toLowerCase()])}</div>`).join("")}</div>`}
    <div class="kunci-box">🔑 Kunci jawaban: <b>${esc(isian ? key : `${key}. ${c[String(key).toLowerCase()] || ""}`)}</b></div>`;
  const ans = room.answers?.[c.qid] || {};
  const res = room.reveal?.results || {};
  const rows = teamList(room).map((t) => {
    const a = ans[t.id], r = res[t.id];
    let ket = "";
    if (r) ket = r.choice ? `${esc(r.choice)} ${r.correct ? "✔" : "✘"} (${r.points > 0 ? "+" : ""}${r.points})${r.rank ? " · urutan " + r.rank : ""}${r.ms != null ? " · " + (r.ms / 1000).toFixed(2) + " dtk" : ""}` : "—";
    else if (a) ket = a.text === "(lisan)" ? "🗣️ siap menjawab lisan" : `menjawab <b>${esc(ansStr(a))}</b>`;
    else if (s.locked?.[t.id]) ket = "terkunci (sudah salah)";
    if (!ket) ket = isActive() ? "<span class='muted'>belum</span>" : "<span class='muted'>—</span>";
    return `<tr><td><span class="team-dot" style="display:inline-block;background:${t.color}"></span> ${esc(t.name)}</td><td>${ket}</td></tr>`;
  }).join("");
  $("hasil").innerHTML = `<table><tbody>${rows}</tbody></table>`;
  renderJuri(c, s, ans);
}

// Panel juri untuk soal isian singkat: operator menentukan benar/salah.
function renderJuri(c, s, ans) {
  const el = $("juri");
  if (!dinilaiJuri(c)) { el.innerHTML = ""; return; }
  const lisan = c.tipe === "lisan";
  const jawabTeks = (a) => !a ? `<span class="muted">${lisan ? "🗣️ Dengarkan jawaban lisan peserta" : "Belum ada jawaban tertulis (boleh dijawab lisan)"}</span>`
    : a.text === "(lisan)" ? "🗣️ lisan" : esc(a.text);
  const nm = (id) => esc(room.teams[id]?.name || "");
  const tombol = `<div class="row"><button class="btn besar" data-v="1">✔ Benar</button><button class="btn besar merah" data-v="0">✘ Salah</button></div>`;
  if (s.session === 1 && ["open", "judging"].includes(s.phase)) {
    const a = ans[s.turnTeam];
    el.innerHTML = `<div class="juri-box"><div class="small muted">Penilaian juri · giliran ${nm(s.turnTeam)}</div>
      <div class="juri-jawab">${jawabTeks(a)}</div>${tombol}</div>`;
  } else if (s.session === 3 && ["answering", "judging"].includes(s.phase) && s.answeringTeam) {
    const a = ans[s.answeringTeam];
    el.innerHTML = `<div class="juri-box"><div class="small muted">Penilaian juri · ${nm(s.answeringTeam)} menjawab</div>
      <div class="juri-jawab">${jawabTeks(a)}</div>${tombol}</div>`;
  } else if (s.session === 2 && ["open", "judging"].includes(s.phase)) {
    const j = room.judge?.[c.qid] || {};
    const list = Object.entries(ans).map(([t, a]) => ({ t, ...a })).sort((x, y) => x.ts - y.ts);
    el.innerHTML = `<div class="juri-box"><div class="small muted">Penilaian juri · urutan sesuai waktu ${lisan ? "menekan tombol — panggil kelompok sesuai urutan ini" : "masuk"}${s.phase === "open" ? " (masih bisa bertambah)" : ""}</div>
      <table><tbody>${list.map((a, i) => `<tr><td>${i + 1}. ${nm(a.t)}</td><td><b>${jawabTeks(a)}</b><div class="small muted">${((a.ts - (s.openedAt || a.ts)) / 1000).toFixed(2)} dtk</div></td>
        <td style="white-space:nowrap"><button class="btn kecil ${j[a.t] === true ? "" : "abu"}" data-j="${a.t}|1">✔ Benar</button>
        <button class="btn kecil ${j[a.t] === false ? "merah" : "abu"}" data-j="${a.t}|0">✘ Salah</button></td></tr>`).join("") || `<tr><td class="muted">Belum ada jawaban masuk.</td></tr>`}</tbody></table>
      <button class="btn emas besar" data-umumkan="1" style="margin-top:.6rem" ${s.phase === "judging" ? "" : "disabled"}>📢 Umumkan hasil</button></div>`;
  } else el.innerHTML = "";
}

$("juri").onclick = async (e) => {
  const d = e.target.closest("button")?.dataset;
  if (!d) return;
  const s = S(), base = `${s.qid}|${s.runId}`;
  if (d.v !== undefined) {
    const v = d.v === "1";
    if (s.session === 1) act(base + "|fin", () => finalizeS1(v));
    if (s.session === 3) act(`${base}|${s.buzzKey}|grade`, () => gradeS3(v));
  }
  if (d.j) {
    const [t, v] = d.j.split("|");
    await update(R(), { [`judge/${s.qid}/${t}`]: v === "1" });
  }
  if (d.umumkan) {
    const ans = room.answers?.[s.qid] || {}, j = room.judge?.[s.qid] || {};
    const belum = Object.keys(ans).filter((t) => j[t] === undefined);
    if (belum.length && !confirm(`${belum.length} jawaban belum dinilai dan akan dianggap salah. Umumkan sekarang?`)) return;
    act(base + "|fin", () => finalizeS2(j));
  }
};

function renderTeams() {
  $("tim").innerHTML = teamList(room).map((t) => `
    <div class="team-row">
      <span class="team-dot" style="background:${t.color}"></span>
      <div class="nama"><a href="javascript:void 0" data-rename="${t.id}">${esc(t.name)}</a>${badgeStatus(t)}
        <div class="small muted">${t.uid ? "📱 HP terhubung" : "HP belum masuk"}${t.uid ? ` · <a href="javascript:void 0" data-lepas="${t.id}">Lepas HP</a>` : ""}${room.status?.[t.id]?.pelanggaran ? ` · <a href="javascript:void 0" data-nolpel="${t.id}">Nolkan pelanggaran</a>` : ""}</div></div>
      <div class="row" style="gap:.25rem">
        <button class="btn abu kecil" data-adj="${t.id}|-50">−50</button>
        <button class="btn abu kecil" data-adj="${t.id}|-10">−10</button>
        <button class="btn abu kecil" data-adj="${t.id}|10">+10</button>
        <button class="btn abu kecil" data-adj="${t.id}|50">+50</button>
      </div>
      <div class="skor">${fmtScore(t.score)}</div>
    </div>`).join("");
}

// ---------- Status siap & peringatan keluar halaman ----------
function badgeStatus(t) {
  const st = room.status?.[t.id];
  if (!t.uid) return "";
  if (!st?.ready) return `<span class="badge-st belum">belum siap</span>`;
  let b = st.away ? `<span class="badge-st pergi">🚨 KELUAR HALAMAN</span>`
    : st.online === false ? `<span class="badge-st putus">📴 terputus</span>`
    : `<span class="badge-st siap">✅ siap</span>`;
  if (st.pelanggaran) b += `<span class="badge-st catat">⚠️ ${st.pelanggaran}× keluar</span>`;
  return b;
}

let prevAway = null;
function cekPeringatan() {
  const teams = teamList(room);
  const pergi = teams.filter((t) => t.uid && room.status?.[t.id]?.away);
  $("peringatan").innerHTML = pergi.length
    ? `<div class="peringatan-op">🚨 ${pergi.map((t) => esc(t.name)).join(", ")} sedang meninggalkan halaman lomba (pindah tab / aplikasi lain)!</div>` : "";
  const now = new Set(pergi.map((t) => t.id));
  if (prevAway === null) { prevAway = now; return; }        // muat pertama: jangan bunyikan peringatan lama
  const baru = [...now].filter((id) => !prevAway.has(id));
  prevAway = now;
  if (!baru.length) return;
  const upd = {};
  baru.forEach((id) => {
    const t = room.teams[id], n = room.status[id].pelanggaran || 1;
    toast(`🚨 ${t.name} meninggalkan halaman lomba (${n}×)`, 5000);
    logEntry(upd, `🚨 ${t.name} keluar halaman lomba (pelanggaran ke-${n})`);
  });
  if ($("suaraOp").checked) playSound("salah");
  update(R(), upd);
}

function renderLog() {
  const items = Object.values(room.log || {}).sort((a, b) => b.t - a.t).slice(0, 40);
  $("log").innerHTML = items.map((l) => `<div><span class="muted">${new Date(l.t).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span> ${esc(l.text)}</div>`).join("") || `<span class="muted small">Belum ada catatan.</span>`;
}
