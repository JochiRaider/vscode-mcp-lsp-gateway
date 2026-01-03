---
name: lsp-audit-schema-runtime-consistency
description: 'Cross-check schema definitions against runtime validation and serialization using rg + LSP (keywords: schema, validate, parse, serialize, request, response, contract, ajv, zod, openapi, json schema, rg).'
---

# Lsp Audit Schema Runtime Consistency

## Inputs

Schema entry names or schema keywords; optional method/endpoint/tool name.

## Procedure (rg recon → LSP confirm)

0. Recon (rg) to stitch the schema ↔ runtime graph:
   - Locate schema files / validators: `rg -n "\b(schema|validate|validator|ajv|zod|joi|openapi)\b" src/ schemas/ docs/`
   - If you know a tool/method name: `rg -n -F "<toolOrMethodName>" src/ schemas/ docs/ test/`
   - Extract:
     - schema definition locations
     - validator instantiation locations
     - handler/dispatcher locations

1. LSP trace for correctness (avoid name-based inference):
   - From schema type/definition symbols: `references` to find usage sites.
   - From handler surface: `definition`/`references` back to schema types and validators.

2. Identify drift:
   - fields present in runtime but absent in schema (or vice versa)
   - tests missing for required fields / error mapping

## Output

Drift findings list with `(field/symbol, expected, observed, evidence)`.
