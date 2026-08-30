"use strict";

const $ = (id) => document.getElementById(id);

const ui = {
  dot: $("dot"),
  statusText: $("statusText"),
  lastTested: $("lastTested"),
  speedVal: $("speedVal"),
  speedUnitLabel: $("speedUnitLabel"),
  phaseLabel: $("phaseLabel"),
  valPing: $("valPing"),
  valDl: $("valDl"),
  valUl: $("valUl"),
  cardPing: $("cardPing"),
  cardDl: $("cardDl"),
  cardUl: $("cardUl"),
  unitDl: $("unitDl"),
  unitUl: $("unitUl"),
  progressPhase: $("progressPhase"),
  progressPct: $("progressPct"),
  barFill: $("barFill"),
  ratingLabel: $("ratingLabel"),
  ratingBadge: $("ratingBadge"),
  startBtn: $("startBtn"),
  btnText: $("btnText"),
  themeBtn: $("themeBtn"),
  themeEmoji: $("themeEmoji"),
  unitBtn: $("unitBtn"),
  footerText: $("footerText"),
};

let lastRaw = { ping: 0, dl: 0, ul: 0 };

function footerLabel() {
  return Unit.current === "mbps"
    ? "Mbps = MEGABITS/SEC · NO DATA STORED · v1.4"
    : "MB/s = MEGABYTES/SEC · NO DATA STORED · v1.4";
}

function refreshUnitTexts() {
  const lbl = Unit.label();
  ui.unitBtn.textContent = lbl;
  ui.speedUnitLabel.textContent = lbl;
  ui.unitDl.textContent = lbl;
  ui.unitUl.textContent = lbl;
  ui.footerText.textContent = footerLabel();
  Dial.refreshLabels();
  if (ui.valDl.textContent !== "—") ui.valDl.textContent = Unit.fmt(lastRaw.dl);
  if (ui.valUl.textContent !== "—") ui.valUl.textContent = Unit.fmt(lastRaw.ul);
  if (ui.speedVal.textContent !== "—" && !Dial.running) {
    ui.speedVal.textContent = Unit.fmt(lastRaw.dl);
  }
  if (ui.phaseLabel.textContent.startsWith("↓")) {
    ui.phaseLabel.textContent = `↓ ${Unit.fmt(lastRaw.dl)} ${lbl}  ↑ ${Unit.fmt(lastRaw.ul)} ${lbl}  ⚡ ${lastRaw.ping}ms`;
  }
}

Dial.resetDial();

Theme.init((light) => {
  ui.themeEmoji.textContent = light ? "☀️" : "🌙";
});
ui.themeBtn.addEventListener("click", () => {
  Theme.toggle((light) => {
    ui.themeEmoji.textContent = light ? "☀️" : "🌙";
  });
});

Unit.init(() => refreshUnitTexts());
ui.unitBtn.addEventListener("click", () => {
  Unit.toggle(() => refreshUnitTexts());
});

function setStatus(state, text) {
  ui.dot.className = `dot ${state}`;
  ui.statusText.textContent = text;
}
function setProgress(phase, pct) {
  ui.progressPhase.textContent = phase;
  ui.progressPct.textContent = `${Math.round(pct)}%`;
  ui.barFill.style.width = `${pct}%`;
}
function setPhase(t) {
  ui.phaseLabel.textContent = t;
}
function highlightCard(id) {
  ["cardPing", "cardDl", "cardUl"].forEach((k) => ui[k].classList.remove("active"));
  if (id) ui[id].classList.add("active");
}

