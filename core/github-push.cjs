'use strict';

const https = require('https');

// ── CONFIG ──────────────────────────────────────────────
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = 'anulakhera-max';
const REPO_NAME = 'phantom';
const BRANCH = 'main';

// ── HELPERS ─────────────────────────────────────────────
function githubRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'User-Agent': 'PHANTOM-Agent',
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── GET CURRENT FILE SHA (needed for updates) ───────────
async function getFileSha(filePath) {
  const path = `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;
  const res = await githubRequest('GET', path);
  if (res.status === 200 && res.body.sha) return res.body.sha;
  return null; // file doesn't exist yet
}

// ── MAIN: WRITE JSON TO GITHUB ───────────────────────────
async function pushData(filePath, data, commitMessage) {
  if (!GITHUB_TOKEN) {
    console.error('[GITHUB-PUSH] No GITHUB_TOKEN set — skipping push');
    return false;
  }

  try {
    const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
    const sha = await getFileSha(filePath);

    const body = {
      message: commitMessage || `data: update ${filePath}`,
      content,
      branch: BRANCH,
      ...(sha ? { sha } : {})
    };

    const path = `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;
    const res = await githubRequest('PUT', path, body);

    if (res.status === 200 || res.status === 201) {
      console.log(`[GITHUB-PUSH] ✓ ${filePath} committed`);
      return true;
    } else {
      console.error(`[GITHUB-PUSH] Failed ${filePath} — status ${res.status}:`, 
        JSON.stringify(res.body).slice(0, 200));
      return false;
    }
  } catch (err) {
    console.error(`[GITHUB-PUSH] Error pushing ${filePath}:`, err.message);
    return false;
  }
}

module.exports = { pushData };
