# Thuis – privé smart-home-dashboard

Mobiele webapp (Android/tablet/Windows) met Node.js-backend. Homey blijft thuis; de backend gebruikt Athom Cloud OAuth en het `remoteUrl` dat Athom bij `/user/me` teruggeeft. Er is geen lokale Homey-IP, lokale API-key, port-forwarding of extra apparaat thuis nodig.

## Status van deze oplevering

- Werkende responsive UI voor Overzicht, Apparaten, Flows, Energie, Camera's en Instellingen.
- Demo met gesimuleerde apparaten, kamers, gewone/Advanced Flows en HomeWizard-meetwaarden.
- Persoonlijke wachtwoordlogin, server-side sessie, HttpOnly-cookie, rate limit op API, OAuth-state en AES-256-GCM-encryptie voor Athom-tokens in PostgreSQL.
- Echte Homey-leesroute voorbereid: devices, zones, gewone/Advanced Flows en beschikbare Insights-logs.
- Echte bediening is expliciet alleen aanroepbaar vanuit de UI wanneer Homey verbonden is. Eerste live test blijft handmatig; er wordt nooit automatisch een Flow gestart.
- HomeWizard-data wordt uitsluitend uit Homey-apparaten/capabilities gelezen.
- Netatmo-deurbel opent Home + Security. EZVIZ HB30-tegel opent de officiële EZVIZ-site/app.

**Nog niet als live-integratie geverifieerd:** jouw eigen Homey OAuth-client/scope-toekenning, daadwerkelijke apparaten/capabilities, Insights-logstructuur, Legrand-capabilities, Netatmo Flow-trigger en EZVIZ HB30-cloudstream. De UI toont geen verzonnen livebeeld. De Homey API-route voor device writes en Flow trigger is gebaseerd op Athom's gepubliceerde API-referentie; de OAuth-client moet de betreffende scopes daadwerkelijk mogen gebruiken.

## Vereisten

- Node.js 20+
- PostgreSQL (Supabase of Neon)
- Hosting met HTTPS en environment variables (Render Web Service is een eenvoudige optie)
- Homey Web API OAuth Client in Homey Developer Tools

## Lokaal testen

```bash
cp .env.example .env
# Vul ADMIN_PASSWORD, ENCRYPTION_KEY en DATABASE_URL in
npm install
npm test
npm start
```

Open `http://localhost:3000`. Gebruik een lange unieke wachtzin uit `ADMIN_PASSWORD`. Voor lokale OAuth moet `APP_URL` overeenkomen met een publiek HTTPS-adres; localhost werkt niet als Athom Redirect URI.

Genereer encryptiesleutel:

```bash
openssl rand -hex 32
```

## Publiceren zonder kosten te autoriseren

Deze repository is voorbereid voor Render + Supabase/Neon. Maak zelf accounts aan; er wordt niets namens jou besteld of betaald.

1. Maak een privé GitHub-repository en upload deze projectmap. Voeg `.env` nooit toe; commit alleen `.env.example`.
2. Maak een PostgreSQL-database aan bij Supabase of Neon. Kopieer de connection string met SSL.
3. Maak op Render een **Web Service** vanuit de repository. Runtime: Node; Build command: `npm install`; Start command: `npm start`.
4. Stel bij Render Environment in: `APP_URL` (de uiteindelijke HTTPS-URL), `ADMIN_PASSWORD` (minimaal 20 tekens), `ENCRYPTION_KEY` (64 hextekens), `DATABASE_URL`, `HOMEY_CLIENT_ID`, `HOMEY_CLIENT_SECRET`, `DEMO_ENABLED=true` en `NODE_ENV=production`.
5. Render geeft een HTTPS-URL. Zet exact die URL als `APP_URL`. De callback is dan `https://<jouw-host>/auth/homey/callback`.
6. Voeg pas daarna de OAuth-client toe bij Athom met exact deze Redirect URI.
7. Zet `DEMO_ENABLED=false` pas nadat de eerste echte verbinding is gelukt.
8. Controleer dat de site achter wachtwoordlogin blijft. Deel de URL niet; deel geen toegang met anderen.

