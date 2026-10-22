export default {
  baseUrl: "https://example.figma.site",
  password: process.env.UI_CLIPS_PASSWORD,     // optional; published-prototype gate only
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "light",                         // "light" | "dark" | "no-preference"
  fps: 30,
  cursor: { style: "arrow", color: "#1f2937", size: 22, ripple: true },  // "arrow" (default) | "dot" | "none"
  zoom: { mode: "gentle" },                     // "off" | "gentle" | "pronounced"; each clip may override
  outputs: ["mp4", "webm", "poster"],           // + "gif"
  quality: { crf: 20, webmCrf: 30, maxWidth: 1440 },
  sizes: {                                      // output sizes every clip gets (§10.2); clips add `crops`
    full: true,
    card: { width: 480, height: 600, scale: 2, focus: "auto" },   // 4:5 at 960×1200, framed by the camera
  },
  camera: { feel: "calm" },                     // "brisk" | "calm" | "lazy" (§10.3)
  stage: null,                                  // { exclude: ["nav.sidebar"], fill: "#FFFFFF" }: regions that never appear
  hideSelectors: [],                            // e.g. ['[class*="made-with"]'] for a "Made with Figma" badge
  cssOverrides: "",
  waitForFonts: true,
};
