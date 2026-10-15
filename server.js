const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync('l3_vault.db');
const PORT = 3000;
const CATEGORY_ID = 68;

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

  CREATE TABLE IF NOT EXISTS cards (
    card_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    set_code TEXT,
    set_name TEXT,
    rarity TEXT,
    color TEXT,
    card_type TEXT,
    cost INTEGER,
    power INTEGER,
    counter INTEGER,
    attribute TEXT,
    subtypes TEXT,
    effect TEXT,
    image_url TEXT,
    market_price REAL DEFAULT 0.0
  );

  CREATE TABLE IF NOT EXISTS collection (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id TEXT NOT NULL,
    variant TEXT DEFAULT 'Regular',
    quantity INTEGER DEFAULT 1,
    condition TEXT DEFAULT 'NM',
    notes TEXT,
    FOREIGN KEY (card_id) REFERENCES cards(card_id)
  );

  CREATE TABLE IF NOT EXISTS decks (
    deck_id INTEGER PRIMARY KEY AUTOINCREMENT,
    deck_name TEXT NOT NULL,
    leader_card_id TEXT,
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS deck_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deck_id INTEGER NOT NULL,
    card_id TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    FOREIGN KEY (deck_id) REFERENCES decks(deck_id) ON DELETE CASCADE,
    FOREIGN KEY (card_id) REFERENCES cards(card_id)
  );
