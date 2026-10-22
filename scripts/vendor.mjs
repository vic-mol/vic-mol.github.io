#!/usr/bin/env node
/**
 * Vendors third-party assets into the repo so the site makes no third-party requests.
 * Run with `npm run vendor` after `npm ci`. Commit the result. Idempotent: a second run
 * rewrites nothing (every output is deterministic and is only written when its bytes change).
 *
 *   1. Fonts       node_modules/@fontsource*  ->  static/fonts/*.woff2, *-OFL.txt, assets/css/fonts.css
 *   2. Font Awesome node_modules/@fortawesome ->  assets/icons/fa/{solid,brands}/<name>.svg + LICENSE.txt
 *                  (only the icons the site uses, found by scanning layouts/, content/ and hugo.toml;
 *                  layouts/partials/icon.html inlines them, so no Font Awesome font or CSS is shipped)
 *   3. Devicon     `npm pack devicon@2.17.0`  ->  assets/icons/devicon/<devicon_name>-<style>.svg + LICENSE
 *   4. OG font     `npm pack @ibm/plex-sans`  ->  assets/fonts/og/IBMPlexSans-SemiBold.ttf + OFL.txt
 *
 * Steps 3 and 4 download tarballs. Each goes into its own new, empty temp directory outside the
 * repo, is checked against a pinned sha512, is read in memory, and only the few files we need are
 * written out. Nothing from a tarball is ever executed.
 *
 * Exit code: 0 on success, 1 on any failure (including devicon icons named in
 * content/<lang>/technical.md that do not exist in devicon, and Font Awesome icon names that
 * have no SVG in the package).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = (...p) => path.join(ROOT, ...p);
const show = (file) => path.relative(ROOT, file).split(path.sep).join('/');

const DEVICON = {
  spec: 'devicon@2.17.0',
  name: 'devicon',
  version: '2.17.0',
  integrity:
    'sha512-2nKUdjobJlmRSaCHa50PGsVq0VDURnq9gVzQoJggsM/NKN0tLhC/Uq2zmy2pH36Q/1q3gvYwp/GjTgv/R0Ysbg==',
};
const PLEX = {
  spec: '@ibm/plex-sans@1.1.0',
  name: '@ibm/plex-sans',
  version: '1.1.0',
  integrity:
    'sha512-WPgvO6Yfj2w5YbhyAr1tv95RUz4LRJlqN+CmYvBglabXteufP1D1E9BABMde+ZIKdRbFJDoKF5eQzfhpnbgZcQ==',
};
const FONTAWESOME_VERSION = '6.7.2';
const FONTAWESOME_PKG = '@fortawesome/fontawesome-free';
const FONTAWESOME_STYLES = ['solid', 'brands'];

let changed = 0;
let total = 0;

/** Writes `data` to `file` only when the bytes differ. Creates parent directories. */
function writeIfChanged(file, data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  total += 1;
  if (fs.existsSync(file) && fs.readFileSync(file).equals(buf)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  changed += 1;
  return true;
}

/** Deletes files in `dir` that match `test` but are not in `keep`, so renamed or removed inputs leave no stale copies. */
function prune(dir, keep, test) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isFile() && test(name) && !keep.has(name)) {
      fs.rmSync(full);
      changed += 1;
      console.log(`  removed stale ${show(full)}`);
    }
  }
}

function readPkgFile(pkg, ...parts) {
  const file = at('node_modules', pkg, ...parts);
  if (!fs.existsSync(file)) {
    throw new Error(`${show(file)} not found. Run "npm ci" first.`);
  }
  return fs.readFileSync(file);
}

function pkgVersion(pkg) {
  return JSON.parse(readPkgFile(pkg, 'package.json').toString('utf8')).version;
}

/* ------------------------------------------------------------------ 1. fonts */

