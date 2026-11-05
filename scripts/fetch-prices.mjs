#!/usr/bin/env node
// Mengambil harga BBM Pertamina dari API resmi MyPertamina,
// menormalkan formatnya, lalu menyimpannya sebagai JSON statis di data/prices.json.
//
// Dijalankan oleh GitHub Actions secara terjadwal (lihat .github/workflows/update-prices.yml),
// atau manual: `node scripts/fetch-prices.mjs`

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_URL = "https://api.web.mypertamina.id/price";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = resolve(__dirname, "..", "data", "prices.json");

/**
 * Ubah string harga ("24200", "Rp 10.000", "0", "") menjadi angka (integer).
 * Mengembalikan null jika harga 0 / kosong (artinya produk tidak tersedia di provinsi itu).
 */
function parsePrice(raw) {
  if (raw == null) return null;
  const digits = String(raw).replace(/[^0-9]/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

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

    return {
      province: String(entry.province ?? "").trim(),
      updatedDate: provinceUpdated ? provinceUpdated.toISOString() : null,
      prices,
    };
  });

  provinces.sort((a, b) => a.province.localeCompare(b.province, "id"));
  const products = [...productSet].sort((a, b) => a.localeCompare(b, "id"));

  return {
    fetchedAt: new Date().toISOString(),
    sourceUpdatedDate: latestSourceDate ? latestSourceDate.toISOString() : null,
    source: "https://mypertamina.id/about/product-price",
    apiSource: API_URL,
    totalProvinces: provinces.length,
    products,
    provinces,
  };
}

async function main() {
  console.log(`Mengambil data dari ${API_URL} ...`);
  const raw = await fetchWithRetry(API_URL);
  const normalized = normalize(raw);

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(normalized, null, 2) + "\n", "utf8");

  console.log(
    `Berhasil. ${normalized.totalProvinces} provinsi, ${normalized.products.length} produk.`
  );
  console.log(`Disimpan ke ${OUT_FILE}`);
}

main().catch((err) => {
  console.error("Gagal mengambil harga:", err);
  process.exit(1);
});
