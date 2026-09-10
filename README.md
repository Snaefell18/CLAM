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

Punkt 1 ist erledigt, Punkt 2 halb. Ohne 2 bis 4 läuft die App nicht,
die letzten beiden sind Komfort.

### 1. Logo · **erledigt, mit einer Einschränkung**

Die hochgeladenen Dateien sind als Bildinhalt in der Unterhaltung angekommen,
nicht als Dateien im Arbeitsverzeichnis — ich konnte die Original-PNGs deshalb
nicht ins Repository legen.

Was jetzt drin ist: eine **Nachzeichnung als Vektor**. `icons/logo-mark.svg`
bildet Version 3 nach (die Verlaufsmarke), `icons/wordmark.svg` den
CLAM-Schriftzug. Beide sind der Vorlage sehr nahe, aber nicht Pixel für Pixel
identisch. Daraus erzeugt sind alle PNG-Icons für PWA, iOS und Browser-Tab.

Marke und Schriftzug stehen zusätzlich direkt in `index.html` — im Splash und
auf dem Login als eingebettetes SVG. Das ist Absicht: ein Splash darf nicht auf
einen Netzwerk-Abruf warten, sonst blitzt er leer auf. Nebenbei erlaubt der
Vektor die Zeichenanimation, bei der sich die Schleife einmal selbst zieht —
die Bewegung sagt genau das, was die App tut.

**Willst du die Originale einspielen**, geht das so:
- PNG-Icons in `icons/` einfach überschreiben, Namen beibehalten.
- Für Splash und Login: in `index.html` nach `clamGrad` suchen, dort stehen
  Marke und Schriftzug als Pfade.
- Hast du nur PNG statt SVG, sag Bescheid — dann baue ich den Splash auf
  `<img>` um. Die Zeichenanimation entfällt dann, die geht nur mit Vektoren.

Einzelheiten und die Farbwerte stehen in `icons/README.md`.
Icons neu erzeugen: `npm i playwright && node tools-make-icons.mjs`.

### 2. Firebase-Projekt · **Config eingetragen, Rest offen**

Die SDK-Konfiguration für `clam-cd7c5` steht in `app.js`. Diese Werte dürfen
öffentlich im Frontend stehen — so ist Firebase gebaut, der Schutz läuft über
die Regeln.

Offen in der Firebase-Konsole:

1. **Authentication** → Anmeldemethoden **E-Mail/Passwort** und **Google**
   aktivieren.
2. **Firestore Database** anlegen, Modus *Production*.
3. Regeln einspielen — entweder in der Konsole unter *Firestore Database →
   Regeln* den Inhalt von `firestore.rules` einfügen und veröffentlichen,
   oder im geklonten Projektordner:

```bash
npm i -g firebase-tools
firebase login
firebase deploy --only firestore:rules
```

`firestore.rules` ist bewusst streng: **jeder kommt nur an die eigenen Daten**,
kein Praxiszugang über die Datenbank.

**Firebase Storage wird nicht gebraucht.** Es setzt den Blaze-Plan voraus,
deshalb liegen auch die Fotos in Firestore — ein Dokument je Bild, vorher auf
ein festes Budget heruntergerechnet (siehe unten). Der kostenlose Spark-Plan
reicht damit für die ganze App.

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
├─ data.js             Vorgaben: Diagnosen, Medikamente, Gelenke, Laborwerte
├─ catalog.js          legt den Firestore-Katalog über die Vorgaben
├─ admin.js            Adminbereich: Tabellen, Excel-Austausch, Adminliste
├─ doctor.js           Praxisansicht: Code, Patientenliste, Empfehlung
├─ api/
│  ├─ _claude.js       gemeinsame Basis (kein Endpunkt, führender _)
│  ├─ assess.js        gezielte Nachfragen bei erhöhtem Risiko
│  ├─ photo.js         Auswertung der Gelenkfotos
│  ├─ report.js        Bericht für die Praxis
│  ├─ advice.js        Empfehlung für die Praxis
│  └─ ingest.js        Apple-Kurzbefehl → Firestore
├─ firestore.rules     Zugriffsregeln
├─ tools-make-icons.mjs  erzeugt den PNG-Iconsatz aus der Vektormarke
└─ icons/
   ├─ logo-mark.svg    Marke (Version 3), Quelle für alles Weitere
   ├─ wordmark.svg     Schriftzug CLAM
   └─ *.png            App-Icons für PWA, iOS und Browser-Tab
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

## Praxisansicht

Beim Login wählt man **Patient** oder **Praxis**. Nach dem ersten Anmelden
entscheidet aber nicht mehr die Auswahl, sondern welches Dokument existiert:
wer als Praxis angelegt ist, landet dort auch dann, wenn der Schalter auf
Patient stand. Der Patiententeil ist unverändert geblieben — eigener Screen,
eigenes Modul, eigene Sammlungen.

**Einrichtung.** Die Praxis trägt einmal ihre Stammdaten ein und bekommt einen
Code nach dem Muster `CLyyxxxx` — zwei Buchstaben, vier Ziffern. `I` und `O`
kommen nicht vor: am Telefon vorgelesen sind sie von `1` und `0` nicht zu
unterscheiden, und dieser Code wird vorgelesen. Vor der Vergabe wird geprüft,
ob er frei ist.