const SUBSETS = ['latin-ext', 'latin']; // latin last: it wins where the unicode-ranges overlap
const FONT_FAMILIES = [
  {
    pkg: '@fontsource-variable/space-grotesk',
    family: 'Space Grotesk Variable',
    prefix: 'space-grotesk',
    cssFiles: ['wght.css'],
    variants: ['wght-normal'],
    licenseOut: 'space-grotesk-OFL.txt',
    licensesName: 'SpaceGrotesk-OFL.txt',
  },
  {
    pkg: '@fontsource/ibm-plex-sans',
    family: 'IBM Plex Sans',
    prefix: 'ibm-plex-sans',
    cssFiles: ['400.css', '400-italic.css', '600.css'],
    variants: ['400-normal', '400-italic', '600-normal'],
    licenseOut: 'ibm-plex-sans-OFL.txt',
    licensesName: null, // LICENSES/IBMPlexSans-OFL.txt comes from the upstream @ibm/plex-sans tarball (step 4)
  },
  {
    pkg: '@fontsource/jetbrains-mono',
    family: 'JetBrains Mono',
    prefix: 'jetbrains-mono',
    cssFiles: ['400.css'],
    variants: ['400-normal'],
    licenseOut: 'jetbrains-mono-OFL.txt',
    licensesName: 'JetBrainsMono-OFL.txt',
  },
];

