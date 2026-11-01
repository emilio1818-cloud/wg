# Nestly – Plan zum Geldverdienen

> Stand: 1. November 2026. Ziel: mit minimalen Ausgaben Einnahmen erzielen, und Claude erledigt
> so viel wie möglich. Kennzeichnung: **[belegt]** mit Quelle · **[Annahme]** begründete
> Schätzung · **[offen]** muss vor dem Schritt geprüft werden.

## Kurzfassung

1. **Die App bleibt kostenlos und unbegrenzt.** Das ist der Hebel gegen Splitwise (Gratis-Version
   mit Tageslimit und Werbung) und Flatastic (Premium pro Person). Eine WG-App wächst über
   Einladungen – jede Bezahlschranke im Kern bremst genau das.
2. **Geld kommt zuerst aus dem Tarif-Check** (schon eingebaut): Wenn ein Strom-, Gas-, Internet-,
   Handy- oder Versicherungsvertrag gerade kündbar ist, zeigt Nestly einen gekennzeichneten
   Partnerlink zum Tarifvergleich. Kein Bezahlsystem, keine Store-Gebühr, keine Datenweitergabe.
3. **Nestly Plus kommt erst, wenn es Nutzer gibt** (Ziel: ab ca. 300 wöchentlich aktiven WGs) –
   pro WG statt pro Person, und die App teilt den Preis automatisch als Fixkosten auf.
4. **Start mit Web + Android**, iPhone zunächst als installierbare Web-App. Der App Store (99 €/Jahr)
   lohnt sich erst mit Traktion.
5. **Kosten im ersten Jahr: ca. 100–200 €.** Realistisch sind am Anfang eher Hunderte als
   Tausende Euro im Monat; der Plan ist darauf ausgelegt, dass sich das mit Nutzerzahl skaliert,
   nicht mit deiner Arbeitszeit.

## Ehrliche Einschätzung zum „Zeitfenster“

Richtig ist: Apps zu bauen ist 2026 billig geworden. Genau deshalb sind die Stores voll, und
Google hat für neue private Entwicklerkonten eine Pflicht-Testphase eingeführt (siehe unten).
Der Engpass ist nicht mehr der Code, sondern **Vertrieb und Vertrauen**. Nestly hat hier zwei
echte Vorteile: Die App ist fertig und durchgetestet (166 automatische Tests), und sie besetzt
eine Lücke, die die bekannten Apps nicht abdecken – Verträge, Fristen und Fixkosten zusammen mit
Putzplan und Geld. Das Fenster ist also weniger „schnell Geld mit irgendeiner App“, sondern
„früh mit einer guten App in einer Nische sein, in der die Etablierten alt oder nervig sind“.

## Geldquellen

### 1. Tarif-Check – ab sofort

**Was es ist:** Eine Karte im Vertrag („Frist naht: Tarife vergleichen“, „Jederzeit wechselbar“,
„Anschlussvertrag finden“) und ein Tipp im Kündigungsschreiben („Erst wechseln, dann kündigen“).
Erscheint nur, wenn man wirklich handeln kann, nie während einer laufenden Mindestlaufzeit.
Gekennzeichnet als „Anzeige“, mit einem Tipp ausblendbar, in den Einstellungen abschaltbar.
Die Links kommen aus der Build-Variable `NESTLY_OFFERS`; ohne sie zeigt die App nichts an.

**Warum das passt:** Nutzer tragen Verträge und Fristen ohnehin ein. Der Moment „Frist läuft ab“
ist genau der Moment, in dem Vergleichsportale Provision zahlen – und der Hinweis spart den
Nutzern echtes Geld. Partnerlinks für Strom & Co. sind keine digitalen Güter, deshalb fällt
keine In-App-Kauf-Pflicht und keine Store-Provision an **[Annahme, nach Store-Richtlinien für
Dienstleistungen außerhalb der App]**.

