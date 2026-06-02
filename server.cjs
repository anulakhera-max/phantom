'use strict';

const cron = require('node-cron');

console.log('[PHANTOM] Agent scheduler starting...');
console.log('[PHANTOM] ' + new Date().toISOString());

// ── AGENT SCHEDULE ──────────────────────────────────────
// Each agent runs on its own cron. Agents not yet built
// are stubbed here so the schedule is visible and ready.

// EDGAR — Form 4, 13F, 13D/G — every 2 hours
cron.schedule('0 */2 * * *', () => {
  console.log('[EDGAR] Running Form 4 collector...');
  // require('./agents/edgar.cjs').run();
});

// Congressional trades — every 4 hours
cron.schedule('0 */4 * * *', () => {
  console.log('[CONGRESS] Running congressional trade collector...');
  // require('./agents/congressional.cjs').run();
});

// News RSS — every 15 minutes
cron.schedule('*/15 * * * *', () => {
  console.log('[NEWS] Running RSS collector...');
  // require('./agents/news.cjs').run();
});

// Reddit — every 30 minutes
cron.schedule('*/30 * * * *', () => {
  console.log('[REDDIT] Running Reddit collector...');
  // require('./agents/reddit.cjs').run();
});

// Social targets — every hour
cron.schedule('0 * * * *', () => {
  console.log('[SOCIAL] Running social monitor...');
  // require('./agents/social.cjs').run();
});

// CFTC COT — Fridays at 3:30 PM EST
cron.schedule('30 15 * * 5', () => {
  console.log('[CFTC] Running COT collector...');
  // require('./agents/cftc.cjs').run();
});

// Norway GPFG — daily at 6 AM EST
cron.schedule('0 6 * * *', () => {
  console.log('[NORWAY] Running GPFG collector...');
  // require('./agents/norway.cjs').run();
});

// Convergence engine — every 6 hours
cron.schedule('0 */6 * * *', () => {
  console.log('[CONVERGENCE] Running pattern engine...');
  // require('./core/convergence.cjs').run();
});

console.log('[PHANTOM] All agents scheduled. Running 24/7.');

// Keep process alive on Render
setInterval(() => {
  console.log('[PHANTOM] Heartbeat — ' + new Date().toISOString());
}, 60000);