/** Parses fontsource CSS into Map(comment name -> declarations). */
function parseFontFaces(css) {
  const blocks = new Map();
  const re = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const decls = {};
    for (const part of m[2].split(';')) {
      const i = part.indexOf(':');
      if (i > 0) decls[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    blocks.set(m[1], decls);
  }
  return blocks;
}

function vendorFonts() {
  console.log('Fonts (fontsource) -> static/fonts, assets/css/fonts.css');
  const outDir = at('static', 'fonts');
  const keep = new Set();
  const keepLicenses = new Set();
  const faces = [];
  const versions = [];

  for (const fam of FONT_FAMILIES) {
    const version = pkgVersion(fam.pkg);
    versions.push(`${fam.pkg} ${version}`);
    const blocks = new Map();
    for (const cssFile of fam.cssFiles) {
      const css = readPkgFile(fam.pkg, cssFile).toString('utf8');
      for (const [k, v] of parseFontFaces(css)) blocks.set(k, v);
    }

    for (const variant of fam.variants) {
      for (const subset of SUBSETS) {
        const key = `${fam.prefix}-${subset}-${variant}`;
        const d = blocks.get(key);
        if (!d) throw new Error(`${fam.pkg}: @font-face "${key}" not found in ${fam.cssFiles.join(', ')}`);
        const family = (d['font-family'] ?? '').replace(/^['"]|['"]$/g, '');
        if (family !== fam.family) throw new Error(`${key}: font-family is "${family}", expected "${fam.family}"`);
        if (d['font-display'] !== 'swap') throw new Error(`${key}: font-display is "${d['font-display']}", expected swap`);
        if (!d['unicode-range']) throw new Error(`${key}: no unicode-range`);
        const src = /url\(\.\/files\/([\w.-]+\.woff2)\)\s*format\('(woff2(?:-variations)?)'\)/.exec(d.src ?? '');
        if (!src) throw new Error(`${key}: cannot find a woff2 source in "${d.src}"`);
        const [, file, format] = src;

        writeIfChanged(path.join(outDir, file), readPkgFile(fam.pkg, 'files', file));
        keep.add(file);
        faces.push(
          [
            `/* ${key} */`,
            '@font-face {',
            `  font-family: "${fam.family}";`,
            `  font-style: ${d['font-style']};`,
            `  font-weight: ${d['font-weight']};`,
            '  font-display: swap;',
            `  src: url(/fonts/${file}) format("${format}");`,
            `  unicode-range: ${d['unicode-range']};`,
            '}',
          ].join('\n'),
        );
      }
    }

    writeIfChanged(path.join(outDir, fam.licenseOut), readPkgFile(fam.pkg, 'LICENSE'));
    keepLicenses.add(fam.licenseOut);
    if (fam.licensesName) writeIfChanged(at('LICENSES', fam.licensesName), readPkgFile(fam.pkg, 'LICENSE'));
  }

  prune(outDir, keep, (n) => n.endsWith('.woff2'));
  prune(outDir, keepLicenses, (n) => n.endsWith('-OFL.txt'));

  const header = [
    '/*',
    ' * Generated by scripts/vendor.mjs (npm run vendor). Do not edit.',
    ` * Source: ${versions.join(', ')}.`,
    ' * Fonts are served from /fonts (static/fonts); licenses (SIL OFL 1.1) sit next to them.',
    ' * latin-ext is declared before latin so latin wins where the unicode-ranges overlap.',
    ' */',
  ].join('\n');
  writeIfChanged(at('assets', 'css', 'fonts.css'), `${header}\n\n${faces.join('\n\n')}\n`);

  const woff2Bytes = [...keep].reduce((n, f) => n + fs.statSync(path.join(outDir, f)).size, 0);
  console.log(`  ${keep.size} woff2 files, ${(woff2Bytes / 1024).toFixed(1)} KB; ${faces.length} @font-face rules`);
}

/* ------------------------------------------------------- 2. Font Awesome icons */

/**
 * Icons are inlined as SVG by layouts/partials/icon.html (no webfont, no stylesheet). Only the icons the
 * site uses are copied, from node_modules/@fortawesome/fontawesome-free/svgs/{solid,brands}/, to
 * assets/icons/fa/<style>/<name>.svg. "Used" is decided by scanning, deterministically:
 *   - literal   partial "icon.html" (dict ... "name" "<n>" ... "style" "<s>")   calls in layouts/**;
 *   - the names that templates take from data, listed in DYNAMIC_ICON_CALLS below:
 *       `icon:` in the front matter of content/<lang>/about.md (quick facts) and skills.md (domains),
 *       `icon` of [[params.social]] in hugo.toml (always the brands set), and
 *       `icon:` in content/<lang>/technical.md (the fallback when a skill has no devicon file; style
 *       "auto": the brands set for the names in the $brandIcons list of layouts/partials/icon.html,
 *       which is read from there so the template and this script cannot disagree).
 * A name without a Font Awesome SVG fails the run (exit 1) and the list is printed.
 */

/** Template expressions that carry a name from data. A new one must be added here, with its data source. */
const DYNAMIC_ICON_CALLS = [
  { expr: '$fact.icon', style: 'solid', source: 'about' },
  { expr: '$domain.icon', style: 'solid', source: 'skills' },
  { expr: '.icon', style: 'brands', source: 'social' },
  { expr: '$skill.icon', style: 'auto', source: 'technical' },
];

const ICON_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function listFiles(dir, ext) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, ext));
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

/** Reads the one `$brandIcons := slice "a" "b" ...` line from layouts/partials/icon.html. */
function brandIconNames() {
  const file = at('layouts', 'partials', 'icon.html');
  const text = fs.readFileSync(file, 'utf8');
  const m = /\$brandIcons\s*:=\s*slice((?:\s+"[a-z0-9-]+")+)\s*-?\}\}/.exec(text);
  if (!m) throw new Error(`${show(file)}: cannot find the line {{ $brandIcons := slice "name" ... }}`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/** Splits the inside of a Go-template parenthesis group into top-level tokens: { lit } for strings, { expr } for the rest. */
function tokenizeGroup(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i += 1;
    } else if (c === '"') {
      let j = i + 1;
      let value = '';
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\') j += 1;
        value += src[j];
        j += 1;
      }
      if (j >= src.length) throw new Error(`unterminated string in: ${src}`);
      tokens.push({ lit: value });
      i = j + 1;
    } else if (c === '`') {
      const j = src.indexOf('`', i + 1);
      if (j < 0) throw new Error(`unterminated raw string in: ${src}`);
      tokens.push({ lit: src.slice(i + 1, j) });
      i = j + 1;
    } else if (c === '(') {
      let depth = 0;
      let j = i;
      for (; j < src.length; j += 1) {
        if (src[j] === '"') {
          j += 1;
          while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
        } else if (src[j] === '(') depth += 1;
        else if (src[j] === ')' && --depth === 0) break;
      }
      if (j >= src.length) throw new Error(`unbalanced parenthesis in: ${src}`);
      tokens.push({ expr: src.slice(i, j + 1) });
      i = j + 1;
    } else {
      let j = i;
      while (j < src.length && !/\s/.test(src[j])) j += 1;
      tokens.push({ expr: src.slice(i, j) });
      i = j;
    }
  }
  return tokens;
}

