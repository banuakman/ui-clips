export default {
  serve: "./site",                              // local static site; the engine serves it on 127.0.0.1
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "light",
  fps: 30,
  cursor: { style: "arrow", color: "#1f2937", size: 22, ripple: true },
  zoom: { mode: "gentle" },                     // "gentle" | "pronounced" | "off"; clips may override
  camera: { feel: "calm" },                     // "brisk" | "calm" | "lazy"
  stage: { exclude: ["footer"], fill: "#ffffff" },   // the card's footer never appears in any frame
  outputs: ["mp4", "webm", "poster", "gif"],
  sizes: {
    full: true,                                            // the stage at 1440 wide
    card: { width: 480, height: 600, scale: 2, focus: "auto" },   // 4:5 at 960×1200, white fill below the stage
    landscape: { aspect: "16:9", focus: "list" },          // static 16:9 window on the mark "list"
  },
  quality: { crf: 20, webmCrf: 30, maxWidth: 1440 },
  hideSelectors: [],
  cssOverrides: "",
  waitForFonts: true,
};
