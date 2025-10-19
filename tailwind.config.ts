import type { Config } from "tailwindcss";

const config = {
  darkMode: "class",
  plugins: [require("tailwindcss-animate")],
} satisfies Config;

export default config;
