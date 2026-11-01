# Nestly – der Minimalplan

> Stand: 1. November 2026. Ziel: mit möglichst wenig Aufwand und ohne laufende Kosten ein paar
> Euro verdienen; Claude macht fast alles. Kennzeichnung: **[belegt]** mit Quelle ·
> **[Annahme]** begründete Schätzung · **[offen]** vor dem Schritt prüfen.

## In einem Satz

Kostenlose Kündigungs-Vorlagen und die App laufen auf GitHub Pages (0 €). Wer dort einen Vertrag
kündigen will, bekommt einen gekennzeichneten Link zum Tarifvergleich – kommt ein Wechsel
zustande, gibt es Provision. Dazu ein freiwilliger Trinkgeld-Link.

## Warum genau das

- **Kein Store:** spart 25 $, den Pflichttest mit 12 Testern über 14 Tage und mehrere Formulare.
- **Kein Server:** 0 € im Monat. Die Vorlagen und das Vertrags-Radar der App funktionieren ohne.
- **Kein Bezahlsystem:** Die Provision zahlt der Partner; keine Abo-Technik, keine Store-Gebühr.
- **Besucher kommen über Google,** nicht über deine Zeit.
- **Der Moment passt:** Wer „Stromvertrag kündigen“ sucht, will oft wechseln. CHECK24 zahlt laut
  Awin-Profil ca. 16,50 € pro Online-Stromwechsel und 20–55 € pro DSL-Abschluss
  **[belegt, Seite undatiert – im Partnerportal prüfen]** ([Awin](https://ui.awin.com/merchant-profile/9364)).
- **Ich kann alles bauen, ändern und veröffentlichen.** Alle Einstellungen stehen in
  [`site.config.json`](../site.config.json); du schickst mir die Daten einfach im Chat.

**Schon fertig:** Vorlagen-Seiten für Strom, Gas, Internet, Handy, Haftpflicht/Hausrat und
Fitnessstudio mit Generator, Fristen und FAQ (`/kuendigen/`), Sitemap, Tarif-Check in der App,
Trinkgeld-Link, Impressum und Datenschutzerklärung aus deinen Angaben. Partnerlinks erscheinen
erst, wenn ein Impressum existiert – vorher bleibt alles werbefrei und nichtkommerziell.

## Was du machst – einmalig, ca. 1 Stunde

| # | Schritt | Zeit | Kosten |
| --- | --- | --- | --- |
| 1 | Schreib mir „PR“: Ich erstelle den Pull Request, du klickst auf *Merge*. Danach ist alles live unter `emilio1818-cloud.github.io/wg/kuendigen/`. | 2 Min. | 0 € |
| 2 | Schick mir **Name, Adresse und E-Mail** fürs Impressum. Pflicht, sobald Partnerlinks erscheinen. | 2 Min. | 0 € (Impressums-Adresse ca. 5–15 €/Monat, falls deine Wohnadresse nicht öffentlich sein soll **[Annahme]**) |
| 3 | **Gewerbe anmelden** (online bei deiner Gemeinde) – vor der ersten Provision. | 20 Min. | ca. 15–60 € einmalig **[Annahme]** |
| 4 | Beim **CHECK24-Partnerprogramm** anmelden (direkt oder über Awin), als Website `…/wg/kuendigen/` angeben, Partnerlinks für Strom, Gas, DSL, Handy und Haftpflicht/Hausrat erzeugen und mir schicken. | 30 Min. | 0 € **[offen: ggf. kleine Prüfgebühr bei Awin]** |
| 5 | *Optional:* Seite bei **Ko-fi** anlegen und mir den Link schicken. Ko-fi nimmt auf Spenden 0 %, nur PayPal/Stripe kosten Gebühren **[belegt über Drittquellen]** ([Ko-fi](https://ko-fi.com/patreon)). | 5 Min. | 0 € |
| 6 | *Optional:* Website in der **Google Search Console** hinzufügen, mir den Bestätigungscode schicken, danach die Sitemap einreichen. Beschleunigt die Aufnahme bei Google. | 10 Min. | 0 € |

Danach ist nichts mehr Pflicht. Wer mag, postet den Link in zwei, drei WhatsApp-Gruppen oder
beantwortet damit Fragen auf Reddit – Texte liegen in [marketing/OUTREACH.md](marketing/OUTREACH.md).

## Was ich mache

- **Sobald deine Daten da sind:** eintragen, testen, veröffentlichen.
- **Laufend:** weitere Vorlagen-Seiten für Suchbegriffe rund um WGs (z. B. Miete in der WG aufteilen,
  Putzplan-Vorlage, Kaution zurückfordern, Rundfunkbeitrag in der WG), Texte nach den Daten aus
  der Search Console verbessern, Fehler beheben.

## Was realistisch ist

- **Zeit:** Google braucht Wochen bis Monate, bis neue Seiten gut gefunden werden **[Annahme]**. Eine
  Adresse unter `github.io` hat es schwerer als eine eigene Domain, und große Kündigungsportale
  sind starke Konkurrenz. Erste Provision eher nach 1–3 Monaten **[Annahme]**.
- **Größenordnung [Annahme]:** 1.000 Besucher im Monat auf den Strom-/DSL-Seiten → 5–10 % klicken
  den Vergleich → 10–20 % schließen ab → ca. 5–20 Abschlüsse × 16–55 € ≈ **80–1.000 € im Monat**.
  Am Anfang eher **0–50 €**.
- **Schlechtester Fall:** Google zeigt die Seiten kaum. Dann hat es dich eine Stunde und die
  Gewerbeanmeldung gekostet.

## Kosten

**Laufend 0 €.** Einmalig die Gewerbeanmeldung. Optional später eine eigene Domain
(ca. 1–15 €/Jahr **[Annahme]**), die bei Google hilft.

## Ausbau – nur wenn die Zahlen es rechtfertigen

| Signal | Nächster Schritt | Kosten |
| --- | --- | --- |
| erste Provisionen oder ca. 1.000 Besucher im Monat | eigene Domain | ca. 1–15 €/Jahr |
| WGs wollen die App gemeinsam nutzen (Synchronisation) | Sync-Server: kostenlos über Cloudflare (Umbau, mache ich; SQLite-Speicher ist im Gratis-Plan verfügbar **[belegt]** ([Cloudflare](https://developers.cloudflare.com/changelog/2026-01-07-durable-objects-sqlite-storage-billing)), genaue Limits **[offen]**) oder fertig vorbereitet auf einem kleinen Server für ca. 4–6 €/Monat ([LAUNCH.md](LAUNCH.md)) | 0–6 €/Monat |
| ca. 300 aktive WGs | Play Store ([store/PLAY_STORE.md](store/PLAY_STORE.md)) und Nestly Plus: 2,99 €/Monat oder 19,99 €/Jahr pro WG | 25 $ einmalig |

## Was gegenüber dem ersten Plan rausgeflogen ist

| Raus | Warum |
| --- | --- |
| Play Store zum Start | 25 $, 12 Tester über 14 Tage, Formulare – lohnt erst mit Nutzern |
| eigener Server zum Start | 4–6 € im Monat würden „ein paar Euro“ auffressen |
| Nestly Plus und Bezahlsystem | bringt ohne Nutzer 0 € |
| Videos, Uni-Mails, Coliving-Anfragen | kosten deine Zeit; bleiben als Option in [marketing/](marketing/) |

## Risiken und offene Punkte

| Punkt | Was tun |
| --- | --- |
| Partnerprogramm lehnt ab oder schränkt Werbeformen ein **[offen]** | anderes Vergleichsportal; die Seiten funktionieren mit jedem Link |
| Rechtstexte und Vertragsregeln | Vorlagen, keine Rechtsberatung; die Seiten sind bewusst allgemein und tragen „Angaben ohne Gewähr“ |
| Steuern | Provisionen sind Einnahmen. Kleinunternehmerregelung (§ 19 UStG; seit 2025: Vorjahr bis 25.000 €, laufendes Jahr bis 100.000 €) spart Umsatzsteuer-Aufwand. Keine Steuerberatung – im Zweifel beim Finanzamt fragen. |
| Name „Nestly“ | In den USA laufen Markenanmeldungen **[belegt über Drittanbieter]** ([Markinton](https://markinton.com/trademark/nestly-99640757)); vor einer eigenen Domain im DPMA-/EUIPO-Register prüfen |
