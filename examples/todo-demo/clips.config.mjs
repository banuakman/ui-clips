export default {
  serve: "./site",                              // local static site; the engine serves it on 127.0.0.1
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "light",
  fps: 30,
  cursor: { style: "dot", color: "#1f2937", size: 16, ripple: true },
  zoom: { mode: "off" },
  outputs: ["mp4", "webm", "poster"],
  quality: { crf: 20, webmCrf: 30, maxWidth: 1440 },
  hideSelectors: [],
  cssOverrides: "",
  waitForFonts: true,
};
