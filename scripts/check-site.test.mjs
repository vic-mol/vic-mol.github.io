// Self-tests for scripts/check-site.mjs.   Run: node --test scripts/check-site.test.mjs
//
// How the fixtures work
//   scripts/fixtures/good/ is a tiny, complete, passing site:
//     public/   the "built" site (two languages, translated + untranslated pages, feeds, sitemaps,
//               a bilingual 404, a redirect stub)
//     layouts/, assets/   the repo-side files that `no-hardcoded-host` scans
//   Every test copies it to a temp dir, applies ONE mutation, runs the checker and asserts that the
//   mutated rule fires (exactly the expected number of times) and that no other rule does.
//
// The repo must never contain the owner's plain contact details or the pending-decision marker, so
// those two violations are generated at run time (string concatenation, from the checker's own
// pattern list) and only ever written to a temp dir.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import * as checker from './check-site.mjs';
import { check, RULES, RULE_META, CONTACT_PATTERNS, formatViolation } from './check-site.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECKER = path.join(HERE, 'check-site.mjs');
const GOOD = path.join(HERE, 'fixtures', 'good');
const BASE = 'https://fixture.test/';

const RULE_IDS = [
  'lang-attr',
  'hreflang',
  'lang-switch',
  'translation-parity',
  'no-plain-contact',
  'no-third-party',
  'no-hardcoded-host',
  'img-alt',
  'meta',
  'og',
  'h1',
  'landmarks',
  'no-confirm',
  'feeds',
  'sitemap',
  'js-budget',
];

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

const tmpRoots = [];
process.on('exit', () => {
  for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true });
});

/** Copy the good fixture to a temp dir and return helpers to mutate it. */
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-site-'));
  tmpRoots.push(root);
  fs.cpSync(GOOD, root, { recursive: true });
  // a Windows checkout with core.autocrlf turns the fixtures into CRLF; the mutations match on LF
  for (const f of fs.readdirSync(root, { recursive: true })) {
    const abs = path.join(root, f);
    if (!fs.statSync(abs).isFile() || /\.(png|jpe?g)$/i.test(f)) continue;
    const s = fs.readFileSync(abs, 'utf8');
    if (s.includes('\r\n')) fs.writeFileSync(abs, s.replace(/\r\n/g, '\n'));
  }
  const pub = path.join(root, 'public');
  const sb = {
    root,
    pub,
    read: (rel) => fs.readFileSync(path.join(pub, rel), 'utf8'),
    write(rel, content) {
      fs.mkdirSync(path.dirname(path.join(pub, rel)), { recursive: true });
      fs.writeFileSync(path.join(pub, rel), content);
    },
    /** Replace the first occurrence of `from`; fail loudly if the fixture drifted. */
    edit(rel, from, to) {
      const s = sb.read(rel);
      assert.ok(s.includes(from), `fixture drift: ${rel} does not contain ${JSON.stringify(from)}`);
      sb.write(rel, s.replace(from, () => to));
    },
    /** Replace every occurrence of `from`. */
    editAll(rel, from, to) {
      const s = sb.read(rel);
      assert.ok(s.includes(from), `fixture drift: ${rel} does not contain ${JSON.stringify(from)}`);
      sb.write(rel, s.split(from).join(to));
    },
    remove: (rel) => fs.rmSync(path.join(pub, rel)),
    repoWrite(rel, content) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), content);
    },
    repoRead: (rel) => fs.readFileSync(path.join(root, rel), 'utf8'),
    run: (opts) => check(pub, opts),
  };
  return sb;
}

const urlOfFile = (file) => BASE + file.replace(/index\.html$/, '');

/**
 * Add a page by cloning an existing one: swap the URL, drop its hreflang/og:locale:alternate lines
 * (the clone has no translation), point the switcher at `switchTo`, and list it in a sitemap.
 */
