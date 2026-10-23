// Page inspection for authoring: visible text with element paths, ARIA snapshot, ranked locator candidates.

const IMPLICIT_ROLES = {
  A: "link", BUTTON: "button", H1: "heading", H2: "heading", H3: "heading", H4: "heading", H5: "heading", H6: "heading",
  NAV: "navigation", MAIN: "main", HEADER: "banner", FOOTER: "contentinfo", INPUT: "textbox", TEXTAREA: "textbox",
  SELECT: "combobox", IMG: "img", UL: "list", OL: "list", LI: "listitem", TABLE: "table", TH: "columnheader", TD: "cell",
  SECTION: "region", ARTICLE: "article", DIALOG: "dialog", SUMMARY: "button", LABEL: null,
};

export async function inspectPage(page) {
  const aria = await page.locator("body").ariaSnapshot().catch(() => "");
  const items = await page.evaluate(() => {
    const out = [];
    const seen = new Map();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
    };
    const pathOf = (el) => {
      const parts = [];
      let n = el;
      while (n && n.nodeType === 1 && parts.length < 8 && n !== document.body) {
        let s = n.tagName.toLowerCase();
        if (n.id) { parts.unshift(`${s}#${n.id}`); break; }
        const sibs = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
        if (sibs.length > 1) s += `:nth-of-type(${sibs.indexOf(n) + 1})`;
        parts.unshift(s);
        n = n.parentElement;
      }
      return parts.join(" > ");
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let el;
    while ((el = walker.nextNode())) {
      if (el.id === "ui-clips-cursor" || el.closest("#ui-clips-cursor")) continue;
      if (["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "PATH"].includes(el.tagName)) continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").replace(/\s+/g, " ").trim();
      const isInput = ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
      const label = el.getAttribute("aria-label") || (isInput ? (el.placeholder || (el.labels && el.labels[0]?.innerText) || "") : "");
      // Links and buttons often wrap their text in spans; fall back to the element's own innerText.
      let text = own;
      let via = "text";
      if (!text && !label && (el.tagName === "A" || el.tagName === "BUTTON" || el.getAttribute("role") === "button")) {
        const inner = (el.innerText || "").replace(/\s+/g, " ").trim();
        if (inner && inner.length <= 80) { text = inner; via = "innerText"; }
      }
      if (!text && !label) continue;
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      const role = el.getAttribute("role");
      const rec = {
        text: text || null, label: label || null, tag: el.tagName.toLowerCase(), role, path: pathOf(el),
        box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        href: el.tagName === "A" ? el.getAttribute("href") : undefined,
        via,
        clickable: !!(el.closest("a,button,[role=button],[onclick],input,select,textarea,summary,label") || getComputedStyle(el).cursor === "pointer"),
        inputType: isInput ? (el.type || el.tagName.toLowerCase()) : undefined,
      };
      const key = (text || label).toLowerCase();
      seen.set(key, (seen.get(key) || 0) + 1);
      out.push(rec);
    }
    for (const rec of out) rec.count = seen.get((rec.text || rec.label).toLowerCase());
    return out;
  });

  for (const it of items) {
    const role = it.role || IMPLICIT_ROLES[it.tag.toUpperCase()] || null;
    const q = (s) => JSON.stringify(s);
    const locators = [];
    if (it.text) {
      if (it.via === "innerText") locators.push(`page.locator(${q(it.tag)}, { hasText: ${q(it.text)} })${it.count > 1 ? "  // " + it.count + " matches; add .first()/.nth(n) or scope it" : ""}`);
      else locators.push(`page.getByText(${q(it.text)}, { exact: true })${it.count > 1 ? "  // " + it.count + " matches; add .first()/.nth(n) or scope it" : ""}`);
      locators.push(`page.locator(${q(it.tag + ":has-text(" + q(it.text) + ")")})`);
    }
    if (it.label) locators.push(`page.getByLabel(${q(it.label)})`);
    if (it.inputType && !it.label) locators.push(`page.getByPlaceholder(...)  // no label; see path`);
    if (role && role !== "listitem" && role !== "cell" && (it.text || it.label)) {
      locators.push(`page.getByRole(${q(role)}, { name: ${q(it.text || it.label)} })`);
    }
    locators.push(`page.locator(${q(it.path)})  // structural, last resort`);
    it.implicitRole = role;
    it.locators = locators;
  }

  return {
    url: page.url(),
    title: await page.title(),
    viewport: page.viewportSize(),
    counts: { textItems: items.length, clickable: items.filter((i) => i.clickable).length },
    items,
    aria,
    guidance: "Prefer visible text (getByText / getByLabel), then structure relative to text (locator('li', { hasText }) or .locator('..')), then role/name when a role exists. Never guess a locator not listed here.",
  };
}
