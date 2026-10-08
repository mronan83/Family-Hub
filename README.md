# FamilyWise

A family digital board for a 32" 4K touch display: a child checks off chores, earns points, spends them in a rewards shop and works toward goals; parents manage everything from phone or laptop.

- Project brief and decisions: [`docs/00-README.md`](docs/00-README.md)
- Technical Architecture, Data Model, User Stories, Requirements and Traceability, Backlog: [`docs/`](docs/)
- Brand kit: [`brand/`](brand/) (open `brand/specimen.html`)

## Develop

Requires Node 22, pnpm 10, Python 3 and a local PostgreSQL with pgTAP. No Docker.

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test   # code checks
pnpm db:test                               # migrations + pgTAP on native Postgres
pnpm trace                                 # requirements traceability
pnpm dev                                   # app at http://localhost:3000
```

Delivery (pull request gates, previews, ordered production deploys) is described in [`docs/01-technical-architecture.md` §9](docs/01-technical-architecture.md).
