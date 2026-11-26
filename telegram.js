// telegram.js
const fetch = require('node-fetch');

async function verifyToken(token) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      method: 'GET',
      timeout: 10000
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.description || 'Invalid token' };
    return {
      ok: true,
      botId: String(data.result.id),
      username: data.result.username,
      firstName: data.result.first_name
    };
  } catch (e) {
    return { ok: false, error: 'Telegram API unreachable' };
  }
}

async function getBotPhoto(token, botId) {
  try {
    // Önce profil fotoğrafını bul
    const photos = await fetch(
      `https://api.telegram.org/bot${token}/getUserProfilePhotos?user_id=${botId}&limit=1`
    ).then(r => r.json());

    if (!photos.ok || !photos.result.total_count) return null;

    const fileId = photos.result.photos[0][0].file_id;
    const fileInfo = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`
    ).then(r => r.json());

    if (!fileInfo.ok) return null;
    return `https://api.telegram.org/file/bot${token}/${fileInfo.result.file_path}`;
  } catch (e) {
    return null;
  }
}

module.exports = { verifyToken, getBotPhoto };
