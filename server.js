const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || 10000;
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://hlasbjayeptkuylnrnoq.supabase.co').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_2WLqzVsb2ZpIaO96jg9yQA_oIw2R0jW';

const OP_COLORS = ['Red', 'Green', 'Blue', 'Purple', 'Black', 'Yellow'];

function extractColors(colorStr) {
  if (!colorStr) return [];
  const lower = String(colorStr).toLowerCase();
  return OP_COLORS.filter(c => lower.includes(c.toLowerCase()));
}

function getBaseCardId(cardId) {
  const match = String(cardId || '').match(/^([A-Z]{1,4}\d{0,2}-\d{3})/i);
  return match ? match[1].toUpperCase() : String(cardId || '').split(' ')[0].trim();
}

function getExt(extendedData, ...keys) {
  if (!Array.isArray(extendedData)) return null;
  for (const key of keys) {
    const found = extendedData.find(
      item =>
        (item.name && item.name.toLowerCase() === key.toLowerCase()) ||
        (item.displayName && item.displayName.toLowerCase() === key.toLowerCase())
    );
    if (found && found.value !== undefined && found.value !== '') {
      return String(found.value).trim();
    }
  }
  return null;
}

// Helper for Supabase PostgREST API calls
async function sbFetch(endpoint, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase error (${res.status}): ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

// Fetch all rows from a table (handles Supabase's 1,000-row pagination limit automatically)
async function sbFetchAll(table, queryParams = 'select=*') {
  const allRows = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const sep = queryParams ? '&' : '';
    const batch = await sbFetch(`${table}?${queryParams}${sep}limit=${limit}&offset=${offset}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    allRows.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return allRows;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'L3Vault/5.0.0 (One Piece TCG Supabase Cloud)',
      'Accept': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// Sync a single One Piece Set (Group) from TCGcsv into Supabase
async function syncSingleGroupToSupabase(group) {
  const productsData = await fetchJson(`https://tcgcsv.com/tcgplayer/68/${group.groupId}/products`);
  const pricesData = await fetchJson(`https://tcgcsv.com/tcgplayer/68/${group.groupId}/prices`);

  const priceMap = new Map();
  for (const p of pricesData.results || []) {
    if (p.marketPrice && (!priceMap.has(p.productId) || p.subTypeName === 'Normal')) {
      priceMap.set(p.productId, p.marketPrice);
    }
  }

  const cardRowsMap = new Map();
  for (const prod of productsData.results || []) {
    const ext = prod.extendedData || [];
    const rawNumber = getExt(ext, 'Number', 'Card Number');
    const rarity = getExt(ext, 'Rarity');
    if (!rawNumber) continue;

    let cardId = rawNumber.trim().toUpperCase();
    const variantMatch = prod.name.match(/\((Parallel\vert{}Alternate Art\vert{}Manga\vert{}Box Topper\vert{}SP\vert{}TR\vert{}Foil)\)/i);
    if (variantMatch) cardId = `${cardId} (${variantMatch[1]})`;
    if (cardRowsMap.has(cardId)) cardId = `${rawNumber.trim().toUpperCase()}-${prod.productId}`;

    const baseId = getBaseCardId(cardId);
    const setCode = baseId.includes('-') ? baseId.split('-')[0] : (group.abbreviation || group.name);
    const rawColor = getExt(ext, 'Color') || 'Unknown';
    const parsedColors = extractColors(rawColor);
    const normalizedColor = parsedColors.length > 0 ? parsedColors.join('/') : rawColor;

    const cardType = getExt(ext, 'CardType', 'Card Type') || 'Card';
    const costVal = parseInt(getExt(ext, 'Cost', 'Life'), 10);
    const powerVal = parseInt(getExt(ext, 'Power'), 10);
    const counterVal = parseInt(getExt(ext, 'Counter', 'Counter+'), 10);
    const attribute = getExt(ext, 'Attribute');
    const subtypes = getExt(ext, 'Subtypes', 'Type');
    const effect = getExt(ext, 'Description', 'Effect');
    const fallbackImg = `https://en.onepiece-cardgame.com/images/cardlist/card/${baseId}.png`;
    const imageUrl = prod.imageUrl || fallbackImg;
    const marketPrice = priceMap.get(prod.productId) || 0.0;

    cardRowsMap.set(cardId, {
      card_id: cardId,
      name: prod.name,
      set_code: setCode,
      set_name: group.name,
      rarity: rarity || null,
      color: normalizedColor,
      card_type: cardType,
      cost: Number.isNaN(costVal) ? null : costVal,
      power: Number.isNaN(powerVal) ? null : powerVal,
      counter: Number.isNaN(counterVal) ? null : counterVal,
      attribute: attribute || null,
      subtypes: subtypes || null,
      effect: effect || null,
      image_url: imageUrl,
      market_price: marketPrice
    });
  }

  const rows = Array.from(cardRowsMap.values());
  if (rows.length > 0) {
    await sbFetch(`cards?on_conflict=card_id`, {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows)
    });
  }
  return rows.length;
}

function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function requestHandler(req, res) {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  try {
    // Serve Frontend UI
    if (req.method === 'GET' && pathname === '/') {
      const htmlPath = path.join(__dirname, 'index.html');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(htmlPath, 'utf8'));
    }

    // 1. Get All Cards + Active Owner Collection + Custom Locations
    if (req.method === 'GET' && pathname === '/api/cards') {
      const owner = urlObj.searchParams.get('owner') || "Larry's Collection";

      const [cards, copies, locRows, metaRows] = await Promise.all([
        sbFetchAll('cards', 'select=*&order=card_id.asc'),
        sbFetchAll('collection_copies', `owner=eq.${encodeURIComponent(owner)}&select=*&order=copy_id.asc`),
        sbFetch(`locations?owner=eq.${encodeURIComponent(owner)}&select=name&order=name.asc`),
        sbFetch(`meta?key=eq.last_sync&select=value`)
      ]);

      const copiesByCard = new Map();
      for (const c of copies) {
        if (!copiesByCard.has(c.card_id)) copiesByCard.set(c.card_id, []);
        copiesByCard.get(c.card_id).push(c);
      }

      const enrichedCards = cards.map(card => {
        const cardCopies = copiesByCard.get(card.card_id) || [];
        return {
          ...card,
          market_price: Number(card.market_price || 0),
          owned_qty: cardCopies.length,
          copies: cardCopies
        };
      });

      const rawLocs = (locRows || []).map(r => r.name);
      const sortedLocs = ['Unassigned', ...rawLocs.filter(n => n !== 'Unassigned')];
      const lastSync = (metaRows && metaRows[0]) ? metaRows[0].value : 'Ready';

      return sendJson(res, 200, {
        cards: enrichedCards,
        locations: sortedLocs,
        lastSync
      });
    }

    // 2. Quick + / - Adjust Copy Count
    if (req.method === 'POST' && pathname === '/api/collection/adjust') {
      const { owner = "Larry's Collection", card_id, delta = 1, location = 'Unassigned', condition = 'NM' } = await readJsonBody(req);

      if (delta > 0) {
        const rowsToInsert = [];
        for (let i = 0; i < delta; i++) {
          rowsToInsert.push({ owner, card_id, condition, location, notes: '' });
        }
        await sbFetch(`collection_copies`, {
          method: 'POST',
          headers: { 'Prefer': 'return=minimal' },
          body: JSON.stringify(rowsToInsert)
        });
      } else if (delta < 0) {
        const toRemove = Math.abs(delta);
        const existing = await sbFetch(
          `collection_copies?owner=eq.${encodeURIComponent(owner)}&card_id=eq.${encodeURIComponent(card_id)}&select=copy_id,location&order=copy_id.desc`
        );
        // Prefer removing 'Unassigned' copies first
        existing.sort((a, b) => (a.location === 'Unassigned' ? -1 : 1) - (b.location === 'Unassigned' ? -1 : 1));
        const idsToDelete = existing.slice(0, toRemove).map(r => r.copy_id);
        if (idsToDelete.length > 0) {
          await sbFetch(`collection_copies?copy_id=in.(${idsToDelete.join(',')})`, { method: 'DELETE' });
        }
      }

      const updatedCopies = await sbFetch(
        `collection_copies?owner=eq.${encodeURIComponent(owner)}&card_id=eq.${encodeURIComponent(card_id)}&select=*&order=copy_id.asc`
      );

      return sendJson(res, 200, {
        success: true,
        card_id,
        owned_qty: updatedCopies.length,
        copies: updatedCopies
      });
    }

    // 3. Update a Specific Copy's Location, Condition, or Notes
    if (req.method === 'PUT' && pathname === '/api/collection/copy') {
      const { copy_id, location, condition, notes } = await readJsonBody(req);
      const updated = await sbFetch(`collection_copies?copy_id=eq.${copy_id}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({
          location: location || 'Unassigned',
          condition: condition || 'NM',
          notes: notes || ''
        })
      });

      let updatedCopies = [];
      if (updated && updated[0]) {
        const { owner, card_id } = updated[0];
        updatedCopies = await sbFetch(
          `collection_copies?owner=eq.${encodeURIComponent(owner)}&card_id=eq.${encodeURIComponent(card_id)}&select=*&order=copy_id.asc`
        );
      }

      return sendJson(res, 200, { success: true, copies: updatedCopies });
    }

    // 4. Delete a Specific Copy
    if (req.method === 'DELETE' && pathname === '/api/collection/copy') {
      const { copy_id } = await readJsonBody(req);
      const existing = await sbFetch(`collection_copies?copy_id=eq.${copy_id}&select=owner,card_id`);
      await sbFetch(`collection_copies?copy_id=eq.${copy_id}`, { method: 'DELETE' });

      let updatedCopies = [];
      let cardId = null;
      if (existing && existing[0]) {
        cardId = existing[0].card_id;
        updatedCopies = await sbFetch(
          `collection_copies?owner=eq.${encodeURIComponent(existing[0].owner)}&card_id=eq.${encodeURIComponent(cardId)}&select=*&order=copy_id.asc`
        );
      }

      return sendJson(res, 200, {
        success: true,
        card_id: cardId,
        owned_qty: updatedCopies.length,
        copies: updatedCopies
      });
    }

    // 5. Add a Custom User Location
    if (req.method === 'POST' && pathname === '/api/locations') {
      const { owner = "Larry's Collection", name } = await readJsonBody(req);
      const cleanName = (name || '').trim();
      if (!cleanName) return sendJson(res, 400, { error: 'Location name required' });

      await sbFetch(`locations?on_conflict=owner,name`, {
        method: 'POST',
        headers: { 'Prefer': 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify([{ owner, name: cleanName }])
      });

      const locRows = await sbFetch(`locations?owner=eq.${encodeURIComponent(owner)}&select=name&order=name.asc`);
      const rawLocs = (locRows || []).map(r => r.name);
      return sendJson(res, 200, {
        success: true,
        locations: ['Unassigned', ...rawLocs.filter(n => n !== 'Unassigned')]
      });
    }

    // 6. Delete a Custom User Location
    if (req.method === 'DELETE' && pathname === '/api/locations') {
      const { owner = "Larry's Collection", name } = await readJsonBody(req);
      if (name && name !== 'Unassigned') {
        await sbFetch(`locations?owner=eq.${encodeURIComponent(owner)}&name=eq.${encodeURIComponent(name)}`, {
          method: 'DELETE'
        });
        await sbFetch(`collection_copies?owner=eq.${encodeURIComponent(owner)}&location=eq.${encodeURIComponent(name)}`, {
          method: 'PATCH',
          headers: { 'Prefer': 'return=minimal' },
          body: JSON.stringify({ location: 'Unassigned' })
        });
      }

      const locRows = await sbFetch(`locations?owner=eq.${encodeURIComponent(owner)}&select=name&order=name.asc`);
      const rawLocs = (locRows || []).map(r => r.name);
      return sendJson(res, 200, {
        success: true,
        locations: ['Unassigned', ...rawLocs.filter(n => n !== 'Unassigned')]
      });
    }

    // 7. Get Saved Decks for Active Owner
    if (req.method === 'GET' && pathname === '/api/decks') {
      const owner = urlObj.searchParams.get('owner') || "Larry's Collection";
      const decks = await sbFetch(`decks?owner=eq.${encodeURIComponent(owner)}&select=*&order=deck_name.asc`);
      if (!decks || decks.length === 0) return sendJson(res, 200, []);

      const deckIds = decks.map(d => d.deck_id).join(',');
      const allDeckCards = await sbFetch(`deck_cards?deck_id=in.(${deckIds})&select=*`);

      const decksWithCards = decks.map(d => ({
        ...d,
        cards: (allDeckCards || []).filter(dc => Number(dc.deck_id) === Number(d.deck_id))
      }));

      return sendJson(res, 200, decksWithCards);
    }

    // 8. Save or Update a Deck
    if (req.method === 'POST' && pathname === '/api/decks/save') {
      const { deck_id, owner = "Larry's Collection", deck_name, leader_card_id, notes, cards = [] } = await readJsonBody(req);
      if (!deck_name || !deck_name.trim()) {
        return sendJson(res, 400, { success: false, error: 'Deck name is required' });
      }

      let targetDeckId = deck_id;
      if (targetDeckId) {
        await sbFetch(`decks?deck_id=eq.${targetDeckId}`, {
          method: 'PATCH',
          headers: { 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            owner,
            deck_name: deck_name.trim(),
            leader_card_id: leader_card_id || '',
            notes: notes || ''
          })
        });
        await sbFetch(`deck_cards?deck_id=eq.${targetDeckId}`, { method: 'DELETE' });
      } else {
        const created = await sbFetch(`decks`, {
          method: 'POST',
          headers: { 'Prefer': 'return=representation' },
          body: JSON.stringify([{
            owner,
            deck_name: deck_name.trim(),
            leader_card_id: leader_card_id || '',
            notes: notes || ''
          }])
        });
        targetDeckId = created[0].deck_id;
      }

      const validCards = cards
        .filter(item => item.card_id && item.quantity > 0)
        .map(item => ({
          deck_id: targetDeckId,
          card_id: item.card_id,
          quantity: Math.min(4, Math.max(1, Number(item.quantity)))
        }));

      if (validCards.length > 0) {
        await sbFetch(`deck_cards`, {
          method: 'POST',
          headers: { 'Prefer': 'return=minimal' },
          body: JSON.stringify(validCards)
        });
      }

      return sendJson(res, 200, { success: true, deck_id: targetDeckId });
    }

    // 9. Delete a Deck
    if (req.method === 'DELETE' && pathname === '/api/decks') {
      const { deck_id } = await readJsonBody(req);
      await sbFetch(`deck_cards?deck_id=eq.${deck_id}`, { method: 'DELETE' });
      await sbFetch(`decks?deck_id=eq.${deck_id}`, { method: 'DELETE' });
      return sendJson(res, 200, { success: true });
    }

    // 10. Serverless-Safe Set-by-Set Sync Endpoints (Never times out on Vercel)
    if (req.method === 'GET' && pathname === '/api/sync-groups') {
      const groupsData = await fetchJson(`https://tcgcsv.com/tcgplayer/68/groups`);
      const targetGroups = (groupsData.results || []).filter(
        g => !g.name.includes('(JP)') && !g.name.includes('Pre-Release')
      );
      return sendJson(res, 200, { groups: targetGroups });
    }

    if (req.method === 'POST' && pathname === '/api/sync-set') {
      const { group, isLast } = await readJsonBody(req);
      const count = await syncSingleGroupToSupabase(group);
      if (isLast) {
        const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
        await sbFetch(`meta?on_conflict=key`, {
          method: 'POST',
          headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify([{ key: 'last_sync', value: now }])
        });
      }
      return sendJson(res, 200, { success: true, updatedCount: count });
    }

    // 11. Full Vault Backup & Restore
    if (req.method === 'GET' && pathname === '/api/backup') {
      const [locations, copies, decks, deckCards] = await Promise.all([
        sbFetchAll('locations', 'select=*'),
        sbFetchAll('collection_copies', 'select=*'),
        sbFetchAll('decks', 'select=*'),
        sbFetchAll('deck_cards', 'select=*')
      ]);
      return sendJson(res, 200, {
        version: 5,
        exportedAt: new Date().toISOString(),
        locations,
        copies,
        decks,
        deckCards
      });
    }

    if (req.method === 'POST' && pathname === '/api/restore') {
      const data = await readJsonBody(req);
      if (Array.isArray(data.locations) && data.locations.length > 0) {
        const cleanLocs = data.locations.map(l => ({ owner: l.owner, name: l.name }));
        await sbFetch(`locations?on_conflict=owner,name`, {
          method: 'POST',
          headers: { 'Prefer': 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify(cleanLocs)
        });
      }
      if (Array.isArray(data.copies)) {
        await sbFetch(`collection_copies?copy_id=gt.0`, { method: 'DELETE' });
        if (data.copies.length > 0) {
          const cleanCopies = data.copies.map(c => ({
            owner: c.owner || "Larry's Collection",
            card_id: c.card_id,
            condition: c.condition || 'NM',
            location: c.location || 'Unassigned',
            notes: c.notes || ''
          }));
          await sbFetch(`collection_copies`, {
            method: 'POST',
            headers: { 'Prefer': 'return=minimal' },
            body: JSON.stringify(cleanCopies)
          });
        }
      }
      return sendJson(res, 200, { success: true });
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  } catch (err) {
    console.error('Server error:', err);
    sendJson(res, 500, { error: err.message });
  }
}

// Export for Vercel Serverless Functions AND allow running locally via `node server.js`
module.exports = requestHandler;

if (require.main === module) {
  const server = http.createServer(requestHandler);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`L3-Vault (Supabase Cloud Edition) running at http://0.0.0.0:${PORT}`);
  });
}