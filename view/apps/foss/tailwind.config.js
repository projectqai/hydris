/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "../../packages/ui/src/**/*.{js,jsx,ts,tsx}",
    "../../packages/core/src/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset"), require("@hydris/tailwind-config")],
};
