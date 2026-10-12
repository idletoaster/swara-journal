// Standalone Vedic Ephemeris & Swara Calculations Module (v10)
const JD = d => (d.getTime() / 86400000.0) + 2440587.5;

function getSamagraAyanamsa(jd) {
    let T = (jd - 2451545.0) / 36525.0; 
    return 23.840018 + (1.395521 * T) + (0.000317 * T * T);
}

function shiftToTz(date, tz) {
    if (!tz) return date;
    try { return new Date(date.toLocaleString('en-US', { timeZone: tz })); } 
    catch(e) { return date; }
}

function getAstro(d) {
    let jde = JD(d) + (69.2 / 86400.0);
    let T = (jde - 2451545.0) / 36525.0; 
    
    let omega = 125.04452 - 1934.136261 * T;
    let dPsi = -0.00478 * Math.sin(omega * Math.PI/180);

    let L0 = (280.46646 + 36000.76983 * T) % 360;
    let M = (357.52911 + 35999.05029 * T) * Math.PI/180;
    let sunTrue = (L0 + (1.914602 - 0.004817*T)*Math.sin(M) + 0.019993*Math.sin(2*M)) % 360;
    let sunApp = (sunTrue + dPsi + 360) % 360;

    let L_m = (218.3164477 + 481267.88123421 * T) % 360;
    let D = (297.8501921 + 445267.1114034 * T) * Math.PI/180;
    let M_sun = M;
    let M_moon = (134.9633964 + 477198.8675055 * T) * Math.PI/180;
    let F = (93.2720950 + 483202.0175233 * T) * Math.PI/180;

    const moon_args = [
        [0,0,1,0, 6288774], [2,0,-1,0, 1274027], [2,0,0,0, 658314], [0,0,2,0, 213618], 
        [0,1,0,0, -185116], [0,0,0,2, -114332], [2,0,-2,0, 58793], [2,-1,-1,0, 57066], 
        [2,0,1,0, 53322], [2,-1,0,0, 45758], [0,1,-1,0, -40923], [1,0,0,0, -34720]
    ];

    let ptb_sum = 0;
    for(let i=0; i<moon_args.length; i++) {
        let a = moon_args[i];
        let arg = a[0]*D + a[1]*M_sun + a[2]*M_moon + a[3]*F;
        ptb_sum += a[4] * Math.sin(arg);
    }
    
    let moonTrue = (L_m + (ptb_sum / 1000000.0)) % 360;
    let moonApp = (moonTrue + dPsi + 360) % 360;

    let ayanamsa = getSamagraAyanamsa(JD(d));
    let siderealSun = (sunApp - ayanamsa + 360) % 360;
    let siderealMoon = (moonApp - ayanamsa + 360) % 360;
    let diff = (siderealMoon - siderealSun + 360) % 360;

    return { sunTropical: sunApp, sunSidereal: siderealSun, moonSidereal: siderealMoon, diff: diff, ayanamsa: ayanamsa };
}

function getGeometricSunTimesForDate(date, lat, lon, tz) {
    let tzDate = shiftToTz(date, tz);
    let utcMidnight = new Date(Date.UTC(tzDate.getFullYear(), tzDate.getMonth(), tzDate.getDate(), 0, 0, 0));
    let jd_midnight = (utcMidnight.getTime() / 86400000.0) + 2440587.5;

    function sunParams(jd) {
        let jc = (jd - 2451545.0) / 36525.0;
        let L0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
        let M = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
        let e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
        let C = Math.sin(M * Math.PI/180) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) + 
                Math.sin(2 * M * Math.PI/180) * (0.019993 - 0.000101 * jc) + 
                Math.sin(3 * M * Math.PI/180) * 0.000289;
        let sunTrueLong = L0 + C;
        let omega = 125.04 - 1934.136 * jc;
        let sunAppLong = sunTrueLong - 0.00569 - 0.00478 * Math.sin(omega * Math.PI/180);
        let epsilon = (23 + (26 + 21.448/60)/60) + 0.00256 * Math.cos(omega * Math.PI/180);
        let dec = Math.asin(Math.sin(epsilon * Math.PI/180) * Math.sin(sunAppLong * Math.PI/180)) * 180/Math.PI;
        let y = Math.pow(Math.tan(epsilon / 2 * Math.PI/180), 2);
        let eqTime = 4 * (y * Math.sin(2 * L0 * Math.PI/180) - 2 * e * Math.sin(M * Math.PI/180)) * 180/Math.PI;
        return { eqTime, dec };
    }

    let initial = sunParams(jd_midnight);
    let cosHA = -Math.tan(lat * Math.PI/180) * Math.tan(initial.dec * Math.PI/180);
    cosHA = Math.max(-1, Math.min(1, cosHA));
    let HA = Math.acos(cosHA) * 180/Math.PI;
    let solarNoonGMT = 720 - (lon * 4) - initial.eqTime;
    let riseMin = solarNoonGMT - (HA * 4);
    let setMin = solarNoonGMT + (HA * 4);

    let rise = new Date(utcMidnight.getTime() + riseMin * 60000);
    let set = new Date(utcMidnight.getTime() + setMin * 60000);
    return { rise, set };
}

