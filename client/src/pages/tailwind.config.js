/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class', // Forces dark mode to only activate when 'dark' class is present
  theme: {
    extend: {},
  },
  plugins: [],
}