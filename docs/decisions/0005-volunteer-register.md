# ADR 0005 – Freiwilligenregister, Versicherungsindikation und Fristen

Status: angenommen (Sprint 2.4, 30.10.2026)

## Kontext

ETS/ODV müssen nicht gelegentlich tätige Freiwillige in einem Register führen und alle Freiwilligen versichern (Art. 17–18 D.Lgs. 117/2017, D.M. 6.10.2021). Elektronische Register müssen Unveränderbarkeit und Datum der Einträge sicherstellen. Die Anwendung kann weder Versicherungsschutz noch Rechtsgültigkeit einer Signatur verbindlich feststellen.

## Entscheidung

1. **Drei Ebenen.** Operative Tätigkeit (änderbar, versioniert) → gesetzliches Register (append-only, Hash-Kette je Sektion) → festgeschriebene Registerstände (reproduzierbares PDF, SHA-256, verkettete Nummern, Statusmaschine). Übergänge zwischen den Ebenen sind bewusste Handlungen mit eigener Berechtigung.
2. **Personen nur einmal.** Registerdaten werden in `persons` gepflegt und je Eintrag als Momentaufnahme gespeichert. Spätere Personenänderungen überschreiben keinen Eintrag, sondern erzeugen einen Korrekturbedarf.
3. **Datenbank als letzte Instanz.** Unveränderbarkeit, Nummerierung, Verkettung, Snapshot-Übergänge, Überschneidungen und Fristnachweise werden durch Trigger erzwungen, nicht nur durch den Service.
4. **Signatur außerhalb.** Eine `SignatureProvider`-Schnittstelle trennt künftige qualifizierte Dienste ab; heute gibt es nur den nicht-qualifizierten manuellen Anbieter. Importierte Dateien werden technisch geprüft, die Gültigkeitsprüfung wird extern durchgeführt und dokumentiert. Der höchste Status ist „Extern geprüft“; eine rechtliche Freigabe des Verfahrens wird separat referenziert.
5. **Versicherung als Indikation.** Vier Zustände statt „versichert ja/nein“; maßgeblich bleibt der Vertrag.
6. **Fristen aus versionierten Regeln.** Regeln sind je Organisation editierbar, aber nur durch neue Versionen; erzeugte Fristen sind über `source_key` idempotent.
7. **Idempotenz ohne Personendaten.** Freiwilligen-Schreibvorgänge nutzen das bestehende Operationsprotokoll, speichern dort aber nur IDs; Antworten werden frisch gelesen.

## Konsequenzen

- Register und Snapshots sind nur durch neue Einträge korrigierbar; ein fehlerhafter Stand bleibt sichtbar und wird durch einen späteren ersetzt.
- Ein Wechsel regelmäßig/gelegentlich erfordert Austritt und neue Tätigkeit.
- Juristische Klärungen (Intervall, Unterzeichner, Aufbewahrung) bleiben Konfiguration und sind in der [Validierungsgrundlage](../legal/volunteer-register-validation.md) dokumentiert.
