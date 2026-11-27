import { db, ref, onValue, push, set, update, remove, esc } from "./common.js";
import { requireAdmin, toast } from "./admin-auth.js";

const $ = (id) => document.getElementById(id);
let bank = {};
let pendingImport = [];

requireAdmin($("login"), () => {
  $("app").classList.remove("hidden");
  onValue(ref(db, "bank"), (s) => { bank = s.val() || {}; renderPaket(); renderList(); });
});

function items() {
  return Object.entries(bank).map(([id, q]) => ({ id, ...q }))
    .sort((a, b) => (a.sesi - b.sesi) || ((a.dibuat || 0) - (b.dibuat || 0)));
}

function filtered() {
  const s = $("fSesi").value, p = $("fPaket").value, c = $("fCari").value.trim().toLowerCase();
  return items().filter((q) =>
    (!s || String(q.sesi) === s) &&
    (!p || (q.paket || "") === p) &&
    (!c || (q.soal || "").toLowerCase().includes(c)));
}

function renderPaket() {
  const pakets = [...new Set(items().map((q) => q.paket || "").filter(Boolean))].sort();
  const cur = $("fPaket").value;
  $("fPaket").innerHTML = `<option value="">Semua paket</option>` + pakets.map((p) => `<option ${p === cur ? "selected" : ""}>${esc(p)}</option>`).join("");
  $("paketList").innerHTML = pakets.map((p) => `<option value="${esc(p)}">`).join("");
}