function clonePage(sb, from, to, { switchTo, sitemap }) {
  let html = sb.read(from);
  html = html.split(urlOfFile(from)).join(urlOfFile(to));
  html = html
    .split('\n')
    .filter((l) => !/rel="alternate" hreflang=/.test(l) && !/og:locale:alternate/.test(l))
    .map((l) => (l.includes('data-lang-switch') ? l.replace(/href="[^"]*" hreflang/, `href="${switchTo}" hreflang`) : l))
    .join('\n');
  sb.write(to, html);
  sb.edit(sitemap, '</urlset>', `<url><loc>${urlOfFile(to)}</loc></url>\n</urlset>`);
}

const byRule = (res, id) => res.violations.filter((v) => v.rule === id);
const summary = (res) => res.violations.map(formatViolation).join('\n');

/**
 * Mutate a fresh copy of the good site, run the checker, and assert that `rule` fires `count`
 * times (matching `detail`) at `level` and that nothing else does (except `also` rule ids).
 */
function expectViolation(name, rule, mutate, { detail, level = 'error', count = 1, file, also = [], opts } = {}) {
  test(`${rule}: ${name}`, () => {
    const sb = sandbox();
    mutate(sb);
    const res = sb.run(opts);
    const mine = byRule(res, rule);
    assert.equal(mine.length, count, `expected ${count} "${rule}" violation(s):\n${summary(res)}`);
    for (const v of mine) {
      assert.equal(v.level, level, `level of: ${formatViolation(v)}`);
      if (detail) assert.match(v.detail, detail);
      if (file) assert.equal(v.file, file);
    }
    const stray = res.violations.filter((v) => v.rule !== rule && !also.includes(v.rule));
    assert.deepEqual(stray.map(formatViolation), [], 'no other rule may fire');
  });
}

const covered = new Set();
function rule(id, fn) {
  covered.add(id);
  describe(id, fn);
}
const expect = (id) => (name, mutate, o) => expectViolation(name, id, mutate, o);

/** A string that matches contact pattern `p`, built from the checker's own pattern list. */
const sampleFor = (p) => 'x ' + p.source.replace(/\\s\?/g, ' ').replace(/\\\./g, '.') + ' x';

// ---------------------------------------------------------------------------------------------
// the good fixture and the module contract
// ---------------------------------------------------------------------------------------------

describe('contract', () => {
  test('the good fixture passes every rule (no violations at all)', () => {
    const res = check(path.join(GOOD, 'public'));
    assert.deepEqual(res.violations.map(formatViolation), []);
    assert.equal(res.errors, 0);
    assert.equal(res.warnings, 0);
  });

  test('the good fixture also passes when --base is given explicitly', () => {
    const res = check(path.join(GOOD, 'public'), { base: BASE });
    assert.deepEqual(res.violations.map(formatViolation), []);
  });

  test('exactly the 16 fixed rule ids exist, each one an exported function', () => {
    assert.deepEqual(Object.keys(RULES).sort(), [...RULE_IDS].sort());
    for (const id of RULE_IDS) {
      const exportName = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      assert.equal(typeof checker[exportName], 'function', `export ${exportName}`);
      assert.equal(RULES[id], checker[exportName], `RULES["${id}"] is the exported ${exportName}`);
      assert.ok(['page', 'site'].includes(RULE_META[id].scope));
      assert.ok(['error', 'warn'].includes(RULE_META[id].level));
    }
  });

  test('every rule has at least one violating variant in this file', () => {
    // evaluated after all describe() blocks have registered their rule ids
    assert.deepEqual([...covered].sort(), [...RULE_IDS].sort());
  });
});

// ---------------------------------------------------------------------------------------------
// rules
// ---------------------------------------------------------------------------------------------

rule('lang-attr', () => {
  const it = expect('lang-attr');
  it('Spanish page declared as English', (sb) => sb.edit('es/projects/index.html', '<html lang="es-MX">', '<html lang="en-US">'), {
    detail: /expected lang "es".*lang="en-US"/,
    file: 'es/projects/index.html',
  });
  it('English page declared as Spanish', (sb) => sb.edit('projects/index.html', '<html lang="en-US">', '<html lang="es">'), {
    detail: /expected lang "en".*lang="es"/,
    file: 'projects/index.html',
  });
  it('missing lang attribute', (sb) => sb.edit('gallery/index.html', '<html lang="en-US">', '<html>'), { detail: /no lang attribute/ });
  it('the bilingual root 404 must still declare some lang', (sb) => sb.edit('404.html', '<html lang="en-US">', '<html>'), {
    detail: /no lang attribute/,
    file: '404.html',
  });
  test('the bilingual root 404 is exempt from the language match', () => {
    const sb = sandbox();
    sb.edit('404.html', '<html lang="en-US">', '<html lang="es-MX">');
    assert.deepEqual(sb.run().violations.map(formatViolation), []);
  });
  test('en and es-MX style tags are accepted, en-US prefix is not confused with "es"', () => {
    const sb = sandbox();
    sb.edit('es/projects/index.html', '<html lang="es-MX">', '<html lang="ES">');
    sb.edit('projects/index.html', '<html lang="en-US">', '<html lang="en">');
    assert.deepEqual(sb.run().violations.map(formatViolation), []);
  });
});

rule('hreflang', () => {
  const it = expect('hreflang');
  const P = 'projects/index.html';
  it('missing x-default', (sb) => sb.edit(P, '<link rel="alternate" hreflang="x-default" href="https://fixture.test/projects/">\n', ''), {
    detail: /missing.*hreflang="x-default"/,
    file: P,
  });
  it('translated page without any hreflang (what the stock theme does)', (sb) => {
    sb.write(P, sb.read(P).split('\n').filter((l) => !/rel="alternate" hreflang=/.test(l)).join('\n'));
  }, { count: 4, detail: /missing.*hreflang="(en|es|x-default)"|not reciprocal/ }); // 3 missing here + the twin no longer has a page linking back
  it('relative href', (sb) => sb.edit(P, 'hreflang="es" href="https://fixture.test/es/projects/"', 'hreflang="es" href="/es/projects/"'), {
    detail: /not absolute/,
    file: P,
  });
  it('target does not exist', (sb) => {
    sb.edit(P, 'hreflang="es" href="https://fixture.test/es/projects/"', 'hreflang="es" href="https://fixture.test/es/projects/nope/"');
    // the Spanish page now has no English page linking to it: that is the lang-switch/parity story,
    // but hreflang also reports that the pair is no longer reciprocal
  }, { count: 2, detail: /not found in public|not reciprocal/ });
  it('not reciprocal (English alternate of the Spanish page points to the home page)', (sb) =>
    sb.edit('es/projects/index.html', 'hreflang="en" href="https://fixture.test/projects/"', 'hreflang="en" href="https://fixture.test/"'), {
    detail: /not reciprocal/,
    file: 'es/projects/index.html',
  });
  it('x-default must be the English page', (sb) =>
    sb.edit(P, 'hreflang="x-default" href="https://fixture.test/projects/"', 'hreflang="x-default" href="https://fixture.test/es/projects/"'), {
    detail: /x-default.*English/,
    file: P,
  });
  it('the alternate for the current language must point at the page itself', (sb) =>
    sb.edit(P, 'hreflang="en" href="https://fixture.test/projects/"', 'hreflang="en" href="https://fixture.test/projects/alpha/"'), {
    count: 2,
    detail: /itself|self|reciprocal/,
  });
  it('hreflang pointing at the wrong language', (sb) =>
    sb.edit(P, 'hreflang="es" href="https://fixture.test/es/projects/"', 'hreflang="es" href="https://fixture.test/projects/alpha/"'), {
    count: 3,
    detail: /Spanish|reciprocal|English/,
  });
  test('untranslated pages need no hreflang, and posts with different slugs are matched through hreflang', () => {
    const res = check(path.join(GOOD, 'public'));
    assert.equal(byRule(res, 'hreflang').length, 0);
  });
  test('pager pages (page 2 of both blogs) need no hreflang and are not each other\'s translation', () => {
    const sb = sandbox();
    // what the templates write for page 2: self canonical, no hreflang, switcher to the other blog's index
    clonePage(sb, 'posts/index.html', 'posts/page/2/index.html', { switchTo: '/es/posts/', sitemap: 'en/sitemap.xml' });
    clonePage(sb, 'es/posts/index.html', 'es/posts/page/2/index.html', { switchTo: '/posts/', sitemap: 'es/sitemap.xml' });
    const res = sb.run();
    assert.equal(res.violations.length, 0, summary(res));
  });
});

rule('lang-switch', () => {
  const it = expect('lang-switch');
  const P = 'projects/index.html';
  it('no [data-lang-switch] at all (what the stock theme does)', (sb) => sb.editAll(P, ' data-lang-switch="es"', ''), {
    detail: /found 0/,
    file: P,
  });
  it('two navs carry a switcher', (sb) =>
    sb.edit(P, '</header>', '<nav aria-label="Again"><a href="/es/projects/" data-lang-switch="es">ES</a></nav>\n</header>'), {
    detail: /found 2/,
  });
  it('switcher target does not exist', (sb) => sb.edit(P, 'href="/es/projects/" hreflang="es"', 'href="/es/projects/nope/" hreflang="es"'), {
    detail: /does not exist/,
    file: P,
  });
  it('switcher on a translated page does not target the translation', (sb) =>
    sb.edit(P, 'href="/es/projects/" hreflang="es"', 'href="/es/" hreflang="es"'), {
    detail: /translation.*es\/projects\/index\.html.*es\/index\.html/,
    file: P,
  });
  it('switcher points at the current language', (sb) =>
    sb.edit(P, 'hreflang="es" lang="es" data-lang-switch="es"', 'hreflang="en" lang="en" data-lang-switch="en"'), {
    detail: /own language|current language/,
    file: P,
  });
  it('switcher element is not a link', (sb) => sb.edit(P, '<a href="/es/projects/" hreflang="es"', '<span hreflang="es"'), {
    detail: /not a link/,
    file: P,
  });
  it('untranslated page whose switcher goes to the other language home is allowed to fall back, but not to a missing page', (sb) =>
    sb.edit('tags/security/index.html', 'href="/es/tags/" hreflang', 'href="/es/tags/security/" hreflang'), {
    detail: /does not exist/,
    file: 'tags/security/index.html',
  });
  test('an untranslated page may send the switcher to the other language tag index or home', () => {
    const sb = sandbox();
    sb.edit('tags/security/index.html', 'href="/es/tags/" hreflang', 'href="/es/" hreflang');
    assert.deepEqual(sb.run().violations.map(formatViolation), []);
  });
  test('absolute switcher URLs are resolved against the base', () => {
    const sb = sandbox();
    sb.edit(P, 'href="/es/projects/" hreflang', 'href="https://fixture.test/es/projects/#top" hreflang');
    assert.deepEqual(sb.run().violations.map(formatViolation), []);
  });
});

rule('translation-parity', () => {
  const it = expect('translation-parity');
  it('English project without a Spanish twin', (sb) =>
    clonePage(sb, 'projects/alpha/index.html', 'projects/beta/index.html', { switchTo: '/es/projects/', sitemap: 'en/sitemap.xml' }), {
    detail: /Spanish twin/,
    file: 'projects/beta/index.html',
  });
  it('Spanish project without an English twin', (sb) =>
    clonePage(sb, 'es/projects/alpha/index.html', 'es/projects/beta/index.html', { switchTo: '/projects/', sitemap: 'es/sitemap.xml' }), {
    detail: /English twin/,
    file: 'es/projects/beta/index.html',
  });
  it('gallery page without a twin', (sb) =>
    clonePage(sb, 'gallery/index.html', 'gallery/extra/index.html', { switchTo: '/es/gallery/', sitemap: 'en/sitemap.xml' }), {
    detail: /Spanish twin/,
  });
  it('a post that exists in one language only is a warning, not an error', (sb) =>
    clonePage(sb, 'es/posts/hola/index.html', 'es/posts/solo/index.html', { switchTo: '/posts/', sitemap: 'es/sitemap.xml' }), {
    level: 'warn',
    detail: /English twin/,
    file: 'es/posts/solo/index.html',
  });
  test('a post pair with different slugs counts as a pair (matched through hreflang and the sitemap)', () => {
    assert.equal(byRule(check(path.join(GOOD, 'public')), 'translation-parity').length, 0);
  });
  test('pages outside projects/, gallery/ and posts/ are not subject to the rule', () => {
    const sb = sandbox();
    clonePage(sb, 'tags/python/index.html', 'tags/other/index.html', { switchTo: '/es/tags/', sitemap: 'en/sitemap.xml' });
    assert.equal(byRule(sb.run(), 'translation-parity').length, 0);
  });
});

rule('no-plain-contact', () => {
  const it = expect('no-plain-contact');
  // obviously fake address assembled at run time; the real patterns are tested below
  it('a fake mailbox on a consumer-mail domain in robots.txt', (sb) => sb.write('robots.txt', sb.read('robots.txt') + '# write to someone@gm' + 'ail.com\n'), {
    detail: /plain contact detail/,
    file: 'robots.txt',
  });
  for (const p of CONTACT_PATTERNS) {
    it(`pattern "${p.label}" matches in a JS file`, (sb) => sb.write('js/site.js', sb.read('js/site.js') + `/*${sampleFor(p)}*/\n`), {
      file: 'js/site.js',
      detail: /plain contact detail/,
    });
  }
  it('in HTML text', (sb) => sb.edit('index.html', '<h1>Home</h1>', '<h1>Home</h1><p>' + sampleFor(CONTACT_PATTERNS[0]) + '</p>'), { file: 'index.html' });
  it('in CSS', (sb) => sb.write('css/site.css', sb.read('css/site.css') + `/*${sampleFor(CONTACT_PATTERNS[1])}*/\n`), { file: 'css/site.css' });
  it('in a feed', (sb) =>
    sb.edit('es/index.xml', '<generator>Hugo</generator>', '<generator>Hugo</generator><managingEditor>' + sampleFor(CONTACT_PATTERNS[0]) + '</managingEditor>'), {
    file: 'es/index.xml',
  });
  it('matches case-insensitively', (sb) => sb.write('robots.txt', sb.read('robots.txt') + sampleFor(CONTACT_PATTERNS[0]).toUpperCase() + '\n'), {
    file: 'robots.txt',
  });
  test('the report never echoes the matched text (CI logs and the baseline file must stay clean)', () => {
    const sb = sandbox();
    const sample = sampleFor(CONTACT_PATTERNS[0]).trim();
    sb.write('robots.txt', sb.read('robots.txt') + sample + '\n');
    const res = sb.run();
    assert.equal(byRule(res, 'no-plain-contact').length, 1);
    assert.ok(!summary(res).includes(sample), 'the output must not contain the contact detail');
  });
  test('binary files are skipped (a PNG that happens to contain the bytes is not scanned as text)', () => {
    const sb = sandbox();
    sb.write('images/blob.bin', Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(sampleFor(CONTACT_PATTERNS[0]))]));
    assert.equal(byRule(sb.run(), 'no-plain-contact').length, 0);
  });
});

