export default {
  id: "todo-tick",
  title: "Ticking a task and undoing it",
  scenario: "Today list → hover the first task → tick it → the label strikes through → hold → untick → loop back to the start.",
  alt: "A to-do list titled Today. The first task, Review the onboarding flow, is ticked and its label is struck through, then unticked again.",
  start: "/",
  length: 7000,
  loop: "return",                 // ends in the start state; export checks first vs last frame
  poster: "ticked",
  zoom: "gentle",
  steps: async ({ page, h }) => {
    const row = page.locator("li", { hasText: "Review the onboarding flow" });
    await h.mark("list", { focus: page.locator("ul") });
    await h.hold(600);
    await h.hover(row.getByText("Review the onboarding flow"), { holdMs: 300 });
    await h.click(row.getByLabel("Mark done"), { expect: () => h.visible(page.locator("li.done", { hasText: "Review the onboarding flow" })) });
    await h.waitForMotion();
    await h.mark("ticked");
    await h.hold(1200);
    await h.click(row.getByLabel("Mark done"), { expect: () => h.hidden(page.locator("li.done", { hasText: "Review the onboarding flow" })) });
    await h.waitForMotion();
    await h.parkCursor();
    await h.hold(1400);                      // the camera releases 1 s after the last action and must rest before the end
  },
};
