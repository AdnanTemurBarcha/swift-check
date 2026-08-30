"use strict";

const $ = (id) => document.getElementById(id);

const ui = {
  dot: $("dot"),
  statusText: $("statusText"),
  lastTested: $("lastTested"),
  speedVal: $("speedVal"),
  speedUnitLabel: $("speedUnitLabel"),
  phaseLabel: $("phaseLabel"),
  miniPing: $("miniPing"),
  miniDl: $("miniDl"),
  miniUl: $("miniUl"),
  miniUnitDl: $("miniUnitDl"),
  miniUnitUl: $("miniUnitUl"),
  startBtn: $("startBtn"),
  btnText: $("btnText"),
  themeBtn: $("themeBtn"),
  themeEmoji: $("themeEmoji"),
  unitBtn: $("unitBtn"),
  detailsBtn: $("detailsBtn"),
};

let lastRaw = { ping: 0, dl: 0, ul: 0 };

function refreshUnitTexts() {
  const lbl = Unit.label();
  ui.unitBtn.textContent = lbl;
  ui.speedUnitLabel.textContent = lbl;
  ui.miniUnitDl.textContent = lbl;
  ui.miniUnitUl.textContent = lbl;
  Dial.refreshLabels();
  if (ui.miniDl.textContent !== "—") ui.miniDl.textContent = Unit.fmt(lastRaw.dl);
  if (ui.miniUl.textContent !== "—") ui.miniUl.textContent = Unit.fmt(lastRaw.ul);
  if (ui.speedVal.textContent !== "—" && !Dial.running) {
    ui.speedVal.textContent = Unit.fmt(lastRaw.dl);
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

ui.detailsBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("details.html") });
});

function setStatus(state, text) {
  ui.dot.className = `dot ${state}`;
  ui.statusText.textContent = text;
}
function setPhase(t) {
  ui.phaseLabel.textContent = t;
}

function restoreResult(r) {
  if (!r) return;
  const dl = Number(r.dl) || 0;
  const ul = Number(r.ul) || 0;
  lastRaw = { ping: r.ping, dl, ul };
  ui.miniPing.textContent = r.ping;
  ui.miniDl.textContent = Unit.fmt(dl);
  ui.miniUl.textContent = Unit.fmt(ul);
  Dial.setCeiling(pickCeiling(dl));
  Dial.setDial(dl);
  setPhase(`${r.rating.label} · ${fmtAge(r.ts)}`);
  setStatus("done", "DONE");
  ui.btnText.textContent = "↺ Test Again";
  ui.lastTested.textContent = `Last tested ${fmtAge(r.ts)}`;
}

let running = false;

async function runTest() {
  if (running) return;
  running = true;

  ui.startBtn.disabled = true;
  ui.btnText.textContent = "⏳ Testing…";
  ui.miniPing.textContent = "—";
  ui.miniDl.textContent = "—";
  ui.miniUl.textContent = "—";
  ui.lastTested.textContent = "";
  Dial.resetDial();
  setStatus("running", "TESTING");
  setPhase("MEASURING LATENCY");

  let ping = 0,
    dl = 0,
    ul = 0;

  try {
    ping = await measurePing();
    lastRaw.ping = ping;
    ui.miniPing.textContent = ping;

    dl = await measureDownload(
      (phase) => setPhase(phase),
      ({ live, ceiling }) => {
        if (ceiling) Dial.setCeiling(ceiling);
        if (live > 0) {
          if (!Dial.running) Dial.startJitter();
          Dial.setLive(live);
          lastRaw.dl = live;
          ui.miniDl.textContent = Unit.fmt(live);
        }
      },
    );
    Dial.stopJitter(dl);
    lastRaw.dl = dl;
    ui.miniDl.textContent = Unit.fmt(dl);

    setPhase("UPLOAD TEST");
    Dial.setLive(0);
    Dial.startJitter();
    ul = await measureUpload(({ live, label }) => {
      Dial.setLive(live);
      lastRaw.ul = live;
      ui.miniUl.textContent = Unit.fmt(live);
      setPhase(`UPLOADING · ${label}`);
    });
    Dial.stopJitter(ul);
    lastRaw.ul = ul;
    ui.miniUl.textContent = Unit.fmt(ul);
    Dial.setDial(dl);

    const rating = rateConnection(ping, dl, ul);
    lastRaw = { ping, dl, ul };
    setPhase(`${rating.label} · ↓ ${Unit.fmt(dl)} ↑ ${Unit.fmt(ul)} ${Unit.label()}`);
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
