export default {
  serve: "./site",                              // local static site; the engine serves it on 127.0.0.1
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "light",
  fps: 30,
  cursor: { style: "arrow", color: "#1f2937", size: 22, ripple: true },
  zoom: { mode: "gentle" },                     // "off" | "gentle" | "pronounced"; clips may override
  outputs: ["mp4", "webm", "poster", "gif"],
  quality: { crf: 20, webmCrf: 30, maxWidth: 1440 },
  crops: {
    landscape: { aspect: "16:9", focus: "list" },  // 1440×810 window centred on the mark "list"
  },
  hideSelectors: [],
  cssOverrides: "",
  waitForFonts: true,
};