**Verknüpfung.** Der Patient trägt den Code unter *Einstellungen → Praxis
verknüpfen* ein, sieht vor der Bestätigung, welche Praxis er da freischaltet,
und hinterlegt seinen Namen für die Patientenliste. Die Richtung ist bewusst
so: **den Zugriff erteilt der Patient, nicht die Praxis**, und er kann ihn
jederzeit wieder lösen. Genauso steht es in den Firestore-Regeln.

**Was die Praxis sieht.** Kennzahlen, Verlauf, Tages-Checks, Laborwerte und die
Befundtexte der Fotos — **nicht die Fotos selbst**. Bilder von Händen sind
biometrienah und lassen sich nicht anonymisieren; wer die Aufnahme zeigen will,
tut das im Sprechzimmer.

Die Übersicht liest nur die Nutzerdokumente: der Patient schreibt bei jedem
Speichern eine Kurzfassung seines Risikos mit, damit die Liste eine einzige
Abfrage kostet statt einen Verlauf je Patient. Gelöst der Patient die
Verknüpfung, wird die Kurzfassung mitgelöscht — sie existierte nur, weil
jemand sie sehen durfte. Sortiert wird nach Dringlichkeit, nicht alphabetisch.

**Empfehlung.** Pro Patient auf Knopfdruck über `/api/advice`. Zielgruppe ist
hier ärztliches Personal, der Text darf also fachlich werden. Er bleibt
Entscheidungsunterstützung: keine Dosierungen, keine Verordnung, keine
Diagnose, und die Grenzen der Datengrundlage stehen drin.

---

## Adminbereich

Erscheint in den Einstellungen nur für Admins. Wurzel-Admin ist fest
`jan.rentzsch@googlemail.com`; weitere Admins trägt er dort selbst ein. Der
Wurzel-Admin lässt sich nicht entfernen — sonst könnte sich das Projekt
aussperren.

Pflegbar sind elf Tabellen: Erkrankungen, Medikamente, Signale, Gewichte,
Schwellen, Laborwerte, Tages-Check, Vitalwerte, Körperregionen, Wearables und
Steifigkeitsstufen. Also alles, worauf die Berechnung fußt.

**Wie das technisch läuft.** Die Vorgaben stehen weiterhin im Code
(`data.js`, `risk.js`). `catalog.js` legt einen in Firestore gepflegten Katalog
darüber und überschreibt die Strukturen **an Ort und Stelle** — `CONDITIONS`,
`SIGNALS`, `WEIGHTS` bleiben dieselben Objekte, nur ihr Inhalt wechselt.
Dadurch funktioniert jeder bestehende Import unverändert. Fehlt der Katalog
oder ist Firestore nicht erreichbar, läuft die App auf den Vorgaben weiter; es
gibt keinen Zustand ohne Stammdaten.

**Prüfung vor jedem Speichern.** Doppelte Kennungen, fehlende Pflichtfelder,
Nichtzahlen in Zahlenspalten und tote Querverweise werden abgewiesen — eine
Erkrankung, die auf ein nicht existierendes Signal zeigt, würde sonst
stillschweigend eine Frage aus dem Tages-Check ausblenden.

**Excel.** Export erzeugt eine Mappe mit einem Blatt je Tabelle; Kopfzeilen
sind die lesbaren Beschriftungen. Der Import akzeptiert Beschriftungen und
technische Schlüssel, prüft jedes Blatt einzeln und zeigt vor dem Übernehmen,
was sich ändert. Blätter mit Fehlern werden übersprungen, der Rest läuft durch.
Schlägt das Speichern fehl, wird alles zurückgerollt.

SheetJS wird erst geladen, wenn jemand tatsächlich exportiert oder importiert —
für alle, die nie in den Adminbereich kommen, fällt die Bibliothek nicht an.

> **Achtung bei Gewichten und Schwellen:** Sie wirken sofort auf alle Nutzer und
> verschieben deren angezeigtes Risiko. Bereits gespeicherte Tagesbewertungen
> bleiben stehen, damit der Verlauf nicht rückwirkend umgeschrieben wird.

---

## Wo die Fotos liegen

In Firestore, nicht in Firebase Storage — Storage verlangt den Blaze-Plan.

Ein Firestore-Dokument fasst 1 MiB, und Base64 bläht Bilddaten um ein Drittel
auf. Die App rechnet jedes Foto deshalb vor dem Speichern auf ein Budget von
rund 0,4 MiB herunter: erst sinkt die JPEG-Qualität, dann die Kantenlänge.
Kompression kostet weniger Erkennbarkeit als Auflösung, und für die Beurteilung
einer Schwellung zählt die Kantenschärfe mehr als die Politur. Ein Testbild mit
2400 × 1800 Pixeln reinem Rauschen — der ungünstigste Fall für JPEG — landet so
bei 325 KB; echte Fotos bleiben deutlich darunter.

Bild und Metadaten liegen getrennt: `users/{uid}/photos/{id}` trägt die
Bilddaten, der Tageseintrag nur Region, Befund und Datum. Das Tagesdokument
wird bei jedem Start geladen — mit eingebetteten Bildern wäre das nach ein paar
Wochen zäh.

Der Spark-Plan gibt 1 GiB Firestore-Speicher, das sind einige tausend Aufnahmen.

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
