/** Tailwind v3 (the theme's main.css uses @tailwind directives). */
module.exports = {
  darkMode: 'class',
  content: [
    './hugo_stats.json',
    './layouts/**/*.html',
    './content/**/*.md',
    './data/**/*.{yaml,toml,json}',
    './assets/js/**/*.js',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        heading: ['"Space Grotesk Variable"', '"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