function restoreResult(r) {
  if (!r) return;
  const dl = Number(r.dl) || 0;
  const ul = Number(r.ul) || 0;
  lastRaw = { ping: r.ping, dl, ul };
  ui.valPing.textContent = r.ping;
  ui.valDl.textContent = Unit.fmt(dl);
  ui.valUl.textContent = Unit.fmt(ul);
  Dial.setCeiling(pickCeiling(dl));
  Dial.setDial(dl);
  setPhase(
    `↓ ${Unit.fmt(dl)} ${Unit.label()}  ↑ ${Unit.fmt(ul)} ${Unit.label()}  ⚡ ${r.ping}ms`,
  );
  setStatus("done", "DONE");
  setProgress("COMPLETE", 100);
  ui.ratingBadge.textContent = r.rating.label;
  ui.ratingBadge.className = `rating-badge show ${r.rating.cls}`;
  ui.ratingLabel.style.opacity = "1";
  ui.btnText.textContent = "↺ Test Again";
  ui.lastTested.textContent = `Last tested ${fmtAge(r.ts)}`;
}

let running = false;

async function runTest() {
  if (running) return;
  running = true;

  ui.startBtn.disabled = true;
  ui.btnText.textContent = "⏳ Testing…";
  ui.ratingBadge.className = "rating-badge";
  ui.ratingLabel.style.opacity = "0";
  ui.valPing.textContent = "—";
  ui.valDl.textContent = "—";
  ui.valUl.textContent = "—";
  ui.lastTested.textContent = "";
  highlightCard(null);
  Dial.resetDial();
  setProgress("STARTING", 0);
  setStatus("running", "TESTING");

  let ping = 0,
    dl = 0,
    ul = 0;

  try {
    setPhase("MEASURING LATENCY");
    highlightCard("cardPing");
    setProgress("PING", 5);
    ping = await measurePing();
    lastRaw.ping = ping;
    ui.valPing.textContent = ping;
    setProgress("PING DONE", 15);
    await delay(150);

    highlightCard("cardDl");
    dl = await measureDownload(
      (phase) => setPhase(phase),
      ({ live, pct, ceiling }) => {
        if (ceiling) Dial.setCeiling(ceiling);
        if (live > 0) {
          if (!Dial.running) Dial.startJitter();
          Dial.setLive(live);
          lastRaw.dl = live;
          ui.valDl.textContent = Unit.fmt(live);
        }
        setProgress("DOWNLOAD", 15 + pct * 0.53);
      },
    );
    Dial.stopJitter(dl);
    lastRaw.dl = dl;
    ui.valDl.textContent = Unit.fmt(dl);
    setProgress("DOWNLOAD DONE", 68);
    await delay(400);

    Dial.setLive(0);
    Dial.startJitter();
    setPhase("UPLOAD TEST");
    highlightCard("cardUl");
    ul = await measureUpload(({ live, label, frac }) => {
      Dial.setLive(live);
      lastRaw.ul = live;
      ui.valUl.textContent = Unit.fmt(live);
      setProgress(`↑ ${label}`, 68 + frac * 28);
      setPhase(`UPLOADING · ${label}`);
    });
    Dial.stopJitter(ul);
    lastRaw.ul = ul;
    ui.valUl.textContent = Unit.fmt(ul);
    await delay(400);
    Dial.setDial(dl);
    setProgress("COMPLETE", 100);

    await delay(150);
    const rating = rateConnection(ping, dl, ul);
    ui.ratingBadge.textContent = rating.label;
    ui.ratingBadge.className = `rating-badge show ${rating.cls}`;
    ui.ratingLabel.style.opacity = "1";
    highlightCard(null);
    lastRaw = { ping, dl, ul };
    setPhase(
      `↓ ${Unit.fmt(dl)} ${Unit.label()}  ↑ ${Unit.fmt(ul)} ${Unit.label()}  ⚡ ${ping}ms`,
    );
    setStatus("done", "DONE");

    saveResult({ ping, dl, ul, rating, ts: Date.now() });
    ui.lastTested.textContent = "Just now";
  } catch (err) {
    setPhase("ERROR — CHECK CONNECTION");
    setStatus("error", "ERROR");
    console.error(err);
  }

  ui.startBtn.disabled = false;
  ui.btnText.textContent = "↺ Test Again";
  running = false;
}

loadResult().then((r) => {
  if (r) restoreResult(r);
});
ui.startBtn.addEventListener("click", runTest);
