import type { Config } from "tailwindcss";

const config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  plugins: [],
} satisfies Config;

export default config;
