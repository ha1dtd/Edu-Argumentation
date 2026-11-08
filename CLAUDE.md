# Edu-Argumentation — parent repo (since 08-11-26)

This repo is the PARENT: the app lives here (`app/ lab/ deploy/ gates/ books/`), and two submodules sit inside it:

- `ml/`  — ha1dtd/Machine-Learning: the ML/edu harness, law, state and memory. **Its rules bind every session here.**
- `aws/` — ha1dtd/aws: AWS cert study content (aws lane edits `books/t-clf-c02-cloud-practitioner/module.json` only).

Lane split: **ml** = app code, features, deploy, infra · **aws** = study content only.
Push order: inside a submodule first (its own branch), then bump + push this repo's pointer on `hais-work`. Never force-push.
Closeout/push across repos is run by the CoreX `coordinator` session — obey a `CLOSEOUT-CHAIN from coordinator` message.

Lane state: `ml/process/context/state/state.edu.md`. AWS harness: `aws/CLAUDE.md` (read it before touching AWS content).

@ml/CLAUDE.md
