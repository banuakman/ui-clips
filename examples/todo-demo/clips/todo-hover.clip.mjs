export default {
  id: "todo-hover",
  title: "Hovering the tasks",
  scenario: "Today list → hover each task in turn → crossfade loop.",
  alt: "A to-do list titled Today; the pointer moves down the three tasks and each row lifts slightly as it is hovered.",
  start: "/",
  length: "natural",
  loop: "crossfade",
  poster: "start",
  zoom: "off",
  steps: async ({ page, h }) => {
    await h.mark("list", { focus: page.locator("ul") });
    await h.hold(500);
    for (const text of ["Review the onboarding flow", "Send the invoice to Acme", "Prepare Friday's demo"]) {
      await h.hover(page.getByText(text), { holdMs: 700 });
    }
    await h.parkCursor();
    await h.hold(600);
  },
};
