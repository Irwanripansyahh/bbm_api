# ⛽ Harga BBM Pertamina

Situs statis yang menampilkan daftar harga BBM Pertamina per provinsi se-Indonesia.
Data diambil dari API publik [MyPertamina](https://mypertamina.id/about/product-price),
dinormalkan menjadi file JSON statis, lalu ditampilkan di halaman web — siap di-hosting
gratis di **GitHub Pages** (`github.io`).

## Cara kerja

GitHub Pages hanya melayani file statis dan browser tidak bisa memanggil API MyPertamina
langsung (tidak ada header CORS). Jadi alurnya:

```
GitHub Actions (terjadwal)  ─►  scripts/fetch-prices.mjs  ─►  data/prices.json  ─►  situs statis (index.html)
```

1. **GitHub Actions** berjalan terjadwal (default: sekali sehari) dan bisa dijalankan manual.
2. Script `scripts/fetch-prices.mjs` memanggil `https://api.web.mypertamina.id/price`,
   menormalkan harga (membersihkan format seperti `"Rp 10.000"` → `10000`, `"0"` → tidak tersedia),
   lalu menyimpannya ke `data/prices.json`.
3. Jika ada perubahan, Actions otomatis commit & push file JSON tersebut.
4. `index.html` membaca `data/prices.json` (same-origin, tanpa CORS) dan menampilkannya.

## Struktur proyek

```
.
├── index.html                      # halaman utama
├── assets/
│   ├── style.css                   # gaya tampilan (mendukung mode gelap)
│   └── app.js                      # logika tampilan (tab Provinsi / Produk)
├── data/
│   └── prices.json                 # data harga (hasil generate, di-commit)
├── scripts/
│   └── fetch-prices.mjs            # pengambil & penormal data
├── .github/workflows/
│   └── update-prices.yml           # otomatisasi update
├── package.json
└── README.md
```

## Menjalankan di lokal

```bash
# 1. Ambil data terbaru (butuh Node.js 18+)
node scripts/fetch-prices.mjs

# 2. Jalankan server statis lalu buka http://localhost:8080
python3 -m http.server 8080
```

> Catatan: buka lewat server (bukan `file://`) karena halaman memakai `fetch()` untuk membaca JSON.

## Deploy ke GitHub Pages

1. Buat repository baru di GitHub, lalu push proyek ini:
   ```bash
   git init
   git add .
   git commit -m "init: situs harga BBM Pertamina"
   git branch -M main
   git remote add origin https://github.com/<username>/<nama-repo>.git
   git push -u origin main
   ```
2. Di GitHub: **Settings → Pages**.
   - **Source**: `Deploy from a branch`
   - **Branch**: `main` , folder `/ (root)` → **Save**.
3. Tunggu beberapa menit. Situs akan tersedia di:
   `https://<username>.github.io/<nama-repo>/`
4. Aktifkan otomatisasi: buka tab **Actions**, aktifkan workflow bila diminta.
   Pastikan **Settings → Actions → General → Workflow permissions** diset
   **Read and write permissions** agar Actions bisa commit data baru.

### Jadwal update

Diatur di `.github/workflows/update-prices.yml` (cron UTC). Default `0 22 * * *`
(≈ 05:00 WIB setiap hari). Ubah sesuai kebutuhan, atau jalankan manual lewat
**Actions → Perbarui Harga BBM → Run workflow**.

## Produk yang ditampilkan

Dexlite, Pertalite, Pertamax, Pertamax Green 95, Pertamax (Pertashop),
Pertamax Turbo, Pertamina Biosolar (Subsidi & Non-Subsidi), dan Pertamina Dex —
sesuai yang disediakan API MyPertamina. Produk dengan harga `0` ditandai
**"Tidak tersedia"** untuk provinsi terkait.

## Lisensi

MIT. Data harga milik PT Pertamina (Persero) / MyPertamina; proyek ini hanya menampilkan ulang.
Harga bersifat indikatif — selalu verifikasi di SPBU resmi.
