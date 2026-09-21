/* Fachliche KI-Empfehlungen bleiben deaktiviert, bis Zweckbestimmung,
   Datengrundlage und Ausgaben klinisch geprüft sind. */

export default function handler(req, res){
  if (req.method === "GET")
    return res.status(200).json({ endpoint:"advice", available:false });
  if (req.method === "POST")
    return res.status(503).json({ error:"clinical_review_required",
      message:"Ärztliche KI-Empfehlungen sind bis zur fachlichen Prüfung deaktiviert." });
  return res.status(405).json({ error:"method_not_allowed" });
}
