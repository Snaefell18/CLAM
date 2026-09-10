# CLAM — Closed-Loop Autoimmune Management

Erkennt bei Autoimmunerkrankungen früh Hinweise auf einen möglichen Schub und
führt Patient und Praxis rechtzeitig zur passenden Diagnostik.

Der geschlossene Kreis:

```
Wearable + Tages-Check + Fotos
   → Schubrisiko gegen die persönliche Baseline
   → gezielte Nachfragen bei erhöhtem Risiko
   → Meldung an die Praxis
   → dort Diagnostik (PoC-TDM, Entzündungswerte)
   → Befund zurück in die App
   → nächster Verlauf auf besserer Grundlage
```

Die App diagnostiziert nicht und legt keine Therapie fest. Sie erkennt
Abweichungen vom individuellen Normal und macht daraus eine Handlung.

---

## Was ich von dir brauche

Sechs Dinge. Ohne die ersten vier läuft die App nicht, die letzten beiden sind
Komfort.

### 1. Logo · **erforderlich**

Du wolltest ein eigenes Logo hochladen — das Walross ist raus. Leg diese
Dateien nach `icons/`:

| Datei | Größe | Wofür |
|---|---|---|
| `boot-logo.png` | ca. 1200 px breit, transparent | Splashscreen, sitzt unten auf dem Farbverlauf |
| `apple-touch-icon.png` | 180 × 180 | Home-Bildschirm iOS, Login-Screen |
| `icon-192.png` | 192 × 192 | PWA |
| `icon-512.png` | 512 × 512 | PWA |
| `icon-maskable-512.png` | 512 × 512, Motiv mit ~10 % Rand | Android adaptive |
| `favicon-32.png` | 32 × 32 | Browser-Tab |

**Zum Seitenverhältnis des Splash-Logos:** In `index.html` steht bei `.boot`
die Zeile `--logo-ratio:0.6825`. Das ist Höhe ÷ Breite deiner Grafik. Bei einem
Logo von 1200 × 600 px trägst du `0.5` ein. Nur diese eine Zahl — der Rest der
Splash-Geometrie hängt daran.

Solange noch kein `boot-logo.png` da ist, läuft der Splash trotzdem sauber: die
App merkt das und zeigt nur den Farbverlauf mit der animierten Wortmarke.

Falls die Wortmarke anders heißen soll als `CLAM` / `health` — sag Bescheid,
das sind zwei Zeilen in `index.html`.

### 2. Firebase-Projekt · **erforderlich**