/** Calls of the icon partial in one template: [{ name?: string, expr?: string, style: string, line: number }]. */
function iconCallsIn(file) {
  // Template and HTML comments (the usage notes in icon.html itself) are blanked out, keeping line numbers.
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  const text = fs
    .readFileSync(file, 'utf8')
    .replace(/\{\{-?\s*\/\*[\s\S]*?\*\/\s*-?\}\}/g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank);
  const lineAt = (index) => text.slice(0, index).split('\n').length;
  const where = (index) => `${show(file)}:${lineAt(index)}`;
  if (/partialCached\s+"icon\.html"/.test(text)) {
    throw new Error(`${show(file)}: partialCached "icon.html" is not supported; use partial "icon.html" (dict ...)`);
  }

  const calls = [];
  for (const m of text.matchAll(/\bpartial\s+"icon\.html"/g)) {
    // The argument must be a parenthesised (dict ...) so every key and value can be read here.
    let i = m.index + m[0].length;
    while (/\s/.test(text[i])) i += 1;
    if (text[i] !== '(') throw new Error(`${where(m.index)}: partial "icon.html" must be called with (dict ...) in parentheses`);
    let depth = 0;
    let j = i;
    for (; j < text.length; j += 1) {
      if (text[j] === '"') {
        j += 1;
        while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      } else if (text[j] === '(') depth += 1;
      else if (text[j] === ')' && --depth === 0) break;
    }
    if (j >= text.length) throw new Error(`${where(m.index)}: unbalanced parenthesis after partial "icon.html"`);

    const tokens = tokenizeGroup(text.slice(i + 1, j));
    if (tokens[0]?.expr !== 'dict') throw new Error(`${where(m.index)}: partial "icon.html" must be called with (dict ...)`);
    const pairs = tokens.slice(1);
    if (pairs.length % 2 !== 0) throw new Error(`${where(m.index)}: dict has an odd number of arguments`);
    const args = {};
    for (let k = 0; k < pairs.length; k += 2) {
      if (!('lit' in pairs[k])) throw new Error(`${where(m.index)}: dict keys must be string literals`);
      args[pairs[k].lit] = pairs[k + 1];
    }
    const nameTok = args.name;
    if (!nameTok) throw new Error(`${where(m.index)}: partial "icon.html" has no "name"`);
    const styleTok = args.style ?? { lit: 'solid' };
    if (!('lit' in styleTok)) throw new Error(`${where(m.index)}: "style" must be a string literal ("solid", "brands" or "auto")`);
    if (!['solid', 'brands', 'auto'].includes(styleTok.lit)) {
      throw new Error(`${where(m.index)}: unknown style "${styleTok.lit}" (use solid, brands or auto)`);
    }
    calls.push({
      ...('lit' in nameTok ? { name: nameTok.lit } : { expr: nameTok.expr }),
      style: styleTok.lit,
      at: where(m.index),
    });
  }
  return calls;
}

/** Front matter lines of a content file, without comment lines. */
function frontMatterLines(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!fm) throw new Error(`${show(file)}: no YAML front matter`);
  return fm[1].split('\n').filter((l) => !l.trim().startsWith('#'));
}

/** Every `icon: <value>` key in the front matter (block list entries and one-line { ... } mappings). */
function frontMatterIcons(file) {
  const names = [];
  for (const line of frontMatterLines(file)) {
    for (const m of line.matchAll(/(?:^|[\s{,])icon\s*:\s*(?:"([^"]*)"|'([^']*)'|([\w-]+))/g)) names.push(m[1] ?? m[2] ?? m[3]);
  }
  return names;
}

/** `icon = "<name>"` under [[params.social]] in hugo.toml. */
function socialIcons() {
  const file = at('hugo.toml');
  const names = [];
  let table = '';
  for (const line of fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n')) {
    const header = /^\s*(\[\[?[^\]]+\]\]?)\s*(?:#.*)?$/.exec(line);
    if (header) {
      table = header[1];
      continue;
    }
    const m = /^\s*icon\s*=\s*"([^"]*)"/.exec(line);
    if (!m) continue;
    if (!/^\[\[(?:languages\.\w+\.)?params\.social\]\]$/.test(table)) {
      throw new Error(`${show(file)}: unexpected icon = "${m[1]}" under ${table || 'the top level'}; only [[params.social]] icons are vendored`);
    }
    names.push(m[1]);
  }
  return names;
}

