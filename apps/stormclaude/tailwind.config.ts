import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        storm: {
          50: "#f0f4ff",
          100: "#e0e9ff",
          500: "#3b5bdb",
          600: "#2f4ac7",
          700: "#2440b0",
          900: "#1a2f80",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
