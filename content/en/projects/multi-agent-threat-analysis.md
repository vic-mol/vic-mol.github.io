---
title: "Multi-agent threat analysis"
translationKey: "project-multi-agent-threat-analysis"
description: "Specialized AI agents that enrich indicators and feed the SIEM, checked by auditor agents before anything reaches an analyst."
weight: 20
featured: true
kind: "case-study"
featured_image: "images/projects/multi-agent-threat-analysis/cover.svg"
stack: ["Microsoft AI Foundry", "Azure OpenAI", "Azure AI Search", "Cosmos DB", "Python", "React"]
tags: ["ai-agents", "llm-security", "azure", "threat-intelligence"]
# [CONFIRM] OK to publish this case study? Add a shareable metric to "Result" if possible.
repo: ""
live: ""
---

## The problem

Security analysts spend much of their time enriching indicators of compromise and moving
findings between tools. Large language models can help, but in a security context their
output has to be checked, traceable and safe around sensitive data.

## What I built

- A **multi-agent framework on Microsoft AI Foundry**: specialized agents for IOC
  enrichment and SIEM integration, coordinated so each one does a narrow job well.
- **Auditor agents** that review other agents' output before it is used, so errors are
  caught by design rather than by luck.
- Around it, an internal **AI workspace** (Azure OpenAI with GPT and Anthropic models,
  Azure AI Search and Cosmos DB) and an **intelligence intake portal** that routes
  analyst reports into the pipeline.
- The governance layer: LLM usage metrics across models and apps, validation patterns,
  and guardrails for what agents may access.

## Result

AI the security team actually uses to make decisions, with the controls to measure and
audit it.
