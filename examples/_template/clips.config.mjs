export default {
  baseUrl: "https://example.figma.site",
  password: process.env.UI_CLIPS_PASSWORD,     // optional; published-prototype gate only
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "light",                         // "light" | "dark" | "no-preference"
  fps: 30,
  cursor: { style: "arrow", color: "#1f2937", size: 22, ripple: true },  // "arrow" (default) | "dot" | "none"
  zoom: { mode: "off" },                        // "off" | "gentle" | "pronounced"
  outputs: ["mp4", "webm", "poster"],           // + "gif"
  quality: { crf: 20, webmCrf: 30, maxWidth: 1440 },
  hideSelectors: [],                            // e.g. ['[class*="made-with"]'] for a "Made with Figma" badge
  cssOverrides: "",
  waitForFonts: true,
};
