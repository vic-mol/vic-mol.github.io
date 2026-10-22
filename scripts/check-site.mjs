#!/usr/bin/env node
/**
 * check-site.mjs: acceptance checks for the built site (the contents of `public/`).
 *
 *   node scripts/check-site.mjs [publicDir] [--base <url>] [--json]
 *
 *   publicDir   the Hugo output directory (default: ./public)
 *   --base URL  the baseURL the site was built with. Every absolute self-URL (canonical, hreflang,
 *               og:url, og:image, sitemap and feed links) must live under it. Default: inferred from
 *               the <link rel="canonical"> of the home page (`index.html`).
 *   --json      print one JSON document instead of text lines
 *
 * Output: one line per violation on stdout, `ERROR|WARN <rule-id> <file>: <detail>`, sorted by rule
 * (table order), then file. `<file>` is relative to publicDir (repo-relative for the layouts/assets
 * scan, `-` when there is no file). A one-line summary goes to stderr. Exit code: 0 when there are
 * no errors (warnings never fail), 1 when there is at least one error, 2 for a usage error or an
 * unreadable publicDir.
 *
 * Contract for the rules
 *   Every rule is an exported function with the SAME signature, `ruleId($, file, ctx)`, returning an
 *   array of violations (a string, or `{ detail, level?, file? }`). The export name is the rule id in
 *   camelCase (`lang-attr` -> `langAttr`); `RULES` maps id -> function and `RULE_META` holds each
 *   rule's `scope` and default `level`.
 *     scope "page"  called once per HTML page with its parsed cheerio document and its path relative
 *                   to publicDir (`es/projects/index.html`). Redirect stubs (a `<meta
 *                   http-equiv="refresh">` page such as Hugo's `en/index.html` alias) are not pages
 *                   and are skipped.
 *     scope "site"  called once as `rule(null, null, ctx)`; it reads everything it needs from ctx
 *                   (no-plain-contact, no-hardcoded-host, translation-parity, no-confirm, feeds,
 *                   sitemap, js-budget). `file` in the returned items is then mandatory.
 *   `ctx` (see createContext): publicDir, repoRoot, base, files, pages (Map file -> page), pageList,
 *   langOf(file), mirrorOf(file), pageUrl(file), toFile(url, fromFile), translationsOf(file),
 *   text(file), sitemaps().
 *   A rule that throws is reported as `ERROR <rule> <file>: rule crashed: ...` instead of aborting.
 *
 * Conventions this checker defines where the plan is silent (so the templates must follow them)
 *   - Language of a page: `es` when its path starts with `es/`, else `en`. The bilingual root
 *     `404.html` is exempt from the lang match (it must still declare a lang).
 *   - "Has a translation": the page's mirror (`x` <-> `es/x`) exists, or a page/sitemap entry links
 *     the two by hreflang. This also covers posts whose slugs differ between languages.
 *   - hreflang values are matched on their primary subtag (`en`, `en-US` -> en; `x-default`).
 *   - Decorative image: `alt=""` is only accepted when the image or an ancestor has
 *     `aria-hidden="true"` or `data-decorative`, or the image has role `presentation` or `none`.
 *   - Sizes: "6 KB" is 6144 bytes of minified JavaScript referenced by a home page (`index.html`
 *     and `es/index.html` are each checked), inline JavaScript (`<script>` without a src, JSON and
 *     other data blocks excluded) is limited to 600 bytes.
 *   - The repo root (for no-hardcoded-host, which scans `layouts/**` and `assets/**`) is
 *     `<publicDir>/..`, falling back to the current directory when that has neither folder.
 *   - Contact details and the pending-decision marker are never echoed in the report (only file,
 *     line and column), so logs and the committed baseline stay clean.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';

// ---------------------------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------------------------

export const JS_BUDGET_BYTES = 6 * 1024;
export const INLINE_JS_BUDGET_BYTES = 600;

const LOCALES = { en: 'en_US', es: 'es_MX' };
const LANG_NAME = { en: 'English', es: 'Spanish' };

/** Hosts a page must never load anything from (substring of the host name). */
const BLOCKED_HOSTS = [
  'fonts.googleapis',
  'fonts.gstatic',
  'cdnjs',
  'jsdelivr',
  'unpkg',
  'pexels',
  'calendly',
  'formspree',
  'googletagmanager',
];

/**
 * Plain contact details that must never appear in the built site. The patterns are assembled from
 * fragments so that this source file itself never contains them (the repository is searched for
 * the same strings before every commit). `label` is what the report says; it never echoes a match.
 */
export const CONTACT_PATTERNS = [
  { label: 'email address', source: 'proton' + 'mail\\.com' },
  { label: 'email handle', source: 'vic' + 'mol23' },
  { label: 'email address', source: 'gm' + 'ail\\.com' },
  { label: 'phone number', source: '2190\\s?68' + '88' },
  { label: 'phone number', source: '55219' + '06888' },
].map((p) => ({ ...p, re: new RegExp(p.source, 'i') }));

const CONFIRM_RE = /\[CONFIRM\]/i;
const HARDCODED_HOST_RE = /vic-mol\.github\.io/i;
const PAGER_RE = /(^|\/)page\/\d+\/index\.html$/;

const BINARY_EXT = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'ico', 'bmp', 'woff', 'woff2', 'ttf', 'otf', 'eot',
  'pdf', 'zip', 'gz', 'mp4', 'webm', 'mov', 'mp3', 'ogg',
]);
const MAX_TEXT_BYTES = 8 * 1024 * 1024;

// ---------------------------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------------------------

const short = (s, n = 80) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '...' : t;
};
const chars = (s) => [...s].length;
const isHtmlFile = (f) => /\.html?$/i.test(f);
const langOfFile = (f) => (f.startsWith('es/') ? 'es' : 'en');
const mirrorOfFile = (f) => (f.startsWith('es/') ? f.slice(3) : `es/${f}`);
const hreflangKey = (h) => {
  const v = String(h ?? '').trim().toLowerCase();
  return v === 'x-default' ? v : v.split(/[-_]/)[0];
};
const lineCol = (text, index) => {
  let line = 1;
  let last = -1;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) {
    line++;
    last = i;
  }
  return { line, col: index - last };
};

