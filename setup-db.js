const { DatabaseSync } = require('node:sqlite');

// Create (or open) the local database file on your hard drive
const db = new DatabaseSync('l3_vault.db');

// 1. Master Cards Table (Every official One Piece card)
db.exec(`
  CREATE TABLE IF NOT EXISTS cards (
    card_id TEXT PRIMARY KEY,      -- e.g., 'OP01-001'
    name TEXT NOT NULL,            -- e.g., 'Roronoa Zoro'
    set_code TEXT,                 -- e.g., 'OP-01'
    set_name TEXT,                 -- e.g., 'Romance Dawn'
    rarity TEXT,                   -- e.g., 'L', 'SR', 'SEC', 'AA'
    color TEXT,                    -- e.g., 'Red', 'Red/Green'
    card_type TEXT,                -- 'Leader', 'Character', 'Event', 'Stage'
    cost INTEGER,                  -- Cost or Life value
    power INTEGER,                 -- e.g., 5000
    counter INTEGER,               -- e.g., 1000, 2000, or NULL
    attribute TEXT,                -- e.g., 'Slash', 'Strike', 'Special'
    subtypes TEXT,                 -- e.g., 'Straw Hat Crew / Supernovas'
    effect TEXT,                   -- Card ability text
    image_url TEXT,                -- Link to card image
    market_price REAL DEFAULT 0.0  -- Optional price tracking
  );
`);

// 2. Your Personal Collection Table (What you actually own)
db.exec(`
  CREATE TABLE IF NOT EXISTS collection (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id TEXT NOT NULL,
    variant TEXT DEFAULT 'Regular', -- 'Regular', 'Alt Art', 'Parallel', 'Manga'
    quantity INTEGER DEFAULT 1,
    condition TEXT DEFAULT 'NM',    -- 'NM', 'LP', 'Graded'
    notes TEXT,                     -- Binder location, deck, etc.
    FOREIGN KEY (card_id) REFERENCES cards(card_id)
  );
`);

// 3. Custom Decks Table
db.exec(`
  CREATE TABLE IF NOT EXISTS decks (
    deck_id INTEGER PRIMARY KEY AUTOINCREMENT,
    deck_name TEXT NOT NULL,
    leader_card_id TEXT,
    notes TEXT,
    FOREIGN KEY (leader_card_id) REFERENCES cards(card_id)
  );
`);

// 4. Insert a sample card so you can see it working right away
const insertCard = db.prepare(`
  INSERT OR REPLACE INTO cards (
    card_id, name, set_code, set_name, rarity, color, card_type, cost, power, counter, attribute, subtypes, effect
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

insertCard.run(
  'OP01-001',
  'Roronoa Zoro',
  'OP-01',
  'Romance Dawn',
  'L',
  'Red',
  'Leader',
  5,
  5000,
  null,
  'Slash',
  'Supernovas/Straw Hat Crew',
  '[DON!! x1] [Your Turn] All of your Characters gain +1000 power.'
);

console.log('Success! l3_vault.db created with tables and sample card OP01-001.');