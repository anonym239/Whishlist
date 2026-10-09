# 🎁 Wunschliste

Wunschlisten-Seite mit Anmeldung, eigenem Link pro Liste (`/abc123`), Preis-Sortierung und Animationen.
Läuft komplett auf Netlify (kostenlos): Netlify Functions + Netlify Blobs – **kein API-Key, keine externe Datenbank**.

## Funktionen
- 🎁 Wünsche mit Bild (URL oder Upload), Preis (€ wird automatisch ergänzt) und Shop-Link
- ⭐ 1–3 Sterne: wie sehr du dir etwas wünschst
- ✅ **Reservieren:** Freunde markieren „Ich besorge das“ – du als Besitzer siehst das nicht (Überraschung bleibt)
- ⏱ Live-Countdown (Tage, Stunden, Minuten, Sekunden) + Konfetti-Regen am großen Tag
- ✋ Eigene Reihenfolge (ziehen mit der Maus oder ◀ ▶ am Handy) oder nach Preis sortieren
- 📋 Mehrere Listen pro Konto (Geburtstag, Weihnachten, Hochzeit, Sonstiges)
- 💶 Gesamtsumme aller Wünsche
- 📤 Teilen per WhatsApp, Telegram, SMS, E-Mail oder andere Apps (Nachricht schon fertig geschrieben)
- ▦ QR-Code anzeigen, als Bild speichern oder direkt verschicken (z.B. WhatsApp)
- 🧭 Übersichtliche Bereiche: Wünsche · Hinzufügen · Teilen · Listen (am Handy als Leiste unten)
- 🌙/☀️ Hell- und Dunkel-Design zum Umschalten
- 🔑 Passwort vergessen über Sicherheitsfrage (ohne E-Mail-Dienst)
- 🔒 Schutz gegen Passwort-Raten: nach 5 Fehlversuchen 15 Minuten Sperre (pro E-Mail, zusätzlich max. 20 pro IP)
- 🙋 Beim Reservieren freiwillig den eigenen Namen angeben – nur andere Gäste sehen ihn
- 📲 Als App installierbar (Startbildschirm, eigenes Icon, öffnet auch offline)
- 🖨 Drucken / als PDF speichern, ⬇ als Textdatei herunterladen
- 📱 Optimiert für Handy, Tablet und PC

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