### Kostenindicatie

Startkosten kunnen **$0 per maand** zijn: Render Hobby is $0 en een Render Free Web Service is $0; Supabase Free is $0 met een Postgres-database tot 500 MB. Er zijn wel forse beperkingen: Render Free slaapt na 15 minuten zonder inkomend verkeer en kan ongeveer een minuut nodig hebben om weer op te starten; de gratis lokale schijf is vluchtig. Supabase Free pauzeert projecten na een week inactiviteit. Dat maakt de gratis combinatie geschikt voor een persoonlijke proef, niet voor gegarandeerde 24/7-bediening.

Voor een betrouwbaardere opstelling geeft Render een kleine webservice aan vanaf **$7 per maand** en Supabase Pro begint bij **$25 per maand**; samen indicatief **$32 per maand**, exclusief eventuele extra's/belastingen. Dit zijn USD-prijzen volgens de geraadpleegde prijspagina's; controleer ze vóór aanmaak. Er wordt in dit project geen abonnement of betaalde dienst gestart.

Bronnen: Render [pricing](https://render.com/pricing) en [Free limitations](https://render.com/docs/free); Supabase [pricing](https://supabase.com/pricing).

## Homey OAuth instellen

1. Open <https://tools.developer.homey.app/api/clients>.
2. Maak een API Client met Redirect URI exact gelijk aan `/auth/homey/callback` op jouw gepubliceerde site.
3. Beperk de client tot de noodzakelijke scopes die Homey aanbiedt:
   - `homey.device.readonly` – apparaten/capabilities lezen.
   - `homey.zone.readonly` – kamers/zones lezen.
   - `homey.flow.readonly` – bestaande Flows lezen.
   - `homey.insights.readonly` – Insights-logboeken lezen (alleen nodig voor historie).
   - `homey.device.control` – alleen nodig voor aan/uit/dimmen.
   - `homey.flow.start` – alleen nodig om bestaande Flows te starten.
4. Als de API Clients-pagina een scope niet aanbiedt, sla die over: de betreffende functie blijft geblokkeerd. Gebruik geen ruimere rechten als vervanging.
5. Zet Client ID en Client Secret als `HOMEY_CLIENT_ID` en `HOMEY_CLIENT_SECRET` in Render Environment. Nooit in de browser of chat plakken.
6. Log in op Thuis → Instellingen → Koppel Homey. Autoriseer met jouw eigen Homey-account.

De server gebruikt `GET https://api.athom.com/user/me`, kiest `remoteUrl`, vraagt een delegation token aan en maakt een Homey-sessie. Tokens worden met AES-256-GCM opgeslagen; access tokens worden ververst en de volledige tokenrespons wordt opnieuw opgeslagen. `remoteUrl` wordt opnieuw opgehaald bij elke sessie en niet permanent verondersteld.

## Grenzen / volgende verificaties

- **OAuth scopes:** Athom documenteert `homey.device.control` voor device writes en `homey.flow.start` voor starten van Flows. De beschikbare scopes kunnen verschillen per type client/account. De app zal bij ontbrekende rechten een fout tonen; er wordt geen alternatieve lokale sleutel gebruikt.
- **Insights:** de backend leest logs met titels die op energie/power duiden. Een echte daggrafiek moet nog worden getest tegen de vorm van de log-entrydata van jouw Homey. Tot die tijd blijft de link naar Homey Insights zichtbaar.
- **Legrand with Netatmo:** de UI toont alleen capability's die Homey per gekoppeld apparaat aanlevert; dimmen verschijnt alleen wanneer `dim` aanwezig is.
- **Netatmo deurbelmelding:** nog geen Homey Flow/webhook geactiveerd. Eerst de echte deurbel-trigger testen en pas daarna server-side webhook/notification toevoegen.
- **EZVIZ HB30 Dual:** de productspecificatie noemt het EZVIZ-proprietary protocol; het model staat niet in de geraadpleegde EZVIZ-ONVIF-compatibiliteitslijst. EZVIZ Open Platform biedt Web/H5-livevideo, maar is partner/project-gebaseerd; de publieke prijspagina noemt een gratis proefperiode van 120 dagen en enterprise-abonnementen vanaf USD 599,99/jaar. Geen livebeeld ingebouwd zonder model- en accounttest.
- **Google Home:** bestaande koppelingen blijven ongemoeid; de dashboardbackend schrijft niet in Google Home.

## Tests

`npm test` voert smoke-tests uit met een gesimuleerde server: health, anonieme toegangsweigering, login, HttpOnly-cookie, demo-data, Advanced Flow-voorbeeld en foutieve login. Deze tests simuleren niet Athom's echte OAuth, Homey-apparaten, Insights, camera's of Legrand.

## Zonverwachting

Stel op Render onder **Environment** `SOLAR_LATITUDE` en `SOLAR_LONGITUDE` in.
Gebruik de coördinaten van je woonplaats of wijk met een decimale punt. De server
stuurt de coördinaten afgerond op twee decimalen naar Open-Meteo. Zonder
locatie blijft de tegel zichtbaar met een instelinstructie.

Vul optioneel `SOLAR_CAPACITY_KWP` in als totaal piekvermogen van je panelen
(bijvoorbeeld `4.8` voor 4.800 Wp). Zonder piekvermogen toont het dashboard
zoninstraling in kWh/m². De grove schatting voor panelen is zoninstraling
× kWp × 0,8. De schatting houdt geen rekening met dakrichting, helling of
schaduw. De tegel toont hele dagen in Nederlandse tijd.

Als Open-Meteo de vraag vanaf de server begrenst (HTTP 429), wacht de server de
opgegeven termijn af. Als de aanbieder geen termijn doorgeeft, wacht de server
een uur. Via **Haal weerdata op via dit apparaat** kun je bewust kiezen voor
een aanvraag vanaf je browser. Open-Meteo ontvangt daarbij het IP-adres van
je browser en dezelfde afgeronde locatie. Als Open-Meteo ook de browser
begrenst, wacht die tab eveneens tot de wachttijd voorbij is.

## Laadadvies op het overzicht

Het overzicht toont een laadadvies wanneer Homey bevestigt dat je thuis bent
en de slimme meter gedurende de ingestelde tijd genoeg teruglevering meet.
Thuis gebruikt de bestaande verversing van het geopende dashboard en toont de
actuele teruglevering bij het advies. Na het openen of herladen van de server
kan het tot de ingestelde meetduur duren voordat er een advies verschijnt.
Zodra de teruglevering daalt of je aanwezigheid niet kan worden bevestigd,
verdwijnt de melding bij de volgende verversing. Onzekere, verouderde of
ontbrekende meetwaarden geven geen advies. Thuis raadpleegt je auto niet en
stuurt de laadpaal niet aan.

- `CHARGE_SURPLUS_W`: ingestelde laaddrempel in watt. Gebruik een positieve
  waarde die past bij het minimale laadvermogen van je installatie.
- `CHARGE_SURPLUS_MINUTES`: meetduur, standaard 10 minuten.
- `CHARGE_METER_ID`: optioneel lokaal Homey-apparaat-ID van je P1-meter, voor
  installaties met meerdere kandidaatmeters.
- `CHARGE_HOMEY_USER_ID`: optioneel lokaal Homey-gebruikers-ID. Laat leeg als
  je eigen Homey-account is gekoppeld.

Geef de Homey API-client leesrecht **View everyone's presence**
(`homey.presence.readonly`). Voor het gekoppelde account gebruikt Thuis
ook `homey.user.self`. Verbind Homey opnieuw als je de rechten wijzigt.

## Startpagina van Hoefsetuin 32

### Zonneprognose

Met de bestaande `SOLAR_LATITUDE` en `SOLAR_LONGITUDE` wordt het weer eenmalig per
cacheperiode opgehaald voor zowel de dag- als uurverwachting. Stel
`SOLAR_CAPACITY_KWP=11.9` in voor jouw 32 zonnepanelen. De grafiek toont een
schatting per uur voor de komende 24 uur en de kaart toont de verwachte opwek
(kWh) en huidige zoninstraling (W/m²). Het rekenmodel gebruikt horizontale
instraling met een systeemfactor van 80%. De noord- en zuidhelft, dakhelling en
schaduw worden nog niet apart gemodelleerd.

### Stroomverbruik en kosten

- Zet in Render onder **Environment** `ELECTRICITY_IMPORT_EUR_KWH` op je eigen
  variabele afnametarief per kWh inclusief btw en eventuele energiebelasting
  en inkoopopslag. Gebruik bijvoorbeeld `0.28` als je tarief € 0,28/kWh is.
- Zet optioneel `ELECTRICITY_EXPORT_EUR_KWH` op je terugleververgoeding per
  kWh. Bij een oningevuld tarief blijft het bijbehorende bedrag leeg.
- De kaart gebruikt de afname- en teruglevertellers van de P1-meter via Homey
  Insights, vergeleken met een meting op of binnen 15 minuten van Nederlandse
  middernacht. Een afwijkende tijd geeft een benadering (`≈`). De raming
  bevat uitsluitend variabele bedragen en verwerkt geen vaste kosten,
  terugleverkosten of saldering. Leveranciers met meerdere tarieven kunnen
  voor deze kaart één gemiddeld afnametarief invoeren.
- De kaart met het actuele vermogen toont dezelfde afnamekosten van vandaag.

### Google Agenda

1. Maak in Google Cloud een serviceaccount aan en schakel de **Google Calendar API** in.
2. Maak een JSON-sleutel voor het serviceaccount. Plaats de volledige JSON in
   Render als `GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON`. Upload de sleutel uitsluitend
   als omgevingsvariabele in Render.
3. Deel in Google Agenda de gewenste agenda met het serviceaccountadres uit
   `client_email`. Kies alleen-lezen toegang tot alle afspraakdetails.
4. Kopieer bij **Agenda integreren** het agenda-ID naar `GOOGLE_CALENDAR_ID` in Render.
   De kaart toont maximaal zes afspraken uit de komende zeven dagen. Als privé
   gemarkeerde afspraken verschijnen als ‘Bezet’ als Google deze doorgeeft.

Zie [Google Agenda delen](https://support.google.com/calendar/answer/37082) en
[Google Cloud-serviceaccounts](https://cloud.google.com/iam/docs/service-accounts-create).

### Muziek, prijzen en auto

- Voeg je Google Home- of Nest-speaker in Homey toe via de
  [Google Chromecast-app](https://homey.app/nl-nl/app/com.google.chromecast/).
  De kaart toont de afspeelstatus, titel en artiest voor zover de speaker en
  de gebruikte afspeelbron deze gegevens via Homey leveren.
- Maak voor de 24-uursvergelijking een persoonlijke
  [Enever-token](https://enever.nl/prijzenfeeds/) aan en zet die in Render
  als `ENEVER_TOKEN`. De kaart gebruikt de Vandebron-uurprijzen uit deze
  externe feed. Uren die nog niet zijn gepubliceerd blijven open. Deze
  prijsvergelijking verandert de dagkostenkaart of je contract niet.
- De Jeep Avenger-kaart toont vaste voorbeeldwaarden. De
  [foto van Cutlass](https://commons.wikimedia.org/wiki/File:2024_Jeep_Avenger_in_Granite,_front_left,_06-10-2025.jpg)
  valt onder CC0 en is verkleind voor het dashboard.
