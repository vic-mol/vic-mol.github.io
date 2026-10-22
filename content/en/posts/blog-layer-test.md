---
title: "Test post for the blog layer"
date: 2026-10-20T09:00:00-06:00
draft: true   # placeholder used to develop the blog templates; delete it before the first real post
translationKey: "blog-layer-test"
description: "A placeholder post that exercises the blog templates: headings, table of contents, tags, a figure, related posts and the Spanish translation link."
tags: ["placeholder", "blog-layer", "ai-agents"]
toc: true
---

This is a test post for the blog layer. None of this text is real content: it only exists so the list, the post page, the tags and the feeds have something to render.

## Why a placeholder post

A layout is easier to judge with a real page in front of you. This post has a few headings, a list, a code block, one image and three tags, which is enough to see the table of contents, the reading time and the typography working together.

- The date follows the language of the page.
- Tags link to their own pages.
- The Spanish translation is linked from the top of the post.

## What the page shows

Below the title you will find the publication date, the estimated reading time and the tags. If the post has at least three headings, a table of contents appears before the text.

{{< figure src="images/gallery/sf-marina-sunrise.jpg" >}}

## A code sample

Code blocks use the same highlighting as the rest of the site, in light and dark mode.

```python
def greet(name: str) -> str:
    return f"Hello, {name}"
```

### A smaller heading

Third-level headings also show up in the table of contents.

## Where to go next

Replace this post with a real one: copy the archetype, write the English and Spanish versions with the same `translationKey`, and set `draft: false`.
