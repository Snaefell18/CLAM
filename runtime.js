// A failed SDK download must never leave an endless splash screen.
try {
  await import("./app.js");
} catch {
  document.getElementById("boot")?.classList.add("off");
  const panel = document.createElement("div");
  panel.className = "glass card";
  panel.style.cssText = "max-width:440px;margin:12vh auto;padding:28px";
  panel.innerHTML = `<h2>CLAM konnte nicht starten</h2>
    <p class="sub" style="margin:16px 0">Bitte prüfe die Verbindung und lade die Seite erneut.
    Die Präsentationsdemo läuft ohne Anmeldung und ohne externe Dienste.</p>
    <button class="btn btn-primary" id="boot-retry">Erneut laden</button>
    <a class="btn btn-glass" style="margin-top:12px" href="/?demo=1">Demo öffnen</a>`;
  document.body.append(panel);
  document.getElementById("boot-retry").onclick = () => location.reload();
}
