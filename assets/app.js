"use strict";

const DATA_URL = "data/prices.json";

const state = {
  data: null,
  view: "province", // "province" | "product" | "api"
  selected: null, // nama provinsi atau produk yang dipilih
};

const el = {
  meta: document.getElementById("meta-line"),
  content: document.getElementById("content"),
  selector: document.getElementById("selector"),
  selectorLabel: document.getElementById("selector-label"),
  selectorWrap: document.querySelector(".selector"),
  tabs: document.querySelectorAll(".tab"),
};

const rupiah = new Intl.NumberFormat("id-ID");

function formatDate(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatDateTime(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function priceHtml(value) {
  if (value == null) {
    return '<span class="price unavail">Tidak tersedia</span>';
  }
  return `<span class="price"><span class="cur">Rp</span>${rupiah.format(
    value
  )}</span>`;
}

/* ---------- Tampilan ---------- */

function renderProvinceView() {
  const { data } = state;
  const prov =
    data.provinces.find((p) => p.province === state.selected) ||
    data.provinces[0];
  state.selected = prov.province;

  const cards = data.products
    .map((product) => {
      const value = prov.prices[product];
      const priceMarkup =
        value == null
          ? priceHtml(null)
          : `${priceHtml(value)} <span class="unit">/ liter</span>`;
      return `
        <article class="card">
          <p class="product">${escapeHtml(product)}</p>
          ${priceMarkup}
        </article>`;
    })
    .join("");

  el.content.innerHTML = `
    <div class="section-head">
      <h2>${escapeHtml(prov.province)}</h2>
      <span class="updated">Berlaku per ${formatDate(prov.updatedDate)}</span>
    </div>
    <div class="grid">${cards}</div>`;
}

function renderProductView() {
  const { data } = state;
  const product = data.products.includes(state.selected)
    ? state.selected
    : data.products[0];
  state.selected = product;

  const rows = data.provinces
    .map((p) => ({ province: p.province, value: p.prices[product] ?? null }))
    .sort((a, b) => {
      // yang tersedia dulu, urut termurah; yang tidak tersedia di bawah
      if (a.value == null && b.value == null)
        return a.province.localeCompare(b.province, "id");
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      return a.value - b.value;
    });

  const body = rows
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.province)}</td>
        <td class="price-col${r.value == null ? " unavail" : ""}">
          ${r.value == null ? "Tidak tersedia" : "Rp " + rupiah.format(r.value)}
        </td>
      </tr>`
    )
    .join("");

  el.content.innerHTML = `
    <div class="section-head">
      <h2>${escapeHtml(product)}</h2>
      <span class="updated">Harga per liter, diurutkan dari termurah</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Provinsi</th><th style="text-align:right">Harga</th></tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function renderApiView() {
  const { data } = state;
  const apiBase = new URL("api/", document.baseURI).href; // termasuk trailing slash
  const exProv = data.provinces[0]?.slug || "prov-dki-jakarta";
  const exProd = slugify(data.products[0] || "pertamax");
  const exDate = data.sourceUpdatedDate
    ? new Date(data.sourceUpdatedDate).toISOString().slice(0, 10)
    : "2026-01-01";

  const endpoints = [
    ["v1/index.json", "Ringkasan + daftar semua provinsi, produk, & endpoint."],
    ["v1/nasional.json", "Harga terkini seluruh provinsi dalam satu berkas."],
    ["v1/provinsi.json", "Daftar provinsi beserta slug-nya."],
    ["v1/produk.json", "Daftar produk BBM beserta slug-nya."],
    [`v1/provinsi/${exProv}.json`, "Harga terkini satu provinsi (ganti slug)."],
    [`v1/produk/${exProd}.json`, "Harga satu produk di semua provinsi, termurah dulu."],
    ["v1/history/index.json", "Daftar tanggal riwayat yang tersedia."],
    [`v1/history/${exDate}.json`, "Snapshot harga pada tanggal tertentu."],
    [
      `v1/history/provinsi/${exProv}.json`,
      "Deret waktu harga satu provinsi (per tanggal).",
    ],
  ];

  const rows = endpoints
    .map(([path, desc]) => {
      const url = apiBase + path;
      return `
        <tr>
          <td><span class="badge">GET</span></td>
          <td><code>${escapeHtml(path)}</code><br /><span class="ep-desc">${escapeHtml(
        desc
      )}</span></td>
          <td class="ep-try">
            <a href="${escapeHtml(url)}" target="_blank" rel="noopener">buka ↗</a>
          </td>
        </tr>`;
    })
    .join("");

  const sampleUrl = apiBase + `v1/provinsi/${exProv}.json`;
  const curl = `curl -s "${sampleUrl}"`;
  const js = `const res = await fetch(
  "${apiBase}v1/nasional.json"
);
const data = await res.json();
console.log(data.provinces);`;

  el.content.innerHTML = `
    <div class="api-doc">
      <div class="section-head"><h2>Dokumentasi API</h2></div>
      <p>
        API read-only berupa berkas JSON statis. Di-hosting GitHub Pages dengan
        header <code>Access-Control-Allow-Origin: *</code>, jadi
        <strong>bisa dipanggil dari domain mana pun</strong> (CORS aktif). Data
        diperbarui otomatis via GitHub Actions; harga lama tersimpan per tanggal
        di endpoint <code>history</code>.
      </p>

      <h3>Base URL</h3>
      <div class="codeblock">
        <button class="copy-btn" type="button">Salin</button>
        <pre><code>${escapeHtml(apiBase + "v1/")}</code></pre>
      </div>

      <h3>Endpoint</h3>
      <div class="table-wrap">
        <table class="api-table">
          <thead>
            <tr><th>Metode</th><th>Path &amp; keterangan</th><th></th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <h3>Contoh — cURL</h3>
      <div class="codeblock">
        <button class="copy-btn" type="button">Salin</button>
        <pre><code>${escapeHtml(curl)}</code></pre>
      </div>

      <h3>Contoh — JavaScript (fetch)</h3>
      <div class="codeblock">
        <button class="copy-btn" type="button">Salin</button>
        <pre><code>${escapeHtml(js)}</code></pre>
      </div>

      <h3>Format harga</h3>
      <ul class="api-notes">
        <li>Satuan: <code>${escapeHtml(data.unit || "IDR/liter")}</code> (Rupiah per liter).</li>
        <li><code>price</code> bertipe angka; <code>null</code> berarti produk tidak tersedia di provinsi itu.</li>
        <li><code>slug</code> dipakai pada path (mis. <code>${escapeHtml(
          exProv
        )}</code>, <code>${escapeHtml(exProd)}</code>).</li>
        <li>Lihat daftar lengkap slug di <code>v1/provinsi.json</code> &amp; <code>v1/produk.json</code>.</li>
      </ul>
    </div>`;

  // tombol salin
  el.content.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.parentElement.querySelector("code")?.textContent ?? "";
      try {
        await navigator.clipboard.writeText(code);
        const prev = btn.textContent;
        btn.textContent = "Tersalin!";
        setTimeout(() => (btn.textContent = prev), 1500);
      } catch {
        btn.textContent = "Gagal";
      }
    });
  });
}