function getBoundingSunEvents(time, lat, lon, tz) {
    let tTime = time.getTime();
    let yGeo = getGeometricSunTimesForDate(new Date(tTime - 86400000), lat, lon, tz);
    let tGeo = getGeometricSunTimesForDate(new Date(tTime), lat, lon, tz);
    let tmGeo = getGeometricSunTimesForDate(new Date(tTime + 86400000), lat, lon, tz);
    
    let events = [
        {type: 'rise', time: yGeo.rise}, {type: 'set', time: yGeo.set},
        {type: 'rise', time: tGeo.rise}, {type: 'set', time: tGeo.set},
        {type: 'rise', time: tmGeo.rise}, {type: 'set', time: tmGeo.set}
    ].sort((a,b) => a.time - b.time);
    
    let startEvent = events[0], endEvent = events[1];
    let isDay = false;
    for (let i = 0; i < events.length - 1; i++) {
        if (time >= events[i].time && time < events[i+1].time) {
            startEvent = events[i];
            endEvent = events[i+1];
            isDay = (startEvent.type === 'rise');
            break;
        }
    }
    return { start: startEvent.time, end: endEvent.time, isDay, todayRise: tGeo.rise, todaySet: tGeo.set };
}

const TithiNames = ["Prathama", "Dwitiya", "Tritiya", "Chaturthi", "Panchami", "Shashti", "Saptami", "Ashtami", "Navami", "Dashami", "Ekadashi", "Dwadashi", "Trayodashi", "Chaturdashi", "Purnima", "Amavasya"];
const NAKSHATRAS = ["Ashwini", "Bharani", "Krittika", "Rohini", "Mrigashira", "Ardra", "Punarvasu", "Pushyami", "Ashlesha", "Magha", "Purva Phalguni", "Uttara Phalguni", "Hasta", "Chitra", "Swati", "Vishakha", "Anuradha", "Jyeshta", "Mula", "Purva Ashadha", "Uttara Ashadha", "Shravana", "Dhanishta", "Shatabhisha", "Purva Bhadrapada", "Uttara Bhadrapada", "Revati"];
const RASHIS = ["Mesham (Aries)", "Vrishabham (Taurus)", "Midhunam (Gemini)", "Karkataka (Cancer)", "Simham (Leo)", "Kanya (Virgo)", "Tula (Libra)", "Vrischikam (Scorpio)", "Dhanusu (Sagittarius)", "Makaram (Capricorn)", "Kumbha (Aquarius)", "Meenam (Pisces)"];
const SOLAR_MONTHS = ["Mesha", "Vrishabha", "Mithuna", "Karkataka", "Simha", "Kanya", "Tula", "Vrischikam", "Dhanusu", "Makaram", "Kumbha", "Meenam"];
const LUNAR_MONTHS = ["Chaitra", "Vaishakha", "Jyeshtha", "Ashadha", "Shravana", "Bhadrapada", "Ashvina", "Kartika", "Margashirsha", "Pausha", "Magha", "Phalguna"];
const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Chaldaean Planetary Sequence & Arrays
const HORA_PLANETS = ["Sun", "Venus", "Mercury", "Moon", "Saturn", "Jupiter", "Mars"];
const DAY_START_HORA_IDX = [0, 3, 6, 2, 5, 1, 4]; // Sunday(0) starts with Sun(0), Monday(1) with Moon(3), etc.

const TATTVA_CHINTAMANI_IDA = [{n:"Earth", s:"Purna"}, {n:"Water", s:"Purna"}, {n:"Agni", s:"Sunya"}, {n:"Vayu", s:"Sunya"}, {n:"Akasha", s:"Sunya"}];
const TATTVA_SWARODAYA_IDA = [{n:"Vayu", s:"Sunya"}, {n:"Agni", s:"Sunya"}, {n:"Earth", s:"Purna"}, {n:"Water", s:"Purna"}, {n:"Akasha", s:"Sunya"}];
const TATTVA_PINGALA_UNIVERSAL = [{n:"Vayu", s:"Purna"}, {n:"Agni", s:"Purna"}, {n:"Earth", s:"Sunya"}, {n:"Water", s:"Sunya"}, {n:"Akasha", s:"Purna"}];