`);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'L3Vault/1.0.0 (Personal One Piece TCG Collection Database)',
      'Accept': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function syncAllPricesAndCards() {
  const groupsData = await fetchJson(`https://tcgcsv.com/tcgplayer/${CATEGORY_ID}/groups`);
  const targetGroups = (groupsData.results || []).filter(
    g => !g.name.includes('(JP)') && !g.name.includes('Pre-Release')
  );

  const upsertCard = db.prepare(`
    INSERT INTO cards (
      card_id, name, set_code, set_name, rarity, color, card_type,
      cost, power, counter, attribute, subtypes, effect, image_url, market_price
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(card_id) DO UPDATE SET
      market_price = excluded.market_price,
      image_url = COALESCE(excluded.image_url, cards.image_url)
  `);

  let updatedCount = 0;
  for (const group of targetGroups) {
    try {
      await sleep(100);
      const productsData = await fetchJson(`https://tcgcsv.com/tcgplayer/${CATEGORY_ID}/${group.groupId}/products`);
      await sleep(100);
      const pricesData = await fetchJson(`https://tcgcsv.com/tcgplayer/${CATEGORY_ID}/${group.groupId}/prices`);

      const priceMap = new Map();
      for (const p of pricesData.results || []) {
        if (p.marketPrice && (!priceMap.has(p.productId) || p.subTypeName === 'Normal')) {
          priceMap.set(p.productId, p.marketPrice);
        }
      }

      const seenIdsInSet = new Set();
      db.exec('BEGIN TRANSACTION');

      for (const prod of productsData.results || []) {
        const ext = prod.extendedData || [];
        const rawNumber = getExt(ext, 'Number', 'Card Number');
        const rarity = getExt(ext, 'Rarity');
        if (!rawNumber) continue;

        let cardId = rawNumber;
        const variantMatch = prod.name.match(/\((Parallel|Alternate Art|Manga|Box Topper|SP|TR|Foil)\)/i);
        if (variantMatch) cardId = `${rawNumber} (${variantMatch[1]})`;
        if (seenIdsInSet.has(cardId)) cardId = `${rawNumber}-${prod.productId}`;
        seenIdsInSet.add(cardId);

        const color = getExt(ext, 'Color') || 'Unknown';
        const cardType = getExt(ext, 'CardType', 'Card Type') || 'Card';
        const costVal = parseInt(getExt(ext, 'Cost', 'Life'), 10);
        const powerVal = parseInt(getExt(ext, 'Power'), 10);
        const counterVal = parseInt(getExt(ext, 'Counter', 'Counter+'), 10);
        const attribute = getExt(ext, 'Attribute');
        const subtypes = getExt(ext, 'Subtypes', 'Type');
        const effect = getExt(ext, 'Description', 'Effect');
        const imageUrl = prod.imageUrl || null;
        const marketPrice = priceMap.get(prod.productId) || 0.0;
        const setCode = rawNumber.includes('-') ? rawNumber.split('-')[0] : (group.abbreviation || group.name);

        upsertCard.run(
          cardId, prod.name, setCode, group.name, rarity, color, cardType,
          Number.isNaN(costVal) ? null : costVal, Number.isNaN(powerVal) ? null : powerVal,
          Number.isNaN(counterVal) ? null : counterVal, attribute, subtypes, effect, imageUrl, marketPrice
        );
        updatedCount++;
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
    }
  }

  const now = new Date().toLocaleString();
  db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('last_sync', ?)`).run(now);
  return { updatedCount, lastSync: now };
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = urlObj.pathname;

  // 1. Serve Webpage
  if (req.method === 'GET' && pathname === '/') {
    const htmlPath = path.join(__dirname, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(fs.readFileSync(htmlPath, 'utf8'));
  }

  // 2. API: Get all cards + collection details
  if (req.method === 'GET' && pathname === '/api/cards') {
    const query = `
      SELECT 
        c.*,
        COALESCE(col.quantity, 0) AS owned_qty,
        col.condition AS condition,
        col.notes AS notes
      FROM cards c
      LEFT JOIN collection col ON c.card_id = col.card_id AND col.variant = 'Regular'
      ORDER BY c.card_id ASC
    `;
    const cards = db.prepare(query).all();
    const syncRow = db.prepare(`SELECT value FROM meta WHERE key = 'last_sync'`).get();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ cards, lastSync: syncRow ? syncRow.value : 'Initial Seed' }));
  }

  // 3. API: Update collection (Quantity, Condition, Notes)
  if (req.method === 'POST' && pathname === '/api/collection') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      const { card_id, quantity, condition, notes } = JSON.parse(body);
      const existing = db.prepare("SELECT id FROM collection WHERE card_id = ? AND variant = 'Regular'").get(card_id);

      if (existing) {
        if (quantity <= 0 && (!notes || notes.trim() === '')) {
          db.prepare('DELETE FROM collection WHERE id = ?').run(existing.id);
        } else {
          db.prepare('UPDATE collection SET quantity = ?, condition = ?, notes = ? WHERE id = ?')
            .run(quantity ?? 1, condition ?? 'NM', notes ?? '', existing.id);
        }
      } else if (quantity > 0 || (notes && notes.trim() !== '')) {
        db.prepare("INSERT INTO collection (card_id, variant, quantity, condition, notes) VALUES (?, 'Regular', ?, ?, ?)")
          .run(card_id, quantity ?? 1, condition ?? 'NM', notes ?? '');
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  // 4. API: Decks Management & Meta Suggestions
  if (req.method === 'GET' && pathname === '/api/decks') {
    const decks = db.prepare('SELECT * FROM decks ORDER BY deck_name ASC').all();
    const decksWithCards = decks.map(deck => {
      const deckCards = db.prepare(`
        - dc.*, c.name, c.color, c.card_type, c.market_price, c.image_url,
        COALESCE(col.quantity, 0) AS owned_qty
        FROM deck_cards dc
        JOIN cards c ON dc.card_id = c.card_id
        LEFT JOIN collection col ON c.card_id = col.card_id AND col.variant = 'Regular'
        WHERE dc.deck_id = ?
      `).all(deck.deck_id);
      return { ...deck, cards: deckCards };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(decksWithCards));
  }

  if (req.method === 'POST' && pathname === '/api/decks/save') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      const { deck_id, deck_name, leader_card_id, notes, cards } = JSON.parse(body);
      let targetDeckId = deck_id;

      db.exec('BEGIN TRANSACTION');
      if (targetDeckId) {
        db.prepare('UPDATE decks SET deck_name = ?, leader_card_id = ?, notes = ? WHERE deck_id = ?')
          .run(deck_name, leader_card_id, notes, targetDeckId);
        db.prepare('DELETE FROM deck_cards WHERE deck_id = ?').run(targetDeckId);
      } else {
        const info = db.prepare('INSERT INTO decks (deck_name, leader_card_id, notes) VALUES (?, ?, ?)')
          .run(deck_name, leader_card_id, notes);
        targetDeckId = info.lastInsertRowid;
      }

      const insertCard = db.prepare('INSERT INTO deck_cards (deck_id, card_id, quantity) VALUES (?, ?, ?)');
      for (const item of cards) {
        insertCard.run(targetDeckId, item.card_id, item.quantity || 1);
      }
      db.exec('COMMIT');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, deck_id: targetDeckId }));
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/decks/meta-suggest') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      const { leader_card_id } = JSON.parse(body);
      const leader = db.prepare('SELECT * FROM cards WHERE card_id = ?').get(leader_card_id);
      const leaderName = leader ? leader.name : 'Custom Meta Build';

      // Generate a structured competitive meta build using existing database cards matching color/theme
      const color = leader ? leader.color : 'Red';
      const candidateCards = db.prepare(`
        SELECT card_id FROM cards 
        WHERE color LIKE ? AND card_type = 'Character' 
        ORDER BY market_price DESC LIMIT 10
      `).all(`%${color.split('/')[0]}%`);

      const suggestedCards = candidateCards.map((c, idx) => ({
        card_id: c.card_id,
        quantity: idx < 3 ? 4 : 2
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        deck_name: `${leaderName} Meta Build`,
        leader_card_id: leader_card_id,
        notes: 'Competitive meta suggestion optimized from current database card pool.',
        cards: suggestedCards
      }));
    });
    return;
  }

  // 5. API: Sync Prices
  if (req.method === 'POST' && pathname === '/api/sync-prices') {
    try {
      const result = await syncAllPricesAndCards();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, ...result }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`L3-Vault Server running at http://localhost:${PORT}`);
});