/** Map("style/name" -> Set(where it is used)) for every Font Awesome icon the site needs. */
function requiredFontAwesomeIcons() {
  const needed = new Map();
  const brands = brandIconNames();
  const add = (style, name, source) => {
    if (style === 'auto') style = brands.includes(name) ? 'brands' : 'solid';
    if (!ICON_NAME.test(name)) throw new Error(`${source}: "${name}" is not a Font Awesome icon name (lowercase letters, digits and hyphens, no "fa-" prefix)`);
    const key = `${style}/${name}`;
    if (!needed.has(key)) needed.set(key, new Set());
    needed.get(key).add(source);
  };

  // 1. Templates.
  for (const file of listFiles(at('layouts'), '.html')) {
    for (const call of iconCallsIn(file)) {
      if (call.name !== undefined) {
        add(call.style, call.name, call.at);
      } else {
        if (!DYNAMIC_ICON_CALLS.some((d) => d.expr === call.expr && d.style === call.style)) {
          throw new Error(
            `${call.at}: "name" is the expression ${call.expr} (style "${call.style}"); add it to DYNAMIC_ICON_CALLS in scripts/vendor.mjs ` +
              'with the data file that holds the names, or use a string literal',
          );
        }
      }
    }
  }

  // 2. Names that come from data. Scanned whether or not a template currently uses them.
  const contentDir = at('content');
  const langs = fs.readdirSync(contentDir).filter((n) => fs.statSync(path.join(contentDir, n)).isDirectory());
  const bySource = { about: 'solid', skills: 'solid', technical: 'auto' };
  for (const [source, style] of Object.entries(bySource)) {
    let found = 0;
    for (const lang of langs) {
      const file = path.join(contentDir, lang, `${source}.md`);
      if (!fs.existsSync(file)) continue;
      for (const name of frontMatterIcons(file)) {
        add(style, name, show(file));
        found += 1;
      }
    }
    if (found === 0) throw new Error(`no icon: values found in content/*/${source}.md`);
  }
  for (const name of socialIcons()) add('brands', name, 'hugo.toml');

  return needed;
}

