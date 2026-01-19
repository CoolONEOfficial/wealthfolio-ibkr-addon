import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3001;

// Enable CORS for development
app.use(cors());

// Serve static files from dist directory
app.use('/dist', express.static(join(__dirname, 'dist')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Status endpoint (for addon discovery)
app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    version: '1.0.0',
    name: 'ibkr-multi-import'
  });
});

// Addon updates endpoint (for dev mode, no updates available)
app.get('/addon-updates', (req, res) => {
  res.json({
    updates: [],
    message: 'Development mode - no updates available'
  });
});

// Manifest endpoint
app.get('/manifest.json', (req, res) => {
  try {
    const manifest = JSON.parse(readFileSync(join(__dirname, 'manifest.json'), 'utf-8'));
    res.json(manifest);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read manifest' });
  }
});

// Serve the addon bundle
app.get('/addon.js', (req, res) => {
  try {
    const addonJs = readFileSync(join(__dirname, 'dist/addon.js'), 'utf-8');
    res.type('application/javascript').send(addonJs);
  } catch (error) {
    res.status(404).json({ error: 'Addon bundle not found. Run `pnpm build` first.' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 IBKR Multi-Import addon dev server running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   Manifest: http://localhost:${PORT}/manifest.json`);
  console.log(`   Addon bundle: http://localhost:${PORT}/addon.js`);
});
