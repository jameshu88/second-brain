require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });

const { loadConfig } = require('./config');
const { buildApp } = require('./slack/adapter');

async function main() {
  const config = loadConfig(process.env);
  const app = await buildApp({ config });
  await app.start();
  console.log(`[brain] started in Socket Mode`);
  console.log(`[brain] vault: ${config.vaultPath}`);
  console.log(`[brain] allowlist: ${config.allowedUserIds.join(',') || '(open)'}`);
}

main().catch((err) => {
  console.error('[brain] fatal:', err);
  process.exit(1);
});
