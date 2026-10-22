// Injected cursor (appendix D): an SVG arrow (default) or dot that follows the page's mousemove
// events, dips and blooms a ring on mousedown, and can be hidden/shown by the engine.

export const ARROW_VIEWBOX = { width: 14, height: 20 };
export const ARROW_PATH = "M1 1 L1 15.5 L4.6 12.4 L7.2 18.4 L9.8 17.3 L7.2 11.4 L12.4 11.4 Z";
const ARROW_TIP = { x: 1, y: 1 };   // the path's tip in viewBox units; the hotspot sits exactly on it

/** Rendered arrow box and hotspot for a given height in CSS px (viewBox 0 0 14 20 scaled uniformly). */
export function arrowGeometry(size = 22) {
  const scale = size / ARROW_VIEWBOX.height;
  return {
    width: ARROW_VIEWBOX.width * scale,
    height: size,
    scale,
    hotspot: { x: ARROW_TIP.x * scale, y: ARROW_TIP.y * scale },
  };
}

export const CLICK = Object.freeze({
  dipScale: 0.92, dipMs: 80,
  ringFrom: 28, ringTo: 48, ringMs: 350, ringStrokeAlpha: 0.28, ringFillAlpha: 0.08,
});

export function cursorInitScript(cursor) {
  const style = cursor?.style || "arrow";
  if (style === "none") return "";
  const color = cursor?.color || "#1f2937";
  const ripple = cursor?.ripple !== false;
  let svg, hot;
  if (style === "arrow") {
    const g = arrowGeometry(cursor?.size || 22);
    hot = g.hotspot;
    svg = `<svg width="${g.width}" height="${g.height}" viewBox="0 0 ${ARROW_VIEWBOX.width} ${ARROW_VIEWBOX.height}" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;display:block;filter:drop-shadow(0 1px 1px rgba(0,0,0,.35)) drop-shadow(0 2px 4px rgba(0,0,0,.18))"><path d="${ARROW_PATH}" fill="${color}" stroke="#fff" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
  } else {
    const size = cursor?.size || 16;
    hot = { x: size / 2 + 4, y: size / 2 + 4 };
    svg = `<svg width="${size + 8}" height="${size + 8}" viewBox="0 0 ${size + 8} ${size + 8}" xmlns="http://www.w3.org/2000/svg" style="display:block;filter:drop-shadow(0 1px 3px rgba(0,0,0,.35))"><circle cx="${hot.x}" cy="${hot.y}" r="${size / 2}" fill="${color}" fill-opacity="0.85" stroke="#fff" stroke-width="1.5"/></svg>`;
  }
  const C = CLICK;

  return `(() => {
    if (window.top !== window) return;
    const ID = "__uiclips_cursor";
    const COLOR = ${JSON.stringify(color)};
    const state = { x: -100, y: -100, visible: false, el: null, inner: null };
    function ensure() {
      if (state.el && state.el.isConnected) return state.el;
      if (!document.documentElement) return null;
      const el = document.createElement("div");
      el.id = ID;
      el.setAttribute("aria-hidden", "true");
      el.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483647;opacity:0;transition:opacity 180ms ease;contain:layout style;";
      const inner = document.createElement("div");
      inner.style.cssText = "position:absolute;left:${-hot.x}px;top:${-hot.y}px;line-height:0;transform-origin:${hot.x}px ${hot.y}px;will-change:transform;";
      inner.innerHTML = ${JSON.stringify(svg)};
      el.appendChild(inner);
      document.documentElement.appendChild(el);
      state.el = el; state.inner = inner;
      el.style.transform = "translate(" + state.x + "px," + state.y + "px)";
      return el;
    }
    function place(x, y) {
      state.x = x; state.y = y;
      const el = ensure();
      if (!el) return;
      el.style.transform = "translate(" + x + "px," + y + "px)";
      if (!state.visible) { state.visible = true; el.style.opacity = "1"; }
    }
    function click() {
      const el = ensure(); if (!el) return;
      // Dip: scale to ${C.dipScale} around the tip, hold ${C.dipMs} ms, ease back.
      state.inner.animate([
        { transform: "scale(1)", offset: 0 },
        { transform: "scale(${C.dipScale})", offset: 0.25 },
        { transform: "scale(${C.dipScale})", offset: 0.6 },
        { transform: "scale(1)", offset: 1 }
      ], { duration: ${Math.round(C.dipMs / 0.35)}, easing: "ease-out" });
      if (!${ripple}) return;
      // Ring: blooms from the tip, ${C.ringFrom} → ${C.ringTo} px over ${C.ringMs} ms, fading out.
      const ring = document.createElement("div");
      ring.style.cssText = "position:absolute;left:${-C.ringFrom / 2}px;top:${-C.ringFrom / 2}px;width:${C.ringFrom}px;height:${C.ringFrom}px;border-radius:50%;box-sizing:border-box;" +
        "border:1.5px solid color-mix(in srgb, " + COLOR + " ${Math.round(C.ringStrokeAlpha * 100)}%, transparent);" +
        "background:color-mix(in srgb, " + COLOR + " ${Math.round(C.ringFillAlpha * 100)}%, transparent);";
      el.insertBefore(ring, state.inner);
      const a = ring.animate([
        { transform: "scale(1)", opacity: 1 },
        { transform: "scale(${(C.ringTo / C.ringFrom).toFixed(4)})", opacity: 0 }
      ], { duration: ${C.ringMs}, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" });
      a.onfinish = () => ring.remove();
    }
    window.addEventListener("mousemove", (e) => place(e.clientX, e.clientY), true);
    window.addEventListener("mousedown", (e) => { place(e.clientX, e.clientY); click(); }, true);
    window.__uiclips = {
      hide() { const el = ensure(); if (el) { el.style.opacity = "0"; } state.visible = false; },
      show() { const el = ensure(); if (el) { el.style.opacity = "1"; } state.visible = true; },
      place, click,
      position() { return { x: state.x, y: state.y }; },
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ensure, { once: true }); else ensure();
  })();`;
}
