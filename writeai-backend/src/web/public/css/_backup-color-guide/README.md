# Color scheme backup — Writect Color Guide

Snapshot of website stylesheets taken before switching light theme to full white backgrounds (boss review).

## Restore

Copy any file from this folder back over `../`:

```
copy shared.css ..\shared.css
copy landing.css ..\landing.css
copy login.css ..\login.css
copy app.css ..\app.css
copy uninstall.css ..\uninstall.css
```

Or restore all at once from repo root:

```
Copy-Item writeai-backend\src\web\public\css\_backup-color-guide\*.css writeai-backend\src\web\public\css\ -Force
```

## What this backup preserves

- Soft lavender page/section backgrounds (`#FCF9FC` / `#F8F2F7`)
- Brand pink CTAs, plum secondary, deep-purple footer tokens
- Landing section washes (hero, cta-inline, etc.)