rule('no-third-party', () => {
  const it = expect('no-third-party');
  const hosts = {
    'fonts.googleapis': 'https://fonts.googleapis.com/css2?family=Inter',
    'fonts.gstatic': 'https://fonts.gstatic.com/s/inter/v1/x.woff2',
    cdnjs: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    jsdelivr: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/devicon.min.css',
    unpkg: 'https://unpkg.com/x@1/x.js',
    pexels: 'https://images.pexels.com/photos/1/x.jpeg',
    calendly: 'https://assets.calendly.com/assets/external/widget.js',
    formspree: 'https://formspree.io/f/abc',
    googletagmanager: 'https://www.googletagmanager.com/gtag/js?id=G-X',
  };
  for (const [token, url] of Object.entries(hosts)) {
    it(`${token} in <link href>`, (sb) => sb.edit('index.html', '</head>', `<link rel="preconnect" href="${url}">\n</head>`), {
      detail: new RegExp(token.replace('.', '\\.')),
      file: 'index.html',
    });
  }
  it('script src (also counted by js-budget: an unmeasurable external script)', (sb) =>
    sb.edit('index.html', '</head>', '<script defer src="https://cdnjs.cloudflare.com/x.js"></script>\n</head>'), {
    also: ['js-budget'],
    detail: /cdnjs/,
  });
  it('img src', (sb) => sb.edit('gallery/index.html', '<h1>Gallery</h1>', '<h1>Gallery</h1><img src="https://images.pexels.com/a.jpg" alt="x" width="1" height="1">'), { detail: /pexels/ });
  it('form action', (sb) => sb.edit('index.html', '<h1>Home</h1>', '<h1>Home</h1><form action="https://formspree.io/f/x"></form>'), { detail: /formspree/ });
  it('protocol-relative URL', (sb) => sb.edit('index.html', '</head>', '<link rel="stylesheet" href="//cdn.jsdelivr.net/x.css">\n</head>'), { detail: /jsdelivr/ });
  it('srcset candidate', (sb) =>
    sb.edit('gallery/index.html', '<h1>Gallery</h1>', '<h1>Gallery</h1><img srcset="/a.jpg 1x, https://images.pexels.com/b.jpg 2x" alt="x" width="1" height="1">'), {
    detail: /pexels/,
  });
  it('@import in an inline <style>', (sb) =>
    sb.edit('index.html', '</head>', '<style>@import url("https://fonts.googleapis.com/css2?family=X");</style>\n</head>'), { detail: /googleapis/ });
  it('@import inside a linked local stylesheet (reported once, on the CSS file)', (sb) =>
    sb.write('css/site.css', '@import url("https://fonts.googleapis.com/css2?family=X");\n' + sb.read('css/site.css')), {
    detail: /googleapis/,
    file: 'css/site.css',
  });
  it('url() in a linked local stylesheet', (sb) => sb.write('css/site.css', sb.read('css/site.css') + '.x{background:url(https://images.pexels.com/x.jpg)}\n'), {
    detail: /pexels/,
    file: 'css/site.css',
  });
  test('ordinary outbound links (LinkedIn, GitHub) are fine', () => {
    assert.equal(byRule(check(path.join(GOOD, 'public')), 'no-third-party').length, 0);
  });
});

