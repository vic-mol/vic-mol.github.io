---
title: "Plataforma de datos de inteligencia de amenazas"
translationKey: "project-threat-intel-platform"
description: "Plataforma con Airflow y PostgreSQL que une más de 25 fuentes externas de seguridad en un solo conjunto de datos confiable para un equipo global."
weight: 10
featured: true
kind: "case-study"
featured_image: "images/projects/threat-intel-platform/cover.svg"
stack: ["Apache Airflow", "PostgreSQL", "Azure Container Apps", "Key Vault", "GitHub Actions", "Python"]
tags: ["ingenieria-de-datos", "inteligencia-de-amenazas", "azure", "airflow"]
repo: ""
live: ""
---

## El problema

Los datos de amenazas llegaban de más de 25 fuentes externas (escáneres de
vulnerabilidades, protección de endpoints, feeds de inteligencia, avisos de proveedores
y catálogos públicos de vulnerabilidades explotadas), cada una con su propio formato y horario. Los
analistas los unían a mano.

## Lo que construí

- Una plataforma con **Apache Airflow** en **Azure Container Apps** que ingiere,
  normaliza y agrega cada fuente de forma programada, con control de lotes y un catálogo
  de fuentes.
- Un **data warehouse medallion en PostgreSQL** (Bronze → Silver → Gold) para que los
  datos crudos, los datos limpios y las vistas para analistas estén separados y sean
  trazables.
- El camino a producción: CI/CD con **GitHub Actions**, imágenes en Azure Container
  Registry, secretos en **Key Vault** y archivos en Blob Storage.

## Resultado

Un solo conjunto de datos confiable que usa todo el equipo de Global Information
Security, y la base sobre la que hoy se construyen sus herramientas de IA.
