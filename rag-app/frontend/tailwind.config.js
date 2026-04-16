/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./hooks/**/*.{js,ts,jsx,tsx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Brand palette — edit these to customise the look
        brand: {
          50:  "#f0f9ff",
          100: "#e0f2fe",
          500: "#0ea5e9",
          600: "#0284c7",
          700: "#0369a1",
          900: "#0c4a6e",
        },
        // Chat surface colours
        surface: {
          DEFAULT: "#ffffff",
          dark:    "#0f172a",
        },
        sidebar: {
          DEFAULT: "#f8fafc",
          dark:    "#1e293b",
        },
        bubble: {
          user:      "#0ea5e9",
          assistant: "#f1f5f9",
          "user-dark":      "#0369a1",
          "assistant-dark": "#1e293b",
        },
      },
      typography: {
        DEFAULT: {
          css: {
            maxWidth: "none",
            color: "inherit",
            a: { color: "#0ea5e9", textDecoration: "underline" },
            "code::before": { content: '""' },
            "code::after":  { content: '""' },
            code: {
              backgroundColor: "#f1f5f9",
              borderRadius:    "0.25rem",
              padding:         "0.1em 0.3em",
              fontWeight:      "400",
            },
          },
        },
        invert: {
          css: {
            code: { backgroundColor: "#1e293b" },
          },
        },
      },
      animation: {
        "fade-in":    "fadeIn 0.2s ease-in-out",
        "slide-up":   "slideUp 0.3s ease-out",
        "pulse-dot":  "pulseDot 1.4s ease-in-out infinite",
      },
      keyframes: {
        fadeIn:   { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        slideUp:  { "0%": { transform: "translateY(8px)", opacity: "0" }, "100%": { transform: "translateY(0)", opacity: "1" } },
        pulseDot: { "0%, 80%, 100%": { transform: "scale(0)" }, "40%": { transform: "scale(1)" } },
      },
    },
  },
  plugins: [
    require("@tailwindcss/typography"),
  ],
};