rule('no-hardcoded-host', () => {
  const it = expect('no-hardcoded-host');
  it('in a layout', (sb) => sb.repoWrite('layouts/partials/head.html', sb.repoRead('layouts/partials/head.html') + '<link rel="canonical" href="https://vic-mol.github.io/">\n'), {
    detail: /hard-coded/,
    file: 'layouts/partials/head.html',
  });
  it('in an asset (css)', (sb) => sb.repoWrite('assets/css/site.css', '.x{background:url(https://vic-mol.github.io/a.png)}\n'), { file: 'assets/css/site.css' });
  it('in an asset (js), case-insensitive', (sb) => sb.repoWrite('assets/js/site.js', 'const u = "https://Vic-Mol.GitHub.io/";\n'), { file: 'assets/js/site.js' });
  test('the host in public/ or elsewhere in the repo is not this rule\'s business', () => {
    const sb = sandbox();
    sb.write('index.html', sb.read('index.html').replace('</main>', '<p>vic-mol.github.io</p></main>'));
    sb.repoWrite('README.md', 'vic-mol.github.io\n');
    sb.repoWrite('scripts/x.mjs', '// vic-mol.github.io\n');
    assert.equal(byRule(sb.run(), 'no-hardcoded-host').length, 0);
  });
  test('the repo root is derived from <publicDir>/..', () => {
    const sb = sandbox();
    sb.repoWrite('layouts/x.html', 'vic-mol.github.io');
    const res = check(sb.pub, { repoRoot: undefined });
    assert.equal(byRule(res, 'no-hardcoded-host').length, 1);
  });
});

