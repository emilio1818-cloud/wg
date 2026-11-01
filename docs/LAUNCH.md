# Launch-Checkliste

Technische Schritte, um Nestly öffentlich zu betreiben und in den Play Store zu bringen. Das
Warum steht in [GELD_PLAN.md](GELD_PLAN.md). Alles, was hier „Variable“ heißt, wird einmal in
GitHub gesetzt; danach baut und veröffentlicht jeder Push auf `main` automatisch.

## 1. Domain und Server

1. **Domain kaufen**, z. B. `nestly-wg.de` (Name vorher markenrechtlich prüfen, siehe Plan).
   Die App läuft dann unter einer Subdomain wie `app.nestly-wg.de`.
2. **Server mieten:** kleinster Cloud-Server mit Ubuntu bei einem deutschen Hoster (z. B. Hetzner),
   Docker vorinstalliert oder per `curl -fsSL https://get.docker.com | sh`.
   Im Kundenkonto den **Vertrag zur Auftragsverarbeitung** abschließen (Datenschutz).
3. **DNS:** A-Record (und AAAA, falls IPv6) von `app.nestly-wg.de` auf die Server-IP.
4. **Starten** – den Ordner [`deploy/`](../deploy) auf den Server kopieren, dann dort:

   ```bash
   cd deploy
   echo "DOMAIN=app.nestly-wg.de" > .env
   echo "ADMIN_TOKEN=$(openssl rand -hex 24)" >> .env
   echo "VAPID_SUBJECT=mailto:deine@adresse.de" >> .env
   docker compose up -d
   ```

   Caddy holt das HTTPS-Zertifikat selbst. Prüfen: `https://app.nestly-wg.de/api/health`.
5. **Image-Zugriff:** Meldet `docker compose pull` „denied“, ist das Paket
   `ghcr.io/emilio1818-cloud/wg` privat. Dann in GitHub unter *Packages → wg → Package settings*
   auf „Public“ stellen oder auf dem Server einmal `docker login ghcr.io` mit einem Token
   (Recht `read:packages`).
6. **Updates:** `docker compose pull && docker compose up -d`. Daten liegen im Volume
   `nestly-data` – regelmäßig sichern (z. B. Hetzner-Backups oder `docker run --rm -v
   deploy_nestly-data:/d -v $PWD:/b alpine tar czf /b/nestly-backup.tgz /d`).

Ab jetzt ist die Domain die eine echte Adresse der App. Die GitHub-Pages-Kopie unter
`emilio1818-cloud.github.io/wg` sollte dann mit der Variable `DEPLOY_PAGES=false` abgeschaltet
werden, sonst gibt es zwei Kopien mit getrennten Daten.

## 2. Variablen in GitHub

*Repository → Settings → Secrets and variables → Actions → Variables → New repository variable.*
Sie fließen in den Docker-Build (`docker.yml`) und in GitHub Pages (`pages.yml`).

| Variable | Beispiel | Wirkung |
| --- | --- | --- |
| `NESTLY_OPERATOR_NAME` | `Emil Beispiel` | Impressum und Datenschutzerklärung werden erst mit Name, |
| `NESTLY_OPERATOR_ADDRESS` | `Musterstr. 1 \| 12345 Musterstadt` | Adresse (Zeilen mit `\|` oder Zeilenumbruch trennen) |
| `NESTLY_OPERATOR_EMAIL` | `hallo@nestly-wg.de` | und E-Mail gebaut und in den Einstellungen verlinkt |
| `NESTLY_OPERATOR_PHONE` | optional | Telefon im Impressum |
| `NESTLY_LEGAL_HOSTING` | `Hetzner Online GmbH \| Industriestr. 25 \| 91710 Gunzenhausen` | Hoster in der Datenschutzerklärung (Adresse beim Hoster nachsehen) |
| `NESTLY_OFFERS` | Inhalt von [offers.example.json](offers.example.json) mit deinen Partnerlinks | schaltet den Tarif-Check ein |
| `NESTLY_TWA_PACKAGE` | `app.nestly.wg` | Android-Paketname (Schritt 4) |
| `NESTLY_TWA_SHA256` | `AB:CD:…` (mehrere mit Komma) | Zertifikats-Fingerabdrücke der Android-App (Schritt 4) |
| `DEPLOY_PAGES` | `false` | GitHub Pages abschalten, sobald die eigene Domain läuft |

Ungültige Werte lassen den Build mit einer klaren Meldung scheitern, statt still etwas
Falsches zu veröffentlichen. Nach dem Setzen: Workflow *Docker image* manuell starten oder auf
`main` pushen, dann auf dem Server `docker compose pull && docker compose up -d`.

**Prüfen:** `https://app.nestly-wg.de/impressum.html` und `/datenschutz.html` öffnen und lesen.
Die Texte sind Vorlagen nach dem tatsächlichen Datenfluss der App, aber keine Rechtsberatung.

## 3. Kennzahlen abrufen

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" https://app.nestly-wg.de/api/admin/stats
```

Liefert nur Summen (WGs, aktive WGs 7/30 Tage, WGs mit ≥ 2 Geräten, Geräte, Push-Abos, Verträge
je Kategorie) – keine Namen, keine Inhalte. Ohne `ADMIN_TOKEN` existiert der Endpunkt nicht.

## 4. Google Play (Trusted Web Activity)

1. **Konto:** [Play Console](https://play.google.com/console) → Entwicklerkonto „Privatperson“,
   25 $ Gebühr, Identitätsprüfung.
2. **Paket bauen:** Auf [pwabuilder.com](https://www.pwabuilder.com) die Domain eingeben →
   *Package for stores* → *Android* → Paket-ID `app.nestly.wg` → herunterladen. Das ZIP enthält
   die `.aab`-Datei, den **Signaturschlüssel** und dessen Passwörter.
   **Den Schlüssel doppelt sichern** (Passwortmanager + Offline-Kopie). Ohne ihn kann keine
   Aktualisierung mehr hochgeladen werden.
3. **App anlegen** in der Play Console, `.aab` in einen **geschlossenen Test** hochladen,
   Store-Eintrag und Formulare aus [store/PLAY_STORE.md](store/PLAY_STORE.md) übernehmen.
4. **Asset Links:** Play Console → *Testen und veröffentlichen → App-Integrität* → SHA-256 des
   **App-Signaturschlüssels** und des **Upload-Schlüssels** kopieren → beide kommagetrennt in
   `NESTLY_TWA_SHA256`, Paketname in `NESTLY_TWA_PACKAGE` → neu bauen und deployen →
   `https://app.nestly-wg.de/.well-known/assetlinks.json` prüfen. Erst dann öffnet die
   Android-App ohne Browser-Adressleiste.
5. **Geschlossener Test:** mindestens **12 Tester, 14 Tage am Stück** (Pflicht für neue private
   Konten). Tester per E-Mail-Liste oder Google-Gruppe einladen; jeder muss den Opt-in-Link
   annehmen und die App installieren.
6. **Produktion beantragen** (Play Console → *Dashboard*), danach Veröffentlichung.

## 5. iPhone

Bis zum App-Store-Start: In Safari die Domain öffnen → Teilen → „Zum Home-Bildschirm“. Push
funktioniert für so installierte Web-Apps ab iOS 16.4. Für den App Store später siehe
[APP_STORES.md](APP_STORES.md) (Capacitor).
