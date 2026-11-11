# YAHLA Network Guard manual

[English](#english) · [Svenska](#svenska)

## English

### Getting started

1. Install YAHLA on your Homey Pro.
2. Point your router's logs at the Homey, with your Homey's IP address and UDP port 5514: in UniFi
   Network the Activity Logging (SIEM server) setting (in the UniFi versions we have used, it takes
   one address only); on ASUS the "Remote log server" field under System Log; on OpenWrt the remote
   log server setting.
3. Set a PIN right away: until a PIN is set, anyone who can open the page can set one.
4. Open Settings, Apps, YAHLA in the Homey app.

### Supported routers

| Router | What YAHLA gets | Tested |
| --- | --- | --- |
| UniFi | MAC, IP, name, network and VLAN, access point or switch port | Yes, real equipment |
| ASUS (Asuswrt, Merlin) | MAC, IP, name, interface (br0), radio (eth2); no VLAN | Published log samples only |
| OpenWrt and others with hostapd + dnsmasq | Same as ASUS | Published log samples only |

Does not work: TP-Link Deco, AVM Fritz!Box and Netgear home routers (we found no way to make them send
logs). Not yet: TP-Link Omada and internet providers' routers. An alert waits up to 10 seconds for the
router's DHCP line so the name and IP are included. A device with a fixed IP address is seen through the
Wi-Fi line only, without name and IP.

### The settings page

- **Status** shows whether YAHLA is listening, how many packets and client events it has received,
  and warnings, for example "no PIN" or "no logs for 30 minutes".
- **PIN.** With a PIN set, the page asks for it when opened and stays unlocked for 15 minutes after
  it was last used. Until then it shows counts only, no devices or addresses. Five wrong tries lock it for 15 minutes. Without a PIN, anyone who can open the
  page can make changes. The PIN can be changed or removed at the bottom of the page.
- **New devices** lists devices that are not approved, with their MAC address, the name they give
  themselves, IP, network and place. Choose Approve, Ignore (never alert) or Forget (removes it from
  the list; it alerts as new if it is seen again).
- **Approved and ignored devices** is a folded list: tap a device to see its details and to remove
  the approval or forget it.
- **Allowed senders**: the addresses that may send logs (up to five), saved with the button right below. Logs from other addresses are
  dropped and counted. While the list is empty, logs from every address are accepted. The page lists the senders it has seen; "Add" copies one to the field.
- **Timeline**: Minimum (new devices, short), Extended (with details and the forged-event alarm, the
  default) or Debug (also your own changes, unknown formats and "logs again"). Alarms for silence,
  floods, outside changes, a lost port, damaged data and a removed PIN, and the daily report,
  always reach the timeline. Flows always get everything.
- **Alert level per network**: for example Silent for a guest network, where devices are listed but
  never alerted.

### Notifications on your phone

YAHLA writes to the Homey timeline. To get a push message as well, turn on push for YAHLA in the Homey
app's timeline settings. No Flow is needed for that. Use Flows for more, for example a critical alert
(sounds in silent mode) when "YAHLA raised an alarm" has severity CRITICAL, or a check at 07:15 that the
daily report came.

### Alarms

| Alarm | What it means |
| --- | --- |
| No logs for 30 minutes | The log sender, the network or the setting on the router has changed |
| Flood | 10 new devices or 100 client events in 10 minutes, or more than 20 device alerts in 10 minutes |
| Forged or unreadable client event | A device may be trying to hide behind another identity (Extended and Debug) |
| Unknown format | A log line YAHLA does not understand (Debug level) |
| Setting changed from outside | The device list, settings or PIN were written around the app; the change was undone |
| Cannot listen for logs | Another app holds port 5514, or the network is down |

### Limits

A device that copies an approved MAC address is not detected. A log sender can be faked from the
same network. Changes to the settings while YAHLA is stopped cannot be seen.

## Svenska

### Kom i gång

1. Installera YAHLA på din Homey Pro.
2. Peka routerns loggar mot Homey, med Homeys IP-adress och UDP-port 5514: i UniFi Network
   inställningen Activity Logging (SIEM server) (i de UniFi-versioner vi har använt tar den bara en
   adress); på ASUS fältet "Remote log server" under System Log; på OpenWrt inställningen för
   fjärrloggserver.
3. Sätt en PIN direkt: tills en PIN är satt kan alla som kan öppna sidan sätta en.
4. Öppna Inställningar, Appar, YAHLA i Homey-appen.

### Routrar som stöds

| Router | Vad YAHLA får | Testad |
| --- | --- | --- |
| UniFi | MAC, IP, namn, nät och VLAN, accesspunkt eller switchport | Ja, riktig utrustning |
| ASUS (Asuswrt, Merlin) | MAC, IP, namn, gränssnitt (br0), radio (eth2); inget VLAN | Bara publicerade loggexempel |
| OpenWrt och andra med hostapd + dnsmasq | Samma som ASUS | Bara publicerade loggexempel |

Fungerar inte: TP-Link Deco, AVM Fritz!Box och Netgears hemroutrar (vi har inte hittat något sätt att få
dem att skicka loggar). Inte än: TP-Link Omada och operatörernas routrar. Ett larm väntar upp till 10
sekunder på routerns DHCP-rad så att namn och IP kommer med. En enhet med fast IP-adress syns bara via
Wi-Fi-raden, utan namn och IP.

### Inställningssidan

- **Status** visar om YAHLA lyssnar, hur många paket och klienthändelser som har kommit, och
  varningar, till exempel "ingen PIN" eller "inga loggar på 30 minuter".
- **PIN.** Med en PIN frågar sidan efter den när den öppnas och är sedan upplåst i 15 minuter efter
  att den senast användes. Dessförinnan visar den bara räknare, inga enheter eller adresser. Fem felaktiga försök låser i 15 minuter. Utan PIN kan alla som kan öppna
  sidan göra ändringar. PIN kan bytas eller tas bort längst ner på sidan.
- **Nya enheter** listar enheter som inte är godkända, med MAC-adress, namnet de kallar sig, IP, nät
  och plats. Välj Godkänn, Ignorera (larmar aldrig) eller Glöm (tar bort den ur listan; den larmar som ny om den
  syns igen).
- **Godkända och ignorerade enheter** är en hopfälld lista: tryck på en enhet för att se detaljer och
  för att ta bort godkännandet eller glömma den.
- **Tillåtna avsändare**: adresserna som får skicka loggar (högst fem), sparas med knappen direkt under. Loggar från andra adresser
  kastas och räknas. Så länge listan är tom tas loggar från alla adresser emot. Sidan listar avsändare den har sett; "Lägg till" kopierar en till fältet.
- **Tidslinje**: Minimum (nya enheter, kort), Utökad (med detaljer och larmet för förfalskade
  händelser, standard) eller Felsökning (även dina egna ändringar, okända format och "tar emot
  igen"). Larm för tystnad, översvämning, ändringar utifrån, förlorad port, skadad data och borttagen
  PIN, samt dagsrapporten, kommer alltid i tidslinjen. Flöden får alltid allt.
- **Larmnivå per nät**: till exempel Tyst för ett gästnät, där enheter listas men aldrig larmar.

### Notiser i telefonen

YAHLA skriver i Homeys tidslinje. För att även få ett pushmeddelande slår du på push för YAHLA i
tidslinjens inställningar i Homey-appen. Inget flöde behövs för det. Använd flöden för mer, till exempel
en kritisk varning (hörs även i tyst läge) när "YAHLA larmade" har allvarlighet CRITICAL, eller en
kontroll kl 07:15 att dagsrapporten kom.

### Larm

| Larm | Vad det betyder |
| --- | --- |
| Inga loggar på 30 minuter | Loggavsändaren, nätverket eller inställningen i routern har ändrats |
| Översvämning | 10 nya enheter eller 100 klienthändelser på 10 minuter, eller fler än 20 enhetslarm på 10 minuter |
| Förfalskad eller oläslig klienthändelse | En enhet kan försöka gömma sig bakom en annan identitet (Utökad och Felsökning) |
| Okänt format | En loggrad som YAHLA inte förstår (nivån Felsökning) |
| Inställning ändrad utifrån | Enhetslistan, inställningarna eller PIN skrevs förbi appen; ändringen togs tillbaka |
| Kan inte ta emot loggar | En annan app använder port 5514, eller nätverket är nere |

### Begränsningar

En enhet som kopierar en godkänd MAC-adress upptäcks inte. En loggavsändare kan förfalskas från
samma nätverk. Ändringar av inställningarna medan YAHLA är stoppad kan inte ses.
