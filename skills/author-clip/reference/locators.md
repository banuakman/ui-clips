# Locators: read from the inspection, never guessed

`ui-clips inspect <route> --project <dir>` prints JSON:

```json
{
  "url": "…", "title": "…", "viewport": { "width": 1680, "height": 1920 },
  "counts": { "textItems": 212, "clickable": 41 },
  "items": [
    { "text": "View", "tag": "a", "path": "main > div > table > tbody > tr:nth-of-type(1) > td:nth-of-type(6) > a",
      "box": { "x": 1573, "y": 460, "w": 30, "h": 20 }, "clickable": true, "count": 6, "implicitRole": "link",
      "locators": [
        "page.getByText(\"View\", { exact: true })  // 6 matches; add .first()/.nth(n) or scope it",
        "page.locator(\"a:has-text(\\\"View\\\")\")",
        "page.getByRole(\"link\", { name: \"View\" })",
        "page.locator(\"main > div > … > a\")  // structural, last resort"
      ] }
  ],
  "aria": "- main: …",
  "guidance": "Prefer visible text, then structure relative to text, then role/name. Never guess a locator not listed here."
}
```

The file is long. Grep it for each text the scenario names (`"text": "Run agent fix"`), then Read the lines around the hit for its `count`, `path`, `box` and `locators`.

## Ranking

1. **Visible text**: `page.getByText("Run agent fix", { exact: true })`, `page.getByLabel("Add a task")`. Exact text, as the inspection prints it (including `·` and arrows).
2. **Structure relative to text**, when the text is not unique or the target is a container:
   - the row that holds a text: `page.locator("tr", { hasText: "Missing buyer VAT ID" }).first()`, then `.getByText("View", { exact: true })` inside it;
   - the parent: `page.getByText("Status:").locator("..")`;
   - the nearest ancestor with a class: `heading.locator("xpath=ancestor::div[contains(@class, 'border-l')][1]")` (a drawer, from its title);
   - `page.locator("li", { hasText: "Book the studio" })` for a list item.
3. **Role and name** when the inspection shows a role: `page.getByRole("button", { name: "Apply Resolution", exact: true })`.
4. **Structural paths** (`main > div > …`) only as a last resort, and never across a layout that reflows.

## Scoping

`count` above one means the text appears more than once on the page. Scope it to the row, card or region it belongs to (rule 2), or take `.first()` only when "the first one" is what the scenario means (say so in a comment). `h.click` on a locator with several matches fails the dry run.

## States reached only after an action

The inspection shows one state. For the contents of a drawer, a dialog or the next step of a flow, write the steps up to that point with a mark, then:

```bash
ui-clips inspect <clip-id> --at <mark> --project <dir> > <dir>/.cache/inspect/<clip-id>@<mark>.json
```

This runs the clip's steps in a dry run, stops at the mark and inspects the page there.

## Figma-published prototypes

- The ARIA snapshot is thin; almost everything is text and divs, so rules 1 and 2 do the work. Tables are real `<table>` elements; rows are `tr`.
- Buttons are often `div`s with a pointer cursor (`clickable: true` in the inspection without a role). `getByText` finds them.
- Selected or active states are usually a class (`bg-gray-100`, `border-blue-500`), not an attribute; write the `expect` against the class with the comment from clip-file.md.
- A password gate is handled by the engine (`UI_CLIPS_PASSWORD`); the clip starts past it.
- Hover states exist; a transition that re-wraps text when a drawer opens is a published-file issue to report, not to script around.
