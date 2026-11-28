# Cerdas Cermat MDIIA

Aplikasi lomba cerdas cermat realtime untuk Ma'had Dirosah Islamiyah Ibnu Aqil.
Hosting: GitHub Pages · Database: Firebase Realtime Database · Login: Firebase Authentication.

Alamat setelah aktif: **https://salfar256.github.io/cerdas-cermat-mdiia/**

## Halaman

| Halaman | Dipakai oleh | Fungsi |
|---|---|---|
| `operator.html` | Juri/operator (laptop) | Membuat ruang lomba, memilih sesi & soal, mesin penilaian otomatis, koreksi skor |
| `layar.html` | Proyektor | Soal, timer, siapa yang menekan buzzer, hasil, papan skor, juara. **Suara diputar di sini.** |
| `peserta.html` | HP tiap kelompok | Menjawab pilihan ganda & tombol ANGKAT TANGAN |
| `bank.html` | Operator | Mengetik soal, impor dari Excel/CSV, ekspor |

> Halaman operator harus **tetap terbuka** selama lomba, karena penilaian dan perpindahan tahap berjalan di sana.

## Aturan permainan (bawaan, bisa diubah di operator)

- **Sesi 1 – Soal Kelompok:** kelompok 1 menghabiskan jatahnya dulu (bawaan 5 soal), lalu kelompok 2, dan seterusnya. Benar **+100**, salah/tidak menjawab: soal hangus (0). Waktu 30 detik.
- **Sesi 2 – Adu Cepat:** semua kelompok menjawab. Hanya jawaban benar yang diurutkan berdasarkan waktu masuk ke server: **+100 / +80 / +60 / +40**. Salah = 0. Waktu 20 detik.
- **Sesi 3 – Rebutan:** jeda baca soal 3 detik, lalu tombol dibuka 15 detik. Yang pertama menekan menjawab dalam 10 detik. Benar **+100**, salah **−50**, lalu kelompok itu terkunci dan rebutan dibuka lagi untuk kelompok lain.

**Tipe soal:**
- **Pilihan ganda (pg):** dinilai otomatis.
- **Isian singkat (isian):** peserta mengetik jawaban, juri menekan Benar/Salah.
- **Jawab lisan (lisan):** peserta mengucapkan jawaban, tanpa mengetik; juri menekan Benar/Salah. Hanya untuk sesi 1 dan 3 (tidak dipakai di sesi 2 adu cepat).

Satu paket boleh mencampur ketiganya.

**Suasana layar proyektor:**
- Musik latar berbeda untuk tiap sesi (berulang tanpa jeda), mengecil otomatis saat bunyi buzzer/benar/salah. Bisa dimatikan dan diatur volumenya dari operator.
- Pembukaan sesi: saat operator berpindah sesi, layar menampilkan judul sesi beranimasi dengan musik pembukaan, lalu musik sesi dimulai. Bisa diulang dengan tombol 🎬 Pembukaan sesi.
- Hitung mundur 3-2-1 dengan bunyi sebelum setiap soal (bisa diatur/dimatikan), dan detak di 5 detik terakhir.
- Skor bergulir naik/turun, 👑 untuk pemimpin, pengumuman saat pemimpin berganti.
- 📊 Rekap sesi: tabel skor per sesi. Layar juara dengan podium naik dan musik pembukaan.

**Tombol SIAP & pengawasan:** setelah memilih kelompok, peserta menekan SAYA SIAP. Sejak itu, jika HP/laptop peserta berpindah tab, membuka aplikasi lain, atau mengunci layar, operator langsung mendapat peringatan (banner merah, status kelompok, catatan) dan peserta melihat peringatan saat kembali. Jumlah pelanggaran tercatat per kelompok.

**Jeda waktu:** tombol ⏸ di operator membekukan timer di semua layar dan HP; tekan ▶ untuk melanjutkan dari sisa waktu yang sama.

Urutan tercepat memakai **jam server Firebase**, bukan jam HP, sehingga adil walau jam HP berbeda.

