"use strict";

const DATA_URL = "data/prices.json";

const state = {
  data: null,
  view: "province", // "province" | "product"
  selected: null, // nama provinsi atau produk yang dipilih
};

const el = {
  meta: document.getElementById("meta-line"),
  content: document.getElementById("content"),
  selector: document.getElementById("selector"),
  selectorLabel: document.getElementById("selector-label"),
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

function render() {
  if (state.view === "province") renderProvinceView();
  else renderProductView();
}

/* ---------- Kontrol ---------- */

function populateSelector() {
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
