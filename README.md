# vic-mol.github.io

Victor Molina's bilingual (English / Spanish) portfolio. It is a [Hugo](https://gohugo.io/) site that uses the [CareerCanvas](https://github.com/felipecordero/careercanvas) theme, built with Tailwind CSS v3 through Hugo Pipes and published to GitHub Pages by GitHub Actions.

- Production URL: <https://vic-mol.github.io/> (English at `/`, Spanish at `/es/`).
- Built output (`public/`, `resources/`) is never committed; CI builds it.
- No third-party requests: fonts, icons and scripts are self-hosted.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Hugo **extended** | **0.168.0** | The extended edition is required (image processing, PostCSS). Check with `hugo version`: it must say `+extended`. CI pins the same version. |
| Node.js | **24** | `package.json` declares `"node": ">=24"`. |
| Git | any recent | The theme is a submodule. |
| Python 3 + Pillow | optional | Only for `scripts/prepare_images.py` (adding photos). `python -m pip install pillow` |

Windows installs Hugo in step 1 of "Get started" below (one `winget` command); nothing else needs to be installed to see the site.

## Get started

### Windows (PowerShell), step by step

1. **Install Hugo Extended 0.168.0** (one time). Without it `npm run dev` stops with `'hugo' is not recognized as an internal or external command`.

   ```powershell
   winget install --id Hugo.Hugo.Extended --exact --version 0.168.0
   ```

   Close PowerShell and open a **new** window (the old one does not see the new program), then check:

   ```powershell
   hugo version
   ```

   It must print `v0.168.0` and `+extended`.

2. **Get the code** (skip this if you already have the folder). The theme is a Git submodule, so clone with `--recurse-submodules`:

   ```powershell
   git clone --recurse-submodules https://github.com/vic-mol/vic-mol.github.io.git
   cd vic-mol.github.io
   ```

   If the folder was cloned without it and `themes\careercanvas` is empty, run `git submodule update --init`.

