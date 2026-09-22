export function mountDemo({ demo, openSheet, closeSheet, openHistory, openCheckin, openReport }){
  document.body.classList.add("demo-mode");
  const bar = document.createElement("header");
  bar.className = "demo-bar";
  bar.innerHTML = `<div class="demo-label"><span class="demo-dot"></span>
    <b>CLAM Demo</b><span>Synthetische Daten</span></div>
    <nav class="demo-controls" aria-label="Präsentationsmodus">
      <button id="demo-patient" aria-pressed="true">Patientin</button>
      <button id="demo-doctor" aria-pressed="false">Praxis</button>
      <button id="demo-guide">Ablauf</button>
      <button id="demo-reset" title="Alle Demo-Eingaben zurücksetzen">Neustart</button>
    </nav>`;
  document.body.prepend(bar);
  const buttons = [...bar.querySelectorAll("button")];
  async function change(role, reset = false){
    buttons.forEach(b => b.disabled = true);
    closeSheet();
    try {
      if (reset) demo.resetDemo();
      await demo.switchDemoRole(role);
      document.getElementById("demo-patient").setAttribute("aria-pressed", String(role === "patient"));
      document.getElementById("demo-doctor").setAttribute("aria-pressed", String(role === "doctor"));
    } finally { buttons.forEach(b => b.disabled = false); }
  }
  document.getElementById("demo-patient").onclick = () => change("patient");
  document.getElementById("demo-doctor").onclick = () => change("doctor");
  document.getElementById("demo-reset").onclick = () => change("patient",true);
  document.getElementById("demo-guide").onclick = () => {
    openSheet("CLAM in vier Schritten", `
      <p class="sub">Anna Becker ist eine erfundene Patientin mit rheumatoider Arthritis.
      Ihr Beispiel zeigt, wie Beobachtungen zwischen zwei Arztterminen sichtbar werden.</p>
      <ol class="demo-steps">
        <li><b>Veränderungen erkennen</b><p>45 Tage Verlauf: stabile Ausgangswerte, dann drei Tage mit zunehmenden Abweichungen.</p></li>
        <li><b>Den Alltag ergänzen</b><p>Schmerz, Morgensteifigkeit und Befinden im Tages-Check dokumentieren.</p></li>
        <li><b>Das Gespräch vorbereiten</b><p>Beispielfragen beantworten und einen Bericht speichern. Die Patientin gibt ihn selbst weiter.</p></li>
        <li><b>Die Praxissicht öffnen</b><p>Die freigegebenen Verläufe von drei Demo-Patienten gemeinsam betrachten.</p></li>
      </ol>
      <p class="note">Alle Daten und vorbereiteten Ausgaben sind synthetisch. Die Demo sendet
      nichts an Firebase oder einen KI-Dienst. Eingaben bleiben nur bis zum Neuladen erhalten.
      Klinische Validierung und eine bestätigte Zustellung an die Praxis stehen noch aus.</p>`, `
      <button class="btn btn-primary" id="demo-start">Tages-Check zeigen</button>
      <button class="btn btn-glass" id="demo-trend">Verlauf zeigen</button>
      <button class="btn btn-glass" id="demo-report">Beispielbericht erstellen</button>`);
    for (const [id, action] of [["demo-start",openCheckin],["demo-trend",openHistory],["demo-report",openReport]])
      document.getElementById(id).onclick = async () => { await change("patient"); action(); };
  };
}
