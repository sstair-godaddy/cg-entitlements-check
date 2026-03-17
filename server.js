import express from 'express';
import https from 'https';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { runCompare } from './src/compareLogic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3443;

const certsDir = path.join(__dirname, '.certs');
const certKey = '_.capabilities-graph.api.test-godaddy.com';
const keyPath = path.join(certsDir, `${certKey}.key`);
const certPath = path.join(certsDir, `${certKey}.crt`);
const caPath = path.join(certsDir, `${certKey}_intermediate_chain.crt`);

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/compare', async (req, res) => {
  const { xAppKey } = req.body || {};
  const cookies = req.headers.cookie || req.body?.cookies || '';
  if (!xAppKey || typeof xAppKey !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing xAppKey in request body.' });
  }
  try {
    const result = await runCompare({
      xAppKey: xAppKey.trim(),
      cookies: typeof cookies === 'string' ? cookies.trim() : '',
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

function start() {
  const hostname = 'local.capabilities-graph.api.test-godaddy.com';
  try {
    const key = fs.readFileSync(keyPath);
    const cert = fs.readFileSync(certPath);
    const ca = fs.readFileSync(caPath);
    const server = https.createServer({ key, cert, ca }, app);
    server.listen(PORT, () => {
      console.log(`CG Entitlements Check: https://${hostname}:${PORT}`);
      console.log('Add to /etc/hosts: 127.0.0.1 ' + hostname);
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error('Missing TLS certs in .certs/. Add key, crt, and intermediate chain for ' + certKey);
      process.exit(1);
    }
    throw err;
  }
}

start();
