export default {
  id: "todo-add",
  title: "Adding a task and ticking it off",
  scenario: "Today list → type 'Book the studio' into Add a task → press Enter → the row slides in → hold → tick it → the label strikes through → hold.",
  alt: "A to-do list titled Today. A new task, Book the studio, is typed and added; the row slides in, then is ticked and struck through.",
  start: "/",
  length: "natural",
  loop: "none",
  poster: "added",
  steps: async ({ page, h }) => {
    await h.hold(600);
    await h.type(page.getByLabel("Add a task"), "Book the studio");
    await h.press("Enter", { expect: () => h.visible(page.getByText("Book the studio")) });
    await h.waitForMotion();
    await h.mark("added");
    await h.hold(1400);
    await h.click(page.locator("li", { hasText: "Book the studio" }).getByLabel("Mark done"), {
      expect: () => h.visible(page.locator("li.done", { hasText: "Book the studio" })),
    });
    await h.waitForMotion();
    await h.parkCursor();
    await h.hold(1200);
  },
};
