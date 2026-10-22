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
    const input = page.getByLabel("Add a task");
    const newRow = page.locator("li", { hasText: "Book the studio" });
    h.track("list", page.locator("ul"));
    h.track("newRow", newRow);                                    // sampled once it exists
    await h.mark("list", { focus: page.locator("ul") });          // crop focus for the landscape size
    await h.mark("b1-start");
    await h.shot("wide");
    await h.hold(800);
    // Explicit track: wide → focus on the input (the first push scales from the top-left) → the new row → wide.
    await h.click(input);
    await h.shot({ focus: [input], padding: 24 }, { ms: 600 });
    await h.mark("b2-typing");
    await h.speed(2, async () => {                                 // the typing plays 2× faster at export
      await h.type(input, "Book the studio", { click: false });   // the field was clicked before the shot
    });
    await h.click(page.getByRole("button", { name: "Add" }), { expect: () => h.visible(page.getByText("Book the studio")) });
    await h.waitForMotion();
    await h.mark("added");
    await h.shot({ focus: ["newRow"], padding: 24 }, { ms: 700 });  // follows the tracked row
    await h.hold(1400);
    await h.mark("b4-tick");
    await h.hover(newRow.getByText("Book the studio"), { holdMs: 500 });
    await h.click(newRow.getByLabel("Mark done"), { expect: () => h.visible(page.locator("li.done", { hasText: "Book the studio" })) });
    await h.waitForMotion();
    await h.mark("ticked");
    await h.hold(900);
    await h.shot("opening", { ms: 700 });                      // back to the opening framing (§13: at rest at both ends)
    await h.parkCursor();
    await h.mark("b5-end");
    await h.hold(1600);
  },
};
