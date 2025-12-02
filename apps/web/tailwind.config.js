/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
    "./node_modules/primevue/**/*.{vue,js,ts,jsx,tsx}"
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Custom dark mode colors with purple tint
        dark: {
          50: '#f3f2f8',
          100: '#e8e5f1',
          200: '#d4cee5',
          300: '#b4aad2',
          400: '#8f81ba',
          500: '#7161a4',
          600: '#5e4c8b',
          700: '#3d2f55',
          800: '#2a1f3d', // Darker for better contrast with dark-900
          900: '#1a1625', // Main dark background - deep purple
          950: '#0f0d19', // Darker variant
        }
      }
    },
  },
  plugins: [],
}