function walk(dir, rel = '') {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...walk(dir, r));
    else if (ent.isFile()) out.push(r);
  }
  return out;
}

const looksBinary = (buf) => buf.subarray(0, 8000).includes(0);

function readText(abs) {
  const ext = path.extname(abs).slice(1).toLowerCase();
  if (BINARY_EXT.has(ext)) return null;
  try {
    if (fs.statSync(abs).size > MAX_TEXT_BYTES) return null;
    const buf = fs.readFileSync(abs);
    return looksBinary(buf) ? null : buf.toString('utf8');
  } catch {
    return null;
  }
}

/** Strict-enough XML well-formedness check (no DTD support). Returns a problem string or null. */
export function xmlProblem(src) {
  const n = src.length;
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  const stack = [];
  let rootSeen = false;
  let rootClosed = false;
  const lineAt = (pos) => {
    let l = 1;
    for (let k = 0; k < pos && k < n; k++) if (src.charCodeAt(k) === 10) l++;
    return l;
  };
  const fail = (msg, pos) => `${msg} (line ${lineAt(pos)})`;
  const badAmp = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;
  const NAME = '[A-Za-z_:\\u00C0-\\uFFFF][\\w:.\\u00B7\\u00C0-\\uFFFF-]*';
  const startRe = new RegExp(`<(${NAME})`, 'y');
  const endRe = new RegExp(`<\\/(${NAME})\\s*>`, 'y');
  const attrRe = new RegExp(`\\s+(${NAME})\\s*=\\s*(?:"([^"<]*)"|'([^'<]*)')`, 'y');
  const closeRe = /\s*(\/?)>/y;

  while (i < n) {
    const lt = src.indexOf('<', i);
    const text = src.slice(i, lt === -1 ? n : lt);
    if (text) {
      if (stack.length === 0) {
        if (text.trim() !== '') return fail('text outside the root element', i);
      } else {
        const m = badAmp.exec(text);
        if (m) return fail('unescaped "&" or undefined entity', i + m.index);
        if (text.includes(']]>')) return fail('"]]>" in character data', i + text.indexOf(']]>'));
      }
    }
    if (lt === -1) break;
    i = lt;
    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i + 4);
      if (e === -1) return fail('unterminated comment', i);
      i = e + 3;
    } else if (src.startsWith('<![CDATA[', i)) {
      if (stack.length === 0) return fail('CDATA outside the root element', i);
      const e = src.indexOf(']]>', i);
      if (e === -1) return fail('unterminated CDATA section', i);
      i = e + 3;
    } else if (src.startsWith('<?', i)) {
      const e = src.indexOf('?>', i + 2);
      if (e === -1) return fail('unterminated processing instruction', i);
      i = e + 2;
    } else if (src.startsWith('<!', i)) {
      let depth = 0;
      let k = i + 2;
      for (; k < n; k++) {
        const c = src[k];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      if (k >= n) return fail('unterminated declaration', i);
      i = k + 1;
    } else if (src.startsWith('</', i)) {
      endRe.lastIndex = i;
      const m = endRe.exec(src);
      if (!m) return fail('malformed end tag', i);
      const open = stack.pop();
      if (open !== m[1]) return fail(`end tag </${m[1]}> does not match <${open ?? 'nothing'}>`, i);
      if (stack.length === 0) rootClosed = true;
      i = endRe.lastIndex;
    } else {
      startRe.lastIndex = i;
      const m = startRe.exec(src);
      if (!m) return fail('malformed start tag', i);
      if (stack.length === 0 && rootClosed) return fail('more than one root element', i);
      let k = startRe.lastIndex;
      const seen = new Set();
      for (;;) {
        attrRe.lastIndex = k;
        const a = attrRe.exec(src);
        if (!a) break;
        if (seen.has(a[1])) return fail(`duplicate attribute "${a[1]}"`, k);
        seen.add(a[1]);
        if (badAmp.test(a[2] ?? a[3] ?? '')) return fail(`unescaped "&" in attribute "${a[1]}"`, k);
        k = attrRe.lastIndex;
      }
      closeRe.lastIndex = k;
      const c = closeRe.exec(src);
      if (!c) return fail(`malformed tag <${m[1]}>`, i);
      rootSeen = true;
      if (c[1] === '/') {
        if (stack.length === 0) rootClosed = true;
      } else {
        stack.push(m[1]);
      }
      i = closeRe.lastIndex;
    }
  }
  if (stack.length) return fail(`element <${stack[stack.length - 1]}> is never closed`, n);
  if (!rootSeen) return 'no root element';
  return null;
}

const loadXml = (text) => load(text, { xml: true });

// ---------------------------------------------------------------------------------------------
// context
// ---------------------------------------------------------------------------------------------

function normalizeBase(value) {
  const u = new URL(value);
  u.hash = '';
  u.search = '';
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  return u;
}

function isRedirectStub($) {
  return $('meta[http-equiv]')
    .toArray()
    .some((el) => String(el.attribs['http-equiv']).trim().toLowerCase() === 'refresh');
}

function alternatesOf($) {
  const out = [];
  $('link[hreflang]').each((_, el) => {
    const rel = String(el.attribs.rel ?? '').toLowerCase().split(/\s+/);
    if (!rel.includes('alternate')) return;
    out.push({ hreflang: String(el.attribs.hreflang).trim(), href: String(el.attribs.href ?? '').trim() });
  });
  return out;
}

function findRepoRoot(publicDir, explicit) {
  const has = (d) => fs.existsSync(path.join(d, 'layouts')) || fs.existsSync(path.join(d, 'assets'));
  if (explicit) return path.resolve(explicit);
  for (const candidate of [path.dirname(publicDir), process.cwd()]) if (has(candidate)) return candidate;
  return null;
}

