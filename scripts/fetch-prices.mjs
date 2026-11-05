#!/usr/bin/env node
// Mengambil harga BBM Pertamina dari API resmi MyPertamina, menormalkan formatnya,
// menyimpan harga terkini + riwayat per tanggal, lalu menghasilkan API statis.
//
// Keluaran:
//   - data/prices.json              -> dipakai halaman web (harga terkini)
//   - data/history/YYYY-MM-DD.json  -> snapshot harga per tanggal (riwayat)
//   - data/history/index.json       -> daftar tanggal riwayat
//   - api/v1/*.json                 -> API statis read-only (lintas-domain)
//   - api/v1/history/*.json         -> API riwayat per tanggal & per provinsi
//
// Dijalankan oleh GitHub Actions terjadwal, atau manual: `node scripts/fetch-prices.mjs`

import { writeFile, mkdir, rm, readdir, readFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const API_URL = "https://api.web.mypertamina.id/price";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_FILE = join(ROOT, "data", "prices.json");
const HISTORY_DIR = join(ROOT, "data", "history");
const API_DIR = join(ROOT, "api", "v1");

const SOURCE_PAGE = "https://mypertamina.id/about/product-price";
const UNIT = "IDR/liter";

/* ---------- util ---------- */

/** "24200" | "Rp 10.000" | "0" | "" -> integer, atau null jika 0/kosong (tidak tersedia). */
function parsePrice(raw) {
  if (raw == null) return null;
  const digits = String(raw).replace(/[^0-9]/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "Prov. Aceh" -> "prov-aceh", "PERTAMAX GREEN 95" -> "pertamax-green-95" */
function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Tanggal kalender zona WIB (Asia/Jakarta) dalam format YYYY-MM-DD. */
function jakartaDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
  }).format(d);
}

