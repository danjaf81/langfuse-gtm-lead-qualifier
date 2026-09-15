# Langfuse GTM Lead Qualifier

Small AI-assisted GTM lead qualification workflow built to explore Langfuse for tracing, prompt management, datasets, experiments and evaluation.

## Goal

The project evaluates companies for a hypothetical B2B SaaS company selling API infrastructure to the travel industry.

Three main signals are used:

1. Travel / hospitality relevance
2. B2B business model
3. API / integration / infrastructure orientation

The workflow returns:

- `segment`
- `fit_score`
- `reason`
- `next_action`

## Architecture

The first version delegated both classification and reasoning to the LLM.

This produced variable results across runs.

The architecture was then changed:

```text
Company data
    ↓
Deterministic business rules
    ↓
Segment + signals
    ↓
LLM
    ↓
Fit score + qualitative reasoning

Deterministic logic now handles:

signal detection
segment classification
recommended action

The LLM handles:

fit score
concise qualitative reasoning
Results
V1

Generic LLM-based classification:

66.7% accuracy

V2

Explicit qualification rubric:

86.7% – 93.3% accuracy across runs

The variation showed that deterministic business logic should not be delegated unnecessarily to the LLM.

V3

Hybrid architecture:

15 / 15 correct classifications

Langfuse

The project uses Langfuse for:

tracing and observability
prompt management
prompt versioning
datasets
experiments
automated evaluators

A benchmark dataset of 15 simulated companies is used for experiments.

Evaluators include:

segment_accuracy
score_range_consistency
reason_word_limit
reason_quality
Prompt comparison
Metric	Prompt v1	Prompt v2
Segment accuracy	1.000	1.000
Score range consistency	1.000	1.000
Reason word limit	1.000	1.000
Reason quality	0.500	0.550

Prompt v2 preserved the functional constraints while producing a small improvement in reasoning quality.

Main learning

The most useful outcome was identifying which decisions should not be made by the LLM.

Stable business rules are better kept in application code.

The LLM is used where probabilistic reasoning adds value.

Stack
Node.js
JavaScript / ES Modules
OpenAI API
Langfuse
OpenTelemetry
JSON Schema
Git / GitHub
Run

Install dependencies:

npm install

Create .env from .env.example and add your API keys.

Run the application:

node index.mjs

Run the experiment:

node experiment.mjs

Compare prompt versions:

node compare-prompts.mjs
Security

API keys are stored locally in .env.

The .env file is excluded from Git and must never be committed.

Built by Daniele Campese as a small technical experiment around AI observability, evaluation and GTM automation.