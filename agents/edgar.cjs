'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

// ── CONFIG ──────────────────────────────────────────────
const EDGAR_BASE = 'data.sec.gov';
const USER_AGENT = 'PHANTOM-Agent phantom@anulakhera.com'; // required by SEC
const ENTITIES_PATH = path.join(__dirname, '../core/entities.json');
const OUTPUT_PATH = path.join(__dirname, '../data/signals/form4.json');

// ── HELPERS ─────────────────────────────────────────────
function get(host, urlPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: host,
      path: urlPath,
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── CORE LOGIC ──────────────────────────────────────────
async function getRecentFilings(cik, formType = '4') {
  const paddedCik = String(cik).replace(/^0+/, '').padStart(10, '0');
  const urlPath = `/submissions/CIK${paddedCik}.json`;

  try {
    const data = await get(EDGAR_BASE, urlPath);
    if (!data || !data.filings || !data.filings.recent) return [];

    const recent = data.filings.recent;
    const forms = recent.form || [];
    const dates = recent.filed || recent.date || [];
    const accessions = recent.accessionNumber || [];

    const results = [];
    const len = Math.min(forms.length, dates.length, accessions.length);

    for (let i = 0; i < len; i++) {
      if (forms[i] === formType) {
        results.push({
          form: forms[i],
          date: dates[i],
          accession: accessions[i],
          cik: paddedCik,
          url: `https://www.sec.gov/Archives/edgar/data/${parseInt(paddedCik)}/` +
               `${accessions[i].replace(/-/g, '')}/`
        });
      }
      if (results.length >= 5) break;
    }
    return results;
  } catch (err) {
    console.error(`[EDGAR] Error fetching CIK ${cik}:`, err.message);
    return [];
  }
}

// ── MAIN RUN ────────────────────────────────────────────
async function run() {
  console.log('[EDGAR] Starting Form 4 collection — ' + new Date().toISOString());

  // Load entity registry
  let entities;
  try {
    entities = JSON.parse(fs.readFileSync(ENTITIES_PATH, 'utf8')).entities;
  } catch (err) {
    console.error('[EDGAR] Failed to load entities.json:', err.message);
    return;
  }

  // Filter to entities with CIK and Form 4 signal
  const targets = entities.filter(e =>
  e.cik &&
  e.cik !== 'multiple' &&
  (e.signals.includes('form4') || e.signals.includes('13F'))
);

  console.log(`[EDGAR] Scanning ${targets.length} entities...`);

  const allSignals = [];
  const breakingPoints = [];

  for (const entity of targets) {
    try {
      // Form 4 for individuals
      if (entity.signals.includes('form4')) {
        const form4s = await getRecentFilings(entity.cik, '4');
        if (form4s.length > 0) {
          allSignals.push({
            entity_id: entity.id,
            entity_name: entity.name,
            type: 'form4',
            tier: entity.tier,
            filings: form4s,
            collected_at: new Date().toISOString()
          });
          console.log(`[EDGAR] ✓ ${entity.name} — ${form4s.length} Form 4s found`);
        } else {
          console.log(`[EDGAR] — ${entity.name} — no recent Form 4s`);
        }
        await sleep(200); // respect 10 req/sec SEC rate limit
      }

      // 13F for institutional
      if (entity.signals.includes('13F') && entity.cik) {
        const thirteenFs = await getRecentFilings(entity.cik, '13F-HR');
        if (thirteenFs.length > 0) {
          allSignals.push({
            entity_id: entity.id,
            entity_name: entity.name,
            type: '13F',
            tier: entity.tier,
            filings: thirteenFs,
            collected_at: new Date().toISOString()
          });
          console.log(`[EDGAR] ✓ ${entity.name} — ${thirteenFs.length} 13F filings found`);
        }
        await sleep(200);
      }

    } catch (err) {
      console.error(`[EDGAR] Failed on ${entity.name}:`, err.message);
      breakingPoints.push({
        entity_id: entity.id,
        entity_name: entity.name,
        error: err.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Write output
  const output = {
    meta: {
      collected_at: new Date().toISOString(),
      entity_count: targets.length,
      signal_count: allSignals.length,
      breaking_points: breakingPoints
    },
    signals: allSignals
  };

  try {
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
    console.log(`[EDGAR] ✓ Written to ${OUTPUT_PATH}`);
    console.log(`[EDGAR] Complete — ${allSignals.length} signals from ${targets.length} entities`);
  } catch (err) {
    console.error('[EDGAR] Failed to write output:', err.message);
  }
}

module.exports = { run };

// Run directly if called standalone
if (require.main === module) {
  run().catch(console.error);
}
