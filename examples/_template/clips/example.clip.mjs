export default {
  id: "example",
  title: "A detail panel opens beside the list",
  scenario: "List → click the first row's View → the drawer slides in → hold → close → loop.",
  alt: "A list; clicking a row slides open a detail panel on the right.",
  start: "/",
  length: 7000,                   // target ms, or "natural"
  loop: "return",                 // "return" | "crossfade" | "none"
  poster: "open",                 // "start" | "end" | ms | a mark name
  steps: async ({ page, h }) => {
    await h.hold(600);
    await h.click(page.getByText("View").first(), {
      expect: () => h.visible(page.getByText("Details")),
    });
    await h.waitForMotion();
    await h.mark("open");
    await h.hold(2500);
    await h.click(page.getByText("Close"), { expect: () => h.hidden(page.getByText("Details")) });
    await h.parkCursor();
    await h.hold(500);
  },
};