**Provision:** Laut Awin-Profil zahlt CHECK24 ca. 16,50 € pro Online-Stromwechsel, Gas gleich;
CHECK24 selbst wirbt mit „bis zu 125 € pro Abschluss“ je nach Produkt
**[belegt, Seite undatiert – im Partnerportal prüfen]**
([Awin](https://ui.awin.com/merchant-profile/9364), [CHECK24 Partnerprogramm](https://www.check24.de/partner/partnerprogramm/)).

**Zu tun:** Bei einem oder mehreren Partnerprogrammen bewerben (CHECK24 direkt oder über Awin;
weitere Vergleichsportale möglich). **[offen]** Ob App-Traffic zugelassen ist und welche
Kennzeichnung der Partner verlangt, steht in den jeweiligen Bedingungen – bei der Bewerbung die
App als Traffic-Quelle angeben.

**Markenversprechen:** Bisher stand überall „Keine Werbung“. Mit dem Tarif-Check stimmt das
streng genommen nicht mehr. Ich habe die Texte deshalb auf „keine Werbebanner, keine Tracker“
umgestellt, sobald Partnerlinks aktiv sind. Ob du den Tarif-Check überhaupt willst, ist deine
Entscheidung – technisch reicht es, `NESTLY_OFFERS` leer zu lassen.

### 2. Nestly Plus – sobald es Nutzer gibt

| | Preis | Begründung |
| --- | --- | --- |
| Monatlich | **2,99 € pro WG** | in einer 4er-WG 0,75 € pro Person – Nestly bucht es selbst als Fixkosten und teilt es auf |
| Jährlich | **19,99 € pro WG** | passt zum Semester-Rhythmus, ca. 44 % günstiger als monatlich |
| Gründer-WG (einmalig) | **29,99 €**, nur für die ersten 500 WGs | frühes Geld, treue Erstnutzer, Dringlichkeit ohne Tricks |

Zum Vergleich: Flatastic verlangt im US-App-Store 1,99 $/Monat pro Person bzw. 6,49 $/Monat oder
34,99 $/Jahr für alle Mitbewohner; Splitwise Pro kostet ca. 4,99 $/Monat oder ca. 40 $/Jahr, die
Gratis-Version ist auf ca. 3–5 Ausgaben pro Tag begrenzt und zeigt Werbung
**[belegt über Store-Einträge und Drittquellen, Preise je Region verschieden]**
([Flatastic im App Store](https://apps.apple.com/app/id840810742),
[Splitwise im App Store](https://apps.apple.com/us/app/splitwise/id458023433),
[Splitwise-Preise 2026](https://getfinny.app/blog/splitwise-pricing-2026)).

**Was in Plus kommt** (der Kern bleibt immer frei und unbegrenzt): Fotos und Belege an Ausgaben
(kostet Serverspeicher, daher fair), Kassenbon-Scan, Nebenkosten-Assistent für die
Jahresabrechnung, Monatsbericht als PDF, mehrere WGs, Themes und App-Icons. Diese Funktionen
stehen auf der Roadmap und werden gebaut, wenn das Signal da ist.

**Warum nicht sofort:** Ohne Nutzer bringt eine Bezahlschranke 0 €, und jede Woche, die in
Zahlungsabwicklung fließt, fehlt beim Vertrieb. **Auslöser:** ca. 300 wöchentlich aktive WGs
(`active.d7` im Kennzahlen-Endpunkt) oder wiederholte Nachfragen von Nutzern.

**Technik und Gebühren, wenn es so weit ist:** In der Play-Store-App müssen digitale Abos über
Google Play Billing laufen; für Web-Apps im Play Store geht das über die Digital Goods API
**[belegt]** ([Chrome-Doku](https://developer.chrome.com/docs/android/trusted-web-activity/receive-payments-play-billing)).
Google und Apple behalten bei Abos bzw. kleinen Entwicklern 15 % ein **[Annahme nach aktuellem
Kenntnisstand – vor dem Start prüfen]**. Im Web erledigt ein „Merchant of Record“ (z. B. Paddle)
die Umsatzsteuer für dich.

### 3. Optional: Coliving-Anbieter und Wohnheime (B2B)

Coliving-Firmen und private Wohnheime verwalten Hunderte WG-Zimmer und haben genau die Probleme,
die Nestly löst. Ein „Haus-Modus“ für Betreiber zu z. B. 1 € pro Zimmer und Monat wäre bei
300 Zimmern so viel wert wie rund 100 Plus-Abos **[Annahme, Preis nicht validiert]**. Das
braucht Gespräche, die nur du führen kannst; Anschreiben und Einseiter liegen in
[marketing/B2B_PITCH.md](marketing/B2B_PITCH.md). Lohnt sich als Versuch nebenbei, ist aber kein
Muss für den Start.

### Bewusst nicht

- **Werbebanner:** zerstören das Vertrauensversprechen und bringen bei kleiner Nutzerzahl kaum etwas.
- **Daten verkaufen:** nein.
- **Bezahlte Werbung (Ads):** Bei 2–3 € Umsatz pro WG und Jahr ist jeder bezahlte Nutzer teurer als
  das, was er einbringt **[Annahme]**.

## Was es kostet

| Posten | Kosten | Wann |
| --- | --- | --- |
| GitHub Pages / Repository | 0 € | läuft schon |
| Google-Play-Entwicklerkonto | 25 $ einmalig | Woche 1 |
| Domain (.de) | ca. 1–15 € pro Jahr **[Annahme, je nach Anbieter]** | Woche 1 |
| Kleiner Server (z. B. Hetzner in Deutschland) | ca. 4–6 € pro Monat **[Annahme, aktuelle Preise prüfen]** | Woche 1 |
| Gewerbeanmeldung | ca. 15–60 € einmalig **[Annahme, je nach Gemeinde]** | vor der ersten Einnahme |
| Impressums-Adresse, falls deine Wohnadresse nicht öffentlich sein soll | ca. 5–15 € pro Monat **[Annahme]** | optional |
| Apple-Entwicklerprogramm | 99 € pro Jahr | erst bei Traktion |
| **Summe Jahr 1 ohne Apple** | **ca. 100–200 €** | |

Der Server ist Pflicht: Ohne ihn funktionieren Einladungen und Synchronisation nicht, und eine
WG-App ohne Sync ist eine Einzelspieler-App. Ein deutscher Hoster ist zugleich ein
Verkaufsargument („Daten liegen in Deutschland“). Die Server-Einrichtung ist vorbereitet
(`deploy/`, Anleitung in [LAUNCH.md](LAUNCH.md)).

## Was realistisch drin ist

Grobe Größenordnung pro **1.000 aktive WGs** und Jahr – alle Werte **[Annahme]**, zum Ersetzen
durch echte Zahlen, sobald sie da sind:

| Quelle | Rechnung | pro Jahr |
| --- | --- | --- |
| Tarif-Check | ca. 40 % der WGs tragen Strom/Internet ein → ca. 1 Wechselmoment pro Vertrag und Jahr → 5–10 % klicken → 20–30 % schließen ab → 25–80 Abschlüsse × 15–40 € | ca. 400–3.000 € |
| Plus | 3–5 % zahlen, ca. 17 € nach Store-Gebühr | ca. 500–850 € |
| **Summe** | | **ca. 1.000–4.000 €** |

Heißt: Mit 1.000 aktiven WGs ist es ein Taschengeld, mit 10.000 ein ordentliches Nebeneinkommen,
mit einem B2B-Kunden kann sich das schneller verschieben. Weil die laufenden Kosten fast null sind
und ich die Arbeit am Produkt mache, ist das Risiko klein – aber es ist kein schnelles Geld.

## Stores: Reihenfolge

1. **Web-App auf eigener Domain** (Woche 1). Funktioniert auf jedem Handy, inklusive iPhone
   („Zum Home-Bildschirm“, Push ab iOS 16.4).
2. **Google Play über Trusted Web Activity** (Woche 1–4). Neue private Entwicklerkonten müssen vor
   der Veröffentlichung einen geschlossenen Test mit **mindestens 12 Testern über 14 Tage am Stück**
   machen **[belegt]** ([Google Play Console Hilfe](https://support.google.com/googleplay/android-developer/answer/14151465)).
   Das ist kein Hindernis, sondern der erste Vertriebsschritt: 12 Tester = deine ersten 3–4 WGs.
3. **Apple App Store** (ab Traktion). Braucht 99 €/Jahr und eine native Hülle mit eigenen
   Funktionen (Capacitor ist vorbereitet), weil Apple reine Website-Verpackungen ablehnt.
   Bauen geht ohne eigenen Mac über Cloud-Build-Dienste **[offen: Gratis-Kontingente prüfen]**.

Store-Texte, Keywords und die Antworten für Googles Datensicherheits-Formular liegen in
[store/](store/).

## Marketing ohne Budget

In der Reihenfolge des erwarteten Ertrags:

1. **Der eingebaute WG-Loop.** Jede neue WG lädt 2–4 Leute ein (Link, QR, WhatsApp). Die
   wichtigste Kennzahl ist deshalb, wie viele WGs mindestens zwei aktive Geräte haben.
2. **Die 12 Play-Tester** aus Freundeskreis, eigener WG, Uni-Gruppen – echte WGs, echtes Feedback.
3. **Kurzvideos** (TikTok, Reels, Shorts): WG-Alltagshumor + Bildschirmaufnahme der App, 3 pro
   Woche. 20 Skripte liegen in [marketing/VIDEOS.md](marketing/VIDEOS.md).
4. **Uni-Kanäle:** Fachschaften, AStA, Wohnheim-Tutorien, Erstsemester-Gruppen. Vorlagen in
   [marketing/OUTREACH.md](marketing/OUTREACH.md).
5. **Communities:** Reddit (r/Studium, r/de, r/germany auf Englisch), mit Mehrwert statt Werbung.
6. **Suchmaschinen:** „Splitwise Alternative“, „Putzplan WG“, „Kündigungsschreiben Vorlage“ – als
   Nächstes baue ich frei nutzbare Werkzeugseiten (Kündigungsschreiben-Generator,
   Putzplan-Vorlage), die auf die App verweisen.
7. **Tech-Launch:** Show HN / Product Hunt („offline-first, null Abhängigkeiten, Open Source“) –
   bringt Glaubwürdigkeit und GitHub-Sterne, wenig WGs, aber kostet nichts.

**Timing:** Die WGs vom Wintersemester haben sich gerade gefunden (jetzt), im Januar kommen die
guten Vorsätze und der Putzplan-Streit, im März/April Sommersemester und Umzüge, im
September/Oktober der größte Schub.

## Zeitplan

| Woche | Du | Ich (Claude) |
| --- | --- | --- |
| **1** (2.–8. Nov) | Domain + Server mieten, Repository-Variablen setzen, Play-Konto anlegen, Gewerbe anmelden, bei Partnerprogramm bewerben | Server- und Store-Paket vorbereiten, Feature-Grafik, Fragen beantworten |
| **2** | 12 Tester einladen, geschlossenen Test starten, erste 3 Videos | Feedback der Tester einbauen, „WG endgültig löschen“ in der App, Werkzeugseiten für Suchmaschinen |
| **3–4** | Videos, Uni-Kanäle anschreiben | Fehler beheben, Store-Eintrag feinschleifen |
| **5** | Antrag auf Veröffentlichung im Play Store, Reddit-Launch | ASO nach ersten Daten anpassen |
| **6–8** | weiter Videos und Kanäle; Kennzahlen anschauen | je nach Zahlen: Plus bauen oder Vertrieb nachschärfen |

**Entscheidungspunkte nach 8 Wochen:** Unter 50 aktiven WGs → Kanal oder Positionierung ändern,
nicht noch mehr Funktionen bauen. Ab ca. 300 aktiven WGs → Plus bauen und iOS-App angehen.

## Kennzahlen

Der Server liefert anonyme Summen unter `GET /api/admin/stats` (nur mit `ADMIN_TOKEN`, keine Namen
oder Inhalte):

| Feld | Bedeutung | wofür |
| --- | --- | --- |
| `active.d7` | WGs mit Änderungen in den letzten 7 Tagen | Hauptkennzahl |
| `withTwoDevices` / `households` | Anteil WGs, die Nestly wirklich gemeinsam nutzen | Aktivierung |
| `created.d7` | neue WGs pro Woche | Wachstum, Wirkung von Marketing |
| `contractsByCategory` | eingetragene Verträge je Art | Potenzial des Tarif-Checks |

Dazu kommen Klicks und Abschlüsse im Partner-Dashboard.

## Was nur du machen kannst

1. **Gewerbe anmelden** (meist online bei deiner Gemeinde) und danach den Fragebogen zur
   steuerlichen Erfassung in ELSTER ausfüllen. Die Kleinunternehmerregelung (§ 19 UStG; seit 2025:
   Vorjahresumsatz bis 25.000 €, laufendes Jahr bis 100.000 €) erspart dir Umsatzsteuer-Aufwand.
   Ich bin kein Steuerberater – bei Unsicherheit kurz beim Finanzamt oder einer Beratung nachfragen.
2. **Domain und Server** mieten und die Repository-Variablen in GitHub setzen (Liste in
   [LAUNCH.md](LAUNCH.md)). Danach baue und veröffentliche ich alles automatisch.
3. **Google-Play-Konto** (25 $, Identitätsprüfung) und **Partnerprogramm-Bewerbung**.
4. **12 Tester** finden.
5. **Videos** aufnehmen und posten (Skripte und Bildschirmaufnahmen liefere ich).
6. **Impressum:** Für eine Einnahmen-App brauchst du eine ladungsfähige Anschrift im Impressum.
   Wenn deine Wohnadresse nicht öffentlich sein soll, gibt es Impressums- bzw. Geschäftsadressen-Dienste.

Alles andere – Code, Store-Texte, Rechtstext-Vorlagen, Server-Konfiguration, Marketingtexte,
Screenshots, Funktionen für Plus, iOS-Hülle – mache ich.

## Risiken und offene Punkte

| Punkt | Warum wichtig | Was tun |
| --- | --- | --- |
| **Name „Nestly“** | In den USA laufen zwei Markenanmeldungen „NESTLY“ (u. a. Klasse 42, Software-Dienste, angemeldet Feb. 2026) **[belegt über Drittanbieter, im USPTO-Register prüfen]** ([Markinton](https://markinton.com/trademark/nestly-99640757)) | Vor dem Store-Eintrag im DPMA- und EUIPO-Register nach „Nestly“ in Klasse 9/42 suchen (kostenlos). Ein Namenswechsel ist jetzt billig, später teuer. |
| Partnerprogramm lässt App-Traffic nicht zu | Tarif-Check bringt dann nichts | anderes Programm oder Web-Werkzeugseiten als Quelle **[offen]** |
| 12-Tester-Regel | verzögert den Play-Start um mindestens 2 Wochen | sofort starten, Tester = erste Nutzer |
| Sensible Daten auf dem Server (IBAN, Kundennummern) | Datenschutz und Vertrauen | Hoster in Deutschland, Vertrag zur Auftragsverarbeitung abschließen, Backups verschlüsseln; Ende-zu-Ende-Verschlüsselung steht auf der Roadmap |
| Rechtstexte | Vorlagen, keine Rechtsberatung | einmal von einem Generator oder einer Beratung gegenlesen lassen |
| Datenlöschung | Google verlangt für Apps mit Konten einen Löschweg in der App und im Web; ob eine WG ohne E-Mail-Konto darunter fällt, ist unklar **[offen]** | bis zum Produktionsantrag baue ich „WG endgültig löschen“; bis dahin Löschung per E-Mail (steht in der Datenschutzerklärung) |
