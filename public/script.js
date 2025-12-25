// زر التوقيع عبر Farcaster
const signBtn = document.getElementById('sign-btn');

async function handleSign() {
  setStatus('progress', 'جاري طلب التوقيع من Farcaster...');
  try {
    // مثال: توقيع رسالة نصية
    const message = 'أوافق على استخدام DownloadFar';
    if (typeof sdk !== 'undefined' && sdk.signer) {
      const result = await sdk.signer.requestSignature({
        message,
        type: 'text',
      });
      if (result && result.signature) {
        setStatus('success', 'تم التوقيع بنجاح!');
        console.log('Signature:', result.signature);
      } else {
        setStatus('warn', 'لم يتم التوقيع أو رفض المستخدم.');
      }
    } else {
      setStatus('error', 'SDK غير متوفر أو لا يدعم التوقيع.');
    }
  } catch (err) {
    setStatus('error', 'حدث خطأ أثناء طلب التوقيع.');
    console.error(err);
  }
}

if (signBtn) signBtn.addEventListener('click', handleSign);
const form = document.getElementById('form');
const urlInput = document.getElementById('url');
const typeSelect = document.getElementById('type');
const qualitySelect = document.getElementById('quality');
const statusEl = document.getElementById('status');
const downloadBtn = document.getElementById('download-btn');
const subscribeBtn = document.getElementById('subscribe');
const inspectBtn = document.getElementById('inspect-btn');
const mediaPanel = document.getElementById('media-panel');
const mediaListEl = document.getElementById('media-list');
let hasNeynarKey = false;

import { sdk } from 'https://esm.sh/@farcaster/miniapp-sdk';
let sessionToken;
// Optional runtime config: set `window._walletConfig = { address: '0x...', secret: 'wc_secret_...' }`
const WALLET_CONFIG = typeof window !== 'undefined' && window._walletConfig ? window._walletConfig : {};

async function getSessionToken() {
  try {
      // Farcaster QuickAuth: جلب توكن المستخدم وربط fid
      const { token, fid } = await sdk.quickAuth.getToken();
    sessionToken = token;
      window._farcasterUser = { fid, token };
    hideSplash();
    // Attempt wallet auto-linking if configured
    linkWalletIfConfigured().catch(() => {});
    return token;
  } catch (e) {
    console.error('QuickAuth getToken failed', e);
    // Fallback: hide splash so the app remains usable
    hideSplash();
    setStatus('warn', 'تعذر التحقق من الجلسة — نمط المطور مفعل.');
    return undefined;
  }
}

async function postJson(url, body) {
  if (!sessionToken) await getSessionToken();
  const headers = { 'Content-Type': 'application/json' };
  if (sessionToken) headers['Authorization'] = 'Bearer ' + sessionToken;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  return res;
}

function setStatus(state, text) {
  statusEl.dataset.state = state;
  statusEl.textContent = text;
}

