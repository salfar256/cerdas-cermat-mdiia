import {
  auth, db, ref, get, onAuthStateChanged, signInWithEmailAndPassword, signOut, esc
} from "./common.js?v=20261128202713";

// Menampilkan form login operator. Memanggil onReady(user) jika user terdaftar sebagai admin.
export function requireAdmin(container, onReady) {
  let started = false;
  onAuthStateChanged(auth, async (user) => {
    if (!user || user.isAnonymous) { showLogin(); return; }
    let isAdmin = false;
    try { isAdmin = (await get(ref(db, `admins/${user.uid}`))).val() === true; } catch (e) { isAdmin = false; }
    if (!isAdmin) { showNotAdmin(user); return; }
    container.classList.add("hidden");
    if (!started) { started = true; onReady(user); }
  });

  function showLogin() {
    container.classList.remove("hidden");
    container.innerHTML = `
      <div class="card" style="max-width:420px;margin:3rem auto">
        <h2>Masuk Operator</h2>
        <p class="muted small">Gunakan akun email yang dibuat di Firebase Authentication.</p>
        <form id="loginForm" class="stack">
          <div><label>Email</label><input type="email" id="lgEmail" required autocomplete="username"></div>
          <div><label>Kata sandi</label><input type="password" id="lgPass" required autocomplete="current-password"></div>
          <button class="btn" style="width:100%">Masuk</button>
          <div id="lgErr" class="small" style="color:var(--merah)"></div>
        </form>
      </div>`;
    container.querySelector("#loginForm").onsubmit = async (e) => {
      e.preventDefault();
      const err = container.querySelector("#lgErr");
      err.textContent = "";
      try {
        if (auth.currentUser && auth.currentUser.isAnonymous) await signOut(auth);
        await signInWithEmailAndPassword(auth, container.querySelector("#lgEmail").value.trim(), container.querySelector("#lgPass").value);
      } catch (ex) {
        err.textContent = "Gagal masuk: periksa email dan kata sandi. (" + (ex.code || ex.message) + ")";
      }
    };
  }

  function showNotAdmin(user) {
    container.classList.remove("hidden");
    container.innerHTML = `
      <div class="card" style="max-width:560px;margin:3rem auto">
        <h2>Akun belum terdaftar sebagai operator</h2>
        <p>Login berhasil, tetapi akun <b>${esc(user.email || "")}</b> belum diberi hak operator.</p>
        <p>Buka Firebase Console → <b>Realtime Database</b> → tab <b>Data</b>, lalu tambahkan:</p>
        <div class="soal-preview"><code>admins</code> → <code>${esc(user.uid)}</code> : <code>true</code></div>
        <p class="small muted">UID di atas bisa disalin. Setelah ditambahkan, muat ulang halaman ini.</p>
        <div class="row"><button class="btn" id="cpUid">Salin UID</button><button class="btn abu" id="reload">Muat ulang</button><button class="btn garis" id="out">Keluar</button></div>
      </div>`;
    container.querySelector("#cpUid").onclick = () => navigator.clipboard.writeText(user.uid);
    container.querySelector("#reload").onclick = () => location.reload();
    container.querySelector("#out").onclick = () => signOut(auth);
  }
}

export function toast(msg, ms = 2600) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
