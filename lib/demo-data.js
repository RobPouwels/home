import { dutchMidnight } from '../public/overview-data.js';

function demoPowerLog(now) {
  const values = [340, 290, 610, -750, -1640, -840, 330, -1240, -530, 428];
  return {
    id: 'homey:device:d5:measure_power',
    title: 'HomeWizard P1 · netto vermogen (demo)',
    units: 'W',
    entries: values.map((v, index) => ({
      t: new Date(now - (values.length - 1 - index) * 20 * 60_000).toISOString(),
      v,
    })),
  };
}

function demoCounters(now) {
  const start = new Date(dutchMidnight(now)).toISOString();
  return [
    { name: 'Afnamemeter · demo', id: 'homey:device:d5:meter_power', units: 'kWh', entries: [{ t: start, v: 1229.13 }] },
    { name: 'Teruglevermeter · demo', id: 'homey:device:d5:meter_power.returned', units: 'kWh', entries: [{ t: start, v: 319.23 }] },
  ];
}

export function demoData(){const now = new Date();return {connected:true,demo:true,updatedAt:now.toISOString(),insights:[demoPowerLog(now), ...demoCounters(now)],source:'Gesimuleerde Homey-gegevens',zones:[{id:'z1',name:'Woonkamer'},{id:'z2',name:'Keuken'},{id:'z3',name:'Hal'}],devices:[{id:'d1',name:'Staande lamp',zone:'z1',class:'light',capabilities:['onoff','dim'],capabilitiesObj:{onoff:{value:true},dim:{value:.65}}},{id:'d2',name:'Keuken verlichting',zone:'z2',class:'light',capabilities:['onoff','dim'],capabilitiesObj:{onoff:{value:false},dim:{value:0}}},{id:'d3',name:'Slimme stekker TV',zone:'z1',class:'socket',capabilities:['onoff','measure_power'],capabilitiesObj:{onoff:{value:true},measure_power:{value:84,unit:'W'}}},{id:'d4',name:'Netatmo deurbel',zone:'z3',class:'sensor',capabilities:['alarm_motion'],capabilitiesObj:{alarm_motion:{value:false}}},{id:'d5',name:'HomeWizard P1',zone:'z2',class:'sensor',capabilities:['measure_power','meter_power','meter_power.returned'],capabilitiesObj:{measure_power:{value:428,unit:'W'},meter_power:{value:1234.56,unit:'kWh'},'meter_power.returned':{value:321.45,unit:'kWh'}}}, {id:'d6',name:'Google Nest Woonkamer',zone:'z1',class:'speaker',
  driverId:'homey:app:com.google.chromecast:chromecast',
  capabilities:['speaker_playing','speaker_track','speaker_artist'],
  capabilitiesObj:{speaker_playing:{value:true},speaker_track:{value:'Zondagmorgen'},speaker_artist:{value:'Voorbeeldtrack'}}
}],flows:[{id:'f1',name:'Alles uit beneden',enabled:true,advanced:false},{id:'f2',name:'Avondverlichting',enabled:true,advanced:true},{id:'f3',name:'Thuis komen',enabled:true,advanced:false}],energy:[{id:'d5',name:'HomeWizard P1',capabilities:['measure_power','meter_power','meter_power.returned']} ]};}