rule('img-alt', () => {
  const it = expect('img-alt');
  const G = 'gallery/index.html';
  it('missing alt attribute', (sb) => sb.edit(G, 'alt="A one pixel fixture picture" ', ''), { detail: /no alt attribute/, file: G });
  it('empty alt on an image that is not marked decorative', (sb) => sb.edit(G, 'alt="" role="presentation" ', 'alt="" '), {
    detail: /empty alt.*not marked decorative/,
    file: G,
  });
  it('missing width', (sb) => sb.edit(G, 'alt="A one pixel fixture picture" width="1200" ', 'alt="A one pixel fixture picture" '), { detail: /width/, file: G });
  it('missing height', (sb) => sb.edit(G, 'width="1200" height="630"><figcaption>', 'width="1200"><figcaption>'), { detail: /height/, file: G });
  it('non-numeric dimensions', (sb) => sb.edit(G, 'width="1200" height="630"><figcaption>', 'width="100%" height="630"><figcaption>'), { detail: /width/, file: G });
  it('empty alt inside aria-hidden is accepted but an image outside is not', (sb) =>
    sb.edit(G, '<li><div aria-hidden="true"><img src="/images/og-en.png" alt="" width="1200" height="630"></div></li>', '<li><div><img src="/images/og-en.png" alt="" width="1200" height="630"></div></li>'), {
    detail: /not marked decorative/,
  });
  test('decorative markers: aria-hidden ancestor or self, role=presentation/none, data-decorative', () => {
    const sb = sandbox();
    sb.edit(G, '</ul>', [
      '<li><img src="/images/og-en.png" alt="" aria-hidden="true" width="1" height="1"></li>',
      '<li><img src="/images/og-en.png" alt="" role="none" width="1" height="1"></li>',
      '<li><img src="/images/og-en.png" alt="" data-decorative width="1" height="1"></li>',
      '<li><picture data-decorative="true"><img src="/images/og-en.png" alt="" width="1" height="1"></picture></li>',
      '</ul>',
    ].join('\n'));
    assert.equal(byRule(sb.run(), 'img-alt').length, 0);
  });
  test('images inside <noscript> are not parsed as images (no crash, no false positive)', () => {
    const sb = sandbox();
    sb.edit(G, '</main>', '<noscript><img src="/a.png"></noscript></main>');
    assert.equal(byRule(sb.run(), 'img-alt').length, 0);
  });
});

rule('meta', () => {
  const it = expect('meta');
  const P = 'projects/index.html';
  const DESC = (s) => `<meta name="description" content="${s}">`;
  const CUR = DESC('Fixture page: Projects. Used by the site checker self-tests (English version).');
  it('two <title> elements', (sb) => sb.edit(P, '</head>', '<title>Again</title>\n</head>'), { detail: /exactly one <title>.*2/ });
  it('no <title>', (sb) => sb.edit(P, '<title>Projects | Fixture Site</title>\n', ''), { detail: /exactly one <title>.*0/ });
  it('empty <title>', (sb) => sb.edit(P, '<title>Projects | Fixture Site</title>', '<title> </title>'), { detail: /empty/ });
  it('description shorter than 50 characters', (sb) => sb.edit(P, CUR, DESC('Too short.')), { detail: /10 characters.*50-160/ });
  it('description longer than 160 characters', (sb) => sb.edit(P, CUR, DESC('x'.repeat(161))), { detail: /161 characters.*50-160/ });
  test('description limits are inclusive (50 and 160) and count characters, not bytes', () => {
    const sb = sandbox();
    sb.edit(P, CUR, DESC('a'.repeat(50)));
    sb.edit('es/projects/index.html', DESC('Página de prueba: Proyectos. Usada por las autopruebas del verificador (versión en español).'), DESC('é'.repeat(160)));
    assert.equal(byRule(sb.run(), 'meta').length, 0);
  });
  it('missing description', (sb) => sb.edit(P, CUR + '\n', ''), { detail: /description/ });
  it('canonical is relative', (sb) => sb.edit(P, '<link rel="canonical" href="https://fixture.test/projects/">', '<link rel="canonical" href="/projects/">'), {
    detail: /canonical.*not absolute/,
  });
  it('canonical missing', (sb) => sb.edit(P, '<link rel="canonical" href="https://fixture.test/projects/">\n', ''), { detail: /canonical/ });
  it('canonical on another host than the base', (sb) =>
    sb.edit(P, '<link rel="canonical" href="https://fixture.test/projects/">', '<link rel="canonical" href="https://elsewhere.test/projects/">'), {
    detail: /canonical.*base/,
  });
});

