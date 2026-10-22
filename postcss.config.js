// Order matters: postcss-import first, Tailwind (purges its own utilities) next, then PurgeCSS removes the
// unused custom rules that the theme CSS and the site blocks carry. Content globs mirror tailwind.config.js.
const purgecss = require('@fullhuman/postcss-purgecss');

module.exports = {
  plugins: [
    require('postcss-import')(),
    require('tailwindcss')(),
    require('autoprefixer')(),
    purgecss({
      content: [
        './layouts/**/*.html',
        './content/**/*.md',
        './data/**/*.{yaml,toml,json}',
        './assets/js/**/*.js',
      ],
      // Generous tokenizer: Tailwind variants (md:flex, dark:text-white), fractions (w-1/2), arbitrary values.
      defaultExtractor: (content) => content.match(/[^\s"'`<>=(){};,]+/g) || [],
      keyframes: true,
      fontFace: true,
      variables: true,
      safelist: {
        // dark/js/no-js/no-dialog/hidden: toggled by site.js. chroma/highlight/footnote*: classes Hugo's markdown renderer
        // writes into post HTML. featured-card__badge--*: composed inside a template ({{ if }} between the two halves).
        standard: ['dark', 'js', 'no-js', 'no-dialog', 'hidden', 'chroma', 'highlight', 'footnotes', /^footnote-/, /^featured-card__badge--/,
          // Elements that only the markdown renderer writes (not literally present in any template).
          /^(pre|code|kbd|samp|blockquote|table|thead|tbody|tfoot|tr|th|td|caption|hr|figure|figcaption|ul|ol|li|dl|dt|dd|em|strong|del|ins|mark|sup|sub|abbr|details|summary)$/],
        // Chroma token classes (.k, .s1 ...) only exist inside rendered code blocks.
        deep: [/^chroma$/],
        // Custom properties read only from HTML (inline style) or JS would look unused to PurgeCSS.
        variables: [/^--color-/, /^--hero-/],
      },
    }),
  ],
};
