'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const { pushData } = require('../core/github-push.cjs');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const POSITIONS_PATH = path.join(__dirname, '../data/signals/positions.json');
const OUTPUT_PATH = path.join(__dirname, '../data/signals/analysis.json');

function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data).content?.[0]?.text || ''); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildPrompt(entity) {
  const top10 = entity.top_10.slice(0, 10);
  const topStr = top10.map((h, i) =>
    `${i+1}. ${h.name} — $${(h.value_usd/1e9).toFixed(1)}B (${((h.value_usd/entity.total_value_usd)*100).toFixed(1)}%)`
  ).join('\n');
  const concentration = ((top10.slice(0,3).reduce((a,h)=>a+h.value_usd,0)/entity.total_value_usd)*100).toFixed(1);
  const top3 = top10.slice(0,3).map(h=>h.name).join(', ');

  return `You are PHANTOM — shadow intelligence. Analyze this 13F.

ENTITY: ${entity.entity_name}
AUM: $${entity.total_value_b}B | POSITIONS: ${entity.total_positions}
TOP 3 CONCENTRATION: ${concentration}% in ${top3}

TOP 10:
${topStr}

Respond in EXACTLY this format with no extra text before or after:

THE POSITION
[2-3 sentences on what they own and concentration]

THE THESIS
[2-3 sentences on investment thesis this reveals]

THE SIGNAL
[2-3 sentences on specific ticker implications right now]`;
}

async function run() {
  console.log('[ANALYZER] Starting — ' + new Date().toISOString());
  if (!ANTHROPIC_API_KEY) { console.error('[ANALYZER] No API key'); return; }

  let positionData;
  try { positionData = JSON.parse(fs.readFileSync(POSITIONS_PATH, 'utf8')); }
  catch (err) { console.error('[ANALYZER] Cannot load positions:', err.message); return; }

  const entities = positionData.positions;
  console.log(`[ANALYZER] Analyzing ${entities.length} entities...`);
  const analyses = [];

  for (const entity of entities) {
    try {
      console.log(`[ANALYZER] Analyzing ${entity.entity_name}...`);
      const response = await callClaude(buildPrompt(entity));
      console.log('[ANALYZER] Raw sample:', response.slice(0, 120));

      const posMatch = response.match(/THE POSITION\n([\s\S]*?)(?=\nTHE THESIS)/);
      const thesisMatch = response.match(/THE THESIS\n([\s\S]*?)(?=\nTHE SIGNAL)/);
      const signalMatch = response.match(/THE SIGNAL\n([\s\S]*?)$/);

      analyses.push({
        entity_id: entity.entity_id,
        entity_name: entity.entity_name,
        aum_b: entity.total_value_b,
        total_positions: entity.total_positions,
        top_3: entity.top_10.slice(0,3).map(h => ({
          name: h.name,
          value_b: parseFloat((h.value_usd/1e9).toFixed(2))
        })),
        analysis: {
          the_position: posMatch?.[1]?.trim() || '',
          the_thesis: thesisMatch?.[1]?.trim() || '',
          the_signal: signalMatch?.[1]?.trim() || ''
        },
        analyzed_at: new Date().toISOString()
      });
      console.log(`[ANALYZER] ✓ ${entity.entity_name}`);
      await sleep(1000);
    } catch (err) {
      console.error(`[ANALYZER] Error on ${entity.entity_name}:`, err.message);
    }
  }

  const output = {
    meta: { analyzed_at: new Date().toISOString(), entity_count: analyses.length, model: 'claude-sonnet-4-20250514' },
    analyses
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  await pushData('data/signals/analysis.json', output, `data: Claude analysis — ${analyses.length} entities`);
  console.log(`[ANALYZER] Complete — ${analyses.length} entities`);
}

module.exports = { run };
if (require.main === module) { run().catch(console.error); }
