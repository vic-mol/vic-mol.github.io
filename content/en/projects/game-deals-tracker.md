---
title: "Game deals tracker"
translationKey: "project-game-deals-tracker"
description: "A daily GitHub Actions job that posts new releases, upcoming games and free giveaways for PS5 and Xbox to Discord, without repeats."
weight: 50
featured: false
kind: "personal"
featured_image: "images/projects/game-deals-tracker/cover.svg"
stack: ["Python", "GitHub Actions", "Supabase", "RAWG API", "GamerPower API", "Discord webhooks"]
tags: ["python", "automation", "github-actions", "side-project"]
# [CONFIRM] repo is private: make public or keep as is
repo: ""
live: ""
---

A small automation I actually use. Every day at 12:00 UTC a GitHub Actions workflow:

- pulls **new releases** (last 7 days) and **upcoming games** (next 30 days) for
  PlayStation 5 and Xbox Series X|S from the RAWG API, and **active giveaways** from
  GamerPower;
- posts them to Discord as categorized notifications;
- remembers what it already sent in **Supabase**, so nothing is posted twice.
