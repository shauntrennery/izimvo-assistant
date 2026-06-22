import { DEFAULT_COUNTRY, SEARCH_COUNTRIES } from "../core/countries.js";

/**
 * The catalogue search page (served at GET /search). A single self-contained
 * HTML document — no build step, no framework — with a fixed header carrying the
 * search box and filters (Country primary, default South Africa; plus an
 * optional max-price). It calls GET /v1/catalog/search on this same origin and
 * paints a results grid. Country options are generated from core so the list and
 * the currency mapping never drift.
 *
 * Aesthetic: warm editorial / curated marketplace — bone paper, ink text, a
 * terracotta accent, Fraunces (display serif) + Hanken Grotesk (body). Cards are
 * numbered "editor's picks" that reveal in a stagger; the tagline reacts to the
 * chosen country. Leans into the brand: Izimvo *has an opinion*.
 */

const countryOptions = SEARCH_COUNTRIES.map(
  (ctry) =>
    `<option value="${ctry.code}"${ctry.code === DEFAULT_COUNTRY ? " selected" : ""}>${ctry.name}</option>`,
).join("");

export const SEARCH_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Izimvo — Considered Picks</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,400;1,9..144,500&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  :root {
    --bg: #f1eadd;
    --paper: #fbf8f1;
    --ink: #211c16;
    --muted: #8c8173;
    --faint: #b6ab99;
    --line: #ddd4c3;
    --accent: #bf3b21;
    --accent-deep: #9a2f19;
    --shadow: 24px 30px 60px -32px rgba(54, 38, 22, 0.45);
    --serif: "Fraunces", Georgia, "Times New Roman", serif;
    --sans: "Hanken Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    background: var(--bg);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 15px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  /* Paper grain overlay for atmosphere. */
  body::before {
    content: "";
    position: fixed;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    opacity: 0.5;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E");
  }
  ::selection { background: var(--accent); color: #fff7f0; }

  /* ---------- Masthead ---------- */
  header.masthead {
    position: sticky;
    top: 0;
    z-index: 20;
    background: linear-gradient(180deg, var(--bg) 70%, rgba(241, 234, 221, 0.92));
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--line);
    box-shadow: 0 1px 0 #fff8 inset;
  }
  .accent-rule { height: 4px; background: var(--accent); }
  .masthead-inner {
    max-width: 1180px;
    margin: 0 auto;
    padding: 22px 32px 20px;
  }
  .brandline {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 20px;
    flex-wrap: wrap;
  }
  .wordmark {
    font-family: var(--serif);
    font-weight: 600;
    font-size: clamp(30px, 4vw, 46px);
    letter-spacing: -0.02em;
    line-height: 1;
    margin: 0;
  }
  .wordmark em {
    font-style: italic;
    color: var(--accent);
    font-weight: 500;
  }
  .kicker {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.32em;
    color: var(--muted);
    font-weight: 600;
  }
  #tagline {
    font-family: var(--serif);
    font-style: italic;
    font-size: clamp(15px, 1.6vw, 19px);
    color: var(--muted);
  }
  #tagline b { color: var(--ink); font-style: normal; font-weight: 600; }

  /* ---------- Controls ---------- */
  form.controls {
    margin-top: 22px;
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    gap: 18px;
    align-items: end;
  }
  .field { display: flex; flex-direction: column; gap: 7px; }
  .field > span {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: var(--muted);
    font-weight: 700;
    padding-left: 1px;
  }
  .field.search { position: relative; }
  #q {
    font-family: var(--serif);
    font-size: clamp(22px, 3vw, 32px);
    font-weight: 400;
    background: transparent;
    border: 0;
    border-bottom: 2px solid var(--ink);
    padding: 4px 2px 8px;
    color: var(--ink);
    width: 100%;
    outline: none;
    transition: border-color 0.25s;
  }
  #q::placeholder { color: var(--faint); font-style: italic; }
  #q:focus { border-color: var(--accent); }

  select, #maxPrice {
    font-family: var(--sans);
    font-size: 15px;
    font-weight: 500;
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 2px;
    padding: 12px 14px;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  select:focus, #maxPrice:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(191, 59, 33, 0.14);
  }
  select {
    appearance: none;
    -webkit-appearance: none;
    padding-right: 38px;
    min-width: 178px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%23bf3b21' stroke-width='1.6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 14px center;
    cursor: pointer;
  }
  .field.country select { font-weight: 600; }
  #maxPrice { width: 132px; }
  #maxPrice::placeholder { color: var(--faint); }

  button#go {
    font-family: var(--sans);
    font-weight: 700;
    font-size: 14px;
    letter-spacing: 0.02em;
    color: #fdf6ee;
    background: var(--accent);
    border: 0;
    border-radius: 2px;
    padding: 13px 26px;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.18s, transform 0.12s;
  }
  button#go:hover { background: var(--accent-deep); }
  button#go:active { transform: translateY(1px); }
  button#go:disabled { opacity: 0.55; cursor: progress; }

  /* ---------- Main ---------- */
  main {
    position: relative;
    z-index: 2;
    max-width: 1180px;
    margin: 0 auto;
    padding: 40px 32px 90px;
  }

  #meta {
    display: flex;
    align-items: baseline;
    gap: 14px;
    margin-bottom: 26px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--line);
  }
  #meta .count {
    font-family: var(--serif);
    font-weight: 600;
    font-size: 20px;
  }
  #meta .where {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: var(--muted);
    font-weight: 700;
  }

  .status {
    z-index: 2;
    position: relative;
    text-align: center;
    padding: 90px 20px;
    max-width: 540px;
    margin: 0 auto;
  }
  .status .lede {
    font-family: var(--serif);
    font-size: clamp(26px, 4vw, 40px);
    font-weight: 400;
    line-height: 1.12;
    letter-spacing: -0.01em;
    margin: 0 0 14px;
  }
  .status .lede em { font-style: italic; color: var(--accent); }
  .status .sub { color: var(--muted); font-size: 15px; }
  .status.error .lede { color: var(--accent-deep); }

  /* ---------- Grid ---------- */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(248px, 1fr));
    gap: 26px;
  }
  .card {
    position: relative;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 3px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    opacity: 0;
    transform: translateY(14px);
    animation: rise 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
    transition: transform 0.28s ease, box-shadow 0.28s ease, border-color 0.28s ease;
  }
  @keyframes rise { to { opacity: 1; transform: translateY(0); } }
  @media (prefers-reduced-motion: reduce) {
    .card { animation: none; opacity: 1; transform: none; }
  }
  .card:hover {
    transform: translateY(-4px);
    box-shadow: var(--shadow);
    border-color: var(--faint);
  }
  .index {
    position: absolute;
    top: 10px;
    left: 12px;
    z-index: 2;
    font-family: var(--serif);
    font-weight: 600;
    font-size: 13px;
    color: var(--accent);
    background: rgba(251, 248, 241, 0.9);
    border-radius: 999px;
    padding: 1px 9px;
    letter-spacing: 0.04em;
  }
  .thumb {
    aspect-ratio: 4 / 5;
    background: #efe7d7;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-bottom: 1px solid var(--line);
  }
  .thumb img {
    width: 100%; height: 100%;
    object-fit: cover;
    transition: transform 0.5s ease;
  }
  .card:hover .thumb img { transform: scale(1.04); }
  .thumb .ph {
    font-family: var(--serif);
    font-style: italic;
    color: var(--faint);
    font-size: 14px;
  }
  .card-body { padding: 16px 17px 18px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
  .merchant {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--muted);
    font-weight: 700;
  }
  .title {
    font-family: var(--serif);
    font-size: 19px;
    font-weight: 500;
    line-height: 1.22;
    letter-spacing: -0.01em;
  }
  .price {
    font-family: var(--serif);
    font-size: 21px;
    font-weight: 600;
    margin-top: auto;
    padding-top: 6px;
  }
  .view {
    margin-top: 10px;
    align-self: flex-start;
    font-size: 13px;
    font-weight: 600;
    text-decoration: none;
    color: var(--ink);
    position: relative;
    padding-bottom: 3px;
  }
  .view::after {
    content: "";
    position: absolute;
    left: 0; bottom: 0;
    width: 100%; height: 1.5px;
    background: var(--accent);
    transform: scaleX(0);
    transform-origin: left;
    transition: transform 0.28s ease;
  }
  .card:hover .view::after, .view:hover::after { transform: scaleX(1); }
  .view .arrow { color: var(--accent); transition: transform 0.2s ease; display: inline-block; }
  .view:hover .arrow { transform: translateX(3px); }

  @media (max-width: 720px) {
    form.controls { grid-template-columns: 1fr 1fr; }
    .field.search { grid-column: 1 / -1; }
    .masthead-inner { padding: 18px 20px 16px; }
    main { padding: 30px 20px 70px; }
  }