rule('og', () => {
  const it = expect('og');
  const P = 'projects/index.html';
  const remove = (needle) => (sb) => sb.edit(P, needle + '\n', '');
  it('missing og:title', remove('<meta property="og:title" content="Projects">'), { detail: /missing og:title/ });
  it('missing og:description', remove('<meta property="og:description" content="Fixture page: Projects. Used by the site checker self-tests (English version).">'), { detail: /missing og:description/ });
  it('missing og:url', remove('<meta property="og:url" content="https://fixture.test/projects/">'), { detail: /missing og:url/ });
  it('missing og:image', remove('<meta property="og:image" content="https://fixture.test/images/og-en.png">'), { detail: /missing og:image/, also: [] });
  it('missing og:image:width', remove('<meta property="og:image:width" content="1200">'), { detail: /og:image:width/ });
  it('missing og:image:height', remove('<meta property="og:image:height" content="630">'), { detail: /og:image:height/ });
  it('missing og:locale', remove('<meta property="og:locale" content="en_US">'), { detail: /og:locale/ });
  it('missing twitter:card', remove('<meta name="twitter:card" content="summary_large_image">'), { detail: /twitter:card/ });
  it('translated page without og:locale:alternate', remove('<meta property="og:locale:alternate" content="es_MX">'), { detail: /og:locale:alternate.*es_MX/ });
  it('wrong og:image dimensions', (sb) => sb.edit(P, 'content="1200"', 'content="1201"'), { detail: /og:image:width.*1201.*1200/ });
  it('og:image file does not exist in public/', (sb) =>
    sb.edit(P, 'content="https://fixture.test/images/og-en.png"', 'content="https://fixture.test/images/missing.png"'), {
    detail: /not found in public.*images\/missing\.png/,
  });
  it('og:image is relative', (sb) => sb.edit(P, 'content="https://fixture.test/images/og-en.png"', 'content="/images/og-en.png"'), { detail: /og:image.*not absolute/ });
  it('og:url is relative', (sb) => sb.edit(P, 'property="og:url" content="https://fixture.test/projects/"', 'property="og:url" content="/projects/"'), {
    detail: /og:url.*not absolute/,
  });
  it('og:locale does not match the page language', (sb) => sb.edit('es/projects/index.html', 'property="og:locale" content="es_MX"', 'property="og:locale" content="en_US"'), {
    detail: /es_MX/,
    file: 'es/projects/index.html',
  });
  it('og:locale not one of en_US / es_MX', (sb) => sb.edit(P, 'property="og:locale" content="en_US"', 'property="og:locale" content="en-US"'), { detail: /en_US/ });
  it('og:image on another host than the base', (sb) =>
    sb.edit(P, 'content="https://fixture.test/images/og-en.png"', 'content="https://elsewhere.test/images/og-en.png"'), {
    detail: /base/,
  });
  test('untranslated pages need no og:locale:alternate', () => {
    assert.equal(byRule(check(path.join(GOOD, 'public')), 'og').length, 0);
  });
});

rule('h1', () => {
  const it = expect('h1');
  it('no <h1>', (sb) => sb.edit('projects/index.html', '<h1>Projects</h1>', '<h2>Projects</h2>'), { detail: /exactly one <h1>.*0/ });
  it('two <h1>', (sb) => sb.edit('projects/index.html', '<h1>Projects</h1>', '<h1>Projects</h1><h1>More</h1>'), { detail: /exactly one <h1>.*2/ });
});

rule('landmarks', () => {
  const it = expect('landmarks');
  const P = 'projects/index.html';
  it('<main> without id="main"', (sb) => sb.edit(P, '<main id="main">', '<main>'), { detail: /id="main"/ });
  it('<main> with another id', (sb) => sb.edit(P, '<main id="main">', '<main id="content">'), { detail: /id="main"/ });
  it('no <main>', (sb) => {
    sb.edit(P, '<main id="main">', '<div id="main">');
    sb.edit(P, '</main>', '</div>');
  }, { detail: /exactly one <main>.*0/ });
  it('two <main>', (sb) => sb.edit(P, '</main>', '</main><main></main>'), { detail: /exactly one <main>.*2/ });
  it('no skip link', (sb) => sb.edit(P, '<a class="skip" href="#main">Skip to content</a>\n', ''), { detail: /first focusable.*skip link/ });
  it('skip link points somewhere else', (sb) => sb.edit(P, '<a class="skip" href="#main">', '<a class="skip" href="#content">'), { detail: /first focusable/ });
  it('skip link is not the first focusable element', (sb) => sb.edit(P, '<a class="skip"', '<button type="button">Menu</button><a class="skip"'), {
    detail: /first focusable.*<button/,
  });
  it('<nav> without aria-label', (sb) => sb.edit(P, '<nav aria-label="Primary">', '<nav>'), { detail: /<nav[^>]*>.*aria-label/ });
  it('<nav> with an empty aria-label', (sb) => sb.edit(P, '<nav aria-label="Primary">', '<nav aria-label="  ">'), { detail: /<nav[^>]*>.*aria-label/ });
  test('a hidden or tabindex=-1 element before the skip link does not count as focusable', () => {
    const sb = sandbox();
    sb.edit(P, '<a class="skip"', '<div hidden><a href="/x/">x</a></div><a href="/y/" tabindex="-1">y</a><button disabled>b</button><a class="skip"');
    assert.equal(byRule(sb.run(), 'landmarks').length, 0);
  });
});

rule('no-confirm', () => {
  const it = expect('no-confirm');
  const MARK = '[CONFI' + 'RM]';
  it('in robots.txt', (sb) => sb.write('robots.txt', sb.read('robots.txt') + `# ${MARK} publish this?\n`), { detail: /line 4/, file: 'robots.txt' });
  it('in an HTML comment', (sb) => sb.edit('index.html', '<h1>Home</h1>', `<h1>Home</h1><!-- ${MARK} -->`), { file: 'index.html' });
  it('in a feed', (sb) => sb.edit('index.xml', 'Recent posts', `Recent posts ${MARK}`), { file: 'index.xml' });
  test('plain English "confirm" is fine', () => {
    const sb = sandbox();
    sb.edit('index.html', '<h1>Home</h1>', '<h1>Home</h1><p>Please confirm your email</p>');
    assert.equal(byRule(sb.run(), 'no-confirm').length, 0);
  });
});

