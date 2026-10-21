---
title: "Tracker de juegos y ofertas"
translationKey: "project-game-deals-tracker"
description: "Un job diario en GitHub Actions que publica en Discord estrenos, próximos lanzamientos y juegos gratis para PS5 y Xbox, sin repetir."
weight: 50
featured: false
kind: "personal"
featured_image: "images/projects/game-deals-tracker/cover.svg"
stack: ["Python", "GitHub Actions", "Supabase", "RAWG API", "GamerPower API", "Discord webhooks"]
tags: ["python", "automatizacion", "github-actions", "proyecto-personal"]
repo: ""
live: ""
---

Una automatización pequeña que sí uso. Todos los días a las 12:00 UTC un workflow de
GitHub Actions:

- trae los **estrenos** (últimos 7 días) y los **próximos lanzamientos** (siguientes 30
  días) para PlayStation 5 y Xbox Series X|S desde la API de RAWG, y los **juegos gratis**
  vigentes desde GamerPower;
- los publica en Discord como notificaciones por categoría;
- guarda en **Supabase** lo que ya envió para no repetir nada.
