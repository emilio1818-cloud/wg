/**
 * Content of the Kündigungs-Vorlagen pages (German). Rules are deliberately general and hedged
 * ("in der Regel"): the pages carry a "keine Rechtsberatung" note and a date.
 * `offer` names the Tarif-Check categories (core/src/offers.ts) to link, in order of preference.
 */
export const UPDATED = 'November 2026';

export const FORM_NOTE =
  '<strong>Form:</strong> Bei Verträgen ab Oktober 2021 reicht eine E-Mail (Textform). Wurde der Vertrag online abgeschlossen, muss der Anbieter außerdem einen Kündigungsbutton auf seiner Website anbieten. Bei älteren Verträgen im Zweifel per Brief.';

export const PAGES = [
  {
    slug: 'strom',
    label: 'Strom',
    emoji: '⚡',
    contractName: 'Stromliefervertrag',
    offer: ['electricity'],
    title: 'Stromvertrag kündigen – Vorlage kostenlos ausfüllen | Nestly',
    description: 'Kündigungsschreiben für deinen Stromvertrag in einer Minute: ausfüllen, kopieren oder mailen. Dazu Fristen, Umzug und Sonderkündigung bei Preiserhöhung.',
    h1: 'Stromvertrag kündigen: Vorlage zum Ausfüllen',
    rulesTitle: 'Fristen und Regeln beim Strom',
    rules: [
      '<strong>Verträge seit März 2022:</strong> Nach der Mindestlaufzeit (höchstens 24 Monate) kannst du jeden Monat mit einem Monat Frist kündigen.',
      '<strong>Grundversorgung</strong> (du hast nie einen eigenen Tarif gewählt): jederzeit mit zwei Wochen Frist kündbar.',
      '<strong>Preiserhöhung:</strong> Du darfst zu dem Tag kündigen, an dem der neue Preis gelten soll.',
      '<strong>Umzug:</strong> In der Regel kannst du mit sechs Wochen Frist kündigen, wenn der Anbieter dich in der neuen Wohnung nicht zu den gleichen Bedingungen weiter beliefert.',
    ],
    offerTitle: 'Erst vergleichen, dann kündigen',
    offerText:
      'Wenn du den Anbieter wechselst, kündigt meist der neue Anbieter den alten Vertrag für dich – dann brauchst du gar kein Schreiben. Ohne neuen Vertrag landest du in der Ersatzversorgung, die meist teurer ist.',
    faq: [
      ['Muss ich selbst kündigen, wenn ich den Stromanbieter wechsle?', 'Meistens nicht. Beim Wechsel beauftragst du den neuen Anbieter, und der kündigt den alten Vertrag. Selbst kündigen musst du vor allem, wenn du ausziehst und für die Wohnung keinen neuen Vertrag abschließt.'],
      ['Was passiert, wenn ich kündige und keinen neuen Vertrag habe?', 'Der Strom wird nicht abgestellt. Du wirst automatisch vom örtlichen Grundversorger beliefert – das ist in der Regel teurer als ein frei gewählter Tarif.'],
      ['Wir sind eine WG – wer muss kündigen?', 'Die Person, auf die der Vertrag läuft. Zieht sie aus, sollte der Vertrag vorher auf jemand anderen übergehen oder gekündigt und neu abgeschlossen werden – sonst zahlt sie für Strom, den andere verbrauchen.'],
      ['Was gehört in die Kündigung?', 'Name und Adresse, Kunden- oder Vertragsnummer, das gewünschte Vertragsende (oder „zum nächstmöglichen Zeitpunkt“) und die Bitte um eine schriftliche Bestätigung. Bei Auszug zusätzlich Zählernummer und Zählerstand.'],
    ],
  },
  {
    slug: 'gas',
    label: 'Gas',
    emoji: '🔥',
    contractName: 'Gasliefervertrag',
    offer: ['gas'],
    title: 'Gasvertrag kündigen – Vorlage kostenlos ausfüllen | Nestly',
    description: 'Gasvertrag kündigen mit fertiger Vorlage: ausfüllen, kopieren, mailen. Fristen, Grundversorgung, Umzug und Sonderkündigung einfach erklärt.',
    h1: 'Gasvertrag kündigen: Vorlage zum Ausfüllen',
    rulesTitle: 'Fristen und Regeln beim Gas',
    rules: [
      '<strong>Verträge seit März 2022:</strong> Nach der Mindestlaufzeit (höchstens 24 Monate) monatlich mit einem Monat Frist kündbar.',
      '<strong>Grundversorgung:</strong> jederzeit mit zwei Wochen Frist kündbar.',
      '<strong>Preiserhöhung:</strong> Sonderkündigungsrecht zu dem Tag, an dem der neue Preis gelten soll.',
      '<strong>Umzug:</strong> In der Regel mit sechs Wochen Frist kündbar, wenn der Anbieter die neue Wohnung nicht zu gleichen Bedingungen beliefert.',
    ],
    offerTitle: 'Erst vergleichen, dann kündigen',
    offerText: 'Beim Anbieterwechsel übernimmt meist der neue Anbieter die Kündigung – ohne Versorgungslücke. Gerade nach Preiserhöhungen zahlen viele Haushalte deutlich mehr als nötig.',
    faq: [
      ['Hat unsere WG überhaupt einen eigenen Gasvertrag?', 'Nur bei Gasetagenheizung oder Gasherd mit eigenem Zähler. Bei Zentralheizung steckt das Gas meist in den Nebenkosten – dann gibt es nichts zu kündigen, und der Vertrag liegt bei der Vermietung.'],
      ['Wird das Gas abgestellt, wenn ich ohne neuen Vertrag kündige?', 'Nein. Du wirst automatisch vom Grundversorger beliefert, allerdings meist zu einem höheren Preis.'],
      ['Wie kündige ich bei einer Preiserhöhung?', 'Der Anbieter muss dich vorher informieren. Du kannst dann zu dem Tag kündigen, an dem die Erhöhung wirksam wird. Im Schreiben kurz auf die Preiserhöhung als Grund hinweisen.'],
    ],
  },
  {
    slug: 'internet',
    label: 'Internet & DSL',
    emoji: '🌐',
    contractName: 'Internetvertrag',
    offer: ['internet'],
    title: 'Internetvertrag kündigen (DSL, Kabel, Glasfaser) – Vorlage | Nestly',
    description: 'DSL-, Kabel- oder Glasfaservertrag kündigen: Vorlage ausfüllen und verschicken. Mindestlaufzeit, Umzug, Anbieterwechsel und zu langsames Internet erklärt.',
    h1: 'Internetvertrag kündigen: Vorlage für DSL, Kabel und Glasfaser',
    rulesTitle: 'Fristen und Regeln beim Internet',
    rules: [
      '<strong>Mindestlaufzeit:</strong> höchstens 24 Monate. Danach ist der Vertrag jeden Monat mit einem Monat Frist kündbar.',
      '<strong>Umzug:</strong> Kann der Anbieter am neuen Wohnort nicht die vereinbarte Leistung liefern, darfst du mit einem Monat Frist kündigen. Kann er liefern, zieht der Vertrag mit um.',
      '<strong>Anbieterwechsel:</strong> Der neue Anbieter übernimmt meist die Kündigung, und die Unterbrechung darf höchstens einen Arbeitstag dauern.',
      '<strong>Zu langsames Internet:</strong> Liegt die Geschwindigkeit deutlich und dauerhaft unter dem Vertrag, kannst du mindern oder kündigen. Nachweis: die Breitbandmessung der Bundesnetzagentur.',
    ],
    offerTitle: 'Neuer Tarif statt Altkunden-Preis',
    offerText: 'Nach der Mindestlaufzeit zahlen viele mehr als Neukunden. Beim Wechsel kündigt der neue Anbieter für dich und schaltet nahtlos um.',
    faq: [
      ['Wie lange vorher muss ich kündigen?', 'Während der Mindestlaufzeit spätestens einen Monat vor deren Ende, sofern dein Vertrag nichts Kürzeres vorsieht. Danach jederzeit mit einem Monat Frist.'],
      ['Was passiert mit dem Router?', 'Gemietete Router musst du nach Vertragsende meist zurückschicken. Die Anleitung kommt in der Regel mit der Kündigungsbestätigung.'],
      ['Der Vertrag läuft auf jemanden, der aus der WG auszieht – was nun?', 'Entweder auf eine andere Person übertragen (viele Anbieter haben dafür ein Formular zur Vertragsübernahme) oder kündigen und neu abschließen. Früh planen: Ein neuer Anschluss kann Wochen dauern.'],
    ],
  },
  {
    slug: 'handy',
    label: 'Handy',
    emoji: '📱',
    contractName: 'Mobilfunkvertrag',
    offer: ['phone'],
    title: 'Handyvertrag kündigen – Vorlage & Nummer mitnehmen | Nestly',
    description: 'Handyvertrag kündigen mit kostenloser Vorlage. Mindestlaufzeit, monatliche Kündigung, Rufnummernmitnahme und Prepaid einfach erklärt.',
    h1: 'Handyvertrag kündigen: Vorlage zum Ausfüllen',
    rulesTitle: 'Fristen und Regeln beim Handyvertrag',
    rules: [
      '<strong>Mindestlaufzeit:</strong> höchstens 24 Monate, danach jeden Monat mit einem Monat Frist kündbar.',
      '<strong>Rufnummer mitnehmen:</strong> Deine Nummer kannst du zum neuen Anbieter mitnehmen; den Wechsel stößt der neue Anbieter an.',
      '<strong>Vertragsänderung oder Preiserhöhung:</strong> Ändert der Anbieter den Vertrag zu deinem Nachteil, hast du in der Regel ein Sonderkündigungsrecht.',
    ],
    offerTitle: 'Gleiche Leistung, oft günstiger',
    offerText: 'Nach der Mindestlaufzeit lohnt sich ein Vergleich fast immer – deine Nummer nimmst du mit.',
    faq: [
      ['Kann ich meine Nummer behalten?', 'Ja. Beim neuen Anbieter die Rufnummernmitnahme beauftragen; er klärt den Rest mit dem alten Anbieter.'],
      ['Was ist mit dem Handy, das ich in Raten bezahle?', 'Die Raten für das Gerät laufen oft unabhängig vom Tarif bis zum Ende weiter. Das steht in deinem Vertrag.'],
      ['Wie kündige ich Prepaid?', 'Prepaid-Verträge sind meist kurzfristig kündbar. Restguthaben kannst du dir nach der Kündigung auszahlen lassen.'],
    ],
  },
  {
    slug: 'versicherung',
    label: 'Haftpflicht & Hausrat',
    emoji: '🛡️',
    contractName: 'Versicherungsvertrag',
    offer: ['liability', 'insurance'],
    title: 'Versicherung kündigen (Haftpflicht, Hausrat) – Vorlage | Nestly',
    description: 'Haftpflicht- oder Hausratversicherung kündigen: Vorlage ausfüllen und verschicken. Fristen, Sonderkündigung nach Schaden oder Beitragserhöhung, Tipps für WGs.',
    h1: 'Versicherung kündigen: Vorlage für Haftpflicht und Hausrat',
    rulesTitle: 'Fristen und Regeln bei Versicherungen',
    rules: [
      '<strong>Laufzeit:</strong> meist ein Jahr mit automatischer Verlängerung. Kündigen musst du in der Regel spätestens drei Monate vor Ablauf des Versicherungsjahres.',
      '<strong>Nach einem Schadensfall:</strong> Beide Seiten dürfen kündigen, in der Regel innerhalb eines Monats nach der Regulierung.',
      '<strong>Beitragserhöhung:</strong> Steigt der Beitrag ohne mehr Leistung, kannst du in der Regel innerhalb eines Monats nach der Mitteilung kündigen.',
      '<strong>In der WG:</strong> Mitbewohnis sind meist nicht automatisch mitversichert – eine private Haftpflicht gilt in der Regel nur für dich und ggf. deine Familie. Bei der Hausrat hängt es vom Tarif ab, ob nur dein Zimmer oder auch Gemeinschaftsräume versichert sind.',
    ],
    offerTitle: 'Erst neu abschließen, dann kündigen',
    offerText: 'Schließ den neuen Vertrag mit Beginn zum Ende des alten ab – so bist du keinen Tag ohne Schutz.',
    faq: [
      ['Wann endet mein Versicherungsjahr?', 'Das steht im Versicherungsschein – oft am 1. Januar oder am Jahrestag des Vertragsbeginns.'],
      ['Brauche ich in der WG eine eigene Haftpflicht?', 'In der Regel ja. Eine Familienhaftpflicht deckt Mitbewohnis nicht ab, auch wenn ihr zusammen wohnt.'],
      ['Reicht eine E-Mail?', 'Bei Verträgen ab Oktober 2021 ja. Bei älteren Verträgen steht die Form in den Bedingungen; im Zweifel per Brief mit Unterschrift.'],
    ],
  },
  {
    slug: 'fitnessstudio',
    label: 'Fitnessstudio',
    emoji: '🏋️',
    contractName: 'Mitgliedschaftsvertrag',
    offer: [],
    title: 'Fitnessstudio kündigen – Vorlage kostenlos | Nestly',
    description: 'Fitnessstudio-Vertrag kündigen mit fertiger Vorlage. Mindestlaufzeit, Verlängerung, Kündigungsbutton und außerordentliche Kündigung einfach erklärt.',
    h1: 'Fitnessstudio kündigen: Vorlage zum Ausfüllen',
    rulesTitle: 'Fristen und Regeln beim Fitnessstudio',
    rules: [
      '<strong>Verträge seit März 2022:</strong> Nach der Mindestlaufzeit verlängern sie sich nur noch auf unbestimmte Zeit und sind dann monatlich kündbar.',
      '<strong>Ältere Verträge</strong> können sich noch um bis zu ein Jahr verlängern, wenn du die Frist verpasst (meist bis zu drei Monate vor Laufzeitende).',
      '<strong>Außerordentlich kündigen</strong> geht nur aus wichtigem Grund, etwa wenn du dauerhaft nicht mehr trainieren kannst (mit ärztlichem Attest). Ein Umzug allein reicht laut Bundesgerichtshof meist nicht.',
    ],
    offerTitle: '',
    offerText: '',
    faq: [
      ['Darf das Studio verlangen, dass ich vor Ort kündige?', 'Nein. Bei Verträgen ab Oktober 2021 reicht Textform, also auch eine E-Mail. Wichtig ist, dass du den Zugang belegen kannst – etwa durch eine Bestätigung des Studios.'],
      ['Kann ich pausieren statt kündigen?', 'Viele Studios bieten eine Ruhezeit an, etwa bei Krankheit oder Auslandssemester. Die Laufzeit verlängert sich dann meist entsprechend.'],
      ['Was, wenn das Studio nicht bestätigt?', 'Nachhaken und die Kündigung erneut mit Lesebestätigung schicken. Lastschriften nach dem Vertragsende kannst du bei deiner Bank zurückgeben lassen.'],
    ],
  },
];