rule('feeds', () => {
  const it = expect('feeds');
  it('an item that is not a post (home feed lists a project)', (sb) =>
    sb.edit('index.xml', '<link>https://fixture.test/posts/hello/</link>', '<link>https://fixture.test/projects/alpha/</link>'), {
    detail: /not under \/posts\//,
    file: 'index.xml',
  });
  it('Spanish feed lists an English post', (sb) =>
    sb.edit('es/index.xml', '<link>https://fixture.test/es/posts/hola/</link>', '<link>https://fixture.test/posts/hello/</link>'), {
    detail: /not under \/es\/posts\//,
    file: 'es/index.xml',
  });
  it('malformed XML (unclosed element)', (sb) => sb.edit('es/index.xml', '</channel></rss>', '</rss>'), { detail: /not well-formed/, file: 'es/index.xml' });
  it('malformed XML (bare ampersand)', (sb) => sb.edit('index.xml', '<title>Hello</title>', '<title>Q & A</title>'), { detail: /not well-formed/, file: 'index.xml' });
  it('malformed XML (HTML entity without a DTD)', (sb) => sb.edit('index.xml', '<title>Hello</title>', '<title>Hello&rsquo;s</title>'), { detail: /not well-formed/ });
  it('feed missing', (sb) => sb.remove('es/index.xml'), { detail: /missing/, file: 'es/index.xml' });
  it('not an RSS document', (sb) => sb.write('index.xml', '<?xml version="1.0"?><html></html>'), { detail: /rss/ });
  it('relative item link', (sb) => sb.editAll('index.xml', '<link>https://fixture.test/posts/hello/</link>', '<link>/posts/hello/</link>'), { detail: /absolute/ });
  test('a feed without items is fine (no posts yet)', () => {
    const sb = sandbox();
    sb.write('index.xml', sb.read('index.xml').replace(/<item>.*<\/item>/, ''));
    sb.write('es/index.xml', sb.read('es/index.xml').replace(/<item>.*<\/item>/, ''));
    assert.equal(byRule(sb.run(), 'feeds').length, 0);
  });
  test('feed content with CDATA and escaped markup is well-formed', () => {
    const sb = sandbox();
    sb.edit('index.xml', '<generator>Hugo</generator>', '<generator><![CDATA[a < b & c]]></generator><!-- c -->');
    assert.equal(byRule(sb.run(), 'feeds').length, 0);
  });
});

rule('sitemap', () => {
  const it = expect('sitemap');
  const W = { level: 'warn' };
  it('sitemap missing', (sb) => { sb.remove('sitemap.xml'); sb.remove('en/sitemap.xml'); sb.remove('es/sitemap.xml'); }, { ...W, count: 1, detail: /sitemap.*missing/ });
  it('a page is not listed', (sb) => sb.edit('en/sitemap.xml', /<url><loc>https:\/\/fixture\.test\/projects\/<\/loc>.*<\/url>\n/.exec(sb.read('en/sitemap.xml'))[0], ''), {
    ...W,
    detail: /not listed/,
    file: 'projects/index.html',
  });
  it('a translated page without xhtml:link alternates', (sb) =>
    sb.write('es/sitemap.xml', sb.read('es/sitemap.xml').replace(/(<loc>https:\/\/fixture\.test\/es\/gallery\/<\/loc><lastmod>[^<]*<\/lastmod>)<xhtml.*?<\/url>/, '$1</url>')), {
    ...W,
    detail: /xhtml:link/,
  });
  it('a language with no sitemap entries at all', (sb) => sb.write('es/sitemap.xml', '<?xml version="1.0" encoding="utf-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>'), {
    ...W,
    count: 1,
    detail: /no sitemap lists any es pages/,
  });
  it('a <loc> that does not exist in public/', (sb) => sb.edit('en/sitemap.xml', '</urlset>', '<url><loc>https://fixture.test/ghost/</loc></url>\n</urlset>'), {
    ...W,
    detail: /ghost.*not found/,
  });
  it('malformed sitemap', (sb) => sb.edit('en/sitemap.xml', '</urlset>', ''), { ...W, detail: /not well-formed/, file: 'en/sitemap.xml' });
  it('a Spanish page inside the English sitemap', (sb) => {
    const alts = '<xhtml:link rel="alternate" hreflang="en-US" href="https://fixture.test/projects/"/><xhtml:link rel="alternate" hreflang="es-MX" href="https://fixture.test/es/projects/"/>';
    sb.edit('en/sitemap.xml', '</urlset>', `<url><loc>https://fixture.test/es/projects/</loc>${alts}</url>\n</urlset>`);
  }, { ...W, detail: /lists a Spanish page/, file: 'en/sitemap.xml' });
  test('warnings alone never fail the run', () => {
    const sb = sandbox();
    sb.remove('sitemap.xml');
    const res = sb.run();
    assert.equal(res.errors, 0);
    assert.equal(res.warnings, 1);
  });
  test('noindex pages, 404 pages and redirect stubs are not required in the sitemap', () => {
    const sb = sandbox();
    sb.edit('posts/index.html', '<meta name="twitter:card"', '<meta name="robots" content="noindex">\n<meta name="twitter:card"');
    sb.write('en/sitemap.xml', sb.read('en/sitemap.xml').replace(/<url><loc>https:\/\/fixture\.test\/posts\/<\/loc>.*<\/url>\n/, ''));
    assert.equal(byRule(sb.run(), 'sitemap').length, 0);
  });
});

rule('js-budget', () => {
  const it = expect('js-budget');
  const pad = (bytes) => '/*' + 'x'.repeat(bytes) + '*/';
  const siteJsSize = (sb) => Buffer.byteLength(sb.read('js/site.js'));
  it('site.js over 6 KB', (sb) => sb.write('js/site.js', sb.read('js/site.js') + pad(6144 - siteJsSize(sb) - 4 + 1)), {
    count: 2, // both homes load site.js
    detail: /6145 bytes.*6144/,
  });
  test('exactly 6144 bytes passes', () => {
    const sb = sandbox();
    sb.write('js/site.js', sb.read('js/site.js') + pad(6144 - siteJsSize(sb) - 4));
    assert.equal(fs.statSync(path.join(sb.pub, 'js/site.js')).size, 6144);
    assert.equal(byRule(sb.run(), 'js-budget').length, 0);
  });
  it('inline script over 600 bytes', (sb) => sb.edit('index.html', 'document.documentElement.classList.add("js")', 'document.documentElement.classList.add("js");' + pad(600)), {
    detail: /inline.*\d+ bytes.*600/,
    file: 'index.html',
  });
  test('inline budget counts the sum of inline scripts, not JSON-LD', () => {
    const sb = sandbox();
    sb.edit('index.html', '</head>', `<script type="application/ld+json">{"x":"${'y'.repeat(5000)}"}</script>\n</head>`);
    assert.equal(byRule(sb.run(), 'js-budget').length, 0);
  });
  test('the inline budget is inclusive: exactly 600 bytes passes', () => {
    const sb = sandbox();
    const base = 'document.documentElement.classList.add("js")';
    sb.edit('index.html', base, base + ';' + pad(600 - Buffer.byteLength(base) - 1 - 4));
    assert.equal(byRule(sb.run(), 'js-budget').length, 0);
  });
  it('a script that cannot be measured (external host)', (sb) => sb.edit('index.html', '</head>', '<script defer src="https://static.example.org/x.js"></script>\n</head>'), {
    detail: /external.*cannot be measured/,
  });
  it('a script that is not in public/', (sb) => sb.edit('es/index.html', '</head>', '<script defer src="/js/missing.js"></script>\n</head>'), {
    detail: /not found in public/,
    file: 'es/index.html',
  });
  test('only the home pages are budgeted (a heavy script on an inner page is not this rule\'s concern)', () => {
    const sb = sandbox();
    sb.write('js/big.js', pad(20000));
    sb.edit('projects/index.html', '</head>', '<script defer src="/js/big.js"></script>\n</head>');
    assert.equal(byRule(sb.run(), 'js-budget').length, 0);
  });
  test('the Spanish home is budgeted too', () => {
    const sb = sandbox();
    sb.write('js/big.js', pad(7000));
    sb.edit('es/index.html', '</head>', '<script defer src="/js/big.js"></script>\n</head>');
    const v = byRule(sb.run(), 'js-budget');
    assert.equal(v.length, 1);
    assert.equal(v[0].file, 'es/index.html');
  });
});