function renderMediaList(media) {
  mediaListEl.innerHTML = '';
  if (!media || !media.length) {
    mediaPanel.hidden = true;
    return;
  }

  for (const item of media) {
    const card = document.createElement('div');
    card.className = 'media-card';

    const top = document.createElement('div');
    top.className = 'media-card__meta';
    top.innerHTML = `<span>${item.source || 'cast media'}</span><span class="badge ${item.type}">${item.type}</span>`;
    card.appendChild(top);

    const thumb = createThumb(item);
    card.appendChild(thumb);

    const urlEl = document.createElement('code');
    urlEl.textContent = item.url;
    card.appendChild(urlEl);

    const button = document.createElement('button');
    button.className = 'btn ghost';
    button.type = 'button';
    button.textContent = 'Use this';
    button.addEventListener('click', () => {
      urlInput.value = item.url;
      if (item.type === 'video') typeSelect.value = 'video';
      else if (item.type === 'image') typeSelect.value = 'image';
      setStatus('success', 'Media selected. Ready to download.');
      mediaPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    card.appendChild(button);

    mediaListEl.appendChild(card);
  }
  mediaPanel.hidden = false;
}

function createThumb(item) {
  const wrap = document.createElement('div');
  wrap.className = 'media-thumb';

  const lower = (item.url || '').toLowerCase();
  const isYouTube = /youtube\.com|youtu\.be/.test(lower);
  const isHls = lower.endsWith('.m3u8');

  if (item.type === 'image') {
    const img = document.createElement('img');
    img.alt = 'image preview';
    img.loading = 'lazy';
    img.src = item.url;
    img.onerror = () => addFallback(wrap, 'تعذر تحميل المعاينة');
    wrap.appendChild(img);
    return wrap;
  }

  if (item.type === 'video') {
    if (isYouTube) {
      const iframe = document.createElement('iframe');
      const videoId = extractYouTubeId(item.url);
      iframe.src = `https://www.youtube.com/embed/${videoId}`;
      iframe.title = 'YouTube preview';
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.setAttribute('allowfullscreen', '');
      wrap.appendChild(iframe);
      return wrap;
    }
    if (isHls) {
      addFallback(wrap, 'HLS stream (m3u8) — معاينة غير مدعومة هنا');
      return wrap;
    }
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = item.url;
    video.onloadedmetadata = () => {
      // Autoplay a short silent snippet for visual preview, if allowed
      const play = video.play();
      if (play) play.catch(() => {/* ignore autoplay block */});
    };
    video.onerror = () => addFallback(wrap, 'تعذر تحميل الفيديو للمعاينة');
    wrap.appendChild(video);
    return wrap;
  }

  addFallback(wrap, 'نوع غير معروف — افتح الرابط للفحص');
  return wrap;
}

function addFallback(wrap, text) {
  const fb = document.createElement('div');
  fb.className = 'thumb-fallback';
  fb.textContent = text;
  wrap.appendChild(fb);
}

function extractYouTubeId(u) {
  try {
    const url = new URL(u);
    if (url.hostname.includes('youtu.be')) return url.pathname.slice(1);
    if (url.searchParams.has('v')) return url.searchParams.get('v');
    const paths = url.pathname.split('/').filter(Boolean);
    return paths.pop();
  } catch {
    return u;
  }
}

function hideSplash() {
  const el = document.getElementById('splash');
  if (el) el.hidden = true;
}
// Fallbacks: auto-hide splash after a short delay and on click
window.addEventListener('DOMContentLoaded', () => {
  const splash = document.getElementById('splash');
  if (splash) {
    splash.addEventListener('click', () => {
      hideSplash();
      setStatus('warn', 'تم إخفاء شاشة البداية.');
    });
  }
  setTimeout(() => {
    const el = document.getElementById('splash');
    if (el && !el.hidden && !sessionToken) {
      hideSplash();
      setStatus('warn', 'لم نحصل على توكن سريع — سنواصل بدون المصادقة.');
    }
  }, 3500);

  // Mini App SDK: إضافة التطبيق تلقائياً لقائمة الميني آب عند دخول المستخدم
  if (typeof sdk !== 'undefined' && sdk.miniApp) {
    sdk.miniApp.registerApp({
      name: 'DownloadFar',
      url: window.location.origin,
      icon: '/favicon.ico',
      description: 'Download media from Farcaster casts and URLs.'
    }).catch(() => {});
  }
});

async function linkWalletIfConfigured() {
  if (!sessionToken) return;
  const cfg = (typeof window !== 'undefined' ? window._walletConfig : WALLET_CONFIG) || {};
  const address = cfg.address;
  const secret = cfg.secret;
  if (!address || !secret) return;
  try {
    const res = await postJson('/api/wallet/link', { address, secret });
    if (res.ok) {
      const data = await res.json();
      setStatus('success', 'Wallet linked: ' + data.address);
    }
  } catch (e) {
    // Silent failure
  }
}


async function handleDownload(e) {
  e.preventDefault();
  const url = urlInput.value.trim();
  const type = typeSelect.value;
  const quality = qualitySelect.value;

  if (!url) {
    setStatus('warn', 'Paste a URL or cast hash to continue.');
    return;
  }

  setStatus('progress', 'Preparing your file...');
  downloadBtn.disabled = true;
  downloadBtn.textContent = 'Working...';

  try {
    const res = await postJson('/api/download', { url, type, quality });
    if (res.status === 402) {
      const data = await res.json();
      setStatus('warn', (data.error || 'Subscription required') + '. Please subscribe.');
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      const extra = err.details ? ' — ' + err.details : '';
      setStatus('error', 'Error: ' + (err.error || res.statusText) + extra);
      return;
    }

    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    let filename = 'download';
    const m = /filename=\"?([^\\\"]+)\"?/.exec(cd);
    if (m) filename = m[1];

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setStatus('success', 'Download started: ' + filename);
  } catch (err) {
    setStatus('error', 'Network issue. Please retry.');
    console.error(err);
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.textContent = 'Start download';
  }
}

async function fetchStatus() {
  try {
    if (!sessionToken) await getSessionToken();
    const res = await fetch('/api/status', { headers: { Authorization: sessionToken ? ('Bearer ' + sessionToken) : '' } });
    if (!res.ok) return;
    const data = await res.json();
    hasNeynarKey = Boolean(data.hasNeynarKey);
    if (!hasNeynarKey) {
      setStatus('warn', 'الخادم لا يملك NEYNAR_API_KEY حالياً. ضع المفتاح في .env ثم أعد التشغيل.');
    }
  } catch (err) {
    console.error('status check failed', err);
  }
}

async function inspectCast() {
  const value = urlInput.value.trim();
  if (!value) {
    setStatus('warn', 'أدخل رابط أو هاش الكاست أولاً.');
    return;
  }
  if (!hasNeynarKey) {
    setStatus('warn', 'سنحاول الفحص حتى لو لم يتعرف الخادم على NEYNAR_API_KEY.');
  }
  inspectBtn.disabled = true;
  inspectBtn.textContent = 'Inspecting...';
  setStatus('progress', 'جاري جلب الوسائط أو المعاينة...');
  try {
    // أرسل دائماً إلى السيرفر، سواء كان هاش أو رابط
    const res = await postJson('/api/cast-media', { hash: value });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'فشل الفحص' }));
      setStatus('error', err.error || 'فشل الفحص');
      mediaPanel.hidden = true;
      return;
    }
    const data = await res.json();
    if (!data.media || !data.media.length) {
      setStatus('warn', 'لا توجد وسائط أو معاينة متاحة لهذا الإدخال.');
      mediaPanel.hidden = true;
      return;
    }
    renderMediaList(data.media);
    setStatus('success', 'تم جلب الوسائط أو المعاينة.');
  } catch (err) {
    console.error(err);
    setStatus('error', 'تعذر الاتصال بالخادم.');
    mediaPanel.hidden = true;
  } finally {
    inspectBtn.disabled = false;
    inspectBtn.textContent = 'Inspect media';
  }
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}


async function handleSubscribe() {
  subscribeBtn.disabled = true;
  subscribeBtn.textContent = 'Subscribing...';
  try {
    const res = await postJson('/api/subscribe', {});
    if (res.ok) setStatus('success', 'Subscribed (dev).');
    else setStatus('error', 'Subscribe failed.');
  } catch (err) {
    setStatus('error', 'Network issue while subscribing.');
    console.error(err);
  } finally {
    subscribeBtn.disabled = false;
    subscribeBtn.textContent = 'Subscribe (dev)';
  }
}

form.addEventListener('submit', handleDownload);
subscribeBtn.addEventListener('click', handleSubscribe);
inspectBtn.addEventListener('click', inspectCast);
fetchStatus();
