// Injected cursor: an SVG dot (or arrow) that follows the page's mousemove events,
// ripples on mousedown, and can be hidden/shown by the engine. Parameters: appendix D.

export function cursorInitScript(cursor) {
  const style = cursor?.style || "dot";
  if (style === "none") return "";
  const size = cursor.size || 16;
  const color = cursor.color || "#1f2937";
  const ripple = cursor.ripple !== false;
  const svg = style === "arrow"
    ? `<svg width="20" height="24" viewBox="0 0 20 24" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))"><path d="M2 1.5 L2 19 L6.6 14.6 L9.6 21.6 L12.8 20.2 L9.8 13.4 L16 13.4 Z" fill="${color}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`
    : `<svg width="${size + 8}" height="${size + 8}" viewBox="0 0 ${size + 8} ${size + 8}" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 1px 3px rgba(0,0,0,.35))"><circle cx="${size / 2 + 4}" cy="${size / 2 + 4}" r="${size / 2}" fill="${color}" fill-opacity="0.85" stroke="#fff" stroke-width="1.5"/></svg>`;
  const hot = style === "arrow" ? { x: 2, y: 1 } : { x: size / 2 + 4, y: size / 2 + 4 };

  return `(() => {
    if (window.top !== window) return;
    const ID = "__uiclips_cursor";
    const state = { x: -100, y: -100, visible: false, el: null };
    function ensure() {
      if (state.el && state.el.isConnected) return state.el;
      if (!document.documentElement) return null;
      const el = document.createElement("div");
      el.id = ID;
      el.setAttribute("aria-hidden", "true");
      el.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483647;opacity:0;transition:opacity 180ms ease;contain:layout style;";
      el.innerHTML = '<div style="position:absolute;left:${-hot.x}px;top:${-hot.y}px;line-height:0">${svg.replace(/'/g, "\\'")}</div>';
      document.documentElement.appendChild(el);
      state.el = el;
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
    window.addEventListener("mousemove", (e) => place(e.clientX, e.clientY), true);
    window.addEventListener("mousedown", (e) => {
      place(e.clientX, e.clientY);
      if (!${ripple}) return;
      const el = ensure(); if (!el) return;
      const ring = document.createElement("div");
      ring.style.cssText = "position:absolute;left:0;top:0;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:2px solid ${color};opacity:.6;";
      el.appendChild(ring);
      const a = ring.animate([
        { transform: "scale(1)", opacity: 0.6 },
        { transform: "scale(3.5)", opacity: 0 }
      ], { duration: 450, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" });
      a.onfinish = () => ring.remove();
    }, true);
    window.__uiclips = {
      hide() { const el = ensure(); if (el) { el.style.opacity = "0"; } state.visible = false; },
      show() { const el = ensure(); if (el) { el.style.opacity = "1"; } state.visible = true; },
      place,
      position() { return { x: state.x, y: state.y }; },
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ensure, { once: true }); else ensure();
  })();`;
}