// ---------------------------------------------------------------------------------------------
// robustness and CLI
// ---------------------------------------------------------------------------------------------

describe('robustness', () => {
  test('hostile or broken HTML never crashes a rule', () => {
    const sb = sandbox();
    sb.write('empty/index.html', '');
    sb.write('garbage/index.html', '<<<>>> <html <body><img><nav><main><h1>');
    sb.write('nolang/index.html', '<!doctype html><title>x</title>');
    sb.write('es/binaryish/index.html', Buffer.from([0xff, 0xfe, 0, 1, 2, 3, 60, 104, 49, 62]));
    sb.write('deep/index.html', '<div>'.repeat(400) + 'x');
    const res = sb.run();
    const crashed = res.violations.filter((v) => /crash|internal error/i.test(v.detail));
    assert.deepEqual(crashed.map(formatViolation), []);
    assert.ok(res.errors > 0);
  });

  test('redirect stubs are skipped by the page rules', () => {
    const sb = sandbox();
    sb.write('old/index.html', '<!doctype html><html lang=en><head><meta http-equiv=refresh content="0; url=/"></head></html>');
    assert.deepEqual(sb.run().violations.map(formatViolation), []);
  });

  test('a public directory without a home page still produces a report instead of throwing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-site-empty-'));
    tmpRoots.push(dir);
    const res = check(dir);
    assert.ok(res.violations.length > 0);
  });

  test('violations are sorted and de-duplicated', () => {
    const sb = sandbox();
    sb.editAll('index.html', '<h1>Home</h1>', '<h2>Home</h2>');
    const res = sb.run();
    const lines = res.violations.map(formatViolation);
    assert.deepEqual(lines, [...new Set(lines)]);
  });
});

describe('command line', () => {
  const run = (args, cwd) => spawnSync(process.execPath, [CHECKER, ...args], { encoding: 'utf8', cwd });

  test('good site: exit 0 and nothing on stdout', () => {
    const r = run([path.join(GOOD, 'public')]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.stdout, '');
  });

  test('violations: exit 1 and one "LEVEL rule file: detail" line each on stdout', () => {
    const sb = sandbox();
    sb.edit('projects/index.html', '<h1>Projects</h1>', '<h1>Projects</h1><h1>Again</h1>');
    sb.write('js/site.js', sb.read('js/site.js') + 'x'.repeat(7000));
    const r = run([sb.pub]);
    assert.equal(r.status, 1);
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines.length, 3); // h1 once, js-budget on both homes
    for (const l of lines) assert.match(l, /^(ERROR|WARN) [a-z0-9-]+ \S+: .+$/);
    assert.match(lines.join('\n'), /^ERROR h1 projects\/index\.html: /m);
    assert.match(lines.join('\n'), /^ERROR js-budget (es\/)?index\.html: /m);
  });

  test('warnings only: exit 0, WARN lines printed', () => {
    const sb = sandbox();
    sb.remove('sitemap.xml');
    const r = run([sb.pub]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^WARN sitemap /m);
  });

  test('--json prints one parseable document', () => {
    const sb = sandbox();
    sb.edit('projects/index.html', '<h1>Projects</h1>', '');
    const r = run([sb.pub, '--json']);
    assert.equal(r.status, 1);
    const doc = JSON.parse(r.stdout);
    assert.equal(doc.errors, 1);
    assert.equal(doc.warnings, 0);
    assert.deepEqual(doc.violations.map((v) => [v.level, v.rule, v.file]), [['error', 'h1', 'projects/index.html']]);
    assert.equal(doc.base, BASE);
  });

  test('--base is enforced: a build for another base fails, the right one passes', () => {
    const good = path.join(GOOD, 'public');
    assert.equal(run([good, '--base', BASE]).status, 0);
    assert.equal(run([good, `--base=${BASE.slice(0, -1)}`]).status, 0, 'a missing trailing slash is tolerated');
    const r = run([good, '--base', 'http://localhost:8080/']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /base/);
  });

  test('a relative directory is resolved against the cwd, and the directory defaults to ./public', () => {
    const sb = sandbox();
    assert.equal(run(['public'], sb.root).status, 0);
    const r = run([], sb.root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  test('usage errors: unknown flag and missing directory exit 2 with a message on stderr', () => {
    const a = run(['--nope']);
    assert.equal(a.status, 2);
    assert.match(a.stderr, /usage/i);
    const b = run([path.join(os.tmpdir(), 'definitely-not-here-' + process.pid)]);
    assert.equal(b.status, 2);
    assert.match(b.stderr, /not found|no such/i);
  });
});
