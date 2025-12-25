require('dotenv').config();
const express = require('express');
const axios = require('axios');
const ytdl = require('ytdl-core');
const path = require('path');
const db = require('./db');
const fs = require('fs');
const os = require('os');
const { randomUUID } = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { Errors, createClient } = require('@farcaster/quick-auth');
const quickAuthClient = createClient();
if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve root explicitly (fixes Render "Cannot GET /" if static misses)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Simple health check
app.get('/healthz', (req, res) => res.status(200).send('ok'));

function getMiniAppDomain(req) {
  return process.env.MINIAPP_DOMAIN || req.headers.host || 'localhost';
}

async function quickAuthMiddleware(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing_token' });
  }
  try {
    const token = auth.split(' ')[1];
    const payload = await quickAuthClient.verifyJwt({ token, domain: getMiniAppDomain(req) });
    req.user = { fid: payload.sub };
    // Ensure user exists in local DB
    db.ensureUser(String(req.user.fid));
    next();
  } catch (e) {
    if (e instanceof Errors.InvalidTokenError) {
      return res.status(401).json({ error: 'invalid_token' });
    }
    console.error('QuickAuth verify error:', e);
    return res.status(500).json({ error: 'auth_verify_failed' });
  }
}

function detectTypeFromUrl(u) {
  const lower = u.toLowerCase();
  const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff'].some(ext => lower.includes(ext));
  const isVideo = ['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.m3u8'].some(ext => lower.includes(ext));
  if (isImage) return 'image';
  if (isVideo) return 'video';
  return 'other';
}

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0,10);
}

