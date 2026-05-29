/**
 * Renumber the scenario bank after PPs were deleted from Firestore.
 *
 * Usage: node renumber-bank.js <deletedSerial> [<deletedSerial>...]
 *
 * Removes bank entries with those serials, then renumbers remaining entries
 * to match the new (post-deletion) Firestore index ordering.
 */
const fs = require('fs');
const path = require('path');

const BANK = path.join(__dirname, '..', 'tests', '.pp-scenario-bank.json');
const deletedSerials = process.argv.slice(2).map(n => parseInt(n, 10)).filter(Boolean);
if (deletedSerials.length === 0) { console.error('Need at least one deleted serial'); process.exit(2); }
const deletedSet = new Set(deletedSerials);

const bank = JSON.parse(fs.readFileSync(BANK, 'utf8'));
fs.writeFileSync(BANK + '.pre-renumber-' + Date.now() + '.bak', JSON.stringify(bank, null, 2));

// Remove deleted serials, preserve remaining sorted by current serial
const remaining = bank.scenarios
  .filter(s => !deletedSet.has(s.serial))
  .sort((a, b) => a.serial - b.serial);

// Renumber: each entry's new serial = its 1-based position after sort
remaining.forEach((s, idx) => {
  const newSerial = idx + 1;
  if (s.serial !== newSerial) {
    console.log(`  PP ${s.serial} → ${newSerial}: ${(s.name || '').slice(0, 70)}`);
  }
  s.serial = newSerial;
});

bank.scenarios = remaining;
bank.ppCount = remaining.length;
fs.writeFileSync(BANK, JSON.stringify(bank, null, 2));
console.log(`\nBank now has ${remaining.length} PPs.`);
