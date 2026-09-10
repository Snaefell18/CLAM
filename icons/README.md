# Marke und Icons

## Herkunft — bitte lesen

Die hochgeladenen Logo-Dateien sind als **Bildinhalt** in der Unterhaltung
angekommen, nicht als Dateien im Arbeitsverzeichnis. Ich konnte die
Original-PNGs deshalb nicht ins Repository legen.

Was stattdessen hier liegt, ist eine **Nachzeichnung als Vektor**:
`logo-mark.svg` und `wordmark.svg` bilden Version 3 (die Verlaufsmarke) und
den CLAM-Schriftzug nach. Sie sind der Vorlage sehr nahe, aber nicht
Pixel für Pixel identisch.

**Wenn du die Originale einspielen willst**, siehe unten „Originale ersetzen".

## Was hier liegt

| Datei | Format | Verwendung |
|---|---|---|
| `logo-mark.svg` | Vektor, 224 × 136 | Quelle der Marke, Basis für alle PNGs |
| `wordmark.svg` | Vektor, 430 × 100 | Schriftzug CLAM |
| `icon-512.png` | 512 × 512 | PWA |
| `icon-192.png` | 192 × 192 | PWA |
| `icon-maskable-512.png` | 512 × 512, randlos | Android adaptive |
| `apple-touch-icon.png` | 180 × 180, randlos | Home-Bildschirm iOS |
| `favicon-32.png` | 32 × 32 | Browser-Tab |

Marke und Schriftzug stehen **zusätzlich direkt in `index.html`** — im Splash
und auf dem Login-Screen als eingebettetes SVG. Das ist Absicht: ein Splash
darf nicht auf einen Netzwerk-Abruf warten, sonst blitzt er leer auf. Die
SVG-Dateien hier sind die gepflegte Quelle und die Vorlage für die PNGs.

## Farben

| Rolle | Wert |
|---|---|
| Verlauf links | `#0A6EEA` |
| Verlauf Mitte | `#1BB6C0` |
| Verlauf rechts | `#63DD82` |
| Schriftzug | `#26374A` |

Der Verlauf läuft leicht diagonal von unten links nach oben rechts.

## PNGs neu erzeugen

```bash
npm i playwright
node tools-make-icons.mjs
```

Das Skript rendert die Marke im Browser und schneidet die Iconflächen zu.
App-Icons bekommen die Verlaufsfläche mit weißer Marke — auf dem bunten
Hintergrund eines Startbildschirms setzt sich das durch. Die maskable-Variante
ist randlos und rückt die Marke auf 60 % ein, damit Android beim Zuschnitt auf
einen Kreis nichts abschneidet.

## Originale ersetzen

Wenn du die echten Dateien einspielen willst:

1. **PNG-Icons** einfach überschreiben — die Namen oben beibehalten, dann
   greift alles automatisch.
2. **Marke im Splash und Login**: in `index.html` nach `clamGrad` suchen. Dort
   stehen der `<path>` der Marke und die vier `<path>` des Schriftzugs. Hast du
   die Marke als SVG, ersetzt du Pfad und Verlauf direkt. Hast du nur PNG,
   sag Bescheid — dann baue ich den Splash auf `<img>` um; die
   Zeichenanimation entfällt dann allerdings, die funktioniert nur mit Vektoren.