function isHttpUrl(maybe) {
  try {
    const u = new URL(maybe);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
function ffmpegTranscodeOptionsForQuality(quality) {
  const q = (quality || 'high').toLowerCase();
  if (q === 'low') {
    return ['-movflags +faststart', '-preset veryfast', '-crf 30', '-b:v 1200k', '-maxrate 1200k', '-bufsize 2400k', '-b:a 96k'];
  }
  if (q === 'medium') {
    return ['-movflags +faststart', '-preset veryfast', '-crf 23', '-b:a 128k'];
  }
  return ['-movflags +faststart', '-preset fast', '-crf 18', '-b:a 160k'];
}
async function convertHlsToMp4(url, quality) {
  if (!ffmpegPath) throw new Error('ffmpeg not available');
  const tmpFile = path.join(os.tmpdir(), `hls-${randomUUID()}.mp4`);
  // Try stream copy first (fast, no re-encode)
  const q = (quality || 'high').toLowerCase();
  if (q === 'high') {
    try {
      await new Promise((resolve, reject) => {
        ffmpeg(url)
          .outputOptions(['-c:v copy', '-c:a copy', '-movflags +faststart'])
          .format('mp4')
          .on('error', reject)
          .on('end', resolve)
          .save(tmpFile);
      });
      return tmpFile;
    } catch (e) {
      // fall through to transcode
    }
  }
  const opts = ffmpegTranscodeOptionsForQuality(q);
  await new Promise((resolve, reject) => {
    ffmpeg(url)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions(opts)
      .format('mp4')
      .on('error', reject)
      .on('end', resolve)
      .save(tmpFile);
  });
  return tmpFile;
}

function streamFileWithCleanup(filePath, res, filename) {
  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  const rs = fs.createReadStream(filePath);
  rs.pipe(res);
  const cleanup = () => { try { fs.unlinkSync(filePath); } catch {} };
  res.on('finish', cleanup);
  res.on('close', cleanup);
}

function isHlsUrl(maybe) {
  try {
    const u = new URL(maybe);
    return u.pathname.toLowerCase().endsWith('.m3u8');
  } catch {
    return false;
  }
}

function ffmpegTranscodeOptionsForQuality(quality) {
  const q = (quality || 'high').toLowerCase();
  if (q === 'low') return ['-movflags +faststart', '-preset veryfast', '-crf 30', '-b:v 1200k', '-maxrate 1200k', '-bufsize 2400k', '-b:a 96k'];
  if (q === 'medium') return ['-movflags +faststart', '-preset veryfast', '-crf 23', '-b:a 128k'];
  return ['-movflags +faststart', '-preset fast', '-crf 18', '-b:a 160k'];
}
function pickYoutubeFormat(info, desiredQuality) {
  try {
    const all = info.formats || [];
    const av = all.filter(f => f.hasVideo && f.hasAudio);
    const mp4 = av.filter(f => (f.container || '').includes('mp4'));
    const list = (mp4.length ? mp4 : av)
      .filter(f => typeof f.height === 'number')
      .sort((a,b) => a.height - b.height);
    if (!list.length) return null;
    const q = (desiredQuality || 'high').toLowerCase();
    if (q === 'low') {
      const near360 = list.find(f => f.height && f.height <= 360) || list[0];
      return near360;
    }
    if (q === 'medium') {
      const near720 = [...list].reverse().find(f => f.height && f.height <= 720) || list[Math.floor(list.length/2)];
      return near720;
    }
    return list[list.length - 1];
  } catch {
    return null;
  }
}

async function resolveMediaFromCast(hash, preferType) {
  const mediaList = await listCastMedia(hash);
  if (!mediaList.length) return undefined;
  if (preferType === 'image') return mediaList.find(m => m.type === 'image')?.url || mediaList[0].url;
  if (preferType === 'video') return mediaList.find(m => m.type === 'video')?.url || mediaList[0].url;
  return mediaList[0].url;
}

function getPrice(type, quality, user, url) {
  const q = (quality || 'high').toLowerCase();
  if (type === 'image') {
    // First image per day is free
    if (!user.is_subscribed) {
      if (user.last_free_image_date !== todayISO()) {
        return 0; // free today
      }
    }
    // Paid image after free
    if (q === 'low') return 0.1;
    if (q === 'medium') return 0.2;
    return 0.3; // high
  }
  if (type === 'video') {
    // No free video
    if (q === 'high') return 1.0;
    if (q === 'medium') return 0.5;
    return 0.3; // low
  }
  return 0;
}

function makeIntentId() { return 'pi_' + randomUUID(); }

async function listCastMedia(hash) {
  if (!process.env.NEYNAR_API_KEY) {
    throw new Error('Missing NEYNAR_API_KEY to resolve cast hash');
  }
  const url = `https://api.neynar.com/v2/farcaster/cast?identifier=${encodeURIComponent(hash)}&type=hash`;
  const resp = await axios.get(url, {
    headers: {
      accept: 'application/json',
      api_key: process.env.NEYNAR_API_KEY
    },
    proxy: false
  });
  const cast = resp.data.cast || resp.data;
  const candidates = new Map();
  const pushIf = (u, source) => {
    if (u && typeof u === 'string' && !candidates.has(u)) {
      candidates.set(u, { url: u, type: detectTypeFromUrl(u), source });
    }
  };
  if (Array.isArray(cast.embeds)) {
    for (const e of cast.embeds) pushIf(e.url || e.uri || e.src, 'embed');
  }
  if (cast.frames && cast.frames.image) pushIf(cast.frames.image, 'frame');
  if (Array.isArray(cast.attachments)) {
    for (const a of cast.attachments) {
      if (a.image) pushIf(a.image, 'attachment');
      if (a.video) pushIf(a.video, 'attachment');
      if (a.url) pushIf(a.url, 'attachment');
    }
  }
  return Array.from(candidates.values());
}

app.post('/api/download', quickAuthMiddleware, async (req, res) => {
  try {
    const { url, type, quality } = req.body || {};
    const userId = String(req.user.fid);
    if (!url || !type) return res.status(400).json({ error: 'missing url/hash or type' });

    const user = db.getUser(userId);
    if (!user) return res.status(401).json({ error: 'unknown user' });

    // Pricing enforcement: check if payment required and whether already paid
    const price = getPrice(type, quality, user, url);
    if (price > 0 && !db.hasPaidFor(userId, type, quality)) {
      // Create an intent and ask client to pay
      const intentId = makeIntentId();
      db.createPaymentIntent({ id: intentId, user_id: userId, type, quality, amount: price, status: 'pending', created_at: new Date().toISOString() });
      return res.status(402).json({ error: 'payment_required', intentId, amount: price, currency: 'USDC', type, quality });
    }
    // Mark today's free image when applicable
    if (type === 'image' && price === 0 && user.last_free_image_date !== todayISO()) {
      db.setLastFreeDate(userId, todayISO());
    }

    if (type === 'image') {
      if (!user.is_subscribed) {
        if (user.last_free_image_date === todayISO()) {
          return res.status(402).json({ error: 'daily free image already used', needSubscription: true });
        } else {
          db.setLastFreeDate(userId, todayISO());
        }
      }
    }

    if (type === 'video') {
      if (!user.is_subscribed) {
        return res.status(402).json({ error: 'video download requires subscription', needSubscription: true });
      }
    }

    let actualUrl = url;
    if (!isHttpUrl(url)) {
      try {
        actualUrl = await resolveMediaFromCast(url, type);
      } catch (e) {
        return res.status(400).json({ error: 'failed to resolve cast hash', details: e.message });
      }
      if (!actualUrl) {
        return res.status(404).json({ error: 'no media found in cast' });
      }
    }

    if (/youtube\.com|youtu\.be/.test(actualUrl)) {
      if (!ytdl.validateURL(actualUrl)) return res.status(400).json({ error: 'invalid YouTube url' });
      const info = await ytdl.getInfo(actualUrl);
      if (type === 'image') {
        const thumb = info.videoDetails.thumbnails.pop();
        return res.redirect(thumb.url);
      }
      const fmt = pickYoutubeFormat(info, quality);
      const baseName = info.videoDetails.title || 'video';
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.mp4"`);
      if (fmt) {
        ytdl(actualUrl, { format: fmt }).pipe(res);
      } else {
        ytdl(actualUrl, { quality: 'highest', filter: 'audioandvideo' }).pipe(res);
      }
      return;
    }
    // Handle HLS manifest by converting to MP4 via ffmpeg (file-based for reliability)
    if (type === 'video' && isHlsUrl(actualUrl)) {
      if (!ffmpegPath) {
        return res.status(501).json({ error: 'HLS to MP4 requires ffmpeg. Install ffmpeg-static.' });
      }
      try {
        const baseName = path.basename(new URL(actualUrl).pathname).replace(/\.m3u8$/i, '') || 'video';
        const outPath = await convertHlsToMp4(actualUrl, quality);
        streamFileWithCleanup(outPath, res, `${baseName}.mp4`);
      } catch (err) {
        console.error('ffmpeg HLS->MP4 error:', err);
        return res.status(500).json({ error: 'failed to convert HLS to mp4', details: String(err.message || err) });
      }
      return;
    }

    // Default: proxy/stream the content as-is
    const resp = await axios.get(actualUrl, { responseType: 'stream', proxy: false });
    const contentType = resp.headers['content-type'] || (type === 'image' ? 'image/*' : 'application/octet-stream');
    const filename = path.basename(new URL(actualUrl).pathname) || (type === 'image' ? 'image' : 'file');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    resp.data.pipe(res);
  } catch (err) {
    console.error('Download handler error:', err);
    const message = err && (err.message || err.toString());
    const code = err && err.code ? String(err.code) : undefined;
    res.status(500).json({ error: 'server error', details: message, code });
  }
});

// Pricing endpoint
app.get('/api/pricing', (req, res) => {
  res.json({
    image: { low: 0.1, medium: 0.2, high: 0.3 },
    video: { low: 0.3, medium: 0.5, high: 1.0 },
    currency: 'USDC'
  });
});

// Create a payment intent (server records intent; client must complete payment via wallet)
app.post('/api/pay-intent', quickAuthMiddleware, (req, res) => {
  const { type, quality } = req.body || {};
  const userId = String(req.user.fid);
  const user = db.getUser(userId);
  if (!user) return res.status(401).json({ error: 'unknown user' });
  if (!type || !quality) return res.status(400).json({ error: 'missing type/quality' });
  const amount = getPrice(type, quality, user);
  if (!amount || amount <= 0) return res.status(400).json({ error: 'no payment required' });
  const id = makeIntentId();
  db.createPaymentIntent({ id, user_id: userId, type, quality, amount, status: 'pending', created_at: new Date().toISOString() });
  res.json({ intentId: id, amount, currency: 'USDC' });
});

// Confirm payment (DEV: trust client). In production, verify on-chain via WalletConnect+RPC or provider webhook
app.post('/api/pay-confirm', quickAuthMiddleware, (req, res) => {
  const { intentId, txHash, address, secret } = req.body || {};
  const userId = String(req.user.fid);
  const intent = db.getPaymentIntent(intentId);
  if (!intent || intent.user_id !== userId) return res.status(404).json({ error: 'intent_not_found' });
  // DEV: verify using shared secret; in production verify on-chain
  if (process.env.WC_SECRET && secret !== process.env.WC_SECRET) {
    return res.status(401).json({ error: 'invalid_secret' });
  }
  if (address && /^0x[a-fA-F0-9]{40}$/.test(address)) {
    db.setWalletAddress(userId, address);
  }
  // TODO: verify txHash on-chain; for now mark paid
  db.markIntentPaid(intentId);
  res.json({ ok: true, intentId, txHash, linkedAddress: db.getWalletAddress(userId) });
});

// Link wallet address to current user (requires WC secret for security in dev)
app.post('/api/wallet/link', quickAuthMiddleware, (req, res) => {
  const { address, secret } = req.body || {};
  const userId = String(req.user.fid);
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: 'invalid_address' });
  }
  if (process.env.WC_SECRET && secret !== process.env.WC_SECRET) {
    return res.status(401).json({ error: 'invalid_secret' });
  }
  db.setWalletAddress(userId, address);
  res.json({ ok: true, address });
});

// Public in dev: inspect cast media without Quick Auth
app.post('/api/cast-media', async (req, res) => {
  try {
    const { hash } = req.body || {};
    if (!hash) return res.status(400).json({ error: 'missing cast hash' });
    const media = await listCastMedia(hash);
    if (!media.length) return res.status(404).json({ error: 'no media found in cast' });
    res.json({ media });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'failed to resolve cast media' });
  }
});

app.post('/api/subscribe', quickAuthMiddleware, (req, res) => {
  const userId = String(req.user.fid);
  db.setSubscription(userId, true);
  res.json({ ok: true });
});

// Public status for health checks and client key awareness
app.get('/api/status', (req, res) => {
  res.json({ hasNeynarKey: Boolean(process.env.NEYNAR_API_KEY) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port', PORT));
