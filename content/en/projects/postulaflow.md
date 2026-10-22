---
title: "PostulaFlow"
translationKey: "project-postulaflow"
description: "A job-application tracker that reads a vacancy from a URL or a screenshot and files it on a Kanban board shaped like the Mexican hiring process."
weight: 30
featured: true
kind: "personal"
featured_image: "images/projects/postulaflow/cover.svg"   # [CONFIRM] replace with a real screenshot
stack: ["React", "TypeScript", "Vite", "Tailwind CSS", "DaisyUI", "Framer Motion", "Supabase", "Groq"]
tags: ["ai", "react", "supabase", "side-project"]
# [CONFIRM] repo is private: make it public (then set repo) or keep "Private repository"
repo: ""
live: ""
---

Job hunting means dozens of vacancies, each at a different stage. PostulaFlow keeps them
in one place.

- **Three ways to add a vacancy:** paste the URL, drop a screenshot (OCR plus an LLM on
  Groq pulls out company, role and details) or type it in.
- **A Kanban board for the real process in Mexico:** Applied, HR call, Hiring-manager
  call, Technical test, Psychometric tests, Offer, Rejected, Accepted.
- **History of every change** stored in Supabase, a Spanish-first interface, light and
  dark themes, and small motion details with Framer Motion.
