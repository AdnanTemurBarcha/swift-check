"use strict";

// ─── Formatting ─────────────────────────────────────────────────────────────
function fmtMbs(mbs) {
  if (mbs >= 100) return mbs.toFixed(0);
  if (mbs >= 10) return mbs.toFixed(1);
  return mbs.toFixed(2);
}

function fmtCeil(v) {
  return v >= 10 ? v.toFixed(0) : v.toFixed(1);
}

function pickCeiling(probedMbs) {
  const raw = probedMbs * 2;
  for (const s of [1, 2, 3, 5, 8, 10, 15, 20, 30, 50, 75, 100, 125, 200]) {
    if (s >= raw) return s;
  }
  return 200;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function rateConnection(ping, dl, ul) {
  // Thresholds in MB/s. 1.25 MB/s = 10 Mbps.
  let s = 0;
  if (dl > 12.5) s += 3;
  else if (dl > 3.1) s += 2;
  else if (dl > 0.6) s += 1;
  if (ul > 6.25) s += 3;
  else if (ul > 1.25) s += 2;
  else if (ul > 0.25) s += 1;
  if (ping < 20) s += 3;
  else if (ping < 60) s += 2;
  else if (ping < 120) s += 1;
  if (s >= 8) return { label: "EXCELLENT", cls: "excellent" };
  if (s >= 5) return { label: "GOOD", cls: "good" };
  if (s >= 3) return { label: "FAIR", cls: "fair" };
  return { label: "POOR", cls: "poor" };
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Core measurement using PerformanceResourceTiming ───────────────────────
//
// The browser's networking stack records precise transfer timing for every
// fetch at the OS/hardware level — not in JS. We read:
//   responseStart/responseEnd = wire transfer window, transferSize = bytes
// on the wire. This gives pure throughput, unaffected by JS/GC overhead.

const BASE = "https://speed.cloudflare.com/__down";

function getTimingMbs(url) {
  const entries = performance.getEntriesByName(url, "resource");
  if (!entries.length) return null;
  const e = entries[entries.length - 1];
  const bytes = e.transferSize > 0 ? e.transferSize : e.encodedBodySize;
  if (!bytes || bytes < 100) return null;
  const transferMs = e.responseEnd - e.responseStart;
  if (transferMs < 10) return null;
  return bytes / (transferMs / 1000) / 1_000_000; // MB/s
}

async function fetchSized(bytes) {
  const url = `${BASE}?bytes=${bytes}&_r=${Date.now()}`;
  performance.clearResourceTimings();
  const t0 = performance.now();
  const resp = await fetch(url, { cache: "no-store" });
  await resp.arrayBuffer(); // fully consume body so responseEnd is recorded
  const wallMs = performance.now() - t0;
  const hwMbs = getTimingMbs(url);
  const wallMbs = bytes / (wallMs / 1000) / 1_000_000;
  return { mbs: hwMbs ?? wallMbs, wallMs, bytes };
}

async function measurePing() {
  const url = `${BASE}?bytes=1`;
  const times = [];
  for (let i = 0; i < 8; i++) {
    const t0 = performance.now();
    try {
      await fetch(`${url}&_r=${Date.now()}${i}`, { cache: "no-store" });
    } catch (_) {}
    times.push(performance.now() - t0);
    await delay(40);
  }
  times.sort((a, b) => a - b);
  return Math.round(times.slice(2, 6).reduce((s, v) => s + v, 0) / 4);
}

// onPhase(text) — fires for each named stage of the download test
// onProgress({live, pct, ceiling?}) — fires with live readings as they arrive;
// ceiling is set once, right after the probe, so the caller can rescale a dial
async function measureDownload(onPhase, onProgress) {
  onPhase("OPENING CONNECTION…");
  await fetchSized(1_000);
  onProgress({ live: 0, pct: 10 });

  onPhase("PROBING SPEED…");
  const probe = await fetchSized(256_000);
  onProgress({ live: probe.mbs, pct: 35, ceiling: pickCeiling(probe.mbs) });

  const targetBytes = Math.min(
    Math.max(Math.round(probe.mbs * 3 * 1_000_000), 512_000),
    8_000_000,
  );
  const sizeMb = (targetBytes / 1_000_000).toFixed(1);
  onPhase(`DOWNLOADING ${sizeMb} MB…`);
  const main = await fetchSized(targetBytes);
  onProgress({ live: main.mbs, pct: 68 });

  onPhase("CONFIRMING…");
  const confirm = await fetchSized(targetBytes);
  onProgress({ live: confirm.mbs, pct: 100 });

  return median([probe.mbs, main.mbs, confirm.mbs]);
}

function makePayload(bytes) {
  const buf = new Uint8Array(bytes);
  const rand = new Uint8Array(Math.min(bytes, 65536));
  crypto.getRandomValues(rand);
  for (let i = 0; i < bytes; i++) buf[i] = rand[i % rand.length];
  return buf;
}

// onProgress({live, label, frac})
async function measureUpload(onProgress) {
  const chunks = [
    { bytes: 200_000, label: "200 KB" },
    { bytes: 500_000, label: "500 KB" },
    { bytes: 1_000_000, label: "1 MB" },
  ];
  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    const { bytes, label } = chunks[i];
    try {
      const payload = makePayload(bytes);
      const t0 = performance.now();
      await fetch("https://speed.cloudflare.com/__up", {
        method: "POST",
        body: payload,
        headers: { "Content-Type": "application/octet-stream" },
        cache: "no-store",
      });
      const secs = (performance.now() - t0) / 1000;
      results.push(bytes / secs / 1_000_000);
      onProgress({ live: median(results), label, frac: (i + 1) / chunks.length });
    } catch (e) {
      console.warn("UL", e);
    }
  }
  return results.length ? median(results) : 0;
}

// ─── Unit — MB/s vs Mbps, persisted, shared across pages ────────────────────
const Unit = {
  current: "mbs", // "mbs" | "mbps"
  label() {
    return this.current === "mbps" ? "Mbps" : "MB/s";
  },
  toDisplay(mbs) {
    return this.current === "mbps" ? mbs * 8 : mbs;
  },
  fmt(mbs) {
    return fmtMbs(this.toDisplay(mbs));
  },
  init(onReady) {
    chrome.storage.local.get(["unit"], (res) => {
      this.current = res.unit === "mbps" ? "mbps" : "mbs";
      onReady(this.current);
    });
  },
  toggle(onChange) {
    this.current = this.current === "mbps" ? "mbs" : "mbps";
    chrome.storage.local.set({ unit: this.current });
    onChange(this.current);
  },
};

// ─── Theme — light default, dark optional, persisted, shared across pages ───
const Theme = {
  init(onReady) {
    chrome.storage.local.get(["theme"], (res) => {
      const light = res.theme ? res.theme === "light" : true;
      this.apply(light);
      onReady(light);
    });
  },
  apply(light) {
    document.documentElement.classList.toggle("light", light);
  },
  toggle(onChange) {
    const light = !document.documentElement.classList.contains("light");
    this.apply(light);
    chrome.storage.local.set({ theme: light ? "light" : "dark" });
    onChange(light);
  },
};

// ─── Persist last result ─────────────────────────────────────────────────────
function saveResult(d) {
  chrome.storage.local.set({ lastResult: d });
}
function loadResult() {
  return new Promise((r) =>
    chrome.storage.local.get(["lastResult"], (d) => r(d.lastResult || null)),
  );
}
function fmtAge(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
