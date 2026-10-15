const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 10000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'l3_vault.db');

let db;
let isSyncing = false;

// Verified Tournament Decklists (Limitless TCG / Championship Finals)
const TOURNAMENT_DECKS = [
  {
    id: 'tourney_rg_luffy_op13',
    name: '🏆 Red/Green Luffy (Championship Top 4 - OP13-001)',
    leader_card_id: 'OP13-001',
    notes: 'Tournament Meta Build (Limitless TCG Championship Finals). Uses cheapest regular prints.',
    cards: [
      { card_id: 'OP01-016', quantity: 4 },
      { card_id: 'OP13-016', quantity: 4 },
      { card_id: 'ST01-007', quantity: 2 },
      { card_id: 'ST01-006', quantity: 1 },
      { card_id: 'OP14-034', quantity: 4 },
      { card_id: 'OP10-032', quantity: 2 },
      { card_id: 'OP14-022', quantity: 4 },
      { card_id: 'OP14-031', quantity: 4 },
      { card_id: 'OP13-037', quantity: 2 },
      { card_id: 'OP10-011', quantity: 1 },
      { card_id: 'OP13-027', quantity: 4 },
      { card_id: 'OP13-118', quantity: 4 },
      { card_id: 'OP06-118', quantity: 1 },
      { card_id: 'OP01-030', quantity: 4 },
      { card_id: 'OP12-037', quantity: 1 },
      { card_id: 'OP05-038', quantity: 4 },
      { card_id: 'OP01-027', quantity: 4 }
    ]
  },
  {
    id: 'tourney_rb_ace_op13',
    name: '🏆 Red/Blue Ace (1st Place Championship Finals - OP13-002)',
    leader_card_id: 'OP13-002',
    notes: '1st Place Championship Finals Whitebeard Pirates Engine. Uses cheapest regular prints.',
    cards: [
      { card_id: 'ST22-002', quantity: 4 },
      { card_id: 'OP13-016', quantity: 4 },
      { card_id: 'OP13-043', quantity: 4 },
      { card_id: 'OP13-007', quantity: 2 },
      { card_id: 'PRB02-008', quantity: 4 },
      { card_id: 'OP02-008', quantity: 2 },
      { card_id: 'OP06-047', quantity: 2 },
      { card_id: 'OP10-045', quantity: 2 },
      { card_id: 'OP08-040', quantity: 1 },
      { card_id: 'OP13-054', quantity: 4 },
      { card_id: 'OP08-047', quantity: 4 },
      { card_id: 'ST23-001', quantity: 2 },
      { card_id: 'OP02-004', quantity: 1 },
      { card_id: 'OP13-042', quantity: 4 },
      { card_id: 'OP09-118', quantity: 1 },
      { card_id: 'OP01-027', quantity: 2 },
      { card_id: 'OP04-056', quantity: 3 },
      { card_id: 'ST22-015', quantity: 4 }
    ]
  },
  {
    id: 'tourney_purple_doffy_op14',
    name: '🏆 Purple Doflamingo (2nd Place Championship Finals - OP14-060)',
    leader_card_id: 'OP14-060',
    notes: '2nd Place Donquixote Pirates Tournament Build. Uses cheapest regular prints.',
    cards: [
      { card_id: 'OP10-065', quantity: 4 },
      { card_id: 'OP14-067', quantity: 4 },
      { card_id: 'ST18-001', quantity: 3 },
      { card_id: 'OP10-062', quantity: 1 },
      { card_id: 'OP14-063', quantity: 4 },
      { card_id: 'OP14-072', quantity: 3 },
      { card_id: 'OP14-061', quantity: 4 },
      { card_id: 'OP14-074', quantity: 4 },
      { card_id: 'OP10-072', quantity: 2 },
      { card_id: 'OP12-076', quantity: 2 },
      { card_id: 'OP14-068', quantity: 2 },
      { card_id: 'OP14-071', quantity: 1 },
      { card_id: 'OP10-071', quantity: 4 },
      { card_id: 'OP14-069', quantity: 3 },
      { card_id: 'OP13-076', quantity: 4 },
      { card_id: 'OP07-076', quantity: 4 },
      { card_id: 'OP14-078', quantity: 1 }
    ]
  },
  {
    id: 'tourney_py_rosinante_op12',
    name: '🏆 Purple/Yellow Rosinante (Top 4 Championship Finals - OP12-061)',
    leader_card_id: 'OP12-061',
    notes: 'Top 4 Law & Rosinante Supernovas / Donquixote Build. Uses cheapest regular prints.',
    cards: [
      { card_id: 'OP09-069', quantity: 4 },
      { card_id: 'OP10-065', quantity: 4 },
      { card_id: 'OP12-108', quantity: 4 },
      { card_id: 'ST18-001', quantity: 3 },
      { card_id: 'OP05-069', quantity: 2 },
      { card_id: 'ST10-010', quantity: 4 },
      { card_id: 'P-088', quantity: 4 },
      { card_id: 'P-093', quantity: 4 },
      { card_id: 'OP12-112', quantity: 2 },
      { card_id: 'ST10-008', quantity: 1 },
      { card_id: 'EB04-038', quantity: 4 },
      { card_id: 'OP12-073', quantity: 4 },
      { card_id: 'OP13-076', quantity: 1 },
      { card_id: 'OP12-115', quantity: 4 },
      { card_id: 'OP14-078', quantity: 3 },
      { card_id: 'OP05-077', quantity: 2 }
    ]
  }
];