</style>
</head>
<body>
  <header class="masthead">
    <div class="accent-rule"></div>
    <div class="masthead-inner">
      <div class="brandline">
        <h1 class="wordmark">Iz<em>i</em>mvo</h1>
        <span class="kicker">Considered Picks</span>
      </div>
      <p id="tagline">An opinionated read of the catalogue, shipping to <b>South Africa</b>.</p>

      <form class="controls" id="searchForm">
        <label class="field search">
          <span>What are you after</span>
          <input id="q" name="q" type="search" placeholder="waterproof trail shoes…" autocomplete="off" />
        </label>
        <label class="field country">
          <span>Country</span>
          <select id="country" name="country">${countryOptions}</select>
        </label>
        <label class="field">
          <span>Max price</span>
          <input id="maxPrice" name="maxPrice" type="number" min="0" step="1" placeholder="any" />
        </label>
        <button type="submit" id="go">Advise me</button>
      </form>
    </div>
  </header>

  <main>
    <div id="meta" hidden>
      <span class="count"></span>
      <span class="where"></span>
    </div>
    <div id="status" class="status">
      <p class="lede">Tell me what you want — <em>I'll tell you what's worth it.</em></p>
      <p class="sub">Search the catalogue above. Country is the first filter; everything's priced where you'll buy it.</p>
    </div>
    <div id="grid" class="grid" hidden></div>
  </main>

  <script>
    (function () {
      var form = document.getElementById("searchForm");
      var qEl = document.getElementById("q");
      var countryEl = document.getElementById("country");
      var maxEl = document.getElementById("maxPrice");
      var btn = document.getElementById("go");
      var statusEl = document.getElementById("status");
      var grid = document.getElementById("grid");
      var meta = document.getElementById("meta");
      var taglineEl = document.getElementById("tagline");

      function countryName() {
        return countryEl.options[countryEl.selectedIndex].text;
      }

      function syncTagline() {
        taglineEl.innerHTML = "An opinionated read of the catalogue, shipping to <b>" + esc(countryName()) + "</b>.";
      }

      function showStatus(lede, sub, isError) {
        statusEl.className = "status" + (isError ? " error" : "");
        statusEl.innerHTML = '<p class="lede">' + lede + '</p>' + (sub ? '<p class="sub">' + esc(sub) + "</p>" : "");
        statusEl.hidden = false;
        grid.hidden = true;
        meta.hidden = true;
      }

      function money(minor, currency) {
        var amount = (minor || 0) / 100;
        try {
          return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(amount);
        } catch (e) {
          return (currency ? currency + " " : "") + amount.toFixed(2);
        }
      }

      function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
          return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
      }

      function pad(n) { return n < 10 ? "0" + n : String(n); }

      function render(products) {
        if (!products.length) {
          showStatus("Nothing I'd stand behind here.", "Try a broader search, lift the price ceiling, or switch country.", false);
          return;
        }
        grid.innerHTML = products.map(function (p, i) {
          var img = p.imageUrl
            ? '<img src="' + esc(p.imageUrl) + '" alt="" loading="lazy" />'
            : '<span class="ph">no image</span>';
          var merchant = p.bestOfferMerchant ? '<div class="merchant">' + esc(p.bestOfferMerchant) + "</div>" : "";
          return (
            '<article class="card" style="animation-delay:' + (i * 55) + 'ms">' +
              '<span class="index">' + pad(i + 1) + "</span>" +
              '<div class="thumb">' + img + "</div>" +
              '<div class="card-body">' +
                merchant +
                '<div class="title">' + esc(p.title) + "</div>" +
                '<div class="price">' + money(p.priceMinor, p.currency) + "</div>" +
                '<a class="view" href="' + esc(p.checkoutUrl) + '" target="_blank" rel="noopener">View <span class="arrow">&rarr;</span></a>' +
              "</div>" +
            "</article>"
          );
        }).join("");
        meta.querySelector(".count").textContent = products.length === 1 ? "1 pick" : products.length + " picks";
        meta.querySelector(".where").textContent = "shipping to " + countryName();
        meta.hidden = false;
        statusEl.hidden = true;
        grid.hidden = false;
      }

      function search() {
        var q = qEl.value.trim();
        if (!q) { showStatus("Give me something to go on.", "Type what you're shopping for above.", false); qEl.focus(); return; }
        var params = new URLSearchParams({ q: q, country: countryEl.value });
        if (maxEl.value) params.set("max_price", maxEl.value);

        btn.disabled = true;
        btn.textContent = "Thinking…";
        showStatus("Weighing the options&hellip;", "", false);
        fetch("/v1/catalog/search?" + params.toString())
          .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, body: b }; }); })
          .then(function (r) {
            if (!r.ok) {
              var down = r.body && r.body.error === "catalog_unavailable";
              showStatus(
                down ? "The catalogue's not answering." : "That didn't go through.",
                down ? "Give it a moment and try again." : "Check your input and try again.",
                true
              );
              return;
            }
            render(r.body.products || []);
          })
          .catch(function () { showStatus("Network trouble.", "Couldn't reach the catalogue — try again.", true); })
          .finally(function () { btn.disabled = false; btn.textContent = "Advise me"; });
      }

      form.addEventListener("submit", function (e) { e.preventDefault(); search(); });
      countryEl.addEventListener("change", syncTagline);
      syncTagline();
      qEl.focus();
    })();
  </script>
</body>
</html>`;
