# Buku Hutang

Aplikasi web untuk merekod pinjaman peribadi: peminjam, pokok, bunga, bayaran, resit automatik dan ringkasan kewangan.

Data disimpan dalam Firebase Firestore di bawah akaun anda sendiri. Firestore menyimpan salinan tempatan dalam pelayar, jadi app tetap boleh dibuka dan digunakan tanpa internet — tulisan beratur dan dihantar sendiri bila talian pulih.

---

## Apa yang anda perlukan

* Akaun Google (untuk Firebase)
* Akaun GitHub
* 20–30 minit untuk persediaan pertama

Semua perkhidmatan di sini percuma untuk saiz penggunaan ini.

---

## Langkah 1 — Cipta projek Firebase

1. Pergi ke <https://console.firebase.google.com>
2. Tekan **Add project** (atau **Create a project**)
3. Nama projek: `buku-hutang` — tekan **Continue**
4. Google Analytics: **matikan** (tidak diperlukan) — tekan **Create project**
5. Tunggu sehingga siap, tekan **Continue**

## Langkah 2 — Daftarkan aplikasi web

1. Di halaman utama projek, tekan ikon **web** `</>` (bertulis "Add app")
2. App nickname: `buku-hutang-web`
3. **Jangan** tandakan "Also set up Firebase Hosting"
4. Tekan **Register app**
5. Skrin seterusnya memaparkan blok kod `const firebaseConfig = { ... }` — **biarkan tab ini terbuka**, anda perlukan nilai-nilai itu di Langkah 5

## Langkah 3 — Hidupkan log masuk

1. Menu kiri → **Build** → **Authentication** → tekan **Get started**
2. Tab **Sign-in method** → pilih **Email/Password**
3. Hidupkan suis pertama (**Enable**). Biarkan "Email link" dimatikan.
4. Tekan **Save**
5. Tab **Users** → tekan **Add user**
6. Masukkan e-mel dan kata laluan anda → **Add user**

Akaun anda kini wujud. App ini **tiada skrin pendaftaran**, jadi orang lain tidak boleh cipta akaun. Kalau anda mahu peranti kedua atau orang kedua, tambah pengguna di sini juga — tetapi ambil perhatian setiap pengguna mempunyai set rekod yang berasingan.

## Langkah 4 — Cipta pangkalan data

1. Menu kiri → **Build** → **Firestore Database** → **Create database**
2. Pilih lokasi: **asia-southeast1 (Singapore)** — paling dekat dengan Malaysia
3. Pilih **Start in production mode** → **Create**
4. Selepas siap, buka tab **Rules**
5. **Padam semua** yang ada di situ, kemudian tampal keseluruhan kandungan fail [`firestore.rules`](firestore.rules) dalam repo ini
6. Tekan **Publish**

> Langkah 5 ini penting. Tanpa peraturan yang betul, rekod hutang anda — nama orang, jumlah, bayaran — boleh dibaca sesiapa sahaja. Jangan langkau.

## Langkah 5 — Masukkan config

Buka fail `js/firebase-config.js` dan gantikan setiap nilai `GANTI...` dengan nilai dari Langkah 2.

```js
export const firebaseConfig = {
  apiKey: "AIzaSy....",
  authDomain: "buku-hutang-xxxx.firebaseapp.com",
  projectId: "buku-hutang-xxxx",
  storageBucket: "buku-hutang-xxxx.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456"
};
```

Nilai-nilai ini bukan rahsia — ia memang terdedah dalam mana-mana app web Firebase. Keselamatan datang daripada `firestore.rules` (Langkah 4) dan sekatan domain (Langkah 8).

## Langkah 6 — Muat naik ke GitHub

Kalau anda guna laman web GitHub:

1. <https://github.com/new> → nama repo: `buku-hutang` → **Public** → **Create repository**
2. Tekan **uploading an existing file**
3. Seret masuk `index.html`, folder `css`, folder `js`, `firestore.rules`, `README.md`, `.gitignore`
4. Tekan **Commit changes**

Kalau anda guna terminal:

```bash
cd buku-hutang-web
git init
git add .
git commit -m "Buku Hutang: versi pertama"
git branch -M main
git remote add origin https://github.com/NAMA-ANDA/buku-hutang.git
git push -u origin main
```

## Langkah 7 — Hidupkan GitHub Pages

1. Dalam repo → **Settings** → menu kiri **Pages**
2. Source: **Deploy from a branch**
3. Branch: **main**, folder: **/ (root)** → **Save**
4. Tunggu 1–2 minit, muat semula halaman itu

Alamat app anda akan dipaparkan di situ:

```
https://NAMA-ANDA.github.io/buku-hutang/
```

## Langkah 8 — Kunci API key kepada domain anda

Langkah ini menghalang orang lain daripada menggunakan kuota Firebase anda dari laman mereka.

1. <https://console.cloud.google.com/apis/credentials> — pilih projek `buku-hutang` di bar atas
2. Bawah **API Keys**, tekan kunci bernama **Browser key (auto created by Firebase)**
3. Bahagian **Application restrictions** → pilih **Websites**
4. Tekan **Add** dan masukkan:
   * `NAMA-ANDA.github.io/*`
   * `localhost/*` (kalau anda mahu uji di komputer)
5. Tekan **Save**. Perubahan mengambil masa sehingga 5 minit untuk berkuat kuasa.

## Langkah 9 — Pasang di telefon

