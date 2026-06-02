'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const { pushData } = require('../core/github-push.cjs');

const USER_AGENT = 'PHANTOM-Agent phantom@anulakhera.com';
const SIGNALS_PATH = path.join(__dirname, '../data/signals/form4.json');
const OUTPUT_PATH = path.join(__dirname, '../data/signals/positions.json');

// ── FETCH RAW TEXT ───────────────────────────────────────
function fetchText(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── PARSE infotable.xml ──────────────────────────────────
function parseInfoTable(xml) {
  const positions = [];
  const entryRegex = /<infoTable>([\s\S]*?)<\/infoTable>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`));
      return m ? m[1].trim() : '';
    };

    const nameOfIssuer = get('nameOfIssuer');
    const cusip = get('cusip');
    const value = parseInt(get('value')) || 0; // in thousands USD
    const shares = parseInt(get('sshPrnamt')) || 0;
    const shareType = get('sshPrnamtType');
    const investmentDiscretion = get('investmentDiscretion');
    const putCall = get('putCall');

    if (nameOfIssuer) {
      positions.push({
        name: nameOfIssuer,
        cusip,
        value_thousands: value,
        value_usd: value * 1000,
        shares,
        share_type: shareType,
        discretion: investmentDiscretion,
        put_call: putCall || null
      });
    }
  }

  // Sort by value descending
  return positions.sort((a, b) => b.value_usd - a.value_usd);
}

// ── FETCH POSITIONS FOR ONE ENTITY ───────────────────────
async function fetchPositions(entity_id, entity_name, accessionUrl) {
  try {
    // Build infotable.xml URL from accession folder URL
    // Try multiple known XML locations used by different filers
    const candidates = [
      accessionUrl + 'infotable.xml',
      accessionUrl + 'xslForm13F_X02/infotable.xml',
      accessionUrl + 'form13fInfoTable.xml',
      accessionUrl + 'xslForm13F_X02/form13fInfoTable.xml',
    ];

    let xml = '';
    let infoUrl = '';
    for (const candidate of candidates) {
      infoUrl = candidate;
      console.log(`[READER] Trying: ${candidate}`);
      xml = await fetchText(candidate);
      if (xml && xml.includes('<infoTable>')) break;
      xml = '';
      await sleep(150);
    }



    if (!xml || xml.length < 100 || !xml.includes('<infoTable>')) {
      console.log(`[READER] — ${entity_name}: no infotable found`);
      return null;
    }

    const positions = parseInfoTable(xml);
    const totalValue = positions.reduce((a, p) => a + p.value_usd, 0);
    const top10 = positions.slice(0, 10);

    console.log(`[READER] ✓ ${entity_name} — ${positions.length} positions, $${(totalValue/1e9).toFixed(1)}B AUM`);

    return {
      entity_id,
      entity_name,
      filing_url: accessionUrl,
      total_positions: positions.length,
      total_value_usd: totalValue,
      total_value_b: parseFloat((totalValue/1e9).toFixed(2)),
      top_10: top10,
      all_positions: positions,
      parsed_at: new Date().toISOString()
    };
  } catch (err) {
    console.error(`[READER] Error on ${entity_name}:`, err.message);
    return null;
  }
}

// ── MAIN ─────────────────────────────────────────────────
async function run() {
  console.log('[READER] Starting filing reader — ' + new Date().toISOString());

  // Load existing signals
  let signals;
  try {
    signals = JSON.parse(fs.readFileSync(SIGNALS_PATH, 'utf8')).signals;
  } catch (err) {
    console.error('[READER] Cannot load signals:', err.message);
    return;
  }

  // Only process 13F filings — get most recent per entity
  const targets = signals.filter(s => s.type === '13F' && s.filings.length > 0);
  console.log(`[READER] Processing ${targets.length} 13F entities...`);

  const results = [];

  for (const signal of targets) {
    const latest = signal.filings[0]; // most recent first
    const result = await fetchPositions(
      signal.entity_id,
      signal.entity_name,
      latest.url
    );
    if (result) results.push(result);
    await sleep(500); // respect SEC rate limits
  }

  // Build output
  const output = {
    meta: {
      parsed_at: new Date().toISOString(),
      entities_processed: targets.length,
      entities_successful: results.length,
      total_aum_tracked_b: parseFloat(
        results.reduce((a, r) => a + r.total_value_b, 0).toFixed(2)
      )
    },
    positions: results
  };

  // Write locally
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`[READER] Written locally`);

  // Push to GitHub
  await pushData(
    'data/signals/positions.json',
    output,
    `data: positions parsed — ${results.length} entities, $${output.meta.total_aum_tracked_b}B tracked`
  );

  console.log(`[READER] Complete — ${results.length} entities parsed`);
  console.log(`[READER] Total AUM tracked: $${output.meta.total_aum_tracked_b}B`);
}

module.exports = { run };

if (require.main === module) {
  run().catch(console.error);
}
