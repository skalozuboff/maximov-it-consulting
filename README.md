# MAX-CIO — независимый ИТ-консалтинг

Production website: https://max-cio.ru/

## Branches and deployment

- **nda-safe-consulting-v2** is currently connected to Timeweb App Platform for automatic deployment. Until the Timeweb source branch is explicitly changed, commit production updates here.
- **main** was synchronized with the production branch during the 2026-11-24 consolidation. Keep it synchronized with the deployment branch, or first switch Timeweb to main.
- **baseline-2026-11-23** is a preserved historical snapshot for rollback; its history is contained in the consolidated merge commit. Do not deploy the baseline.

## Files

- `index.html` — production website and JavaScript inquiry form
- `apps-script/Code.gs` — versioned Google Apps Script source; changing this GitHub file does **not** update a separately deployed Apps Script web app
- `apps-script/README.md` — Apps Script setup instructions
- `demo-audit.html`, `demo_it_audit_report.pdf` — public example audit material
- `andrey-maximov.png` — site image

No force pushes are required. Make sure the latest production revision exists in the Timeweb-connected branch before deploying.