function initDatabase() {
  console.log('Initializing SQLite database at:', DB_PATH);
  db = new DatabaseSync(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

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

    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      UNIQUE(owner, name)
    );

    CREATE TABLE IF NOT EXISTS collection_copies (
      copy_id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      card_id TEXT NOT NULL,
      condition TEXT DEFAULT 'NM',
      location TEXT DEFAULT 'Unassigned',
      notes TEXT DEFAULT '',
      FOREIGN KEY (card_id) REFERENCES cards(card_id)
    );

    CREATE TABLE IF NOT EXISTS decks (
      deck_id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT DEFAULT 'Larry''s Collection',
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

  try {
    db.exec(`ALTER TABLE decks ADD COLUMN owner TEXT DEFAULT 'Larry''s Collection'`);
  } catch (e) {}

  // Clean out old preset default locations if they are unused so users only see their own custom locations
  try {
    const cleanedPresets = db.prepare(`SELECT value FROM meta WHERE key='cleaned_preset_locations_v3'`).get();
    if (!cleanedPresets) {
      const oldDefaults = ['Red Folder', 'Blue Folder', 'Trade Binder', 'Robin Deck', 'Deck Box', 'Top Loader'];
      const delLoc = db.prepare(`
        DELETE FROM locations
        WHERE name = ?
          AND NOT EXISTS (
            SELECT 1 FROM collection_copies
            WHERE collection_copies.owner = locations.owner
              AND collection_copies.location = locations.name
          )
      `);
      for (const preset of oldDefaults) {
        delLoc.run(preset);
      }
      db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('cleaned_preset_locations_v3', 'true')`).run();
    }
  } catch (e) {
    console.error('Preset location cleanup note:', e.message);
  }

  // Ensure 'Unassigned' always exists as the base fallback for each collection
  const defaultOwners = ["Larry's Collection", "Graham's Collection"];
  const insertLoc = db.prepare(`INSERT OR IGNORE INTO locations (owner, name) VALUES (?, 'Unassigned')`);
  for (const owner of defaultOwners) {
    insertLoc.run(owner);
  }

  console.log('Database tables verified.');
}

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

// Helper: Extract base card ID (e.g., "OP13-083 (Parallel)" -> "OP13-083")
function getBaseCardId(cardId) {
  const match = String(cardId || '').match(/^([A-Z]{1,4}\d{0,2}-\d{3})/i);
  return match ? match[1].toUpperCase() : String(cardId || '').split(' ')[0].trim();
}

// Helper: Resolve any card ID to its cheapest regular print in the DB
function resolveCheapestPrintId(rawCardId) {
  const baseId = getBaseCardId(rawCardId);
  const candidates = db.prepare(`
    SELECT card_id, name, market_price
    FROM cards
    WHERE card_id = ? OR card_id LIKE ?
    ORDER BY
      CASE WHEN card_id = ? THEN 0 ELSE 1 END ASC,
      CASE WHEN market_price > 0 THEN market_price ELSE 999999 END ASC
  `).all(baseId, `${baseId}%`, baseId);

  if (!candidates || candidates.length === 0) return baseId;

  // Prefer regular print (not Parallel / Manga / Alternate Art / SP / Box Topper) with lowest price
  const regularCandidates = candidates.filter(
    c => !/\((Parallel|Alternate Art|Manga|Box Topper|SP|TR|Foil)\)/i.test(c.card_id) &&
         !/\((Parallel|Alternate Art|Manga|Box Topper|SP|TR)\)/i.test(c.name || '')
  );

  if (regularCandidates.length > 0) {
    regularCandidates.sort((a, b) => (a.market_price || 9999) - (b.market_price || 9999));
    return regularCandidates[0].card_id;
  }
  return candidates[0].card_id;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'L3Vault/3.0.0 (One Piece TCG Collection Database)',
      'Accept': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function syncAllPricesAndCards() {
  if (isSyncing) return { updatedCount: 0, lastSync: 'Sync already in progress...' };
  isSyncing = true;
  console.log('Starting TCGplayer / TCGcsv catalog & price sync...');

  try {
    const groupsData = await fetchJson(`https://tcgcsv.com/tcgplayer/68/groups`);
    const targetGroups = (groupsData.results || []).filter(
      g => !g.name.includes('(JP)') && !g.name.includes('Pre-Release')
    );

    const upsertCard = db.prepare(`
      INSERT INTO cards (
        card_id, name, set_code, set_name, rarity, color, card_type,
        cost, power, counter, attribute, subtypes, effect, image_url, market_price
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(card_id) DO UPDATE SET
        name = excluded.name,
        set_code = excluded.set_code,
        set_name = excluded.set_name,
        rarity = COALESCE(excluded.rarity, cards.rarity),
        color = COALESCE(excluded.color, cards.color),
        card_type = COALESCE(excluded.card_type, cards.card_type),
        cost = COALESCE(excluded.cost, cards.cost),
        power = COALESCE(excluded.power, cards.power),
        counter = COALESCE(excluded.counter, cards.counter),
        attribute = COALESCE(excluded.attribute, cards.attribute),
        subtypes = COALESCE(excluded.subtypes, cards.subtypes),
        effect = COALESCE(excluded.effect, cards.effect),
        market_price = excluded.market_price,
        image_url = COALESCE(excluded.image_url, cards.image_url)
    `);

    let updatedCount = 0;
    for (const group of targetGroups) {
      try {
        await sleep(75);
        const productsData = await fetchJson(`https://tcgcsv.com/tcgplayer/68/${group.groupId}/products`);
        await sleep(75);
        const pricesData = await fetchJson(`https://tcgcsv.com/tcgplayer/68/${group.groupId}/prices`);

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

          let cardId = rawNumber.trim().toUpperCase();
          const variantMatch = prod.name.match(/\((Parallel|Alternate Art|Manga|Box Topper|SP|TR|Foil)\)/i);
          if (variantMatch) cardId = `${cardId} (${variantMatch[1]})`;
          if (seenIdsInSet.has(cardId)) cardId = `${rawNumber.trim().toUpperCase()}-${prod.productId}`;
          seenIdsInSet.add(cardId);

          const baseId = getBaseCardId(cardId);
          const setCode = baseId.includes('-') ? baseId.split('-')[0] : (group.abbreviation || group.name);
          const color = getExt(ext, 'Color') || 'Unknown';
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

          upsertCard.run(
            cardId, prod.name, setCode, group.name, rarity, color, cardType,
            Number.isNaN(costVal) ? null : costVal,
            Number.isNaN(powerVal) ? null : powerVal,
            Number.isNaN(counterVal) ? null : counterVal,
            attribute, subtypes, effect, imageUrl, marketPrice
          );
          updatedCount++;
        }
        db.exec('COMMIT');
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch (e) {}
      }
    }

    const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('last_sync', ?)`).run(now);
    return { updatedCount, lastSync: now };
  } finally {
    isSyncing = false;
  }
}

function readJsonBody(req) {
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

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  try {
    if (req.method === 'GET' && pathname === '/') {
      const htmlPath = path.join(__dirname, 'index.html');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(htmlPath, 'utf8'));
    }

    // Get All Cards + Owner Collection + Custom Locations + Tournament Templates
    if (req.method === 'GET' && pathname === '/api/cards') {
      const owner = urlObj.searchParams.get('owner') || "Larry's Collection";

      const cards = db.prepare(`SELECT * FROM cards ORDER BY card_id ASC`).all();
      const copies = db.prepare(`
        SELECT copy_id, card_id, condition, location, notes
        FROM collection_copies
        WHERE owner = ?
        ORDER BY copy_id ASC
      `).all(owner);

      const copiesByCard = new Map();
      for (const c of copies) {
        if (!copiesByCard.has(c.card_id)) copiesByCard.set(c.card_id, []);
        copiesByCard.get(c.card_id).push(c);
      }

      const enrichedCards = cards.map(card => {
        const cardCopies = copiesByCard.get(card.card_id) || [];
        return {
          ...card,
          owned_qty: cardCopies.length,
          copies: cardCopies
        };
      });

      const rawLocations = db.prepare(`SELECT name FROM locations WHERE owner = ? ORDER BY CASE WHEN name = 'Unassigned' THEN 0 ELSE 1 END, name ASC`).all(owner).map(r => r.name);
      const syncRow = db.prepare(`SELECT value FROM meta WHERE key = 'last_sync'`).get();

      return sendJson(res, 200, {
        cards: enrichedCards,
        locations: rawLocations.length ? rawLocations : ['Unassigned'],
        tournamentDecks: TOURNAMENT_DECKS,
        lastSync: syncRow ? syncRow.value : (isSyncing ? 'Syncing catalog in background...' : 'Ready'),
        isSyncing
      });
    }

    // Quick + / - Adjust Copy Count
    if (req.method === 'POST' && pathname === '/api/collection/adjust') {
      const { owner = "Larry's Collection", card_id, delta = 1, location = 'Unassigned', condition = 'NM' } = await readJsonBody(req);

      if (delta > 0) {
        const insert = db.prepare(`
          INSERT INTO collection_copies (owner, card_id, condition, location, notes)
          VALUES (?, ?, ?, ?, '')
        `);
        for (let i = 0; i < delta; i++) {
          insert.run(owner, card_id, condition, location);
        }
      } else if (delta < 0) {
        const toRemove = Math.abs(delta);
        const existing = db.prepare(`
          SELECT copy_id FROM collection_copies
          WHERE owner = ? AND card_id = ?
          ORDER BY CASE WHEN location = 'Unassigned' THEN 0 ELSE 1 END, copy_id DESC
          LIMIT ?
        `).all(owner, card_id, toRemove);

        const del = db.prepare(`DELETE FROM collection_copies WHERE copy_id = ?`);
        for (const row of existing) {
          del.run(row.copy_id);
        }
      }

      const updatedCopies = db.prepare(`
        SELECT copy_id, card_id, condition, location, notes
        FROM collection_copies
        WHERE owner = ? AND card_id = ?
        ORDER BY copy_id ASC
      `).all(owner, card_id);

      return sendJson(res, 200, {
        success: true,
        card_id,
        owned_qty: updatedCopies.length,
        copies: updatedCopies
      });
    }

    // Update a Specific Copy's Location, Condition, or Notes
    if (req.method === 'PUT' && pathname === '/api/collection/copy') {
      const { copy_id, location, condition, notes } = await readJsonBody(req);
      db.prepare(`
        UPDATE collection_copies
        SET location = ?, condition = ?, notes = ?
        WHERE copy_id = ?
      `).run(location || 'Unassigned', condition || 'NM', notes || '', copy_id);

      const copyRow = db.prepare(`SELECT owner, card_id FROM collection_copies WHERE copy_id = ?`).get(copy_id);
      let updatedCopies = [];
      if (copyRow) {
        updatedCopies = db.prepare(`
          SELECT copy_id, card_id, condition, location, notes
          FROM collection_copies
          WHERE owner = ? AND card_id = ?
          ORDER BY copy_id ASC
        `).all(copyRow.owner, copyRow.card_id);
      }

      return sendJson(res, 200, { success: true, copies: updatedCopies });
    }

    // Delete a Specific Copy
    if (req.method === 'DELETE' && pathname === '/api/collection/copy') {
      const { copy_id } = await readJsonBody(req);
      const copyRow = db.prepare(`SELECT owner, card_id FROM collection_copies WHERE copy_id = ?`).get(copy_id);
      db.prepare(`DELETE FROM collection_copies WHERE copy_id = ?`).run(copy_id);

      let updatedCopies = [];
      if (copyRow) {
        updatedCopies = db.prepare(`
          SELECT copy_id, card_id, condition, location, notes
          FROM collection_copies
          WHERE owner = ? AND card_id = ?
          ORDER BY copy_id ASC
        `).all(copyRow.owner, copyRow.card_id);
      }

      return sendJson(res, 200, {
        success: true,
        card_id: copyRow ? copyRow.card_id : null,
        owned_qty: updatedCopies.length,
        copies: updatedCopies
      });
    }

    // Add a New User-Created Location
    if (req.method === 'POST' && pathname === '/api/locations') {
      const { owner = "Larry's Collection", name } = await readJsonBody(req);
      const cleanName = (name || '').trim();
      if (!cleanName) return sendJson(res, 400, { error: 'Location name required' });

      db.prepare(`INSERT OR IGNORE INTO locations (owner, name) VALUES (?, ?)`).run(owner, cleanName);
      const locations = db.prepare(`SELECT name FROM locations WHERE owner = ? ORDER BY CASE WHEN name = 'Unassigned' THEN 0 ELSE 1 END, name ASC`).all(owner).map(r => r.name);
      return sendJson(res, 200, { success: true, locations });
    }

    // Delete a User-Created Location
    if (req.method === 'DELETE' && pathname === '/api/locations') {
      const { owner = "Larry's Collection", name } = await readJsonBody(req);
      if (name && name !== 'Unassigned') {
        db.prepare(`DELETE FROM locations WHERE owner = ? AND name = ?`).run(owner, name);
        db.prepare(`UPDATE collection_copies SET location = 'Unassigned' WHERE owner = ? AND location = ?`).run(owner, name);
      }
      const locations = db.prepare(`SELECT name FROM locations WHERE owner = ? ORDER BY CASE WHEN name = 'Unassigned' THEN 0 ELSE 1 END, name ASC`).all(owner).map(r => r.name);
      return sendJson(res, 200, { success: true, locations });
    }

    // Get Saved Decks for Active Owner
    if (req.method === 'GET' && pathname === '/api/decks') {
      const owner = urlObj.searchParams.get('owner') || "Larry's Collection";
      const decks = db.prepare(`SELECT * FROM decks WHERE owner = ? ORDER BY deck_name ASC`).all(owner);

      const decksWithCards = decks.map(deck => {
        const deckCards = db.prepare(`
          SELECT dc.*, c.name, c.set_code, c.rarity, c.color, c.card_type, c.cost, c.power, c.counter, c.market_price, c.image_url
          FROM deck_cards dc
          LEFT JOIN cards c ON dc.card_id = c.card_id
          WHERE dc.deck_id = ?
          ORDER BY c.card_type DESC, c.cost ASC, dc.card_id ASC
        `).all(deck.deck_id);

        return { ...deck, cards: deckCards };
      });

      return sendJson(res, 200, decksWithCards);
    }

    // Save or Update a Deck
    if (req.method === 'POST' && pathname === '/api/decks/save') {
      const { deck_id, owner = "Larry's Collection", deck_name, leader_card_id, notes, cards = [] } = await readJsonBody(req);
      if (!deck_name || !deck_name.trim()) {
        return sendJson(res, 400, { success: false, error: 'Deck name is required' });
      }

      let targetDeckId = deck_id;
      db.exec('BEGIN TRANSACTION');
      try {
        if (targetDeckId) {
          db.prepare(`UPDATE decks SET deck_name = ?, leader_card_id = ?, notes = ?, owner = ? WHERE deck_id = ?`)
            .run(deck_name.trim(), leader_card_id || '', notes || '', owner, targetDeckId);
          db.prepare(`DELETE FROM deck_cards WHERE deck_id = ?`).run(targetDeckId);
        } else {
          const info = db.prepare(`INSERT INTO decks (owner, deck_name, leader_card_id, notes) VALUES (?, ?, ?, ?)`)
            .run(owner, deck_name.trim(), leader_card_id || '', notes || '');
          targetDeckId = Number(info.lastInsertRowid);
        }

        const insertCard = db.prepare(`INSERT INTO deck_cards (deck_id, card_id, quantity) VALUES (?, ?, ?)`);
        for (const item of cards) {
          if (item.card_id && item.quantity > 0) {
            const cheapestId = resolveCheapestPrintId(item.card_id);
            insertCard.run(targetDeckId, cheapestId, Math.min(4, Math.max(1, Number(item.quantity))));
          }
        }
        db.exec('COMMIT');
        return sendJson(res, 200, { success: true, deck_id: targetDeckId });
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch (e) {}
        return sendJson(res, 500, { success: false, error: err.message });
      }
    }

    // Delete a Deck
    if (req.method === 'DELETE' && pathname === '/api/decks') {
      const { deck_id } = await readJsonBody(req);
      db.prepare(`DELETE FROM deck_cards WHERE deck_id = ?`).run(deck_id);
      db.prepare(`DELETE FROM decks WHERE deck_id = ?`).run(deck_id);
      return sendJson(res, 200, { success: true });
    }

    // Smart Meta / Tournament Suggestion (Always Picks Cheapest Regular Print)
    if (req.method === 'POST' && pathname === '/api/decks/meta-suggest') {
      const { leader_card_id, tournament_id } = await readJsonBody(req);

      // 1. If a specific Tournament Deck was requested, load & resolve each card to its cheapest regular print
      if (tournament_id) {
        const tDeck = TOURNAMENT_DECKS.find(t => t.id === tournament_id);
        if (tDeck) {
          const resolvedCards = tDeck.cards.map(item => ({
            card_id: resolveCheapestPrintId(item.card_id),
            quantity: item.quantity
          }));
          return sendJson(res, 200, {
            deck_name: tDeck.name,
            leader_card_id: resolveCheapestPrintId(tDeck.leader_card_id),
            notes: tDeck.notes,
            cards: resolvedCards
          });
        }
      }

      // 2. If the chosen Leader matches one of our verified Tournament Decks, use that tournament list!
      const baseLeaderId = getBaseCardId(leader_card_id);
      const matchingTourney = TOURNAMENT_DECKS.find(t => getBaseCardId(t.leader_card_id) === baseLeaderId);
      if (matchingTourney) {
        const resolvedCards = matchingTourney.cards.map(item => ({
          card_id: resolveCheapestPrintId(item.card_id),
          quantity: item.quantity
        }));
        return sendJson(res, 200, {
          deck_name: matchingTourney.name,
          leader_card_id: resolveCheapestPrintId(matchingTourney.leader_card_id),
          notes: matchingTourney.notes,
          cards: resolvedCards
        });
      }

      // 3. Otherwise, build a 50-card tournament curve using ONLY the CHEAPEST REGULAR PRINTS for that Leader's colors & traits
      const leader = db.prepare(`SELECT * FROM cards WHERE card_id = ? OR card_id LIKE ? LIMIT 1`).get(leader_card_id, `${baseLeaderId}%`);
      const leaderName = leader ? leader.name : 'Custom Leader';
      const rawColors = leader && leader.color ? leader.color.split('/').map(s => s.trim()) : ['Red'];
      const primarySubtype = leader && leader.subtypes ? leader.subtypes.split('/')[0].trim() : '';

      // Pull all non-leader cards, filter out expensive alternate/manga variants, and keep only the cheapest print per base Card ID
      const rawPool = db.prepare(`
        SELECT * FROM cards
        WHERE card_type IN ('Character', 'Event', 'Stage')
        ORDER BY CASE WHEN market_price > 0 THEN market_price ELSE 999999 END ASC
      `).all();

      const cheapestByBaseId = new Map();
      for (const c of rawPool) {
        if (!c.color) continue;
        // Skip Manga / Alt Art / Parallel / SP variants
        if (/\((Parallel|Alternate Art|Manga|Box Topper|SP|TR|Foil)\)/i.test(c.card_id) ||
            /\((Parallel|Alternate Art|Manga|Box Topper|SP|TR)\)/i.test(c.name || '')) {
          continue;
        }
        const cardColors = c.color.split('/').map(s => s.trim());
        if (!cardColors.some(cc => rawColors.includes(cc))) continue;

        const bId = getBaseCardId(c.card_id);
        if (!cheapestByBaseId.has(bId)) {
          cheapestByBaseId.set(bId, c);
        } else {
          const current = cheapestByBaseId.get(bId);
          const pNew = c.market_price > 0 ? c.market_price : 9999;
          const pCur = current.market_price > 0 ? current.market_price : 9999;
          if (pNew < pCur) cheapestByBaseId.set(bId, c);
        }
      }

      const allPool = Array.from(cheapestByBaseId.values());
      const picked = [];
      let totalCards = 0;

      const addGroup = (filterFn, targetCopies, qtyPerCard = 4) => {
        let added = 0;
        for (const card of allPool) {
          if (totalCards >= 50 || added >= targetCopies) break;
          if (picked.some(p => p.card_id === card.card_id)) continue;
          if (filterFn(card)) {
            const qty = Math.min(qtyPerCard, 50 - totalCards, targetCopies - added);
            if (qty > 0) {
              picked.push({ card_id: card.card_id, quantity: qty });
              totalCards += qty;
              added += qty;
            }
          }
        }
      };

      // Build competitive 50-card curve (Cheapest Regular Prints First)
      addGroup(c => c.counter === 2000 && (primarySubtype ? (c.subtypes || '').includes(primarySubtype) : true), 8, 4);
      addGroup(c => c.counter === 2000, 4, 4);
      addGroup(c => c.card_type === 'Character' && c.cost >= 1 && c.cost <= 3 && (primarySubtype ? (c.subtypes || '').includes(primarySubtype) : true), 12, 4);
      addGroup(c => c.card_type === 'Character' && c.cost >= 4 && c.cost <= 5, 12, 4);
      addGroup(c => c.card_type === 'Character' && c.cost >= 6, 8, 4);
      addGroup(c => c.card_type === 'Event' || c.card_type === 'Stage', 6, 3);
      addGroup(() => true, 50 - totalCards, 4);

      return sendJson(res, 200, {
        deck_name: `${leaderName} (${rawColors.join('/')}) Budget Tournament Curve`,
        leader_card_id: leader ? leader.card_id : leader_card_id,
        notes: `Built with cheapest regular prints for ${leaderName}: +2000 Counters, ${primarySubtype || rawColors[0]} synergy engine, mid-range blockers, and finishers.`,
        cards: picked
      });
    }

    // Full Vault Backup
    if (req.method === 'GET' && pathname === '/api/backup') {
      const locations = db.prepare(`SELECT * FROM locations`).all();
      const copies = db.prepare(`SELECT * FROM collection_copies`).all();
      const decks = db.prepare(`SELECT * FROM decks`).all();
      const deckCards = db.prepare(`SELECT * FROM deck_cards`).all();

      return sendJson(res, 200, {
        version: 3,
        exportedAt: new Date().toISOString(),
        locations,
        copies,
        decks,
        deckCards
      });
    }

    // Restore Vault Backup
    if (req.method === 'POST' && pathname === '/api/restore') {
      const data = await readJsonBody(req);
      db.exec('BEGIN TRANSACTION');
      try {
        if (Array.isArray(data.locations)) {
          db.exec(`DELETE FROM locations`);
          const insLoc = db.prepare(`INSERT OR IGNORE INTO locations (owner, name) VALUES (?, ?)`);
          for (const l of data.locations) insLoc.run(l.owner, l.name);
        }
        if (Array.isArray(data.copies)) {
          db.exec(`DELETE FROM collection_copies`);
          const insCopy = db.prepare(`
            INSERT INTO collection_copies (owner, card_id, condition, location, notes)
            VALUES (?, ?, ?, ?, ?)
          `);
          for (const c of data.copies) {
            insCopy.run(c.owner || "Larry's Collection", c.card_id, c.condition || 'NM', c.location || 'Unassigned', c.notes || '');
          }
        }
        if (Array.isArray(data.decks)) {
          db.exec(`DELETE FROM deck_cards`);
          db.exec(`DELETE FROM decks`);
          const insDeck = db.prepare(`INSERT INTO decks (deck_id, owner, deck_name, leader_card_id, notes) VALUES (?, ?, ?, ?, ?)`);
          for (const d of data.decks) {
            insDeck.run(d.deck_id, d.owner || "Larry's Collection", d.deck_name, d.leader_card_id || '', d.notes || '');
          }
        }
        if (Array.isArray(data.deckCards)) {
          const insDc = db.prepare(`INSERT INTO deck_cards (deck_id, card_id, quantity) VALUES (?, ?, ?)`);
          for (const dc of data.deckCards) {
            insDc.run(dc.deck_id, dc.card_id, dc.quantity || 1);
          }
        }
        db.exec('COMMIT');
        return sendJson(res, 200, { success: true });
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch (e) {}
        return sendJson(res, 500, { success: false, error: err.message });
      }
    }

    // Sync Prices & New Card Releases
    if (req.method === 'POST' && pathname === '/api/sync-prices') {
      const result = await syncAllPricesAndCards();
      return sendJson(res, 200, { success: true, ...result });
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  } catch (err) {
    console.error('Server error:', err);
    sendJson(res, 500, { error: err.message });
  }
});

initDatabase();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`L3-Vault Server running at http://0.0.0.0:${PORT}`);

  try {
    const countRow = db.prepare(`SELECT COUNT(*) AS cnt FROM cards`).get();
    if (!countRow || countRow.cnt === 0) {
      console.log('Card catalog is empty on startup. Triggering automatic initial sync...');
      syncAllPricesAndCards().catch(e => console.error('Initial auto-sync error:', e));
    }
    setInterval(() => {
      syncAllPricesAndCards().catch(e => console.error('Scheduled 24h sync error:', e));
    }, 24 * 60 * 60 * 1000);
  } catch (e) {
    console.error('Auto-sync check error:', e);
  }
});