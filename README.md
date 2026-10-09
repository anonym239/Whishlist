# 🎁 Wunschliste

Wunschlisten-Seite mit Anmeldung, eigenem Link pro Liste (`/abc123`), Preis-Sortierung und Animationen.
Läuft komplett auf Netlify (kostenlos): Netlify Functions + Netlify Blobs – **kein API-Key, keine externe Datenbank**.

## Hosten (Netlify)
1. Repo auf GitHub hochladen (siehe unten).
2. Netlify → *Add new site → Import an existing project* → GitHub → Repo `wishlist` wählen.
3. Einstellungen werden aus `netlify.toml` gelesen → *Deploy*. Fertig.

## Auf GitHub pushen
```bash
cd wishlist
git init -b main
git add .
git commit -m "Wunschliste"
gh repo create wishlist --public --source=. --push
```
(ohne GitHub CLI: Repo `wishlist` auf github.com anlegen, dann `git remote add origin <URL>` und `git push -u origin main`)

## Struktur
- `public/index.html` – komplette Seite
- `netlify/functions/api.mjs` – Anmeldung & Speicherung (scrypt-Passwörter)
- `netlify.toml` – Build & Weiterleitung `/<listen-id>` → Seite
