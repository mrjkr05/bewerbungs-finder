# Bewerbungs-Finder

Statische Seite (HTML, CSS, JS) plus eine kleine Vercel-Funktion (`api/jobs.js`), die die öffentliche Job-API der Bundesagentur für Arbeit abfragt.

## Online stellen
1. Alle Dateien (inklusive Ordner `api`) in ein GitHub-Repository hochladen.
2. Auf vercel.com "Add New > Project", das Repository wählen, "Deploy" klicken. Keine Einstellungen nötig.
3. Seite öffnen, Profil ausfüllen, suchen.

## Benutzung
- Dein Profil bleibt nur in deinem Browser (localStorage), nicht im Code.
- Bei jedem ersten Besuch pro Tag sucht die Seite automatisch neu.
- Pro Stelle: Firma, Anschreiben (editierbar), Lebenslauf, Druck als PDF, Link zur Original-Anzeige.

## Hinweis
Die Seite öffnet lokal per Doppelklick nur die Oberfläche. Die Suche braucht `/api/jobs`, also Vercel (oder `npx vercel dev`).