export function createContext(publicDirArg, { base, repoRoot } = {}) {
  const publicDir = path.resolve(publicDirArg);
  if (!fs.existsSync(publicDir) || !fs.statSync(publicDir).isDirectory()) {
    throw new Error(`public directory not found: ${publicDirArg}`);
  }
  const files = walk(publicDir).sort();
  const fileSet = new Set(files);
  const textCache = new Map();
  const ctx = {
    publicDir,
    repoRoot: findRepoRoot(publicDir, repoRoot),
    files,
    fileSet,
    pages: new Map(),
    pageList: [],
    cache: new Map(),
    langOf: langOfFile,
    mirrorOf: mirrorOfFile,
  };

  ctx.text = (file) => {
    if (!textCache.has(file)) textCache.set(file, fileSet.has(file) ? readText(path.join(publicDir, file)) : null);
    return textCache.get(file);
  };

  // ---- pages
  for (const file of files.filter(isHtmlFile)) {
    const html = ctx.text(file) ?? '';
    const $ = load(html);
    const robots = $('meta[name]')
      .toArray()
      .filter((el) => String(el.attribs.name).toLowerCase() === 'robots')
      .map((el) => String(el.attribs.content ?? '').toLowerCase())
      .join(',');
    const page = {
      file,
      lang: langOfFile(file),
      $,
      stub: isRedirectStub($),
      is404: path.posix.basename(file) === '404.html',
      isPager: PAGER_RE.test(file),
      noindex: /noindex/.test(robots),
      alternates: alternatesOf($),
    };
    ctx.pages.set(file, page);
  }
  ctx.pageList = [...ctx.pages.values()].filter((p) => !p.stub);

  // ---- base URL: --base, else the home page canonical, else any canonical
  const canonicalOf = (p) => {
    const el = p?.$('link[rel]')
      .toArray()
      .find((e) => String(e.attribs.rel).toLowerCase().split(/\s+/).includes('canonical'));
    return el?.attribs.href;
  };
  let baseUrl = null;
  if (base) {
    baseUrl = normalizeBase(base);
  } else {
    // the home page canonical IS the base (also when the site lives under a path prefix)
    try {
      const homeCanonical = canonicalOf(ctx.pages.get('index.html'));
      if (homeCanonical) baseUrl = normalizeBase(homeCanonical);
    } catch {
      /* fall through */
    }
    // otherwise assume the site is served from the root of whatever host the pages claim
    for (const page of baseUrl ? [] : ctx.pageList) {
      try {
        const c = canonicalOf(page);
        if (c) {
          baseUrl = new URL('/', c);
          break;
        }
      } catch {
        /* try the next page */
      }
    }
  }
  baseUrl ??= new URL('http://localhost/');
  ctx.baseUrl = baseUrl;
  ctx.base = baseUrl.href;

  // ---- URLs
  ctx.pageUrl = (file) => {
    const rel = file === 'index.html' ? '' : file.endsWith('/index.html') ? file.slice(0, -'index.html'.length) : file;
    return ctx.base + encodeURI(rel);
  };

  /** Map a URL (absolute, root-relative or relative to `fromFile`) onto a file in publicDir. */
  ctx.toFile = (value, fromFile) => {
    let u;
    try {
      u = new URL(String(value).trim(), fromFile ? ctx.pageUrl(fromFile) : ctx.base);
    } catch {
      return { file: null, rel: null, invalid: true };
    }
    if (!/^https?:$/.test(u.protocol)) return { file: null, rel: null, special: true };
    if (u.origin !== baseUrl.origin || !u.pathname.startsWith(baseUrl.pathname)) {
      return { file: null, rel: null, external: true };
    }
    let rel = u.pathname.slice(baseUrl.pathname.length);
    try {
      rel = decodeURIComponent(rel);
    } catch {
      /* keep the raw path */
    }
    const candidates = rel === '' || rel.endsWith('/') ? [`${rel}index.html`] : [rel, `${rel}/index.html`, `${rel}.html`];
    const file = candidates.find((c) => fileSet.has(c)) ?? null;
    return { file, rel };
  };

  // ---- sitemaps (parsed lazily; the translation graph below also uses them)
  let sitemapResult = null;
  ctx.sitemaps = () => {
    if (sitemapResult) return sitemapResult;
    const result = { rootFound: fileSet.has('sitemap.xml'), files: [], entries: [], problems: [] };
    const seen = new Set();
    const visit = (file) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = ctx.text(file);
      if (text == null) return;
      result.files.push(file);
      const problem = xmlProblem(text);
      if (problem) result.problems.push({ file, problem: `not well-formed XML: ${problem}` });
      const $x = loadXml(text);
      if ($x('sitemapindex').length) {
        $x('sitemap > loc').each((_, el) => {
          const loc = $x(el).text().trim();
          const r = ctx.toFile(loc);
          if (r.file) visit(r.file);
          else result.problems.push({ file, problem: `lists ${loc}, which is ${r.external ? 'outside the site base' : 'not found in public/'}` });
        });
      } else if ($x('urlset').length) {
        $x('url').each((_, el) => {
          const loc = $x(el).children('loc').first().text().trim();
          const alternates = $x(el)
            .find('*')
            .toArray()
            .filter((c) => c.name === 'xhtml:link' && String(c.attribs.rel ?? '').toLowerCase() === 'alternate')
            .map((c) => ({ hreflang: String(c.attribs.hreflang ?? '').trim(), href: String(c.attribs.href ?? '').trim() }));
          result.entries.push({
            sitemap: file,
            loc,
            locFile: ctx.toFile(loc).file,
            alternates: alternates.map((a) => ({ ...a, file: ctx.toFile(a.href).file })),
          });
        });
      } else {
        result.problems.push({ file, problem: 'neither a <sitemapindex> nor a <urlset>' });
      }
    };
    if (fileSet.has('sitemap.xml')) visit('sitemap.xml');
    for (const f of files) if (/(^|\/)sitemap\.xml$/.test(f)) visit(f);
    sitemapResult = result;
    return result;
  };

  // ---- translation graph: mirror paths + hreflang links + sitemap alternates
  const edges = new Map();
  // Pager pages (posts/page/2/) are not translations of each other: page N of each language lists different
  // posts, so they carry no hreflang and stay out of the graph.
  const eligible = (f) => {
    const p = ctx.pages.get(f);
    return Boolean(p) && !p.stub && !p.is404 && !p.isPager;
  };
  const link = (a, b) => {
    if (!a || !b || a === b || !eligible(a) || !eligible(b)) return;
    if (langOfFile(a) === langOfFile(b)) return;
    if (!edges.has(a)) edges.set(a, new Set());
    if (!edges.has(b)) edges.set(b, new Set());
    edges.get(a).add(b);
    edges.get(b).add(a);
  };
  for (const page of ctx.pageList) {
    link(page.file, mirrorOfFile(page.file));
    for (const alt of page.alternates) link(page.file, ctx.toFile(alt.href, page.file).file);
  }
  for (const entry of ctx.sitemaps().entries) {
    for (const alt of entry.alternates) link(entry.locFile, alt.file);
  }
  ctx.translationsOf = (file) => [...(edges.get(file) ?? [])].sort();

  return ctx;
}

