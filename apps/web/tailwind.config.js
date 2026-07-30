/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        pas: {
          red: "#8B0000",
          "red-mid": "#A01010",
          "red-light": "#fdf3f3",
          gold: "#9A7B2F",
          "gold-light": "#fdf8ee",
          green: "#1a5c35",
          "green-light": "#edf7f1",
          blue: "#1a45a0",
          "blue-light": "#edf1fd",
          ink: "#13100e",
          "ink-mid": "#3a3530",
          muted: "#7a7068",
          border: "#dfd9d2",
          surface: "#f7f3ef",
          "surface-mid": "#ede8e3",
        },
      },
  fontFamily: {
        sans: ["Geist", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        pas: "10px",
        "pas-sm": "6px",
        "pas-lg": "14px",
      },
      boxShadow: {
        pas: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
        "pas-md": "0 4px 16px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)",
        "pas-lg": "0 12px 40px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.06)",
      },
    },
  },
  plugins: [],
};