function getSwaraState(time, lat, lon, tz, mode = 'chintamani') {
    let b = getBoundingSunEvents(time, lat, lon, tz);
    let msSinceStart = time.getTime() - b.start.getTime();
    let totalMs = b.end.getTime() - b.start.getTime();
    
    // Core Temporal Divisions
    let nadiDurationMs = totalMs / 12;
    let tattvaDurationMs = nadiDurationMs / 5;
    let yaamamDurationMs = totalMs / 4;
    let horaDurationMs = totalMs / 12; // Exactly 1/12th of Day or Night

    let nIdx = Math.floor(msSinceStart / nadiDurationMs); 
    let tIdx = Math.floor((msSinceStart % nadiDurationMs) / tattvaDurationMs); 
    let yIdx = Math.floor(msSinceStart / yaamamDurationMs);
    let hIdx = Math.floor(msSinceStart / horaDurationMs);

    let activeSunrise = b.isDay ? b.start : b.todayRise;
    let tzActiveRise = shiftToTz(activeSunrise, tz);
    let day = tzActiveRise.getDay(); 
    let vaaraName = WEEKDAYS[day];

    // Hora Calculation
    let absHIdx = b.isDay ? hIdx : hIdx + 12;
    let startHoraIdx = DAY_START_HORA_IDX[day];
    let currentHoraPlanet = HORA_PLANETS[(startHoraIdx + absHIdx) % 7];

    // Panchang Calculations
    let astroAtRise = getAstro(activeSunrise);
    let tithi = Math.floor(astroAtRise.diff / 12) + 1;
    let isShukla = tithi <= 15;
    let adjTithi = isShukla ? tithi : tithi - 15;
    let currentAstro = getAstro(time);
    let nakIdx = Math.floor(currentAstro.moonSidereal / 13.333333);
    let rashiIdx = Math.floor(currentAstro.moonSidereal / 30);
    let solMonthIdx = Math.floor(currentAstro.sunSidereal / 30);
    let ayana = (currentAstro.sunSidereal >= 270 || currentAstro.sunSidereal < 90) ? "Uttarayana" : "Dakshinayana";

    // Nadi & Rule Validation
    let idaStarts = isShukla ? [1,2,3,7,8,9,13,14,15].includes(adjTithi) : [4,5,6,10,11,12].includes(adjTithi);
    let absNIdx = b.isDay ? nIdx : nIdx + 6;
    let currentIsIda = idaStarts ? (absNIdx % 2 === 0) : (absNIdx % 2 !== 0);

    let seq = !currentIsIda ? TATTVA_PINGALA_UNIVERSAL : (mode === 'swarodaya' ? TATTVA_SWARODAYA_IDA : TATTVA_CHINTAMANI_IDA);
    let activeTattva = seq[Math.min(tIdx, 4)];

    // Yaamam Formatting
    let yaamams = ["Earth", "Water", "Agni", "Vayu/Akasha"];
    let yaamamTattva = yaamams[yIdx];
    let yaamamDesc = `${yIdx + 1}${['st','nd','rd','th'][yIdx]} Yaamam (${b.isDay ? 'Day' : 'Night'}) - ${yaamamTattva}`;

    let ruleIsIda = false;
    if (mode === 'swarodaya') {
        ruleIsIda = [1, 3, 4, 5].includes(day);
    } else {
        ruleIsIda = [1, 3, 5].includes(day) || (day === 6 && !b.isDay);
    }

    // Directional Shoola Rules
    let blocked = new Set();
    let nBlocked = currentIsIda ? ["E", "N"] : ["S", "W"];
    nBlocked.forEach(d => blocked.add(d));
    const vaaraSoola = [["W"], ["E"], ["N"], ["N"], ["S"], ["W"], ["E"]];
    vaaraSoola[day].forEach(d => blocked.add(d));
    const rahuSoola = [["E"], ["S"], ["W"], ["N"], ["E"], ["S"], ["N"]];
    rahuSoola[day].forEach(d => blocked.add(d));
    let clearDirs = DIRS.filter(d => !blocked.has(d));

    // Base Score out of 5 (Forensic Baseline)
    let score = (activeTattva.s === "Purna" ? 1 : 0); 
    if (currentIsIda === ruleIsIda) score++;
    if (currentIsIda === isShukla) score++;
    if (currentIsIda === (ayana === "Uttarayana")) score++;
    if (yaamamTattva.includes(activeTattva.n)) score++; // Tattva matching Yaamam 

    return {
        nadi: currentIsIda ? "ida" : "pingala",
        tattva: activeTattva.n,
        tattva_status: activeTattva.s,
        vaara: vaaraName,
        hora: currentHoraPlanet,
        yaamam_desc: yaamamDesc,
        yaamam_tattva: yaamamTattva,
        resonance_score: score,
        tithi: `${TithiNames[adjTithi - 1] || 'Amavasya'}`,
        paksha: isShukla ? "Shukla" : "Krishna",
        ayana: ayana,
        nakshatra: NAKSHATRAS[nakIdx],
        rashi: RASHIS[rashiIdx],
        solar_month: SOLAR_MONTHS[solMonthIdx],
        lunar_month: LUNAR_MONTHS[solMonthIdx],
        soola: {
            blocked_dirs: Array.from(blocked),
            clear_dirs: clearDirs,
            layers: {
                nadi_blocked: nBlocked,
                vaara_blocked: vaaraSoola[day],
                rahu_blocked: rahuSoola[day]
            }
        }
    };
}