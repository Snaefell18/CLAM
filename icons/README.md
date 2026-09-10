# Icons

Hier kommt das Logo hin. Alle Dateien sind PNG.

| Datei | Größe | Wofür |
|---|---|---|
| `boot-logo.png` | ca. 1200 px breit, transparenter Hintergrund | Splashscreen, sitzt unten auf dem Farbverlauf |
| `apple-touch-icon.png` | 180 × 180 | Home-Bildschirm iOS, Login-Screen |
| `icon-192.png` | 192 × 192 | PWA |
| `icon-512.png` | 512 × 512 | PWA |
| `icon-maskable-512.png` | 512 × 512, Motiv mit ~10 % Rand | Android adaptive |
| `favicon-32.png` | 32 × 32 | Browser-Tab |

## Seitenverhältnis des Splash-Logos

In `index.html` steht bei `.boot` die Zeile:

```css
--logo-ratio:0.6825;
```

Das ist **Höhe ÷ Breite** der Datei `boot-logo.png`. Bei einem Logo von
1200 × 600 px trägst du `0.5` ein. Nur diese eine Zahl — die restliche
Splash-Geometrie hängt daran.

Solange `boot-logo.png` fehlt, merkt die App das und zeigt den Splash ohne
Grafik: nur den Farbverlauf mit der animierten Wortmarke. Es sieht also auch
vor dem Upload fertig aus.
