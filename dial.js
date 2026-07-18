"use strict";

// Shared analog-meter widget. Any page that includes engine.js + dial.js and
// has a dial SVG with matching ids (dialArc, needle, ticks, scaleLabels,
// dialMaxLabel, speedVal) gets the same behavior — used by both the compact
// popup and the full details page.
const Dial = (() => {
  const $ = (id) => document.getElementById(id);
  const ARC_LEN = 314;
  let dialCeiling = 10;
  let jitter = {
    running: false,
    target: 0,
    displayed: 0,
    rafId: null,
    lastNumUpdate: 0,
  };

  function mbsToRatio(mbs) {
    if (mbs <= 0) return 0;
    return Math.min(mbs / dialCeiling, 1);
  }

  function drawTicks() {
    const tg = $("ticks"),
      lg = $("scaleLabels");
    while (tg.firstChild) tg.removeChild(tg.firstChild);
    while (lg.firstChild) lg.removeChild(lg.firstChild);
    const cx = 114,
      cy = 114,
      r = 100;
    for (let i = 0; i <= 5; i++) {
      const v = (dialCeiling / 5) * i;
      const ratio = mbsToRatio(v);
      const rad = ((-180 + ratio * 180) * Math.PI) / 180;

      const ns = document.createElementNS("http://www.w3.org/2000/svg", "line");
      ns.setAttribute("x1", cx + (r - 13) * Math.cos(rad));
      ns.setAttribute("y1", cy + (r - 13) * Math.sin(rad));
      ns.setAttribute("x2", cx + (r - 3) * Math.cos(rad));
      ns.setAttribute("y2", cy + (r - 3) * Math.sin(rad));
      ns.setAttribute("stroke-width", "1.5");
      ns.setAttribute("stroke-linecap", "round");
      ns.setAttribute("class", "tick-mark");
      tg.appendChild(ns);

      const tx = document.createElementNS("http://www.w3.org/2000/svg", "text");
      tx.setAttribute("x", cx + (r - 26) * Math.cos(rad));
      tx.setAttribute("y", cy + (r - 26) * Math.sin(rad) + 3);
      tx.setAttribute("text-anchor", "middle");
      tx.setAttribute("font-size", "9");
      tx.setAttribute("font-family", "JetBrains Mono,monospace");
      tx.setAttribute("class", "tick-label");
      tx.textContent = fmtCeil(Unit.toDisplay(v));
      lg.appendChild(tx);
    }
  }

  function setCeiling(mbs) {
    dialCeiling = mbs;
    drawTicks();
    const el = $("dialMaxLabel");
    if (el)
      el.textContent = "MAX " + fmtCeil(Unit.toDisplay(mbs)) + " " + Unit.label();
  }

  function setDialDirect(mbs) {
    const ratio = Math.min(Math.max(mbs / dialCeiling, 0), 1);
    $("dialArc").style.strokeDashoffset = ARC_LEN - ratio * ARC_LEN;
    $("needle").setAttribute("transform", `rotate(${-90 + ratio * 180} 114 114)`);
  }

  function setDial(mbs) {
    setDialDirect(mbs);
    $("speedVal").textContent = mbs <= 0 ? "—" : Unit.fmt(mbs);
  }

  function resetDial() {
    if (jitter.running) {
      jitter.running = false;
      if (jitter.rafId) cancelAnimationFrame(jitter.rafId);
    }
    jitter.target = 0;
    jitter.displayed = 0;
    const needle = $("needle"),
      arc = $("dialArc");
    needle.style.transition = "transform 0.5s cubic-bezier(0.34,1.25,0.64,1)";
    arc.style.transition = "stroke-dashoffset 0.45s cubic-bezier(0.4,0,0.2,1)";
    dialCeiling = 10;
    arc.style.strokeDashoffset = ARC_LEN;
    needle.setAttribute("transform", "rotate(-90 114 114)");
    $("speedVal").textContent = "—";
    const el = $("dialMaxLabel");
    if (el) el.textContent = "";
    drawTicks();
  }

  function noiseAt(t) {
    return (
      Math.sin(t * 1.7) * 0.5 + Math.sin(t * 2.9) * 0.3 + Math.sin(t * 5.1) * 0.2
    );
  }

  function startJitter() {
    if (jitter.running) return;
    jitter.running = true;
    jitter.displayed = jitter.target;
    const needle = $("needle"),
      arc = $("dialArc");
    needle.style.transition = "none";
    arc.style.transition = "none";
    const startTime = performance.now();

    function frame(now) {
      if (!jitter.running) return;
      const t = (now - startTime) / 1000;
      const amplitude = Math.max(dialCeiling * 0.06, 0.05);
      const wobble = noiseAt(t * 2.2) * amplitude;
      const lerpSpeed = 0.08;
      jitter.displayed += (jitter.target + wobble - jitter.displayed) * lerpSpeed;
      const clamped = Math.max(0, Math.min(jitter.displayed, dialCeiling * 1.02));
      const ratio = Math.min(clamped / dialCeiling, 1);
      arc.style.strokeDashoffset = ARC_LEN - ratio * ARC_LEN;
      needle.setAttribute("transform", `rotate(${-90 + ratio * 180} 114 114)`);

      if (now - jitter.lastNumUpdate > 300) {
        jitter.lastNumUpdate = now;
        $("speedVal").textContent = jitter.target <= 0 ? "—" : Unit.fmt(jitter.target);
      }
      jitter.rafId = requestAnimationFrame(frame);
    }
    jitter.rafId = requestAnimationFrame(frame);
  }

  function stopJitter(finalMbs) {
    jitter.running = false;
    if (jitter.rafId) {
      cancelAnimationFrame(jitter.rafId);
      jitter.rafId = null;
    }
    const needle = $("needle"),
      arc = $("dialArc");
    needle.style.transition = "transform 0.6s cubic-bezier(0.34,1.1,0.64,1)";
    arc.style.transition = "stroke-dashoffset 0.6s cubic-bezier(0.4,0,0.2,1)";
    setDialDirect(finalMbs);
    $("speedVal").textContent = finalMbs <= 0 ? "—" : Unit.fmt(finalMbs);
  }

  function setLive(mbs) {
    jitter.target = mbs;
  }

  // Called after a unit toggle to redraw ticks/max-label in the new unit
  function refreshLabels() {
    drawTicks();
    const el = $("dialMaxLabel");
    if (el)
      el.textContent =
        "MAX " + fmtCeil(Unit.toDisplay(dialCeiling)) + " " + Unit.label();
  }

  return {
    setCeiling,
    setDial,
    resetDial,
    startJitter,
    stopJitter,
    setLive,
    refreshLabels,
    get running() {
      return jitter.running;
    },
  };
})();
