export default {
  id: "todo-add",
  title: "Adding a task and ticking it off",
  scenario: "Today list → type 'Book the studio' into Add a task → click Add → the row slides in → hover the row → tick it → the label strikes through → hold.",
  alt: "A to-do list titled Today. A new task, Book the studio, is typed and added; the row slides in, then is ticked and struck through.",
  start: "/",
  length: "natural",
  loop: "none",
  poster: "added",
  steps: async ({ page, h }) => {
    await h.mark("list", { focus: page.locator("ul") });   // crop focus for the project's landscape crop
    await h.hold(600);
    await h.type(page.getByLabel("Add a task"), "Book the studio");
    await h.click(page.getByRole("button", { name: "Add" }), { expect: () => h.visible(page.getByText("Book the studio")) });
    await h.waitForMotion();
    await h.mark("added");
    await h.hold(1200);
    const row = page.locator("li", { hasText: "Book the studio" });
    await h.hover(row.getByText("Book the studio"), { holdMs: 700 });
    await h.click(row.getByLabel("Mark done"), {
      expect: () => h.visible(page.locator("li.done", { hasText: "Book the studio" })),
    });
    await h.waitForMotion();
    await h.parkCursor();
    await h.hold(1800);
  },
};