3. **Install the packages** (one time):

   ```powershell
   npm ci
   ```

   Two kinds of messages are harmless: `tarball ... seems to be corrupted. Trying again` (npm retries by itself) and `N vulnerabilities` (they are in build-time tools that only read this repository's own files; nothing from them ships to the site). Do **not** run `npm audit fix --force`: it upgrades Tailwind to v4 and breaks the site.

4. **Start the site.** From the repository folder, paste this whole block. It puts Hugo on this window's `PATH` (in case the new window still does not see it) and starts `npm run dev` from a path with a lowercase drive letter, which avoids a Windows-only error from Hugo's PostCSS step (see "Windows" below):

   ```powershell
   $hugoDir = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Directory -Filter 'Hugo.Hugo.Extended_*' | Select-Object -First 1 -ExpandProperty FullName
   if (-not $hugoDir) { throw "Hugo Extended is not installed. Install it with: winget install --id Hugo.Hugo.Extended --exact --version 0.168.0" }
   $env:Path = "$hugoDir;$env:Path"
   $repo = (Get-Location).Path
   $repo = $repo.Substring(0, 1).ToLowerInvariant() + $repo.Substring(1)
   & $env:ComSpec /d /c "cd /d `"$repo`" && npm run dev"
   ```

   The first start takes a few seconds (Hugo processes the images). When it prints `Web Server is available at http://localhost:1313/`, open it in the browser.

5. **Look at it**: English at <http://localhost:1313/>, Spanish at <http://localhost:1313/es/>. Edits to files in `content/`, `layouts/`, `assets/` and `data/` reload the page by themselves. Press **Ctrl+C** in the terminal to stop the server.

Useful variations of the last line of the block (it is the part inside the quotes after `&&`):

| Want | Use |
|---|---|
| Also show draft posts (the two test posts under `content/*/posts/`) | `npm run dev -- -D` |
| Another port, because 1313 is taken (`bind: Only one usage of each socket address`) | `npm run dev -- --port 1314` |

### macOS and Linux

```sh
git clone --recurse-submodules https://github.com/vic-mol/vic-mol.github.io.git
cd vic-mol.github.io
npm ci
npm run dev
```

`npm run dev` starts Hugo's development server (`hugo server --disableFastRender`) on <http://localhost:1313/>. Add `-D` to also render drafts: `npm run dev -- -D`. If the `themes/careercanvas` folder is empty, run `git submodule update --init`.

### If something goes wrong

| What you see | What to do |
|---|---|
| `'hugo' is not recognized ...` | Do step 1, then open a new PowerShell window, or use the block in step 4, which adds Hugo to `PATH` for that window. |
| `ERR_ACCESS_DENIED ... tailwind.config.js` | You ran `npm run dev` directly on Windows. Use the block in step 4 (explained in "Windows" below). |
| Hugo asks for the "extended" version, or reports a missing PostCSS/`resources.PostCSS` | `hugo version` must say `+extended` and `v0.168.0`; reinstall with the `winget` command in step 1. |
| `Error: ... themes/careercanvas ...` or an empty theme folder | `git submodule update --init` |
| The page shows but without styling or images | Stop the server (Ctrl+C), delete the `resources` and `public` folders if present, start again. |

| Command | What it does |
|---|---|
| `npm run dev` | Development server with live reload. |
| `npm run build` | Production build into `public/` (`hugo build --gc --minify`). |
| `npm run check` | Runs the site checker (`scripts/check-site.mjs`) on `public/`: language attributes, hreflang, language switcher, contact obfuscation, Open Graph tags, alt text and more. Build first. |
| `npm test` | `npm run build` followed by `npm run check`. |
| `npm run vendor` | Copies the self-hosted fonts and icons into the repo (`scripts/vendor.mjs`). Only needed when you change the font or icon packages. |

## Project layout

```text
content/en, content/es   Pages and posts, one tree per language (paired by translationKey)
data/images.yaml         Alt text and captions for every image, in both languages
i18n/en.toml, es.toml    Interface strings
layouts/                 Project-level templates; they override the theme at the same path
assets/                  CSS, JS and images that Hugo processes (images/<role>/...)
static/                  Files copied as they are (favicons, vendored fonts and icons)
scripts/                 Site checker, vendoring script, image tools
themes/careercanvas      Theme, git submodule pinned to one commit. Never edit it.
hugo.toml                The only place with the site URL (baseURL), languages, menus and parameters
.github/workflows        deploy.yml and quality.yml (see "How CI works")
```

Rules that keep the site maintainable:

- Never edit anything under `themes/`. To change a theme file, create the same path under the project root (for example `layouts/partials/nav.html` overrides `themes/careercanvas/layouts/partials/nav.html`).
- Every page that exists in one language exists in the other, with the same `translationKey` in both files.
- Templates never hard-code the host name; they use `.Permalink`, `.RelPermalink`, `absURL` or `relLangURL`.

## Adding a blog post

Posts live in `content/<lang>/posts/`. The blog needs no configuration: it works with zero posts and with many.

1. Create the English post. The `posts` archetype fills in the front matter:

   ```sh
   hugo new content content/en/posts/my-post.md
   ```

2. Create the Spanish post with a Spanish file name (the file name is the URL slug, so `mi-entrada.md` becomes `/es/posts/mi-entrada/`):

   ```sh
   hugo new content content/es/posts/mi-entrada.md
   ```

   Then set `translationKey` to **the same value in both files**. The archetype uses the file name, so change the Spanish file's value to match the English one (for example `my-post`). The key is what pairs the two files and what the language switcher follows.

3. Fill in the front matter of each file:

   | Field | Notes |
   |---|---|
   | `title`, `date` | Required. |
   | `draft` | Starts as `true`. Set `draft: false` to publish. |
   | `translationKey` | Same value in the EN and ES files of one post. |
   | `description` | One or two sentences, at most 160 characters (used for SEO and share cards). |
   | `tags` | Lowercase and hyphenated, **in the post's own language** (tags are per language). |
   | `cover` | Optional. Path under `assets/`, for example `images/posts/<slug>/cover.jpg`. |
   | `toc` | `true` shows a table of contents on posts with enough headings. |

4. Preview with `npm run dev -- -D` (drafts included), then set `draft: false` in both files and push to `main`. The Deploy workflow publishes it.

Notes:

- A post that exists in only one language is allowed. The language switcher then leads to the other language's blog index, and the site checker reports it as a warning, not an error.
- Images for a post go in `assets/images/posts/<slug>/` so both languages share them (see "Adding an image"). Use a page bundle (`content/en/posts/<slug>/index.md`) only when the post has its own images. Insert one with `{{< figure src="images/posts/<slug>/x.jpg" >}}`; its alt text comes from `data/images.yaml`.
- The Blog menu item, the feeds (`/posts/index.xml`, `/es/posts/index.xml`) and the "no posts yet" behavior follow the published posts of each language automatically; nothing in `hugo.toml` or the templates changes when the first post appears.

## Adding an image

All raster images go through one pipeline so they are small, responsive and free of metadata.

1. **Never commit an original.** Camera and phone originals carry EXIF data, often including GPS coordinates. Keep them in `_photos-src/`, which is git-ignored.
2. **Create a web master** with the script provided in this repo (`scripts/prepare_images.py`, uses Pillow):

   ```sh
   python scripts/prepare_images.py --src _photos-src/IMG_0001.jpg --out assets/images/gallery/sf-golden-gate-fog.jpg
   ```

   | Option | Meaning |
   |---|---|
   | `--src` | The original file. |
   | `--out` | The master to write under `assets/images/<role>/<descriptive-kebab-name>.jpg`. |
   | `--crop l,t,r,b` | Optional crop box in pixels (left, top, right, bottom). |
   | `--max <pixels>` | Longest edge in pixels. Default 2000 (`--max 2000`); use `--max 2560` for full-width backgrounds. |

   The script applies the EXIF orientation, then the optional crop, then resizes, and saves a progressive JPEG (quality 86) **without any metadata**. It fails if the output still contains an EXIF block.

3. **Name and place it.** Names are lowercase ASCII and describe the content (`sf-cable-car-powell-mason.jpg`, not `100_0424.JPG`). Roles (folders under `assets/images/`): `profile/`, `backgrounds/`, `about/`, `gallery/`, `qr/`, `projects/<project-slug>/`, `posts/<post-slug>/`, `og/`. Nothing image-related goes in `static/` except favicons.
4. **Describe it in both languages** in `data/images.yaml`. The key is the path under `assets/`:

   ```yaml
   images/gallery/sf-golden-gate-fog.jpg:
     set: "sf-2026"        # gallery images only: which photo set it belongs to
     weight: 70            # gallery images only: order within the set
     alt:
       en: "Describe what the photo shows"
       es: "Describe lo que muestra la foto"
     caption:              # optional
       en: "Short caption"
       es: "Pie de foto corto"
   ```

   Purely decorative images use `decorative: true` instead of relying on alt text; they render with an empty `alt`. A non-decorative image without alt text in the current language fails the build, on purpose.
5. **Use it** only through the `img.html` partial (`{{ partial "img.html" (dict "page" . "src" "images/..." ) }}`), the `photo-gallery` shortcode for gallery sets (`{{< photo-gallery set="sf-2026" >}}`) or the `figure` shortcode for posts. Do not write raw `<img>` tags for photos.

## Styles and icons

- **CSS pipeline.** `baseof.html` joins the theme's `main.css`, `assets/css/fonts.css`, `assets/css/site.css` and `assets/css/syntax.css`, then runs PostCSS (`postcss.config.js`): Tailwind generates the utilities it finds, and PurgeCSS removes every rule whose class or tag name appears nowhere in `layouts/`, `content/`, `data/` or `assets/js/`. That keeps the bundle small, with one consequence: **write class names literally in templates.** A name assembled across a template action (`class="badge--{{ $kind }}"`) is invisible to the scan and its rules disappear from the bundle. If you must compose a class that way, or a class only appears in HTML that Hugo's markdown renderer writes (`highlight`, `chroma`, footnotes, tables), add it to the `safelist` in `postcss.config.js`.
- **Icons.** Icons are inline SVGs from Font Awesome Free (no webfont, no third-party request): `{{ partial "icon.html" (dict "name" "briefcase" "style" "solid") }}`. After using a new icon name (in a template, in the `icon:` of a content file, or in `[[params.social]]`), run `npm run vendor`: it copies just the icons the site uses into `assets/icons/fa/`. Brand icons use `"style" "brands"` (or `"auto"`, which picks from the list at the top of `icon.html`). The build fails with a clear message when an icon file is missing.

## Updating the theme submodule

CareerCanvas is pinned to commit `727f841996431a8a7a40a9be1ba74e3731385388`. Keep that pin until you have reviewed an update. A blind `git submodule update --remote` is not safe: the site uses some theme files unmodified (for example `layouts/partials/skills.html`, `layouts/partials/color-variables.html` and `assets/css/main.css`), and a change to a file that the site *overrides* is invisible in the browser but can still change the intended behavior.

1. Fetch and read the changes between the pin and the candidate commit:

   ```sh
   git -C themes/careercanvas fetch origin
   git -C themes/careercanvas log --oneline 727f841..origin/main
   git -C themes/careercanvas diff 727f841 origin/main --stat
   git -C themes/careercanvas diff 727f841 origin/main
   ```

2. Compare every changed file with the project's overrides (`layouts/` and `assets/` at the repo root). For files the site overrides, decide whether the upstream change should be ported. For files it uses unmodified, check that the output still looks and behaves the same.
3. On a branch, check out the candidate commit inside the submodule (`git -C themes/careercanvas checkout <commit>`), rebuild, and run the **full quality checklist** again: a clean `npm test`, no Hugo warnings, both languages and both themes by eye, and the pa11y and Lighthouse runs (see below). Open a pull request so the Quality workflow runs.
4. Only then commit the new submodule pointer (`git add themes/careercanvas`), and update the commit hash quoted in this section.

If the review is not done, leave the pin as it is.

## Decisions still to confirm

Facts that Victor has not verified yet are marked `[CONFIRM]` in YAML or TOML comments. They never reach the generated HTML. To list them all:

```sh
grep -rn "CONFIRM" content hugo.toml data
```

Resolve each one (edit the value or remove the marker) before launch. The goal is that the command above prints nothing.

## Contact details

The email address and phone number are not stored in plain text anywhere in the repository. `hugo.toml` holds them encoded under `[params.contact]`, and a small script in the browser decodes them into ordinary links. Do not add the plain values to templates, content, data files or this README. The site checker searches the built site for them, and the quality checklist searches the repository.

## How CI works

Two workflows in `.github/workflows/`. Both install Hugo extended 0.168.0 and Node 24, check out the theme submodule and run `npm ci`.

**Deploy to GitHub Pages** (`deploy.yml`): runs on every push to `main` and can be started by hand (workflow dispatch).

1. Build with `hugo build --gc --minify`, using the base URL that the `configure-pages` action reports (so it keeps working after a custom domain is added).
2. Run the site checker (`node scripts/check-site.mjs public`).
3. Check internal links with lychee in offline mode.
4. Upload `public/` as the Pages artifact, then a second job deploys it to the `github-pages` environment.

**Quality (PRs)** (`quality.yml`): runs on pull requests, by hand, and every Monday (13:17 UTC).

1. Production build with the base URL `http://localhost:8080/`, so the tools below can crawl the local copy. **Any `WARN` or `ERROR` line in Hugo's output fails the run** (deprecations, missing translations).
2. Site checker with `--base http://localhost:8080/`.
3. Link check with lychee. On pull requests it checks internal links only; the weekly run also checks external links (linkedin.com is excluded because it blocks bots).
4. Serves `public/` on port 8080 and runs **pa11y-ci** (`.pa11yci.json`, axe runner, WCAG2AA): nine URLs, each at 390x844 and 1280x800, in light and in dark mode (the dark runs click `#theme-toggle`).
5. Runs **Lighthouse CI** (`lighthouserc.json`): the same nine URLs, mobile, three runs each, judged on the median. Thresholds: performance 0.90, accessibility 0.98, best practices 0.95, SEO 1.0, CLS 0.05, LCP 2500 ms, TBT 150 ms. Reports are uploaded to Lighthouse's temporary public storage.

Repository settings these workflows rely on: Settings > Pages > Source is **GitHub Actions**; Settings > Actions > General > Workflow permissions is read-only for repository contents (the deploy workflow requests `pages: write` and `id-token: write` itself). Optionally protect `main` and require the `quality` check from the "Quality (PRs)" workflow.

### Running the quality checks locally

```sh
hugo build --gc --minify --baseURL "http://localhost:8080/" --logLevel warn --printI18nWarnings
node scripts/check-site.mjs public --base http://localhost:8080/
npx --yes http-server@14.1.1 public -p 8080 -s      # leave running; use a second terminal for the next lines
npx --yes pa11y-ci@5.0.0 --config .pa11yci.json
npx --yes @lhci/cli@0.15.1 autorun --config=./lighthouserc.json
```

Both tools need a Chrome browser; pa11y-ci downloads its own on first use. `lhci autorun` uploads its report to temporary public storage, as it does in CI.

## Custom domain

The site URL lives in one place, `baseURL` in `hugo.toml`. To move to your own domain:

1. Change `baseURL` in `hugo.toml` to `https://example.com/`.
2. In GitHub: Settings > Pages > Custom domain > enter the domain, and turn on **Enforce HTTPS**. Pages deployed from Actions do not read a `CNAME` file, so do not add one.
3. DNS: point the apex domain to GitHub Pages with `A` (and `AAAA`) records, using the addresses in GitHub's current Pages documentation, and point `www` to `vic-mol.github.io` with a `CNAME` record. Verify the domain in your GitHub account settings so nobody else can claim it.
4. Push to `main`. Nothing else in the repository changes; the site checker fails the build if a template hard-codes `vic-mol.github.io`.

## Windows

On Windows, `npm run dev` or `npm run build` can fail with a PostCSS error like:

```text
ERR_ACCESS_DENIED ... tailwind.config.js
```

Cause: Tailwind CSS v3 lower-cases the drive letter of the config path (`c:\...`), while Hugo's Node permission model only allows the original `C:\...`, so Node refuses to read the file. Workarounds:

- Run Hugo with the working directory spelled with a **lowercase drive letter**. In PowerShell, from the repository folder:

  ```powershell
  $env:HUGO_WORKINGDIR = (Get-Location).Path.Substring(0,1).ToLower() + (Get-Location).Path.Substring(1)
  npm run dev
  ```

  Set the variable in the same terminal session before running `npm run dev` or `npm run build`.
- Or build inside WSL, or let CI do the build (Linux is not affected).

## Credits and licenses

The theme is [CareerCanvas](https://github.com/felipecordero/careercanvas) (MIT). Some templates adapt patterns from [hugo-mana-theme](https://github.com/Livour/hugo-mana-theme) (MIT, notice kept at the top of each adapted file). Font and icon licenses are in `LICENSES/` and next to the vendored files. Site content and photographs are Victor Molina's.