function renderList() {
  const list = filtered();
  $("jumlah").textContent = list.length + " soal";
  const all = items();
  $("rekap").innerHTML = [1, 2, 3].map((s) => `<span class="pill abu">Sesi ${s}: ${all.filter((q) => q.sesi == s).length}</span>`).join("");
  $("tbody").innerHTML = list.map((q, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><span class="pill ${q.sesi == 3 ? "merah" : q.sesi == 2 ? "emas" : ""}">S${q.sesi}</span>${q.paket ? `<div class="small muted">${esc(q.paket)}</div>` : ""}</td>
      <td>${esc(q.soal)}<div class="small muted">A. ${esc(q.a)} · B. ${esc(q.b)} · C. ${esc(q.c)} · D. ${esc(q.d)}</div></td>
      <td><b>${esc(q.kunci)}</b></td>
      <td style="white-space:nowrap">
        <button class="btn abu kecil" data-edit="${q.id}">Ubah</button>
        <button class="btn merah kecil" data-del="${q.id}">Hapus</button>
      </td>
    </tr>`).join("") || `<tr><td colspan="5" class="muted center">Belum ada soal.</td></tr>`;
}

["fSesi", "fPaket"].forEach((id) => $(id).onchange = renderList);
$("fCari").oninput = renderList;

$("tbody").onclick = async (e) => {
  const ed = e.target.dataset.edit, del = e.target.dataset.del;
  if (ed) {
    const q = bank[ed];
    $("qId").value = ed; $("qSesi").value = q.sesi; $("qPaket").value = q.paket || "";
    $("qSoal").value = q.soal; $("qA").value = q.a; $("qB").value = q.b; $("qC").value = q.c; $("qD").value = q.d;
    $("qKunci").value = q.kunci; $("formJudul").textContent = "Ubah Soal";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  if (del && confirm("Hapus soal ini?")) { await remove(ref(db, `bank/${del}`)); toast("Soal dihapus"); }
};

function resetForm() {
  $("form").reset(); $("qId").value = ""; $("formJudul").textContent = "Tambah Soal";
}
$("batal").onclick = resetForm;

$("form").onsubmit = async (e) => {
  e.preventDefault();
  const data = {
    sesi: Number($("qSesi").value), paket: $("qPaket").value.trim(),
    soal: $("qSoal").value.trim(), a: $("qA").value.trim(), b: $("qB").value.trim(),
    c: $("qC").value.trim(), d: $("qD").value.trim(), kunci: $("qKunci").value
  };
  const id = $("qId").value;
  if (id) { await update(ref(db, `bank/${id}`), data); toast("Soal diperbarui"); }
  else { await set(push(ref(db, "bank")), { ...data, dibuat: Date.now() }); toast("Soal ditambahkan"); }
  const keepSesi = $("qSesi").value, keepPaket = $("qPaket").value;
  resetForm(); $("qSesi").value = keepSesi; $("qPaket").value = keepPaket; $("qSoal").focus();
};

$("hapusFilter").onclick = async () => {
  const list = filtered();
  if (!list.length) return;
  if (!confirm(`Hapus ${list.length} soal yang sedang tampil? Tindakan ini tidak bisa dibatalkan.`)) return;
  const upd = {}; list.forEach((q) => upd[q.id] = null);
  await update(ref(db, "bank"), upd); toast(`${list.length} soal dihapus`);
};

// ---------- Template & ekspor ----------
const HEADER = ["sesi", "paket", "soal", "a", "b", "c", "d", "kunci"];
const CONTOH = [
  [1, "Babak 1", "Siapa pengarang kitab Alfiyah?", "Imam Nawawi", "Ibnu Malik", "Imam Ghazali", "Ibnu Hajar", "B"],
  [2, "Babak 1", "Berapakah hasil 12 x 12?", "124", "144", "142", "132", "B"],
  [3, "Babak 1", "Ibu kota Provinsi Jawa Barat adalah...", "Bogor", "Bekasi", "Bandung", "Cirebon", "C"]
];
function download(name, blob) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function toCsv(rows) {
  return rows.map((r) => r.map((v) => {
    const s = String(v ?? ""); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");
}
$("tplCsv").onclick = () => download("template-soal.csv", new Blob(["﻿" + toCsv([HEADER, ...CONTOH])], { type: "text/csv" }));
$("tplXlsx").onclick = () => {
  const ws = XLSX.utils.aoa_to_sheet([HEADER, ...CONTOH]);
  ws["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: 50 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 7 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Soal");
  XLSX.writeFile(wb, "template-soal.xlsx");
};
$("ekspor").onclick = () => {
  const rows = items().map((q) => [q.sesi, q.paket || "", q.soal, q.a, q.b, q.c, q.d, q.kunci]);
  const ws = XLSX.utils.aoa_to_sheet([HEADER, ...rows]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Soal");
  XLSX.writeFile(wb, "bank-soal-cerdas-cermat.xlsx");
};

// ---------- Impor ----------
const ALIAS = {
  sesi: ["sesi", "session", "babak sesi"],
  paket: ["paket", "babak", "kategori"],
  soal: ["soal", "pertanyaan", "question"],
  a: ["a", "opsi a", "pilihan a", "opsia"],
  b: ["b", "opsi b", "pilihan b", "opsib"],
  c: ["c", "opsi c", "pilihan c", "opsic"],
  d: ["d", "opsi d", "pilihan d", "opsid"],
  kunci: ["kunci", "jawaban", "kunci jawaban", "answer"]
};
function normKey(k) { return String(k).toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim(); }

function parseWorkbook(wb) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: false });
  const ok = [], bad = [];
  rows.forEach((r, i) => {
    const m = {};
    for (const [k, v] of Object.entries(r)) {
      const nk = normKey(k);
      for (const [field, al] of Object.entries(ALIAS)) if (al.includes(nk)) m[field] = String(v).trim();
    }
    const sesi = Number(m.sesi), kunci = (m.kunci || "").toUpperCase().replace(/[^ABCD]/g, "").slice(0, 1);
    const errs = [];
    if (![1, 2, 3].includes(sesi)) errs.push("sesi harus 1/2/3");
    if (!m.soal) errs.push("soal kosong");
    ["a", "b", "c", "d"].forEach((o) => { if (!m[o]) errs.push(`opsi ${o.toUpperCase()} kosong`); });
    if (!kunci) errs.push("kunci harus A/B/C/D");
    if (!m.soal && !m.a && !m.sesi) return; // baris kosong
    if (errs.length) bad.push(`Baris ${i + 2}: ${errs.join(", ")}`);
    else ok.push({ sesi, paket: m.paket || "", soal: m.soal, a: m.a, b: m.b, c: m.c, d: m.d, kunci });
  });
  return { ok, bad };
}

function showPreview({ ok, bad }) {
  pendingImport = ok;
  const pakets = [...new Set(ok.map((q) => q.paket).filter(Boolean))];
  const ada = pakets.filter((p) => Object.values(bank).some((q) => q.paket === p));
  $("impPreview").innerHTML =
    `<div><b>${ok.length}</b> soal siap diimpor ` +
    `(S1: ${ok.filter((q) => q.sesi === 1).length}, S2: ${ok.filter((q) => q.sesi === 2).length}, S3: ${ok.filter((q) => q.sesi === 3).length}).</div>` +
    (ada.length ? `<div style="color:#7a5a00;margin-top:.4rem">⚠️ Paket <b>${ada.map(esc).join(", ")}</b> sudah ada di bank soal. Mengimpor lagi akan membuat soal ganda.</div>` : "") +
    (bad.length ? `<div style="color:var(--merah);margin-top:.4rem"><b>${bad.length} baris dilewati:</b><br>${bad.slice(0, 15).map(esc).join("<br>")}${bad.length > 15 ? "<br>..." : ""}</div>` : "");
  $("impGo").classList.toggle("hidden", !ok.length);
}

$("file").onchange = async (e) => {
  const f = e.target.files[0];
  pendingImport = []; $("impGo").classList.add("hidden"); $("impPreview").innerHTML = "";
  if (!f) return;
  try {
    showPreview(parseWorkbook(XLSX.read(await f.arrayBuffer(), { type: "array" })));
  } catch (ex) {
    $("impPreview").innerHTML = `<span style="color:var(--merah)">File tidak bisa dibaca: ${esc(ex.message)}</span>`;
  }
};

// ---------- Paket soal bawaan (folder soal/ di GitHub) ----------
fetch("soal/daftar.json").then((r) => r.json()).then((list) => {
  $("bawaan").innerHTML += list.map((x) => `<option value="${esc(x.file)}">${esc(x.nama)}</option>`).join("");
}).catch(() => {});
$("muatBawaan").onclick = async () => {
  const f = $("bawaan").value;
  if (!f) { toast("Pilih paket bawaan dulu"); return; }
  try {
    const text = await (await fetch("soal/" + f, { cache: "no-store" })).text();
    showPreview(parseWorkbook(XLSX.read(text.replace(/^\ufeff/, ""), { type: "string" })));
    $("impPreview").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (ex) {
    $("impPreview").innerHTML = `<span style="color:var(--merah)">Paket tidak bisa dimuat: ${esc(ex.message)}</span>`;
  }
};

$("impGo").onclick = async () => {
  if (!pendingImport.length) return;
  const upd = {}; const now = Date.now();
  pendingImport.forEach((q, i) => { upd[push(ref(db, "bank")).key] = { ...q, dibuat: now + i }; });
  await update(ref(db, "bank"), upd);
  toast(`${pendingImport.length} soal berhasil diimpor`);
  pendingImport = []; $("file").value = ""; $("impPreview").innerHTML = ""; $("impGo").classList.add("hidden");
};