## Langkah pemasangan Firebase (sekali saja)

1. **Realtime Database** → *Create Database* → lokasi **Singapore (asia-southeast1)** → mode *locked*.
2. Tab **Rules** di Realtime Database → hapus isinya → tempel seluruh isi file `database.rules.json` → **Publish**.
3. **Authentication** → *Get started* → tab *Sign-in method* → aktifkan **Email/Password** dan **Anonymous**.
4. **Authentication → Users → Add user** → buat akun operator (email + kata sandi).
5. **Authentication → Settings → Authorized domains** → *Add domain* → `salfar256.github.io`.
6. **Project settings (ikon gerigi) → General → Your apps** → buat *Web app* bila belum ada → salin konfigurasi ke `js/firebase-config.js`. Pastikan `databaseURL` terisi (salin dari halaman Realtime Database).
7. Buka `operator.html`, login. Akan muncul UID Anda → salin.
8. Realtime Database → tab **Data** → tambahkan node: `admins` → `<UID tadi>` : `true` (boolean). Muat ulang halaman operator.

Firestore **tidak dipakai**, jadi tidak perlu disiapkan.

## Mengaktifkan GitHub Pages

Repositori → **Settings → Pages** → *Source: Deploy from a branch* → Branch **main**, folder **/ (root)** → Save. Tunggu 1–2 menit.

## Hari lomba

1. Laptop operator: buka `operator.html` → buat ruang → dapat **kode 4 angka**.
2. Proyektor: klik **Buka layar proyektor** → tekan *Mulai tampilan* (wajib diklik agar suara aktif) → F11.
3. HP kelompok: buka link peserta (atau `peserta.html` lalu ketik kode) → pilih nama kelompok.
4. Pilih sesi → pilih soal → **Tampilkan soal**. Penilaian berjalan otomatis.
5. Selesai: **Tampilkan juara**.

Tips: pakai satu WiFi yang sama untuk semua HP agar adu cepat lebih adil. Jika HP kelompok mati/ganti, tekan **Lepas HP** di operator lalu masuk ulang.

## Soal bergambar & audio

Simpan file di repo ini:
- gambar → `media/gambar/` (jpg, png, webp; usahakan < 500 KB)
- audio → `media/audio/` (mp3, m4a; usahakan < 2 MB)

Unggah lewat GitHub: buka folder → **Add file → Upload files** → Commit. Lalu di Bank Soal isi kolom **Media** dengan nama filenya saja (mis. `kh-hasyim-asyari.jpg`), atau link lengkap `https://...`.

- Gambar tampil di layar proyektor (di samping soal) dan di HP peserta.
- Audio diputar otomatis di layar proyektor sekali saat soal tampil; musik latar berhenti selama audio berbunyi. Operator bisa menekan **▶ Putar audio di layar** untuk mengulang. Waktu menjawab (sesi 1 & 2) dan jeda sebelum buzzer (sesi 3) otomatis ditambah sepanjang durasi audio.

## Format impor soal

Kolom (baris pertama judul): `sesi, tipe, paket, soal, a, b, c, d, kunci, media`
- `sesi`: 1, 2, atau 3
- `tipe`: `pg`, `isian`, atau `lisan` (untuk isian/lisan, kolom a–d dikosongkan dan `kunci` diisi teks jawaban)
- `paket`: opsional (mis. "Babak Final"). Ruang lomba bisa dibatasi ke satu paket.
- `kunci`: A/B/C/D untuk pg, teks jawaban untuk isian/lisan
- `media`: opsional, nama file di folder `media/` atau link https://

Contoh ada di `template-soal.csv`, atau unduh template Excel dari halaman Bank Soal.

## Catatan untuk pengembang

Setiap kali mengubah file JS/CSS, jalankan `python3 tools/versi.py` sebelum commit. Skrip ini menambahkan nomor versi (`?v=...`) ke semua file, sehingga HP dan laptop peserta otomatis memuat versi terbaru dan tidak memakai cache lama.