1. Auf [console.firebase.google.com](https://console.firebase.google.com) ein
   Projekt anlegen (z. B. `clam-app`).
2. **Authentication** → Anmeldemethoden **E-Mail/Passwort** und **Google**
   aktivieren.
3. **Firestore Database** anlegen, Modus *Production*.
4. **Storage** aktivieren (für die Fotos).
5. **Projekteinstellungen → Meine Apps → Web-App** hinzufügen und die
   SDK-Konfiguration kopieren.

Diese sechs Werte trägst du oben in `app.js` bei `FIREBASE_CONFIG` ein:

```js
const FIREBASE_CONFIG = {
  apiKey:            "…",
  authDomain:        "clam-app.firebaseapp.com",
  projectId:         "clam-app",
  storageBucket:     "clam-app.firebasestorage.app",
  messagingSenderId: "…",
  appId:             "…"
};
```

Diese Werte dürfen öffentlich im Frontend stehen — das ist bei Firebase so
vorgesehen. Der Schutz läuft über die Regeln in Schritt 3.

Danach die Sicherheitsregeln einspielen:

```bash
firebase deploy --only firestore:rules,storage
```

Die Regeln liegen in `firestore.rules` und `storage.rules` und sind bewusst
streng: **jeder kommt nur an die eigenen Daten**, keine Ausnahme, kein
Praxiszugang über die Datenbank.

### 3. Claude-API-Key · **erforderlich**

Du sagst, den hast du. Er gehört **niemals ins Frontend**, sondern als
Umgebungsvariable auf den Server:

Vercel → Projekt → **Settings → Environment Variables**

| Name | Wert |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-…` |

Danach einmal neu deployen. Prüfen kannst du es, indem du
`https://deine-domain/api/assess` im Browser aufrufst — dort steht dann
`"api_key_present": true`.

Alle drei Claude-Endpunkte laufen über **Sonnet 5**, serverseitig festgelegt in
`api/_claude.js`. Wenn du günstiger fahren willst, ist das die eine Zeile, die
du änderst.

### 4. Deployment · **erforderlich**

Vercel, gleiches Vorgehen wie bei fitten.me:

```bash
npm i -g vercel
vercel
```

`package.json` und `vercel.json` liegen bereit. Die einzige Abhängigkeit ist
`firebase-admin`, und die braucht nur der Ingest-Endpunkt aus Schritt 5.

### 5. Dienstkonto für die automatische Wearable-Übernahme · optional

Nur nötig, wenn sich die Werte per Apple-Kurzbefehl automatisch eintragen
sollen. Ohne das trägt man Vitalwerte von Hand ein und die App funktioniert
vollständig.

Firebase-Konsole → **Projekteinstellungen → Dienstkonten → Neuen privaten
Schlüssel generieren**. Das heruntergeladene JSON **komplett** (als eine Zeile)
in Vercel eintragen:

| Name | Wert |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | `{"type":"service_account", …}` |

Der Endpunkt repariert die `\n` im privaten Schlüssel selbst — das ist der
häufigste Stolperstein beim Kopieren.

Danach erzeugt sich jeder Nutzer in den App-Einstellungen unter
**Automatische Übernahme** einen persönlichen Schlüssel und baut den
Kurzbefehl (Anleitung steht in der App, Beispiel weiter unten).

### 6. Mailversand an die Praxis · optional

Aktuell wird ein Bericht erzeugt, dir vollständig angezeigt und nach deiner
Bestätigung in Firestore unter `users/{uid}/reports` mit `status: "queued"`
abgelegt. Der tatsächliche Mailversand ist **noch nicht angebunden** — bewusst,
denn dafür brauche ich eine Entscheidung von dir:

- **Wer ist Absender?** Eine eigene Domain (`praxis@clam.app`) braucht
  SPF/DKIM, sonst landet die Mail im Spam.
- **Welcher Dienst?** Resend, Postmark und SendGrid haben alle brauchbare
  kostenlose Kontingente. Ich würde **Resend** nehmen: am wenigsten Aufwand.
- **Braucht die Praxis eine Empfangsbestätigung oder einen Rückkanal?**

Sag mir, was du willst, dann baue ich `api/send.js` plus eine Firestore-Trigger-
Function, die `queued` abarbeitet und auf `sent` setzt.

> **Wichtig für den Datenschutz:** Ein Gesundheitsbericht per unverschlüsselter
> E-Mail ist heikel. Sauberer wäre ein Link auf eine geschützte Ansicht, in der
> die Praxis den Bericht abruft. Wenn das produktiv gehen soll, sollten wir
> darüber reden, bevor wir Mails verschicken.

---

## Aufbau

```
CLAM/
├─ index.html          Designsystem + alle Screens
├─ app.js              Oberfläche, Firebase, Ablauf
├─ risk.js             ← der Kern: Baseline und Schubrisiko
├─ data.js             Diagnosen, Medikamente, Gelenke, Laborwerte
├─ api/
│  ├─ _claude.js       gemeinsame Basis (kein Endpunkt, führender _)
│  ├─ assess.js        gezielte Nachfragen bei erhöhtem Risiko
│  ├─ photo.js         Auswertung der Gelenkfotos
│  ├─ report.js        Bericht für die Praxis
│  └─ ingest.js        Apple-Kurzbefehl → Firestore
├─ firestore.rules     Zugriffsregeln
├─ storage.rules       Zugriffsregeln für Fotos
└─ icons/              ← hier kommt dein Logo hin
```

Kein Build-Schritt, keine Framework-Abhängigkeit — ES-Module direkt im Browser,
genau wie fitten.me. Das ist Absicht: das Designsystem ist Zeile für Zeile das
gleiche, und du kannst beide Apps auf die gleiche Art pflegen.

---

## Wie das Schubrisiko berechnet wird

Alles in `risk.js`, ausführlich kommentiert. Das Wesentliche:

**Individuelle Baseline statt Normwerte.** Ein Ruhepuls von 72 kann für die eine
Person völlig normal und für die andere 8 bpm über ihrem Üblichen sein. Nur die
zweite Aussage ist ein Signal. Grundlage sind Median und Streuung (MAD) über
28 Tage.

**Die Baseline endet zwei Tage vor dem bewerteten Tag.** Sonst zieht ein sich
aufbauender Schub seine eigene Vergleichsgrundlage mit nach oben und macht sich
damit unsichtbar — genau der Fall, den die App erkennen soll.

**Doppeltes Tor je Signal.** Ein Signal zählt erst, wenn es zugleich
statistisch auffällig *und* absolut relevant ist. Wer einen extrem gleichmäßigen
Ruhepuls hat, bekäme sonst schon bei 1,5 bpm Abweichung einen hohen z-Wert,
obwohl das klinisch nichts bedeutet.

**Beharrlichkeit.** „Hoch" wird nur ausgerufen, wenn der Wert an zwei
aufeinanderfolgenden Tagen über der Schwelle liegt — oder an einem Tag sehr
deutlich. Das dämpft Einzeltagsausreißer, ohne einen akuten Schub zu
verschleppen.

**Signale und Gewichte:**

| Signal | Richtung | Gewicht | Quelle |
|---|---|---|---|
| Schmerz | ↑ ungünstig | 1,30 | Tages-Check |
| Morgensteifigkeit | ↑ | 1,15 | Tages-Check |
| Ruhepuls | ↑ | 1,00 | Wearable |
| HRV | ↓ | 0,95 | Wearable |
| Befinden | ↑ | 0,90 | Tages-Check |
| Fatigue | ↑ | 0,80 | Tages-Check |
| Hauttemperatur | ↑ | 0,75 | Wearable |
| Aktivität | ↓ | 0,65 | Wearable |
| Schlaf | ↓ | 0,45 | Wearable |

### Zur Evidenz — bitte ernst nehmen

Die **Richtungen** stützen sich auf Beobachtungsstudien zu Wearables bei
entzündlich-rheumatischen Erkrankungen, unter anderem die 2025 publizierte
Kohorte mit 53 RA-Patienten (Apple Watch, Fitbit, Oura): während entzündlicher
Schübe waren Herzfrequenz und Ruhepuls erhöht, HRV und Aktivität verändert.

Die **konkreten Grenzwerte und Gewichte sind Hypothesen.** Es gibt bislang keine
validierten Cut-offs, aus denen sich ein Schubrisiko in Prozent ableiten ließe.
Deshalb steht jede Zahl in `risk.js` an genau einer Stelle, kommentiert und
einzeln änderbar — in `WEIGHTS` und `GATES`. Sobald eigene Verlaufsdaten oder
neue Studien Besseres hergeben, wird nur diese Datei angefasst.

Die ausgegebene Prozentzahl ist auf Plausibilität kalibriert, nicht auf
gemessene Ereignisraten. Sie wird bewusst auf 5er-Schritte gerundet: eine
Nachkommastelle würde eine Genauigkeit vortäuschen, die diese Kalibrierung
nicht hat.

---

## Apple-Kurzbefehl einrichten

Eine Web-App kommt nicht an HealthKit heran, das geht nur nativ. Der
praktikable Weg für ein PWA ist ein Kurzbefehl:

1. In der App unter **Einstellungen → Automatische Übernahme** einen
   persönlichen Schlüssel erzeugen.
2. In **Kurzbefehle** eine Automation anlegen:
   - Auslöser **Tageszeit**, z. B. 8:00 Uhr
   - **Gesundheitsdaten abrufen** für Ruhepuls, HRV, Schritte, Schlafdauer,
     Handgelenktemperatur
   - **Inhalte von URL abrufen**, `POST` auf `https://deine-domain/api/ingest`,
     Anfragetext JSON:

```json
{
  "token": "dein-persoenlicher-schluessel",
  "date":  "2026-09-24",
  "rhr":   62,
  "hrv":   45,
  "steps": 8200,
  "sleep": 7.2,
  "temp":  33.15
}
```

Der Endpunkt prüft jeden Wert auf Plausibilität und verwirft Unsinn, statt ihn
zurechtzubiegen — eine Schlafdauer von 0, weil die Uhr nachts nicht getragen
wurde, darf die Baseline nicht nach unten ziehen. Was übernommen und was
verworfen wurde, steht in der Antwort.

---

## Rechtliches — was noch offen ist

Die Texte unter **Datenschutz** und **Nutzungsbedingungen** in `data.js` sind
**Platzhalter** und als solche markiert. Vor einer Veröffentlichung brauchst du:

- eine geprüfte Datenschutzerklärung für Gesundheitsdaten nach Art. 9 DSGVO
- Auftragsverarbeitungsverträge mit Google (Firebase) und Anthropic
- eine anwaltliche Einschätzung zur **Abgrenzung vom Medizinprodukt nach MDR**

Zum letzten Punkt: Die App ist durchgehend so gebaut, dass sie beschreibt statt
beurteilt — kein „Sie haben einen Schub", sondern „diese Werte weichen von deiner
Baseline ab". Der Hinweis „kein Medizinprodukt, keine Diagnose" steht an jeder
Stelle, an der ein Risikowert auftaucht, und dieselbe Regel steht als Leitplanke
in jedem System-Prompt an Claude. Das ist eine bewusste Konstruktion, aber
**keine Rechtsberatung** — sobald ein Risikoscore einer konkreten Person
zugeordnet wird, ist die MDR-Frage real und gehört geprüft.

---

## Was als Nächstes sinnvoll wäre

- **Mailversand** an die Praxis (siehe Punkt 6 oben) — dafür brauche ich deine
  Entscheidung.
- **Push-Benachrichtigungen**, wenn das Risiko steigt. Auf iOS geht das seit
  16.4 auch für installierte PWAs.
- **Rückkanal aus der Praxis**: aktuell trägt der Patient die Laborwerte selbst
  nach. Eine geschützte Ansicht, in der die Praxis Befund und Entscheidung
  direkt einträgt, würde den Loop wirklich schließen.
- **Kalibrierung an echten Daten.** Sobald genug Verläufe mit bestätigten
  Schüben vorliegen, lassen sich Gewichte und Schwellen aus den eigenen Daten
  bestimmen statt aus Hypothesen. Dafür ist der Code vorbereitet: gespeicherte
  Bewertungen liegen pro Tag in Firestore und sind gegen bestätigte Schübe
  auswertbar.
