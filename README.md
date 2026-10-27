# SWE Lens Candidate Analyzer Demo

A working public demo of the backend analysis concept from the original Candidate Analyzer project.

**Live demo:** <https://josephmhernandez.com/demos/candidate/>

## Working flow

1. The browser extracts text from a selected PDF locally.
2. The résumé text, target role, and optional public GitHub username are sent to a throttled AWS HTTP API.
3. Lambda retrieves public repository metadata and README evidence using a server-side GitHub credential.
4. Gemini Flash—the model family used by the later original worker—returns a structured, evidence-oriented report.
5. Nothing is written to the retired Supabase candidate tables; the request is processed in memory.

The demo intentionally excludes accounts, subscriptions, token purchases, Stripe, and automated hire/reject decisions.

## Relationship to the original code

The original system had a FastAPI submission service, SQS queues, Supabase task tracking, and separate repository/candidate workers. An early module imported LangChain classes, but its active model calls used the Google Generative AI client directly; the later worker also called Gemini directly. This demo preserves the staged repository-evidence and candidate-analysis prompts while using a smaller serverless runtime suitable for a public portfolio.

## Deploy

```bash
sam build
sam deploy --stack-name jmh-candidate-analyzer-demo --resolve-s3 --capabilities CAPABILITY_IAM
```

## Safety and cost controls

- API throttling and Lambda reserved concurrency
- Input length limits and public GitHub evidence only
- No database or object storage for résumé/job text
- A low-cost Gemini Flash model with bounded output tokens
- The report explicitly supports human review and does not make employment decisions

## License

MIT