/** Hasilkan setiap tanggal (YYYY-MM-DD) dari start s/d end, inklusif. */
function* dateRange(startStr, endStr) {
  const d = new Date(startStr + "T00:00:00Z");
  const end = new Date(endStr + "T00:00:00Z");
  while (d.getTime() <= end.getTime()) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

async function writeJson(file, obj) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

/* ---------- ambil & normalkan ---------- */

async function fetchWithRetry(url, { retries = 3, timeoutMs = 30000 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (pertamina-bbm-price; +https://github.com/) fetch-prices",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      console.warn(`Percobaan ${attempt}/${retries} gagal: ${err.message}`);
      if (attempt < retries) await new Promise((r) => setTimeout(r, 2000 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

function normalize(raw) {
  const rows = raw?.data?.data;
  if (!Array.isArray(rows)) {
    throw new Error("Struktur data tidak terduga: data.data bukan array");
  }

  const productSet = new Set();
  let latestSourceDate = null;

  const provinces = rows.map((entry) => {
    const prices = {};
    let provinceUpdated = null;

    for (const item of entry.list_price ?? []) {
      const product = String(item.product ?? "").trim();
      if (!product) continue;
      productSet.add(product);
      prices[product] = parsePrice(item.price);

      const d = item.updatedDate ? new Date(item.updatedDate) : null;
      if (d && !Number.isNaN(d.getTime())) {
        if (!provinceUpdated || d > provinceUpdated) provinceUpdated = d;
        if (!latestSourceDate || d > latestSourceDate) latestSourceDate = d;
      }
    }

    const province = String(entry.province ?? "").trim();
    return {
      province,
      slug: slugify(province),
      updatedDate: provinceUpdated ? provinceUpdated.toISOString() : null,
      prices,
    };
  });

  provinces.sort((a, b) => a.province.localeCompare(b.province, "id"));
  const products = [...productSet].sort((a, b) => a.localeCompare(b, "id"));

  return {
    fetchedAt: new Date().toISOString(),
    date: jakartaDate(), // tanggal kalender WIB saat pengambilan
    sourceUpdatedDate: latestSourceDate ? latestSourceDate.toISOString() : null,
    source: SOURCE_PAGE,
    apiSource: API_URL,
    unit: UNIT,
    totalProvinces: provinces.length,
    products,
    provinces,
  };
}

/* ---------- riwayat per tanggal ---------- */

function snapshotFromNormalized(n, date) {
  return {
    date,
    fetchedAt: n.fetchedAt,
    sourceUpdatedDate: n.sourceUpdatedDate,
    unit: n.unit,
    products: n.products,
    provinces: n.provinces.map((p) => ({
      province: p.province,
      slug: p.slug,
      prices: p.prices,
    })),
  };
}

/** Sidik jari harga (abaikan tanggal/waktu) untuk mendeteksi perubahan. */
function fingerprint(snap) {
  const prods = [...snap.products].sort();
  const rows = [...snap.provinces]
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((p) => [p.slug, prods.map((pr) => p.prices[pr] ?? null)]);
  return JSON.stringify([prods, rows]);
}

async function loadHistory() {
  let files = [];
  try {
    files = await readdir(HISTORY_DIR);
  } catch {
    return [];
  }
  const snaps = [];
  for (const f of files) {
    if (!f.endsWith(".json") || f === "index.json") continue;
    try {
      const s = JSON.parse(await readFile(join(HISTORY_DIR, f), "utf8"));
      if (s && s.date && Array.isArray(s.provinces)) snaps.push(s);
    } catch {
      /* lewati file rusak */
    }
  }
  snaps.sort((a, b) => a.date.localeCompare(b.date));
  return snaps;
}

/**
 * Simpan snapshot hanya bila harga berubah dibanding snapshot terakhir
 * (berbasis-perubahan), dengan kunci tanggal WIB. Mengembalikan daftar
 * seluruh snapshot (termasuk yang baru bila ada).
 */
async function updateHistory(normalized) {
  // Kunci snapshot = TANGGAL HARGA BERLAKU (dari field updatedDate sumber), bukan
  // tanggal fetch. Dengan begitu riwayat otomatis mundur sampai perubahan harga
  // terakhir yang dibocorkan API (mis. 2026-09-02), bukan hanya sejak hari ini.
  const effDate = normalized.sourceUpdatedDate
    ? jakartaDate(new Date(normalized.sourceUpdatedDate))
    : jakartaDate();
  const snaps = await loadHistory();
  const current = snapshotFromNormalized(normalized, effDate);
  const latest = snaps[snaps.length - 1];
  const changed = !latest || fingerprint(latest) !== fingerprint(current);

  if (changed) {
    await writeJson(join(HISTORY_DIR, `${effDate}.json`), current);
    const idx = snaps.findIndex((s) => s.date === effDate);
    if (idx >= 0) snaps[idx] = current;
    else snaps.push(current);
    snaps.sort((a, b) => a.date.localeCompare(b.date));
    console.log(`Snapshot riwayat disimpan untuk ${effDate} (tanggal harga berlaku).`);
  } else {
    console.log(
      `Harga tidak berubah sejak ${latest.date} — snapshot tidak ditambah.`
    );
  }

  await writeJson(join(HISTORY_DIR, "index.json"), {
    total: snaps.length,
    firstDate: snaps[0]?.date ?? null,
    lastDate: snaps[snaps.length - 1]?.date ?? null,
    dates: snaps.map((s) => ({
      date: s.date,
      sourceUpdatedDate: s.sourceUpdatedDate,
      fetchedAt: s.fetchedAt,
    })),
  });

  return snaps;
}

/* ---------- API statis ---------- */

async function writeApi(n, snaps) {
  // mulai bersih agar file lama (provinsi/produk/tanggal yang hilang) ikut terhapus
  await rm(API_DIR, { recursive: true, force: true });
  await mkdir(API_DIR, { recursive: true });

  const products = n.products.map((product) => ({
    product,
    slug: slugify(product),
  }));
  const provincesMeta = n.provinces.map((p) => ({
    province: p.province,
    slug: p.slug,
  }));

  const base = {
    status: "success",
    fetchedAt: n.fetchedAt,
    sourceUpdatedDate: n.sourceUpdatedDate,
    source: n.source,
    unit: n.unit,
  };

  const priceArray = (pricesObj) =>
    n.products.map((product) => ({
      product,
      slug: slugify(product),
      price: pricesObj[product] ?? null,
    }));

  // index.json
  await writeJson(join(API_DIR, "index.json"), {
    api: "Harga BBM Pertamina",
    version: "v1",
    ...base,
    license:
      "Data milik PT Pertamina (Persero) / MyPertamina. Bersifat indikatif.",
    totalProvinces: n.totalProvinces,
    totalProducts: products.length,
    endpoints: {
      index: "v1/index.json",
      nasional: "v1/nasional.json",
      daftarProvinsi: "v1/provinsi.json",
      daftarProduk: "v1/produk.json",
      perProvinsi: "v1/provinsi/{slug}.json",
      perProduk: "v1/produk/{slug}.json",
      riwayatIndex: "v1/history/index.json",
      riwayatTanggal: "v1/history/{YYYY-MM-DD}.json",
      riwayatTerkini: "v1/history/latest.json",
      riwayatProvinsi: "v1/history/provinsi/{slug}.json",
    },
    provinces: provincesMeta,
    products,
  });

  // nasional.json
  await writeJson(join(API_DIR, "nasional.json"), {
    ...base,
    totalProvinces: n.totalProvinces,
    products,
    provinces: n.provinces.map((p) => ({
      province: p.province,
      slug: p.slug,
      updatedDate: p.updatedDate,
      prices: priceArray(p.prices),
    })),
  });

  // daftar
  await writeJson(join(API_DIR, "provinsi.json"), {
    ...base,
    total: provincesMeta.length,
    data: provincesMeta.map((p) => ({
      ...p,
      endpoint: `v1/provinsi/${p.slug}.json`,
    })),
  });
  await writeJson(join(API_DIR, "produk.json"), {
    ...base,
    total: products.length,
    data: products.map((p) => ({ ...p, endpoint: `v1/produk/${p.slug}.json` })),
  });

  // per-provinsi
  for (const p of n.provinces) {
    await writeJson(join(API_DIR, "provinsi", `${p.slug}.json`), {
      ...base,
      province: p.province,
      slug: p.slug,
      updatedDate: p.updatedDate,
      prices: priceArray(p.prices),
    });
  }

  // per-produk (diurut termurah; tidak tersedia di bawah)
  for (const { product, slug } of products) {
    const list = n.provinces
      .map((p) => ({
        province: p.province,
        slug: p.slug,
        price: p.prices[product] ?? null,
      }))
      .sort((a, b) => {
        if (a.price == null && b.price == null)
          return a.province.localeCompare(b.province, "id");
        if (a.price == null) return 1;
        if (b.price == null) return -1;
        return a.price - b.price;
      });
    await writeJson(join(API_DIR, "produk", `${slug}.json`), {
      ...base,
      product,
      slug,
      prices: list,
    });
  }

  await writeHistoryApi(n, snaps);
}

async function writeHistoryApi(n, snaps) {
  const histDir = join(API_DIR, "history");
  await mkdir(join(histDir, "provinsi"), { recursive: true });

  // Envelope stabil (tanpa waktu pengambilan yang berubah tiap run) agar file
  // tanggal-tanggal lama tidak ikut berubah dan riwayat git tetap ringkas.
  const histBase = { status: "success", source: n.source, unit: n.unit };

  if (snaps.length === 0) {
    await writeJson(join(histDir, "index.json"), {
      ...histBase,
      firstDate: null,
      lastDate: null,
      totalDays: 0,
      totalSnapshots: 0,
      snapshotDates: [],
    });
    return;
  }

  const firstDate = snaps[0].date;
  const lastDate = n.date; // hari ini (WIB); selalu >= tanggal snapshot terakhir
  const days = [...dateRange(firstDate, lastDate)];

  const productMeta = (s) => s.products.map((p) => ({ product: p, slug: slugify(p) }));
  const toProvinces = (s) =>
    s.provinces.map((p) => ({
      province: p.province,
      slug: p.slug,
      prices: s.products.map((product) => ({
        product,
        slug: slugify(product),
        price: p.prices[product] ?? null,
      })),
    }));
  const dayPayload = (reqDate, s) => ({
    ...histBase,
    date: reqDate, // tanggal yang diminta
    effectiveDate: s.date, // snapshot perubahan terakhir yang berlaku pada tanggal itu
    sourceUpdatedDate: s.sourceUpdatedDate,
    capturedAt: s.fetchedAt,
    products: productMeta(s),
    provinces: toProvinces(s),
  });

  // index riwayat
  await writeJson(join(histDir, "index.json"), {
    ...histBase,
    note:
      "Panggil history/{YYYY-MM-DD}.json untuk tanggal mana pun pada rentang firstDate..lastDate. " +
      "Harga mengikuti perubahan terakhir pada/sebelum tanggal tsb (carry-forward). " +
      "Tanggal di luar rentang akan 404.",
    firstDate,
    lastDate,
    totalDays: days.length,
    totalSnapshots: snaps.length,
    snapshotDates: snaps.map((s) => s.date),
  });

  // Satu file untuk SETIAP tanggal pada rentang (carry-forward dari snapshot terakhir).
  let si = 0;
  let lastDay = null;
  for (const d of days) {
    while (si + 1 < snaps.length && snaps[si + 1].date <= d) si++;
    const payload = dayPayload(d, snaps[si]);
    await writeJson(join(histDir, `${d}.json`), payload);
    lastDay = payload;
  }
  // alias tanggal terbaru
  if (lastDay) await writeJson(join(histDir, "latest.json"), lastDay);

  // deret waktu per provinsi (semua snapshot perubahan)
  const provNames = new Map(); // slug -> nama
  const productSet = new Set();
  for (const s of snaps) {
    for (const pr of s.products) productSet.add(pr);
    for (const p of s.provinces) provNames.set(p.slug, p.province);
  }
  const allProducts = [...productSet].sort((a, b) => a.localeCompare(b, "id"));

  for (const [slug, province] of provNames) {
    const history = snaps.map((s) => {
      const p = s.provinces.find((x) => x.slug === slug);
      return {
        date: s.date,
        prices: p
          ? Object.fromEntries(allProducts.map((pr) => [pr, p.prices[pr] ?? null]))
          : null,
      };
    });
    await writeJson(join(histDir, "provinsi", `${slug}.json`), {
      ...histBase,
      province,
      slug,
      firstDate,
      lastDate,
      products: allProducts,
      history,
    });
  }
}

/* ---------- main ---------- */

async function main() {
  console.log(`Mengambil data dari ${API_URL} ...`);
  const raw = await fetchWithRetry(API_URL);
  const normalized = normalize(raw);

  await writeJson(DATA_FILE, normalized);
  const snaps = await updateHistory(normalized);
  await writeApi(normalized, snaps);

  console.log(
    `Berhasil. ${normalized.totalProvinces} provinsi, ${normalized.products.length} produk, ${snaps.length} tanggal riwayat.`
  );
}

main().catch((err) => {
  console.error("Gagal mengambil harga:", err);
  process.exit(1);
});