function render() {
  if (state.view === "province") renderProvinceView();
  else if (state.view === "product") renderProductView();
  else renderApiView();
}

/* ---------- Kontrol ---------- */

function populateSelector() {
  if (state.view === "api") {
    el.selectorWrap.style.display = "none";
    return;
  }
  el.selectorWrap.style.display = "";

  const items =
    state.view === "province"
      ? state.data.provinces.map((p) => p.province)
      : state.data.products;

  el.selectorLabel.textContent =
    state.view === "province" ? "Provinsi" : "Produk";

  el.selector.innerHTML = items
    .map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`)
    .join("");

  // pertahankan pilihan jika masih valid
  if (items.includes(state.selected)) {
    el.selector.value = state.selected;
  } else {
    state.selected = items[0];
  }
}

function setView(view) {
  if (view === state.view) return;
  state.view = view;
  state.selected = null;
  el.tabs.forEach((t) => t.classList.toggle("is-active", t.dataset.view === view));
  populateSelector();
  render();
}

function bindEvents() {
  el.tabs.forEach((tab) =>
    tab.addEventListener("click", () => setView(tab.dataset.view))
  );
  el.selector.addEventListener("change", (e) => {
    state.selected = e.target.value;
    render();
  });
}

/* ---------- Util ---------- */

function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c])
  );
}

/* ---------- Init ---------- */

async function init() {
  try {
    const res = await fetch(DATA_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Gagal memuat data (HTTP ${res.status})`);
    state.data = await res.json();

    el.meta.innerHTML = `
      ${state.data.totalProvinces} provinsi &middot;
      Data sumber: ${formatDate(state.data.sourceUpdatedDate)} &middot;
      Terakhir disinkronkan: ${formatDateTime(state.data.fetchedAt)}`;

    populateSelector();
    bindEvents();
    render();
  } catch (err) {
    el.meta.textContent = "";
    el.content.innerHTML = `
      <div class="error">
        <strong>Tidak dapat memuat data harga.</strong>
        <p>${escapeHtml(err.message)}</p>
        <p>Pastikan file <code>data/prices.json</code> tersedia.</p>
      </div>`;
    console.error(err);
  }
}

init();
