const axios = require('axios');
const path = require('path');

const API = 'https://graph.facebook.com/v21.0';

/**
 * Post a photo to Instagram via the Graph API.
 *
 * Flow:  create container → wait for processing → publish.
 *
 * The image must be reachable by Instagram's servers at a PUBLIC url.
 * We serve it from express at  /media/incoming/<filename>  so the user
 * must set  config.publicUrl  to a URL that resolves to this server
 * (e.g. via Cloudflare Tunnel, reverse proxy, or port-forward).
 */
async function postToInstagram(filePath, caption, config, opts = {}) {
  if (!config.instagramToken) throw new Error('Instagram token not configured');
  if (!config.instagramAccountId) throw new Error('Instagram account ID not configured');
  if (!config.publicUrl) {
    throw new Error(
      'publicUrl not set — Instagram must be able to fetch your image via a public URL. ' +
      'Use Cloudflare Tunnel or port-forwarding and put the URL in Settings → Public URL.'
    );
  }

  const imageUrl =
    config.publicUrl.replace(/\/+$/, '') +
    '/media/incoming/' +
    encodeURIComponent(path.basename(filePath));

  // 1 ── create container
  console.log('[ig] creating container for', imageUrl);
  const containerData = {
    image_url: imageUrl,
    caption,
    access_token: config.instagramToken,
  };
  // Add alt text for discoverability if meta tags provided
  if (opts.altText) {
    containerData.alt_text = opts.altText;
    console.log('[ig] alt_text:', opts.altText.slice(0, 60));
  }
  let ctr;
  try {
    const res = await axios.post(`${API}/${config.instagramAccountId}/media`, containerData);
    ctr = res.data;
  } catch (axErr) {
    const detail = axErr.response?.data?.error?.message || JSON.stringify(axErr.response?.data || {});
    console.error('[ig] container creation failed:', detail);
    throw new Error('Instagram container failed: ' + detail);
  }
  const containerId = ctr.id;
  console.log('[ig] container', containerId);

  // 2 ── poll until FINISHED
  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    const { data } = await axios.get(`${API}/${containerId}`, {
      params: { fields: 'status_code', access_token: config.instagramToken },
    });
    console.log('[ig] status', data.status_code, `(${i + 1})`);
    if (data.status_code === 'FINISHED') break;
    if (data.status_code === 'ERROR') throw new Error('Instagram rejected the image');
    if (i === 29) throw new Error('Timed out waiting for Instagram to process image');
  }

  // 3 ── publish
  const { data: pub } = await axios.post(
    `${API}/${config.instagramAccountId}/media_publish`,
    { creation_id: containerId, access_token: config.instagramToken }
  );
  console.log('[ig] published', pub.id);
  return { mediaId: pub.id, containerId };
}

/** Verify the token is still valid. */
async function verifyToken(token) {
  try {
    const { data } = await axios.get(`${API}/me`, {
      params: { fields: 'id,name', access_token: token },
    });
    return { valid: true, info: data };
  } catch (err) {
    return { valid: false, error: err.response?.data?.error?.message || err.message };
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = { postToInstagram, verifyToken };
