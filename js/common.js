import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, onValue, get, set, update, remove, push,
  serverTimestamp, increment, onDisconnect
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  getAuth, signInAnonymously, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js?v=20261128203410";

export const CONFIG_OK = !String(firebaseConfig.apiKey || "").startsWith("ISI");
if (!CONFIG_OK) {
  document.addEventListener("DOMContentLoaded", () => {
    const b = document.createElement("div");
    b.className = "config-warning";
    b.innerHTML = "⚠️ Konfigurasi Firebase belum diisi. Buka <b>js/firebase-config.js</b> lalu isi sesuai Firebase Console.";
    document.body.prepend(b);
  });
}

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);
export {
  ref, onValue, get, set, update, remove, push, serverTimestamp, increment, onDisconnect,
  signInAnonymously, signInWithEmailAndPassword, signOut, onAuthStateChanged
};

// ---- Jam server (agar timer semua perangkat sama) ----
let _offset = 0;
onValue(ref(db, ".info/serverTimeOffset"), (s) => { _offset = s.val() || 0; });
export const serverNow = () => Date.now() + _offset;

// ---- Konstanta ----
export const SESI_NAMA = {
  1: "Sesi 1 · Soal Kelompok",
  2: "Sesi 2 · Adu Cepat",
  3: "Sesi 3 · Rebutan"
};
export const SESI_PENDEK = { 1: "Soal Kelompok", 2: "Adu Cepat", 3: "Rebutan" };
export const TEAM_COLORS = ["#e63946", "#1d8cf8", "#f4a100", "#7b2cbf"];
export const TEAM_IDS = ["t1", "t2", "t3", "t4"];
export const OPTIONS = ["A", "B", "C", "D"];

export const DEFAULT_SETTINGS = {
  s1Correct: 100,          // sesi 1 benar
  s1Time: 30,              // detik
  s1PerTeam: 5,            // jatah soal sesi 1 per kelompok (dihabiskan berurutan)
  s2Points: "100,80,60,40",// sesi 2: benar ke-1, ke-2, ke-3, ke-4
  s2Time: 20,
  s3Correct: 100,          // sesi 3 benar
  s3Wrong: 50,             // sesi 3 salah (dikurangi)
  s3Delay: 3,              // jeda baca soal sebelum buzzer aktif
  s3BuzzTime: 15,          // waktu menekan buzzer
  s3AnswerTime: 10,        // waktu menjawab setelah menang buzzer
  hitungMundur: 3,         // hitung mundur 3-2-1 sebelum soal (0 = tanpa)
  musik: true,             // musik latar di layar proyektor
  musikVol: 35             // volume musik latar (0-100)
};

export function settingsOf(room) {
  return Object.assign({}, DEFAULT_SETTINGS, (room && room.settings) || {});
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

export function teamList(room) {
  const t = (room && room.teams) || {};
  return TEAM_IDS.filter((id) => t[id]).map((id, i) => ({ id, ...t[id], color: t[id].color || TEAM_COLORS[i] }));
}

export function sortedTeams(room) {
  return teamList(room).sort((a, b) => (b.score || 0) - (a.score || 0));
}

export function getParam(name) {
  return new URLSearchParams(location.search).get(name);
}

export async function ensureAnon() {
  if (auth.currentUser) return auth.currentUser;
  await new Promise((res) => {
    const un = onAuthStateChanged(auth, (u) => { un(); res(u); });
  });
  if (auth.currentUser) return auth.currentUser;
  const cred = await signInAnonymously(auth);
  return cred.user;
}

export const TIMER_PHASES = ["countdown", "open", "ready", "buzz", "answering"];
export const isPaused = (state) => !!(state && state.paused && TIMER_PHASES.includes(state.phase));

export function secondsLeft(state) {
  if (!state || !state.endsAt) return 0;
  if (isPaused(state)) return Math.max(0, (state.pausedLeft || 0) / 1000);
  return Math.max(0, (state.endsAt - serverNow()) / 1000);
}

// ---- Suara ----
const SOUND_FILES = { buzzer: "sounds/buzzer.mp3", benar: "sounds/true.mp3", salah: "sounds/wrong.mp3" };
const _audio = {};
export function preloadSounds() {
  for (const [k, src] of Object.entries(SOUND_FILES)) {
    const a = new Audio(src); a.preload = "auto"; _audio[k] = a;
  }
}
export function unlockSounds() {
  // dipanggil dari klik pengguna supaya browser mengizinkan audio
  for (const a of Object.values(_audio)) {
    a.muted = true;
    a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
  }
}
export function playSound(kind) {
  const a = _audio[kind];
  if (!a) return;
  try { a.pause(); a.currentTime = 0; a.play().catch(() => {}); } catch (e) {}
}

// Peserta & layar hanya boleh membaca bagian publik ruang lomba.
export function watchPublicRoom(code, cb) {
  const room = {};
  const parts = ["meta", "settings", "teams", "state", "current", "reveal", "status"];
  const loaded = new Set();
  const unsubs = parts.map((p) => onValue(ref(db, `rooms/${code}/${p}`), (s) => {
    room[p] = s.val();
    loaded.add(p);
    if (loaded.size === parts.length) cb(room);
  }, (err) => cb(null, err)));
  return () => unsubs.forEach((u) => u());
}

export function fmtScore(n) {
  return (n || 0).toLocaleString("id-ID");
}

// ---- Media soal (gambar / audio) ----
// Kolom media berisi nama file di folder media/gambar atau media/audio repo,
// atau link lengkap (https://...).
const EXT_GAMBAR = /\.(jpe?g|png|gif|webp|svg)(\?.*)?$/i;
const EXT_AUDIO = /\.(mp3|m4a|ogg|wav|aac)(\?.*)?$/i;
export function mediaJenis(m) {
  if (!m) return null;
  if (EXT_GAMBAR.test(m)) return "gambar";
  if (EXT_AUDIO.test(m)) return "audio";
  return null;
}
export function mediaUrl(m) {
  if (!m) return "";
  const s = String(m).trim();
  if (/^https?:\/\//i.test(s) || s.includes("/")) return s;
  const j = mediaJenis(s);
  return j ? `media/${j}/${encodeURIComponent(s)}` : s;
}

// ---- Teks Arab ----
// Potongan Arab dibungkus agar memakai font Arab, ukuran lebih besar, dan arah kanan-ke-kiri yang benar.
const AR = "\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF";
const RE_ADA_ARAB = new RegExp(`[${AR}]`);
const RE_RUN_ARAB = new RegExp(`[${AR}](?:[${AR}\\s«»()\\[\\].!:\\-،؛؟]*[${AR}])?`, "g");
const RE_HURUF_ARAB = new RegExp(`[${AR}]`, "g");
export function adaArab(s) { return RE_ADA_ARAB.test(String(s ?? "")); }
export function dominanArab(s) {
  const t = String(s ?? "");
  const ar = (t.match(RE_HURUF_ARAB) || []).length;
  const lat = (t.match(/[A-Za-z]/g) || []).length;
  return ar > 0 && (lat <= 2 || ar >= lat * 6);
}
// Mengubah teks menjadi HTML aman (escape) dengan penanda Arab.
export function teks(s) {
  const t = String(s ?? "");
  if (!adaArab(t)) return esc(t);
  if (dominanArab(t)) return `<span class="arab-penuh" dir="rtl">${esc(t)}</span>`;
  let out = "", last = 0;
  t.replace(RE_RUN_ARAB, (m, i) => { out += esc(t.slice(last, i)) + `<span class="arab" dir="rtl">${esc(m)}</span>`; last = i + m.length; return m; });
  return out + esc(t.slice(last));
}