1. Buka alamat GitHub Pages anda dalam Chrome (Android) atau Safari (iPhone)
2. Log masuk dengan e-mel dan kata laluan dari Langkah 3
3. Menu pelayar → **Add to Home screen**

Ikon akan muncul di skrin utama dan app terbuka tanpa bar alamat.

---

## Ujian sebelum guna data sebenar

Buat sekali sahaja, lepas siap pasang:

1. Tambah peminjam palsu bernama `Ujian`
2. Rekod pinjaman RM100, bunga 10%, sekali sahaja, tarikh sepatutnya bayar = semalam
3. Balik ke Ringkasan — dia patut muncul bawah **Lewat bayar**
4. Tekan namanya → rekod bayaran RM10, jenis **Bunga sahaja** → resit patut keluar
5. Tutup app, buka semula — data masih ada
6. **Matikan data mudah alih dan WiFi**, buka app, rekod satu lagi bayaran. Ia patut berjaya dengan status *Luar talian*. Hidupkan semula talian — status bertukar ke *Tersimpan*.
7. Buka alamat yang sama di komputer, log masuk — rekod yang sama patut muncul
8. Padam peminjam `Ujian`, kemudian barulah masuk data sebenar

Langkah 6 dan 7 mengesahkan dua perkara yang anda mahukan: berfungsi tanpa internet, dan data tidak terikat pada satu telefon.

---

## Perkara yang perlu anda tahu

**Nombor resit perlukan internet.** Jujukan nombor resit dijana melalui transaction pada pelayan supaya tiada nombor berulang. Kalau anda luar talian, app akan minta anda cuba semula bila ada talian. Semua fungsi lain berjalan seperti biasa tanpa internet.

**Padam bermaksud padam.** Pelan percuma Firebase tiada salinan sejarah automatik. Kalau anda tersilap padam peminjam, rekodnya tidak boleh dikembalikan. Sebab itu setiap padaman ada pengesahan.

**Buat salinan bulanan.** Tetapan → **Salin data** menyalin keseluruhan rekod sebagai teks JSON. Simpan dalam Google Drive atau hantar ke WhatsApp sendiri. Ini perlindungan anda terhadap tersilap padam dan terhadap masalah akaun.

**Data ini tentang orang lain.** Nama, nombor telefon dan jumlah hutang orang lain kini berada di pelayan awan. Jangan kongsi kata laluan, jangan biarkan sesi terbuka pada telefon yang dipinjam orang, dan log keluar kalau anda jual atau serah telefon itu.

**Kos.** Pelan percuma Firebase (Spark) memberi 50,000 bacaan dan 20,000 tulisan sehari. Penggunaan peribadi tidak akan menghampiri had itu. Anda tidak perlu masukkan kad kredit.

---

## Struktur fail

```
buku-hutang-web/
├── index.html              rangka halaman
├── css/style.css           semua gaya
├── js/firebase-config.js   config projek anda — satu-satunya fail yang anda edit
├── js/app.js               logik penuh: kiraan, paparan, Firestore
├── firestore.rules         peraturan keselamatan — salin ke Firebase Console
├── .gitignore
└── README.md
```

## Susunan data dalam Firestore

```
users/{uid}/borrowers/{id}   nama, telefon, nota, createdAt
users/{uid}/loans/{id}       borrowerId, pokok, kadar, jenisBunga,
                             tarikh, tarikhJanji, nota, createdAt
users/{uid}/payments/{id}    loanId, tarikh, jumlah, jenis,
                             alokBunga, alokPokok, bakiSelepas,
                             resitNo, nota, createdAt
users/{uid}/meta/settings    pemberi, telefon
users/{uid}/meta/counters    resit (nombor jujukan terakhir)
```

Baki hutang tidak disimpan. Ia dikira semula daripada pinjaman dan bayaran setiap kali dipaparkan, jadi tidak boleh jadi tak selaras dengan rekod sebenar.

## Cara bunga dikira

**Sekali sahaja** — `bunga = pokok × kadar%`. Dikira sekali, tidak bertambah walaupun lewat bayar.

**Bulanan** — `bunga = pokok × kadar% × bulan penuh sejak tarikh pinjam`, minimum 1 bulan. Bunga dikira atas pokok asal, bukan baki yang berkurang.

Setiap bayaran menolak bunga tertunggak dahulu, kemudian pokok — kecuali jenis **Pokok sahaja** dipilih.

---

## Masalah biasa

| Masalah | Sebab dan penyelesaian |
|---|---|
| Skrin kekal "Memuatkan…" | `firebase-config.js` masih ada nilai `GANTI`. Buka Console pelayar (F12) untuk lihat ralat sebenar. |
| `Missing or insufficient permissions` | Peraturan di Langkah 4 belum di-**Publish**, atau anda belum log masuk. |
| `auth/invalid-credential` | E-mel atau kata laluan salah. Set semula di Firebase Console → Authentication → Users. |
| Log masuk gagal, kata tiada rangkaian | Log masuk kali pertama pada satu peranti memerlukan internet. Selepas itu ia berfungsi luar talian. |
| App tidak muncul di GitHub Pages | Pastikan `index.html` berada di akar repo, bukan dalam subfolder. Tunggu 2 minit dan muat semula. |
| Data tidak muncul di peranti kedua | Pastikan anda log masuk dengan e-mel yang **sama**. Setiap akaun ada set rekod berasingan. |