function vendorFontAwesome() {
  console.log(`Font Awesome Free ${FONTAWESOME_VERSION} icons -> assets/icons/fa`);
  const version = pkgVersion(FONTAWESOME_PKG);
  if (version !== FONTAWESOME_VERSION) throw new Error(`${FONTAWESOME_PKG} is ${version}, expected ${FONTAWESOME_VERSION}`);

  const needed = requiredFontAwesomeIcons();
  const keys = [...needed.keys()].sort();
  const icons = new Map();
  const missing = [];
  for (const key of keys) {
    const [style, name] = key.split('/');
    const file = at('node_modules', FONTAWESOME_PKG, 'svgs', style, `${name}.svg`);
    if (!fs.existsSync(file)) {
      missing.push(key);
      console.log(`  MISSING ${key}.svg  (used in: ${[...needed.get(key)].sort().join(', ')})`);
      continue;
    }
    const svg = fs.readFileSync(file);
    const text = svg.toString('utf8');
    if (!/^<svg[\s>]/.test(text) || !/viewBox="[^"]+"/.test(text) || /<script|\son[a-z]+\s*=|javascript:/i.test(text)) {
      throw new Error(`${key}.svg looks unsafe or is not an SVG with a viewBox`);
    }
    if (!text.includes(`Font Awesome Free ${FONTAWESOME_VERSION}`)) throw new Error(`${key}.svg is not from Font Awesome Free ${FONTAWESOME_VERSION}`);
    icons.set(key, svg);
  }
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} Font Awesome icon(s) have no SVG in ${FONTAWESOME_PKG}@${version} (solid or brands): ${missing.join(', ')}. ` +
        'Fix the name (FA 6 free icons only, no "fa-" prefix, aliases such as check-circle need their canonical name circle-check) ' +
        'or the style. For technical.md the brands set is the $brandIcons list in layouts/partials/icon.html.',
    );
  }

  const outDir = at('assets', 'icons', 'fa');
  for (const [key, svg] of icons) writeIfChanged(path.join(outDir, `${key}.svg`), svg);
  for (const style of FONTAWESOME_STYLES) {
    const keep = new Set([...icons.keys()].filter((k) => k.startsWith(`${style}/`)).map((k) => `${k.slice(style.length + 1)}.svg`));
    prune(path.join(outDir, style), keep, (n) => n.endsWith('.svg'));
  }

  // The package license covers fonts, code and icons; only the SVG icons (CC BY 4.0) are used here.
  const note =
    `This project ships only the Font Awesome Free ${FONTAWESOME_VERSION} SVG icons, which are licensed under\n` +
    'CC BY 4.0 (see "Icons" below). They are vendored in assets/icons/fa/{solid,brands}/ by\n' +
    'scripts/vendor.mjs and inlined into the HTML by layouts/partials/icon.html. No Font Awesome font\n' +
    'files, stylesheets or scripts are shipped, so the SIL OFL (fonts) and MIT (code) sections do not\n' +
    'apply to anything published. The attribution comment inside each SVG file is kept in the repository.\n' +
    'The text below is the license file of the package, unchanged.\n' +
    `${'-'.repeat(80)}\n\n`;
  const license = Buffer.concat([Buffer.from(note, 'utf8'), readPkgFile(FONTAWESOME_PKG, 'LICENSE.txt')]);
  writeIfChanged(path.join(outDir, 'LICENSE.txt'), license);
  writeIfChanged(at('LICENSES', 'FontAwesomeFree-License.txt'), license);

  const solid = keys.filter((k) => k.startsWith('solid/')).length;
  console.log(`  ${icons.size} icons (${solid} solid, ${icons.size - solid} brands) + LICENSE.txt`);
}

/* --------------------------------------------------------- tarball plumbing */

function runNpm(args, cwd) {
  const execpath = process.env.npm_execpath;
  const opts = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  let r;
  if (execpath && /npm-cli\.[cm]?js$/.test(execpath)) {
    r = spawnSync(process.execPath, [execpath, ...args], opts);
  } else if (process.platform === 'win32') {
    r = spawnSync('npm.cmd', args, { ...opts, shell: true }); // args are fixed literals
  } else {
    r = spawnSync('npm', args, opts);
  }
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`npm ${args.join(' ')} failed (${r.status}):\n${r.stderr}`);
  return r.stdout;
}

/** Minimal in-memory reader for a gzipped ustar/pax tarball. Returns Map(path without "package/" -> Buffer). */
function readTarball(tgz) {
  const tar = zlib.gunzipSync(tgz);
  const cstr = (b, start, len) => {
    const s = b.subarray(start, start + len);
    const z = s.indexOf(0);
    return s.subarray(0, z === -1 ? len : z).toString('utf8');
  };
  const files = new Map();
  let pax = {};
  let longName = null;
  let off = 0;
  while (off + 512 <= tar.length) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const size = parseInt(cstr(h, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const name = cstr(h, 0, 100);
    const prefix = cstr(h, 345, 155);
    off += 512;
    const data = tar.subarray(off, off + size);
    off += Math.ceil(size / 512) * 512;

    if (type === 'x') {
      pax = {};
      for (const line of data.toString('utf8').split('\n')) {
        const m = /^\d+ ([^=]+)=(.*)$/.exec(line);
        if (m) pax[m[1]] = m[2];
      }
      continue;
    }
    if (type === 'g') continue;
    if (type === 'L') {
      longName = cstr(data, 0, data.length);
      continue;
    }
    const full = pax.path ?? longName ?? (prefix ? `${prefix}/${name}` : name);
    pax = {};
    longName = null;
    if (type === '0' && full.startsWith('package/')) files.set(full.slice('package/'.length), Buffer.from(data));
  }
  return files;
}

/** `npm pack <spec>` in a fresh empty temp dir outside the repo; verifies the pinned integrity; returns the file map. */
function fetchTarball(pkg, tmp) {
  if (!path.relative(ROOT, tmp).startsWith('..')) throw new Error(`temp dir ${tmp} is inside the repo`);
  if (fs.readdirSync(tmp).length !== 0) throw new Error(`temp dir ${tmp} is not empty`);
  runNpm(['pack', pkg.spec, '--ignore-scripts', '--loglevel=error'], tmp);
  const tgzs = fs.readdirSync(tmp).filter((n) => n.endsWith('.tgz'));
  if (tgzs.length !== 1) throw new Error(`npm pack ${pkg.spec}: expected one .tgz in ${tmp}, found ${tgzs.length}`);
  const tgz = fs.readFileSync(path.join(tmp, tgzs[0]));
  const integrity = `sha512-${createHash('sha512').update(tgz).digest('base64')}`;
  if (integrity !== pkg.integrity) {
    throw new Error(`${pkg.spec}: integrity mismatch\n  expected ${pkg.integrity}\n  got      ${integrity}`);
  }
  const files = readTarball(tgz);
  const meta = JSON.parse(files.get('package.json')?.toString('utf8') ?? '{}');
  if (meta.name !== pkg.name || meta.version !== pkg.version) {
    throw new Error(`${pkg.spec}: tarball contains ${meta.name}@${meta.version}`);
  }
  return files;
}

function withTempDir(prefix, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/* ---------------------------------------------------------------- 3. devicon */

/** Icons named in content/<lang>/technical.md front matter: Map("name-style" -> Set(source files)). */
function requiredDeviconIcons() {
  const needed = new Map();
  const contentDir = at('content');
  const langs = fs.readdirSync(contentDir).filter((n) => fs.existsSync(path.join(contentDir, n, 'technical.md')));
  if (langs.length === 0) throw new Error('no content/*/technical.md found');

  for (const lang of langs) {
    const file = path.join(contentDir, lang, 'technical.md');
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const fm = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
    if (!fm) throw new Error(`${show(file)}: no YAML front matter`);
    const lines = fm[1].split('\n').filter((l) => !l.trim().startsWith('#'));

    let seen = 0;
    let parsed = 0;
    for (const line of lines) {
      seen += (line.match(/\bdevicon_name\s*:/g) ?? []).length;
      // Skills are written as one-line YAML flow mappings: - { name: "AWS", devicon_name: "x", devicon_style: "y" }
      for (const m of line.matchAll(/\{([^{}]*)\}/g)) {
        const entry = {};
        for (const pair of m[1].match(/(?:[^,"']|"[^"]*"|'[^']*')+/g) ?? []) {
          const i = pair.indexOf(':');
          if (i < 0) continue;
          entry[pair.slice(0, i).trim()] = pair.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
        }
        if (!('devicon_name' in entry)) continue;
        parsed += 1;
        const name = entry.devicon_name;
        const style = entry.devicon_style || 'original';
        if (!/^[a-z0-9]+$/i.test(name) || !/^[a-z]+(-[a-z]+)*$/.test(style)) {
          throw new Error(`${show(file)}: unexpected devicon_name "${name}" / devicon_style "${style}"`);
        }
        const key = `${name}-${style}`;
        if (!needed.has(key)) needed.set(key, new Set());
        needed.get(key).add(lang);
      }
    }
    if (seen !== parsed) {
      throw new Error(`${show(file)}: ${seen} devicon_name keys but only ${parsed} parsed; use one-line { ... } skill entries`);
    }
  }
  return needed;
}

function vendorDevicon() {
  console.log(`Devicon (${DEVICON.spec}) -> assets/icons/devicon`);
  const needed = requiredDeviconIcons();
  const names = [...needed.keys()].sort();

  const files = withTempDir('vendor-devicon-', (tmp) => fetchTarball(DEVICON, tmp));
  const missing = [];
  const icons = new Map();
  for (const key of names) {
    const [name] = key.split('-', 1);
    const svg = files.get(`icons/${name}/${key}.svg`);
    if (!svg) {
      missing.push(key);
      console.log(`  MISSING ${key}.svg  (used in: ${[...needed.get(key)].sort().join(', ')})`);
      continue;
    }
    const text = svg.toString('utf8');
    if (!/<svg[\s>]/.test(text) || /<script|\son[a-z]+\s*=|javascript:/i.test(text)) {
      throw new Error(`${key}.svg looks unsafe or is not an SVG`);
    }
    icons.set(key, svg);
    console.log(`  ok      ${key}.svg  (${svg.length} bytes)`);
  }
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} devicon icon(s) not found in ${DEVICON.spec}: ${missing.join(', ')}. ` +
        'Fix devicon_name / devicon_style in content/*/technical.md or drop the devicon_name.',
    );
  }

  const outDir = at('assets', 'icons', 'devicon');
  for (const [key, svg] of icons) writeIfChanged(path.join(outDir, `${key}.svg`), svg);
  const license = files.get('LICENSE');
  if (!license) throw new Error('devicon tarball has no LICENSE');
  writeIfChanged(path.join(outDir, 'LICENSE'), license);
  writeIfChanged(at('LICENSES', 'Devicon-MIT.txt'), license);
  prune(outDir, new Set([...icons.keys()].map((k) => `${k}.svg`)), (n) => n.endsWith('.svg'));
  console.log(`  ${icons.size} icons + LICENSE`);
}