// ---------------------------------------------------------------------------------------------
// shared rule helpers
// ---------------------------------------------------------------------------------------------

/** Classify an absolute URL relative to the site base. */
function inspectUrl(ctx, value, fromFile) {
  const v = String(value ?? '').trim();
  if (!/^https?:\/\//i.test(v)) return { problem: 'is not absolute' };
  const r = ctx.toFile(v, fromFile);
  if (r.external) return { problem: `is outside the site base ${ctx.base}` };
  return { file: r.file, rel: r.rel };
}

function describeTag(el, attrs) {
  const bits = [];
  for (const a of attrs) if (el.attribs?.[a] !== undefined) bits.push(`${a}="${short(el.attribs[a], 40)}"`);
  return `<${el.name}${bits.length ? ' ' + bits.join(' ') : ''}>`;
}

const metaValues = ($, key) =>
  $('meta[property], meta[name]')
    .toArray()
    .filter((el) => (el.attribs.property ?? el.attribs.name ?? '').toLowerCase() === key || (el.attribs.name ?? '').toLowerCase() === key)
    .map((el) => String(el.attribs.content ?? '').trim());

function isFocusable(el) {
  const a = el.attribs ?? {};
  const tab = a.tabindex !== undefined ? parseInt(a.tabindex, 10) : NaN;
  if (!Number.isNaN(tab) && tab < 0) return false;
  switch (el.name) {
    case 'a':
    case 'area':
      return a.href !== undefined || !Number.isNaN(tab);
    case 'button':
    case 'select':
    case 'textarea':
      return a.disabled === undefined;
    case 'input':
      return a.disabled === undefined && String(a.type ?? '').toLowerCase() !== 'hidden';
    case 'summary':
    case 'iframe':
      return true;
    case 'audio':
    case 'video':
      return a.controls !== undefined;
    default:
      break;
  }
  if (!Number.isNaN(tab) && tab >= 0) return true;
  return a.contenteditable !== undefined && String(a.contenteditable).toLowerCase() !== 'false';
}

function isHiddenSubtree(el) {
  const a = el.attribs ?? {};
  return a.hidden !== undefined || a.inert !== undefined || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(a.style ?? '');
}

/** First keyboard-focusable element of <body> in document order (iterative, depth-safe). */
function firstFocusable($) {
  const body = $('body').get(0);
  if (!body) return null;
  const stack = [...(body.children ?? [])].reverse();
  while (stack.length) {
    const el = stack.pop();
    if (el.type !== 'tag' || el.name === 'template' || el.name === 'noscript' || isHiddenSubtree(el)) continue;
    if (isFocusable(el)) return el;
    const kids = el.children ?? [];
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return null;
}

function blockedHostsIn(value) {
  const hits = [];
  for (const raw of String(value).match(/(?:https?:)?\/\/[^\s"'<>),]+/gi) ?? []) {
    let host;
    try {
      host = new URL(raw.startsWith('//') ? `https:${raw}` : raw).hostname.toLowerCase();
    } catch {
      continue;
    }
    const token = BLOCKED_HOSTS.find((t) => host.includes(t));
    if (token) hits.push({ url: raw, token });
  }
  return hits;
}

function cssThirdParty(css) {
  const out = [];
  const re = /(?:@import\s+(?:url\(\s*)?|url\(\s*)["']?((?:https?:)?\/\/[^"')\s]+)/gi;
  for (const m of css.matchAll(re)) out.push(...blockedHostsIn(m[1]));
  return out;
}

// ---------------------------------------------------------------------------------------------
// the rules (ids are fixed; see the plan, section T2)
// ---------------------------------------------------------------------------------------------

/** `<html lang>` starts with `es` under /es/, `en` elsewhere (bilingual /404.html exempt). */
export function langAttr($, file, ctx) {
  const lang = String($('html').first().attr('lang') ?? '').trim();
  if (!lang) return [`<html> has no lang attribute (expected "${ctx.langOf(file)}")`];
  if (file === '404.html') return [];
  const expected = ctx.langOf(file);
  if (!new RegExp(`^${expected}(-|$)`, 'i').test(lang)) {
    return [`expected lang "${expected}" (page is ${expected === 'es' ? 'under /es/' : 'outside /es/'}) but found lang="${lang}"`];
  }
  return [];
}

/** Translated pages carry absolute, existing, reciprocal en / es / x-default alternates. */
export function hreflang($, file, ctx) {
  const page = ctx.pages.get(file);
  const out = [];
  const keys = new Set(page.alternates.map((a) => hreflangKey(a.hreflang)));
  if (ctx.translationsOf(file).length > 0) {
    for (const need of ['en', 'es', 'x-default']) {
      if (!keys.has(need)) out.push(`missing <link rel="alternate" hreflang="${need}"> (the page has a translation)`);
    }
  }
  const targets = new Map();
  for (const alt of page.alternates) {
    const key = hreflangKey(alt.hreflang);
    const label = `hreflang="${alt.hreflang}"`;
    const info = inspectUrl(ctx, alt.href, file);
    if (info.problem) {
      out.push(`${label} href "${short(alt.href)}" ${info.problem}`);
      continue;
    }
    const target = info.file ? ctx.pages.get(info.file) : null;
    if (!target || target.stub) {
      out.push(`${label} target not found in public/: ${alt.href}`);
      continue;
    }
    if (key === 'x-default') {
      if (target.lang !== 'en') out.push(`${label} must point to the English page, not ${alt.href}`);
    } else if ((key === 'en' || key === 'es') && target.lang !== key) {
      out.push(`${label} points to a ${LANG_NAME[target.lang]} page: ${alt.href}`);
    }
    if (key === page.lang && target.file !== file) {
      out.push(`${label} is this page's own language, so it must point to the page itself (self-reference), not ${alt.href}`);
    }
    if (target.file !== file && !targets.has(target.file)) targets.set(target.file, label);
  }
  for (const [targetFile, label] of targets) {
    const back = ctx.pages.get(targetFile).alternates.some((b) => ctx.toFile(b.href, targetFile).file === file);
    if (!back) out.push(`${label} target ${targetFile} does not link back to this page (not reciprocal)`);
  }
  return out;
}

/** One nav with [data-lang-switch] links; each target exists and is the translation when there is one. */
export function langSwitch($, file, ctx) {
  const out = [];
  const navs = $('nav').filter((_, el) => $(el).find('[data-lang-switch]').length > 0);
  const all = $('[data-lang-switch]');
  if (navs.length !== 1) out.push(`expected exactly one <nav> containing [data-lang-switch], found ${navs.length}`);
  if (all.length === 0) return out;
  const own = ctx.langOf(file);
  const translations = ctx.translationsOf(file);
  all.each((_, el) => {
    const value = String(el.attribs['data-lang-switch'] ?? '').trim().toLowerCase();
    const label = `[data-lang-switch="${el.attribs['data-lang-switch']}"]`;
    const href = el.attribs.href;
    if (el.name !== 'a' || href === undefined) {
      out.push(`${label} element ${describeTag(el, ['href', 'class'])} is not a link with an href`);
      return;
    }
    if (value !== 'en' && value !== 'es') {
      out.push(`${label} must be "en" or "es"`);
      return;
    }
    if (value === own) {
      out.push(`${label} links to the page's own language (${own}); the switcher must offer the other language`);
      return;
    }
    const r = ctx.toFile(href, file);
    if (r.external) {
      out.push(`${label} target ${short(href)} is outside the site base ${ctx.base}`);
      return;
    }
    if (!r.file || !ctx.pages.has(r.file)) {
      out.push(`${label} target ${short(href)} does not exist in public/`);
      return;
    }
    if (ctx.langOf(r.file) !== value) {
      out.push(`${label} target ${r.file} is not a ${LANG_NAME[value]} page`);
      return;
    }
    const twins = translations.filter((f) => ctx.langOf(f) === value);
    if (twins.length && !twins.includes(r.file)) {
      out.push(`${label} should target the translation ${twins[0]} but targets ${r.file}`);
    }
  });
  return out;
}

/** Every EN page under projects/, gallery/, posts/ has an ES twin and vice versa (posts: warning). */
export function translationParity(_$, _file, ctx) {
  const out = [];
  for (const page of ctx.pageList) {
    if (page.is404 || page.isPager || !/^(es\/)?(projects|gallery|posts)\//.test(page.file)) continue;
    const other = page.lang === 'en' ? 'es' : 'en';
    if (ctx.translationsOf(page.file).some((f) => ctx.langOf(f) === other)) continue;
    out.push({
      file: page.file,
      level: /^(es\/)?posts\//.test(page.file) ? 'warn' : 'error',
      detail: `no ${LANG_NAME[other]} twin (expected ${ctx.mirrorOf(page.file)}, or an hreflang/sitemap alternate pointing to one)`,
    });
  }
  return out;
}

/** No plain email/phone anywhere in public/ (text files). The match itself is never printed. */
export function noPlainContact(_$, _file, ctx) {
  const out = [];
  for (const file of ctx.files) {
    const text = ctx.text(file);
    if (text == null) continue;
    const first = new Map(); // label -> earliest match index (patterns sharing a label count once)
    for (const p of CONTACT_PATTERNS) {
      const m = p.re.exec(text);
      if (m && (!first.has(p.label) || m.index < first.get(p.label))) first.set(p.label, m.index);
    }
    for (const [label, index] of first) {
      const { line, col } = lineCol(text, index);
      out.push({ file, detail: `plain contact detail found (${label}, line ${line}, column ${col})` });
    }
  }
  return out;
}

/** No src/href/srcset/action/url()/@import to a CDN, font host, map/booking/form or analytics service. */
export function noThirdParty($, file, ctx) {
  const out = [];
  const seen = new Set();
  const report = (where, hit, target = file) => {
    const key = `${target}|${where}|${hit.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ file: target, detail: `${where} loads from a third-party host (${hit.token}): ${short(hit.url, 100)}` });
  };
  const attrs = ['src', 'href', 'srcset', 'imagesrcset', 'action', 'formaction', 'poster'];
  $('*').each((_, el) => {
    for (const a of attrs) {
      const value = el.attribs?.[a];
      if (value === undefined) continue;
      for (const hit of blockedHostsIn(value)) report(`<${el.name} ${a}>`, hit);
    }
    if (el.attribs?.style) for (const hit of cssThirdParty(el.attribs.style)) report(`<${el.name} style>`, hit);
  });
  $('style').each((_, el) => {
    for (const hit of cssThirdParty($(el).text())) report('inline <style>', hit);
  });
  $('link[href]').each((_, el) => {
    const rel = String(el.attribs.rel ?? '').toLowerCase().split(/\s+/);
    if (!rel.includes('stylesheet')) return;
    const r = ctx.toFile(el.attribs.href, file);
    if (!r.file || !/\.css$/i.test(r.file)) return;
    const key = `3p-css:${r.file}`;
    if (ctx.cache.has(key)) return;
    ctx.cache.set(key, true);
    const css = ctx.text(r.file);
    if (css) for (const hit of cssThirdParty(css)) report('stylesheet', hit, r.file);
  });
  return out;
}

/** No hard-coded production host in layouts/** or assets/** (the repo root is <publicDir>/..). */
export function noHardcodedHost(_$, _file, ctx) {
  if (!ctx.repoRoot) {
    return [{ level: 'warn', file: '-', detail: 'could not find layouts/ or assets/ next to the public directory or in the current directory; skipped' }];
  }
  const out = [];
  for (const dir of ['layouts', 'assets']) {
    for (const rel of walk(path.join(ctx.repoRoot, dir)).sort()) {
      const file = `${dir}/${rel}`;
      const text = readText(path.join(ctx.repoRoot, file));
      if (text == null) continue;
      const m = HARDCODED_HOST_RE.exec(text);
      if (!m) continue;
      const { line } = lineCol(text, m.index);
      out.push({ file, detail: `hard-coded site host (line ${line}); use .Permalink, .RelPermalink, absURL or relLangURL` });
    }
  }
  return out;
}

const DECORATIVE_ROLES = new Set(['presentation', 'none']);
const isDecorative = ($el) =>
  $el.attr('aria-hidden') === 'true' ||
  DECORATIVE_ROLES.has(String($el.attr('role') ?? '').trim().toLowerCase()) ||
  ($el.attr('data-decorative') !== undefined && $el.attr('data-decorative') !== 'false') ||
  $el.closest('[aria-hidden="true"]').length > 0 ||
  $el.closest('[data-decorative]:not([data-decorative="false"])').length > 0;

/** Every <img> has alt (non-empty unless decorative) and numeric width and height. */
export function imgAlt($, file) {
  const out = [];
  $('img').each((_, el) => {
    const $el = $(el);
    const label = `<img src="${short($el.attr('src') ?? $el.attr('srcset') ?? '(none)', 60)}">`;
    const alt = $el.attr('alt');
    if (alt === undefined) out.push(`${label} has no alt attribute`);
    else if (alt.trim() === '' && !isDecorative($el)) {
      out.push(`${label} has an empty alt but is not marked decorative (aria-hidden="true", role="presentation" or data-decorative)`);
    }
    for (const dim of ['width', 'height']) {
      const v = $el.attr(dim);
      if (v === undefined) out.push(`${label} is missing ${dim}`);
      else if (!/^\d+(\.\d+)?$/.test(v.trim()) || Number(v) <= 0) out.push(`${label} has an invalid ${dim} "${short(v, 20)}"`);
    }
  });
  return out;
}

/** One <title>, a 50-160 character description, an absolute canonical under the base. */
export function meta($, file, ctx) {
  const out = [];
  const titles = $('title');
  if (titles.length !== 1) out.push(`expected exactly one <title>, found ${titles.length}`);
  else if (titles.first().text().trim() === '') out.push('<title> is empty');

  const descs = metaValues($, 'description');
  if (descs.length !== 1) out.push(`expected exactly one meta description, found ${descs.length}`);
  else {
    const n = chars(descs[0]);
    if (n < 50 || n > 160) out.push(`meta description is ${n} characters, expected 50-160`);
  }

  const canon = $('link[rel]')
    .toArray()
    .filter((el) => String(el.attribs.rel).toLowerCase().split(/\s+/).includes('canonical'));
  if (canon.length !== 1) out.push(`expected exactly one <link rel="canonical">, found ${canon.length}`);
  else {
    const info = inspectUrl(ctx, canon[0].attribs.href, file);
    if (info.problem) out.push(`canonical "${short(canon[0].attribs.href)}" ${info.problem}`);
  }
  return out;
}

/** Open Graph and Twitter card tags, per language. */
export function og($, file, ctx) {
  const out = [];
  const page = ctx.pages.get(file);
  const need = (key) => {
    const values = metaValues($, key).filter(Boolean);
    if (!values.length) out.push(`missing ${key}`);
    return values;
  };
  need('og:title');
  need('og:description');
  for (const url of need('og:url')) {
    const info = inspectUrl(ctx, url, file);
    if (info.problem) out.push(`og:url "${short(url)}" ${info.problem}`);
  }
  for (const url of need('og:image')) {
    const info = inspectUrl(ctx, url, file);
    if (info.problem) out.push(`og:image "${short(url)}" ${info.problem}`);
    else if (!info.file) out.push(`og:image target not found in public/: ${info.rel}`);
  }
  for (const [key, expected] of [['og:image:width', '1200'], ['og:image:height', '630']]) {
    const values = need(key);
    if (values.length && values[0] !== expected) out.push(`${key} is "${values[0]}", expected ${expected}`);
  }
  const locale = need('og:locale')[0];
  if (locale) {
    if (!Object.values(LOCALES).includes(locale)) out.push(`og:locale is "${locale}", expected en_US or es_MX`);
    else if (file !== '404.html' && locale !== LOCALES[page.lang]) {
      out.push(`og:locale is "${locale}" but the page is ${LANG_NAME[page.lang]} (expected ${LOCALES[page.lang]})`);
    }
  }
  if (ctx.translationsOf(file).length > 0) {
    const otherLocale = LOCALES[page.lang === 'en' ? 'es' : 'en'];
    if (!metaValues($, 'og:locale:alternate').includes(otherLocale)) {
      out.push(`translated page has no og:locale:alternate ${otherLocale}`);
    }
  }
  need('twitter:card');
  return out;
}

/** Exactly one <h1>. */
export function h1($) {
  const n = $('h1').length;
  return n === 1 ? [] : [`expected exactly one <h1>, found ${n}`];
}

/** One <main id="main">, the skip link first, every <nav> labelled. */
export function landmarks($) {
  const out = [];
  const mains = $('main');
  if (mains.length !== 1) out.push(`expected exactly one <main>, found ${mains.length}`);
  else if (mains.attr('id') !== 'main') out.push(`<main> must have id="main" (found ${mains.attr('id') === undefined ? 'no id' : `id="${mains.attr('id')}"`})`);

  const first = firstFocusable($);
  if (!first) out.push('no focusable element found; the first one must be a skip link <a href="#main">');
  else if (!(first.name === 'a' && String(first.attribs.href ?? '').trim() === '#main')) {
    out.push(`first focusable element is ${describeTag(first, ['href', 'id', 'class'])}, expected the skip link <a href="#main">`);
  }

  $('nav').each((_, el) => {
    const label = el.attribs['aria-label'];
    const by = el.attribs['aria-labelledby'];
    if (label !== undefined && label.trim() !== '') return;
    if (by && by.split(/\s+/).some((id) => id && $(`[id="${id}"]`).length > 0)) return;
    const d = describeTag(el, ['aria-label', 'class', 'id']);
    out.push(label !== undefined ? `${d} has an empty aria-label` : `${d} has no aria-label`);
  });
  return out;
}

/** The pending-decision marker must never reach public/. */
export function noConfirm(_$, _file, ctx) {
  const out = [];
  for (const file of ctx.files) {
    const text = ctx.text(file);
    if (text == null) continue;
    const m = CONFIRM_RE.exec(text);
    if (!m) continue;
    const { line, col } = lineCol(text, m.index);
    out.push({ file, detail: `pending-decision marker found (line ${line}, column ${col})` });
  }
  return out;
}

/** /index.xml and /es/index.xml are well-formed RSS and list posts only. */
export function feeds(_$, _file, ctx) {
  const out = [];
  for (const [file, lang] of [['index.xml', 'en'], ['es/index.xml', 'es']]) {
    const text = ctx.text(file);
    if (text == null) {
      out.push({ file, detail: `${file} is missing` });
      continue;
    }
    const problem = xmlProblem(text);
    if (problem) {
      out.push({ file, detail: `not well-formed XML: ${problem}` });
      continue;
    }
    const $x = loadXml(text);
    if ($x('rss > channel').length !== 1) {
      out.push({ file, detail: 'not an RSS document (expected <rss><channel>)' });
      continue;
    }
    const feedLang = $x('rss > channel > language').first().text().trim();
    if (feedLang && !new RegExp(`^${lang}(-|$)`, 'i').test(feedLang)) {
      out.push({ file, detail: `channel language is "${feedLang}", expected ${lang}` });
    }
    const prefix = lang === 'es' ? 'es/posts/' : 'posts/';
    $x('rss > channel > item').each((_, el) => {
      const link = $x(el).children('link').first().text().trim();
      const info = inspectUrl(ctx, link, file);
      if (info.problem) out.push({ file, detail: `item link "${short(link)}" ${info.problem}` });
      else if (!(info.rel ?? '').startsWith(prefix)) out.push({ file, detail: `item link ${link} is not under /${prefix} (feeds list posts only)` });
    });
  }
  return out;
}

/** (warn) Each language's sitemap lists that language's pages, with xhtml:link alternates. */
export function sitemap(_$, _file, ctx) {
  const out = [];
  const warn = (file, detail) => out.push({ level: 'warn', file, detail });
  const sm = ctx.sitemaps();
  if (!sm.rootFound) {
    warn('sitemap.xml', 'sitemap.xml is missing');
    return out;
  }
  for (const p of sm.problems) warn(p.file, p.problem);

  const listed = new Set();
  for (const entry of sm.entries) {
    const info = inspectUrl(ctx, entry.loc, entry.sitemap);
    if (info.problem) {
      warn(entry.sitemap, `<loc> "${short(entry.loc)}" ${info.problem}`);
      continue;
    }
    if (!entry.locFile) {
      warn(entry.sitemap, `<loc> ${entry.loc} not found in public/`);
      continue;
    }
    listed.add(entry.locFile);
    const lang = ctx.langOf(entry.locFile);
    const sitemapLang = entry.sitemap.startsWith('es/') ? 'es' : entry.sitemap.startsWith('en/') ? 'en' : null;
    if (sitemapLang && sitemapLang !== lang) warn(entry.sitemap, `${sitemapLang} sitemap lists a ${LANG_NAME[lang]} page: ${entry.loc}`);
    if (ctx.translationsOf(entry.locFile).length > 0) {
      const keys = new Set(entry.alternates.map((a) => hreflangKey(a.hreflang)));
      if (!keys.has('en') || !keys.has('es')) warn(entry.sitemap, `<url> ${entry.loc} has a translation but no xhtml:link alternates for both en and es`);
      for (const a of entry.alternates) {
        if (!a.file) warn(entry.sitemap, `xhtml:link alternate ${a.href} of ${entry.loc} not found in public/`);
      }
    }
  }

  for (const lang of ['en', 'es']) {
    const expected = ctx.pageList.filter(
      (p) => p.lang === lang && !p.is404 && !p.noindex && !p.isPager,
    );
    if (!expected.length) continue;
    if (!expected.some((p) => listed.has(p.file))) {
      warn('sitemap.xml', `no sitemap lists any ${lang} pages`);
      continue;
    }
    for (const p of expected) if (!listed.has(p.file)) warn(p.file, 'page is not listed in any sitemap');
  }
  return out;
}

const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'application/ecmascript', 'text/ecmascript', 'module']);

/** JavaScript referenced by each home page <= 6 KB, inline JavaScript <= 600 bytes. */
export function jsBudget(_$, _file, ctx) {
  const out = [];
  const homes = ['index.html', 'es/index.html'].filter((f) => ctx.pages.has(f) && !ctx.pages.get(f).stub);
  if (!homes.length) return [{ file: 'index.html', detail: 'home page not found in public/' }];
  for (const file of homes) {
    const $ = ctx.pages.get(file).$;
    const refs = [];
    $('script[src]').each((_, el) => refs.push(el.attribs.src));
    $('link[href]').each((_, el) => {
      const rel = String(el.attribs.rel ?? '').toLowerCase().split(/\s+/);
      if (rel.includes('modulepreload') || (rel.includes('preload') && String(el.attribs.as ?? '').toLowerCase() === 'script')) refs.push(el.attribs.href);
    });
    const counted = new Set();
    let total = 0;
    for (const src of refs) {
      const r = ctx.toFile(src, file);
      if (r.external || r.invalid || r.special) {
        out.push({ file, detail: `external script ${short(src)} cannot be measured against the JavaScript budget` });
      } else if (!r.file) {
        out.push({ file, detail: `script ${short(src)} not found in public/` });
      } else if (!counted.has(r.file)) {
        counted.add(r.file);
        total += fs.statSync(path.join(ctx.publicDir, r.file)).size;
      }
    }
    if (total > JS_BUDGET_BYTES) {
      out.push({ file, detail: `JavaScript referenced by the home page totals ${total} bytes (budget ${JS_BUDGET_BYTES}): ${[...counted].join(', ')}` });
    }
    let inline = 0;
    $('script:not([src])').each((_, el) => {
      if (JS_TYPES.has(String(el.attribs.type ?? '').trim().toLowerCase())) inline += Buffer.byteLength($(el).text());
    });
    if (inline > INLINE_JS_BUDGET_BYTES) {
      out.push({ file, detail: `inline JavaScript on the home page totals ${inline} bytes (budget ${INLINE_JS_BUDGET_BYTES})` });
    }
  }
  return out;
}

export const RULES = {
  'lang-attr': langAttr,
  hreflang,
  'lang-switch': langSwitch,
  'translation-parity': translationParity,
  'no-plain-contact': noPlainContact,
  'no-third-party': noThirdParty,
  'no-hardcoded-host': noHardcodedHost,
  'img-alt': imgAlt,
  meta,
  og,
  h1,
  landmarks,
  'no-confirm': noConfirm,
  feeds,
  sitemap,
  'js-budget': jsBudget,
};

export const RULE_META = {
  'lang-attr': { scope: 'page', level: 'error' },
  hreflang: { scope: 'page', level: 'error' },
  'lang-switch': { scope: 'page', level: 'error' },
  'translation-parity': { scope: 'site', level: 'error' },
  'no-plain-contact': { scope: 'site', level: 'error' },
  'no-third-party': { scope: 'page', level: 'error' },
  'no-hardcoded-host': { scope: 'site', level: 'error' },
  'img-alt': { scope: 'page', level: 'error' },
  meta: { scope: 'page', level: 'error' },
  og: { scope: 'page', level: 'error' },
  h1: { scope: 'page', level: 'error' },
  landmarks: { scope: 'page', level: 'error' },
  'no-confirm': { scope: 'site', level: 'error' },
  feeds: { scope: 'site', level: 'error' },
  sitemap: { scope: 'site', level: 'warn' },
  'js-budget': { scope: 'site', level: 'error' },
};

// ---------------------------------------------------------------------------------------------
// runner and CLI
// ---------------------------------------------------------------------------------------------

export const formatViolation = (v) => `${v.level.toUpperCase()} ${v.rule} ${v.file}: ${String(v.detail).replace(/\s*\n\s*/g, ' ')}`;

/** Run the rules over a built site. Returns { violations, errors, warnings, pages, files, base }. */
export function check(publicDir, { base, repoRoot, rules } = {}) {
  const ctx = createContext(publicDir, { base, repoRoot });
  const ids = rules ?? Object.keys(RULES);
  const found = [];
  for (const id of ids) {
    const fn = RULES[id];
    const info = RULE_META[id];
    const run = ($, file) => {
      let items;
      try {
        items = fn($, file, ctx) ?? [];
      } catch (err) {
        items = [{ level: 'error', detail: `rule crashed: ${err?.message ?? err}` }];
      }
      for (const item of items) {
        const v = typeof item === 'string' ? { detail: item } : item;
        found.push({ level: v.level ?? info.level, rule: id, file: v.file ?? file ?? '-', detail: v.detail });
      }
    };
    if (info.scope === 'site') run(null, null);
    else for (const page of ctx.pageList) run(page.$, page.file);
  }
  const order = Object.keys(RULES);
  const seen = new Set();
  const violations = found
    .filter((v) => {
      const key = `${v.rule}|${v.file}|${v.detail}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => order.indexOf(a.rule) - order.indexOf(b.rule) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || (a.detail < b.detail ? -1 : a.detail > b.detail ? 1 : 0));
  return {
    violations,
    errors: violations.filter((v) => v.level === 'error').length,
    warnings: violations.filter((v) => v.level === 'warn').length,
    pages: ctx.pageList.length,
    files: ctx.files.length,
    base: ctx.base,
  };
}

const USAGE = 'usage: node scripts/check-site.mjs [publicDir] [--base <url>] [--json]';

export function main(argv = process.argv.slice(2)) {
  let dir = null;
  let base;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '--base') base = argv[++i];
    else if (a.startsWith('--base=')) base = a.slice('--base='.length);
    else if (a === '--help' || a === '-h') {
      process.stdout.write(`${USAGE}\n`);
      return 0;
    } else if (a.startsWith('-') || dir !== null) {
      process.stderr.write(`check-site: unexpected argument "${a}"\n${USAGE}\n`);
      return 2;
    } else dir = a;
  }
  if (base !== undefined) {
    try {
      normalizeBase(base);
    } catch {
      process.stderr.write(`check-site: --base needs an absolute URL\n${USAGE}\n`);
      return 2;
    }
  }
  let res;
  try {
    res = check(dir ?? 'public', { base });
  } catch (err) {
    process.stderr.write(`check-site: ${err.message}\n${USAGE}\n`);
    return 2;
  }
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ publicDir: dir ?? 'public', base: res.base, pages: res.pages, files: res.files, errors: res.errors, warnings: res.warnings, violations: res.violations }, null, 2)}\n`,
    );
  } else {
    if (res.violations.length) process.stdout.write(`${res.violations.map(formatViolation).join('\n')}\n`);
    process.stderr.write(`check-site: ${res.pages} pages, ${res.files} files, base ${res.base}: ${res.errors} error(s), ${res.warnings} warning(s)\n`);
  }
  return res.errors > 0 ? 1 : 0;
}

const sameFile = (a, b) => {
  try {
    const x = fs.realpathSync(a);
    const y = fs.realpathSync(b);
    return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
  } catch {
    return false;
  }
};
if (process.argv[1] && sameFile(process.argv[1], fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
