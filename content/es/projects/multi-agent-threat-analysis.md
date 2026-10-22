---
title: "Análisis de amenazas multiagente"
translationKey: "project-multi-agent-threat-analysis"
description: "Agentes de IA especializados que enriquecen indicadores y alimentan el SIEM, revisados por agentes auditores antes de llegar a un analista."
weight: 20
featured: true
kind: "case-study"
featured_image: "images/projects/multi-agent-threat-analysis/cover.svg"
stack: ["Microsoft AI Foundry", "Azure OpenAI", "Azure AI Search", "Cosmos DB", "Python", "React"]
tags: ["agentes-de-ia", "seguridad-de-llm", "azure", "inteligencia-de-amenazas"]
# [CONFIRM] OK to publish this case study? Add a shareable metric to "Result" if possible.
repo: ""
live: ""
---

## El problema

Los analistas de seguridad dedican mucho tiempo a enriquecer indicadores de compromiso y
a mover hallazgos entre herramientas. Los modelos de lenguaje pueden ayudar, pero en
seguridad lo que producen tiene que revisarse, ser trazable y manejar con cuidado los
datos sensibles.

## Lo que construí

- Un **framework multiagente en Microsoft AI Foundry**: agentes especializados en
  enriquecimiento de IOCs e integración con el SIEM, coordinados para que cada uno haga
  bien una tarea acotada.
- **Agentes auditores** que revisan lo que producen los demás antes de usarlo, para que
  los errores se detecten por diseño y no por suerte.
- Alrededor, un **espacio de trabajo interno con IA** (Azure OpenAI con modelos GPT y de
  Anthropic, Azure AI Search y Cosmos DB) y un **portal de recepción de inteligencia** que
  envía los reportes de los analistas al pipeline.
- La capa de gobierno: métricas de uso de LLM por modelo y aplicación, patrones de
  validación y guardrails sobre lo que los agentes pueden consultar.

## Resultado

IA que el equipo de seguridad usa de verdad para tomar decisiones, con los controles para
medirla y auditarla.
