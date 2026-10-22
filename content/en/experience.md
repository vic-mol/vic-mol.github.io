---
title: "Experience"
translationKey: "experience"
build: { render: never, list: never }
intro: >-
  From help desk to security AI: almost ten years building and running the systems
  people rely on.
resume_downloads: []   # [CONFIRM] add {lang: en, label: English} / {lang: es, label: Español} once an updated CV PDF exists
positions:
  - company: "Levi Strauss & Co."
    company_url: "https://www.levistrauss.com"
    period: "Oct 2025 – Present"
    industry: "Apparel & retail"
    location: "Mexico City · Remote"
    company_description: "Global Information Security, in the Security Engineering organization that reports to the CISO."
    roles:
      - title: "Security AI Engineer"
        period: "May 2026 – Present"
        bullet_points:   # [CONFIRM] level of internal detail OK to publish (mirrors public LinkedIn text)
          - "Build and operate production LLM systems the security team uses daily, including an internal AI workspace on Azure OpenAI (GPT and Anthropic models) backed by Azure AI Search and Cosmos DB."
          - "Designed a multi-agent threat-analysis framework on Microsoft AI Foundry: specialized agents for IOC enrichment and SIEM integration, plus auditor agents that validate their output."
          - "Shipped a threat-intelligence intake portal that routes analyst-submitted reports straight into the intelligence pipeline."
          - "Define the governance layer for AI in security: LLM usage metrics across models and apps, validation patterns for AI output, and guardrails for agentic access to sensitive data."
          - "Own the stack end to end: Python (Quart, FastAPI, Airflow), React/TypeScript, Next.js, PostgreSQL, Azure Container Apps, Key Vault, Cosmos DB and CI/CD with GitHub Actions."
      - title: "Sr. Threat Intel Analyst"
        period: "Oct 2025 – May 2026"
        bullet_points:
          - "Built the core threat-intelligence data platform from scratch: Apache Airflow on Azure Container Apps ingesting and normalizing data from 25+ external security sources."
          - "Modeled it as a Bronze/Silver/Gold (medallion) PostgreSQL warehouse with batch tracking and a managed source catalog."
          - "Set up CI/CD with GitHub Actions and the Azure footprint: Container Apps, Container Registry, PostgreSQL Flexible Server, Blob Storage and Key Vault."
          - "Grew the role from analyst workflows into full-stack cloud engineering as the platform scaled to serve the whole security team."

  - company: "KodeFree"
    period: "May 2022 – Oct 2025"
    role: "Full Stack & Data Engineer"
    industry: "Software services"   # [CONFIRM] industry wording and company URL
    location: "Hybrid"
    company_description: "Software and data engineering for enterprise clients."
    bullet_points:
      - "Built and maintained enterprise web applications with React, Node.js and FastAPI, keeping codebases modular and maintainable."
      - "Developed REST APIs in FastAPI integrated with Node.js microservices, improving interoperability and performance."
      - "Designed and automated ETL pipelines with Python, Apache Airflow, Snowflake and Informatica PowerCenter, cutting manual processing and enabling near-real-time data."
      - "Optimized data workflows on AWS and GCP for cost and scale."
      - "Supported pre-sales with technical designs and prototypes that helped win new client engagements, and contributed to solution architecture and documentation."

  - company: "Credit Suisse"
    period: "Jan 2019 – May 2022"
    role: "IT Infrastructure Engineer"
    industry: "Banking"
    location: "Mexico City"   # [CONFIRM] not stated on LinkedIn
    company_description: "Global bank, now part of UBS."
    bullet_points:
      - "Led infrastructure initiatives across Latin America: networking, server administration and enterprise software deployments."
      - "Ran servers and virtualized environments (VMware, Hyper-V) and LAN, WAN and VPN connectivity for high availability."
      - "Implemented secure, scalable solutions on AWS and Azure, with security policies, backups and compliance controls."
      - "Resolved VIP and escalated cases, working with global teams and vendors to keep services running."

  - company: "Intel Corporation"
    period: "Jun 2017 – Aug 2018"
    role: "Help Desk Support Specialist"
    industry: "Semiconductors"
    location: "Mexico City"
    bullet_points:
      - "Provided technical support for software, hardware and accounts to end users and VIPs by phone, chat and email."
      - "Administered Microsoft Active Directory users, groups and distribution lists, and documented incidents in ITSM tools following ITIL."
      - "Supported Windows 7, 8.1 and 10 plus enterprise mobile apps on Android and iOS, and onboarded new users."

  - company: "Sykes"   # [CONFIRM] include this role (on LinkedIn, not on the CV)
    period: "Dec 2016 – Jun 2017"
    role: "Team Leader"
    industry: "Contact center"
    location: "Mexico City"
    bullet_points:
      - "Led a contact-center team: real-time floor support, call and chat quality audits, coaching and KPI-based performance management."
---
