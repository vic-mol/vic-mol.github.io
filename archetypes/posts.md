---
title: "{{ replace .File.ContentBaseName "-" " " | title }}"
date: {{ .Date }}
draft: true
translationKey: "{{ .File.ContentBaseName }}"   # SAME value in the en/ and es/ files of one post
description: ""        # 1–2 sentences, max 160 characters; used for SEO and cards
tags: []               # lowercase, hyphenated, in this post's language
cover: ""              # optional: path under assets/, e.g. images/posts/<slug>/cover.jpg
toc: true
---