/* --------------------------------------------------------------- 4. OG font */

function convertWoff2ToTtf(woff2, ttf, cwd) {
  // recalcTimestamp=False keeps head.modified from the source so the output is byte-for-byte reproducible.
  const code = [
    'import sys',
    'from fontTools.ttLib import TTFont',
    'f = TTFont(sys.argv[1], recalcTimestamp=False)',
    'f.flavor = None',
    'f.save(sys.argv[2])',
  ].join('\n');
  // PYTHONSAFEPATH + an empty temp cwd: nothing next to the downloaded file can shadow a module.
  const env = { ...process.env, PYTHONSAFEPATH: '1' };
  for (const py of [process.env.PYTHON, 'python', 'python3'].filter(Boolean)) {
    const r = spawnSync(py, ['-c', code, woff2, ttf], { cwd, env, encoding: 'utf8' });
    if (r.error && r.error.code === 'ENOENT') continue;
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(`${py} could not convert the font (is fontTools + brotli installed?):\n${r.stderr}`);
    return;
  }
  throw new Error('python not found; install Python 3 with fontTools and brotli (pip install fonttools brotli)');
}

function vendorOgFont() {
  console.log(`OG font (${PLEX.spec}) -> assets/fonts/og`);
  const outDir = at('assets', 'fonts', 'og');
  const result = withTempDir('vendor-plex-', (tmp) => {
    const files = fetchTarball(PLEX, tmp);
    const woff2 = files.get('fonts/complete/woff2/IBMPlexSans-SemiBold.woff2');
    const license = files.get('LICENSE.txt');
    if (!woff2 || !license) throw new Error(`${PLEX.spec}: SemiBold woff2 or LICENSE.txt missing from the tarball`);

    // The tarball extraction dir (tmp) holds the .tgz only; the conversion works in its own empty sibling dir.
    return withTempDir('vendor-plex-convert-', (work) => {
      const input = path.join(work, 'in.woff2');
      const output = path.join(work, 'out.ttf');
      fs.writeFileSync(input, woff2);
      convertWoff2ToTtf(input, output, work);
      return { ttf: fs.readFileSync(output), license };
    });
  });
  writeIfChanged(path.join(outDir, 'IBMPlexSans-SemiBold.ttf'), result.ttf);
  writeIfChanged(path.join(outDir, 'OFL.txt'), result.license);
  writeIfChanged(at('LICENSES', 'IBMPlexSans-OFL.txt'), result.license);
  console.log(`  IBMPlexSans-SemiBold.ttf (${(result.ttf.length / 1024).toFixed(1)} KB) + OFL.txt`);
}

/* ---------------------------------------------------------------------- main */

try {
  vendorFonts();
  vendorFontAwesome();
  vendorDevicon();
  vendorOgFont();
  console.log(`Done: ${total} files checked, ${changed} written or removed.`);
} catch (err) {
  console.error(`\nvendor failed: ${err.message}`);
  process.exit(1);
}
