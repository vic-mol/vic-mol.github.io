---
title: "Threat-intelligence data platform"
translationKey: "project-threat-intel-platform"
description: "An Airflow and PostgreSQL platform that turns 25+ external security feeds into one trusted dataset for a global security team."
weight: 10
featured: true
kind: "case-study"
featured_image: "images/projects/threat-intel-platform/cover.svg"
stack: ["Apache Airflow", "PostgreSQL", "Azure Container Apps", "Key Vault", "GitHub Actions", "Python"]
tags: ["data-engineering", "threat-intelligence", "azure", "airflow"]
repo: ""      # internal work; no public code
live: ""
---

## The problem

Threat data arrived from more than 25 external sources (vulnerability scanners,
endpoint protection, threat-intel feeds, vendor advisories and public
exploited-vulnerability catalogs), each with its own format and schedule. Analysts stitched it together by hand.

## What I built

- An **Apache Airflow** platform on **Azure Container Apps** that ingests, normalizes
  and aggregates every source on a schedule, with batch tracking and a managed source
  catalog.
- A **medallion PostgreSQL warehouse** (Bronze → Silver → Gold) so raw data, cleaned
  data and analyst-ready views stay separate and traceable.
- The delivery path: CI/CD with **GitHub Actions**, images in Azure Container Registry,
  secrets in **Key Vault**, files in Blob Storage.

## Result

One trusted dataset that the whole Global Information Security team uses, and the
foundation the team's AI tooling now builds on.
