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
   lalu menyimpan: `data/prices.json` (harga terkini), snapshot riwayat per tanggal di
   `data/history/`, dan **API statis** di `api/v1/`.
3. Jika ada perubahan, Actions otomatis commit & push berkas tersebut.
4. `index.html` membaca `data/prices.json` (same-origin, tanpa CORS) dan menampilkannya.

## Struktur proyek

```
.
├── index.html                      # halaman utama (tab Provinsi / Produk / API)
├── assets/
│   ├── style.css                   # gaya tampilan (mendukung mode gelap)
│   └── app.js                      # logika tampilan
├── data/
│   ├── prices.json                 # harga terkini (dipakai halaman web)
│   └── history/                    # snapshot harga per tanggal (riwayat)
│       ├── index.json
│       └── YYYY-MM-DD.json
├── api/v1/                         # API statis read-only (lihat bagian API)
│   ├── index.json
│   ├── nasional.json
│   ├── provinsi.json
│   ├── produk.json
│   ├── provinsi/{slug}.json
│   ├── produk/{slug}.json
│   └── history/...
├── scripts/
│   └── fetch-prices.mjs            # pengambil, penormal, pembuat riwayat & API
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

## API

Selain halaman web, proyek ini menghasilkan **API statis read-only** berupa berkas
JSON di `api/v1/`. Karena di-hosting GitHub Pages (header
`Access-Control-Allow-Origin: *`), API ini bisa dipanggil dari domain mana pun (CORS aktif).

Base URL: `https://<username>.github.io/<nama-repo>/api/v1/`

| Endpoint | Keterangan |
| --- | --- |
| `index.json` | Ringkasan + daftar semua provinsi, produk, & endpoint |
| `nasional.json` | Harga terkini seluruh provinsi dalam satu berkas |
| `provinsi.json` | Daftar provinsi beserta `slug` |
| `produk.json` | Daftar produk beserta `slug` |
| `provinsi/{slug}.json` | Harga terkini satu provinsi |
| `produk/{slug}.json` | Harga satu produk di semua provinsi (termurah dulu) |
| `history/index.json` | Rentang tanggal tersedia (`firstDate`..`lastDate`) & daftar tanggal perubahan |
| `history/{YYYY-MM-DD}.json` | Harga yang **berlaku** pada tanggal mana pun dalam rentang (carry-forward) |
| `history/latest.json` | Alias snapshot riwayat tanggal terbaru |
| `history/provinsi/{slug}.json` | Deret waktu harga satu provinsi (per tanggal perubahan) |

Contoh:

```bash
curl -s "https://<username>.github.io/<nama-repo>/api/v1/provinsi/prov-dki-jakarta.json"
```

```js
const res = await fetch("https://<username>.github.io/<nama-repo>/api/v1/nasional.json");
const data = await res.json();
console.log(data.provinces);
```

Catatan format: satuan `IDR/liter`; `price` berupa angka, dan `null` berarti
produk tidak tersedia di provinsi itu. Dokumentasi lengkap dengan URL otomatis
juga tersedia pada **tab "API"** di halaman web.

## Riwayat harga (panggil tanggal mana pun)

Setiap kali data berubah, harga disimpan sebagai snapshot bertanggal (zona WIB) di
`data/history/YYYY-MM-DD.json`. Snapshot **hanya ditambahkan bila harga berubah**
dibanding snapshot terakhir, sehingga penyimpanan tetap ringkas.

Namun di sisi **API**, endpoint `history/{YYYY-MM-DD}.json` di-generate untuk **setiap
tanggal** pada rentang `firstDate..lastDate` (lihat `history/index.json`). Jadi kamu
bisa memanggil **tanggal berapa pun** dalam rentang itu dan mendapat harga yang
**berlaku** pada tanggal tersebut — mengikuti perubahan terakhir pada/sebelumnya
(*carry-forward*).

> **Backfill otomatis:** `firstDate` bukan tanggal proyek ini mulai jalan, melainkan
> **tanggal perubahan harga terakhir** yang dibocorkan field `updatedDate` dari API
> MyPertamina. Karena harga tidak berubah sejak tanggal itu, harga di semua tanggal
> setelahnya pasti sama — sehingga riwayat bisa mundur sampai ke sana (mis. `2026-09-02`),
> bukan hanya sejak hari pertama proyek dijalankan.

Setiap respons memuat:

- `date` — tanggal yang diminta
- `effectiveDate` — tanggal perubahan harga terakhir yang berlaku pada `date`
- `capturedAt` — kapan snapshot itu diambil

```bash
# contoh: harga yang berlaku pada 1 Desember 2026
curl -s "https://<username>.github.io/<nama-repo>/api/v1/history/2026-12-01.json"
```

**Batasan:** tanggal **sebelum `firstDate`** (perubahan harga terakhir yang diketahui)
atau **di masa depan** (setelah `lastDate`/hari ini) akan mengembalikan `404` — API
MyPertamina tidak menyediakan harga historis sebelum tanggal perubahan terakhir itu.

## Lisensi

MIT. Data harga milik PT Pertamina (Persero) / MyPertamina; proyek ini hanya menampilkan ulang.
Harga bersifat indikatif — selalu verifikasi di SPBU resmi.
