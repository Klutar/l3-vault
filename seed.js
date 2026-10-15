const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync('l3_vault.db');
const CATEGORY_ID = 68; // One Piece Card Game

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

async function seedDatabase() {
  console.log('Fetching all One Piece TCG sets from TCGCSV...');
  const groupsData = await fetchJson(`https://tcgcsv.com/tcgplayer/${CATEGORY_ID}/groups`);
  const allGroups = groupsData.results || [];

  // Pull all English sets (excluding Japanese sets)
  const targetGroups = allGroups.filter(
    g => !g.name.includes('(JP)') && !g.name.includes('Pre-Release')
  );

  const insertCard = db.prepare(`
    INSERT OR REPLACE INTO cards (
      card_id, name, set_code, set_name, rarity, color, card_type,
      cost, power, counter, attribute, subtypes, effect, image_url, market_price
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let totalImported = 0;

  for (const group of targetGroups) {
    console.log(`Downloading set: ${group.name}...`);
    try {
      await sleep(150);
      const productsData = await fetchJson(`https://tcgcsv.com/tcgplayer/${CATEGORY_ID}/${group.groupId}/products`);
      await sleep(150);
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
        const variantMatch = prod.name.match(/\((Parallel\vert{}Alternate Art\vert{}Manga\vert{}Box Topper\vert{}SP\vert{}TR\vert{}Foil)\)/i);
        if (variantMatch) {
          cardId = `${rawNumber} (${variantMatch[1]})`;
        }
        if (seenIdsInSet.has(cardId)) {
          cardId = `${rawNumber}-${prod.productId}`;
        }
        seenIdsInSet.add(cardId);

        const color = getExt(ext, 'Color') || 'Unknown';
        const cardType = getExt(ext, 'CardType', 'Card Type') || 'Card';
        const costVal = parseInt(getExt(ext, 'Cost', 'Life'), 10);
        const powerVal = parseInt(getExt(ext, 'Power'), 10);
        const counterVal = parseInt(getExt(ext, 'Counter', 'Counter+'), 10);
        const attribute = getExt(ext, 'Attribute');
        const subtypes = getExt(ext, 'Subtypes', 'Type');
        const effect = getExt(ext, 'Description', 'Effect');

        // Keep original TCGplayer CDN URL so images always load
        const imageUrl = prod.imageUrl || null;

        const marketPrice = priceMap.get(prod.productId) || 0.0;
        const setCode = rawNumber.includes('-') ? rawNumber.split('-')[0] : (group.abbreviation || group.name);

        insertCard.run(
          cardId,
          prod.name,
          setCode,
          group.name,
          rarity,
          color,
          cardType,
          Number.isNaN(costVal) ? null : costVal,
          Number.isNaN(powerVal) ? null : powerVal,
          Number.isNaN(counterVal) ? null : counterVal,
          attribute,
          subtypes,
          effect,
          imageUrl,
          marketPrice
        );

        totalImported++;
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      console.error(`Skipped ${group.name}:`, err.message);
    }
  }

  console.log(`\nDone! Imported ${totalImported} One Piece cards into l3_vault.db.`);
}

seedDatabase();