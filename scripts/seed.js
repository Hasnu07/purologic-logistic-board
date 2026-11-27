// Demo data for trying the board out. Used only by `npm run demo`, which keeps it in ./data-demo —
// your real data in ./data is never touched.
//
// Demo sign-ins (all use DEMO_PASSWORD below):
//   admin@demo.test    admin
//   staff@demo.test    staff
//   courier@demo.test  courier
//   alvarez@demo.test  client (has active shipments, wallet and history)
//   costa@demo.test    client
const DEMO_PASSWORD = 'demo-watch-2026';

module.exports = function seed() {
  const D = require('../src/db');
  const { db } = D;
  const H = 3600 * 1000;
  const ago = (hours) => new Date(Date.now() - hours * H).toISOString();

  D.setSetting('sender_address', 'Office 1204, Example Tower\nBusiness Bay, Dubai, UAE\n+971 4 000 0000 · logistics@demo.test');
  const mk = (role, name, email, extra = {}) => D.createUser({ role, name, email, password: DEMO_PASSWORD, ...extra });
  mk('admin', 'Admin (owner)', 'admin@demo.test');
  const staff = mk('staff', 'S. Khan', 'staff@demo.test');
  mk('courier', 'R. Silva', 'courier@demo.test');
  const alvarez = mk('client', 'M. Alvarez', 'alvarez@demo.test', { city: 'Lisbon', phone: '+351 900 000 042', address: 'Rua Augusta 120, 3º Esq.\n1100-053 Lisboa\nPORTUGAL' });
  const costa = mk('client', 'R. Costa', 'costa@demo.test', { city: 'Andorra la Vella', phone: '+376 300 017', address: 'Av. Meritxell 44\nAD500 Andorra la Vella\nANDORRA' });
  const weber = mk('client', 'J. Weber', 'weber@demo.test', { city: 'Dubai', phone: '+971 50 000 0088', address: 'Marina Gate 2, Apt 1803\nDubai Marina, Dubai\nUAE' });
  const khan = mk('client', 'S. Khan (client)', 'khan@demo.test', { city: 'London', phone: '+44 7700 900007', address: '14 Example Mews\nLondon W1K 0AA\nUNITED KINGDOM' });
  const moreau = mk('client', 'L. Moreau', 'moreau@demo.test', { city: 'Dubai', address: 'DIFC Gate Village 5\nDubai\nUAE' });

  const F = require('../src/format');
  // The sample watches are written "Brand Model ..."; this picks the brand out so the
  // accessory list and the form match what staff would really see.
  const BRAND_OF = [['Rolex', 'Rolex'], ['Patek Philippe', 'Patek Philippe'], ['AP ', 'Audemars Piguet'],
    ['Audemars', 'Audemars Piguet'], ['Richard Mille', 'Richard Mille'], ['RM ', 'Richard Mille'], ['Cartier', 'Cartier']];
  const brandOf = (name) => (BRAND_OF.find(([pre]) => name.startsWith(pre)) || [null, 'Other'])[1];
  const modelOf = (name) => {
    const hit = BRAND_OF.find(([pre]) => name.startsWith(pre));
    return hit ? name.slice(hit[0].length).trim() : name;
  };
  const acc = (brand, ...missing) => F.accessoriesFor(brand).map((label) => ({ label, ok: !missing.includes(label) }));
  // [client, watch, reference, serial, date, value, from, to, collectedHoursAgo, cost, paid, courier, awb, steps...]
  const ship = (client, watch, reference, serial, watch_date, value, origin, destination, collected, cost, paid, steps, extra = {}) => {
    const id = D.createShipment({
      client_id: client.id, brand: brandOf(watch), watch: modelOf(watch), reference, serial, watch_date, value, origin, destination,
      insurance: 'Covered to ' + Math.ceil(value / 5000) * 5000, accessories: acc(brandOf(watch), ...(extra.missing || [])),
      condition: extra.condition || 'Unworn', condition_note: extra.conditionNote || '',
      collected_at: ago(collected), collected_from: 'Client · ' + origin, collected_note: 'Accessories checked with the client.',
      addr_note: 'Signature required', eta_note: extra.eta || ''
    }, 'R. Silva');
    for (const [status, hoursAgo, location, note, signed_by] of steps) {
      D.addEvent(id, { status, location, note: note || '', signed_by: signed_by || '' }, staff.name, ago(hoursAgo));
    }
    if (cost !== null) db.prepare('UPDATE shipments SET cost = ?, paid_from = ?, courier = ?, awb = ? WHERE id = ?').run(cost, paid, extra.courier || 'Ferrari Group', extra.awb || '', id);
    return id;
  };

  ship(costa, 'Rolex GMT-Master II 126710BLNR', '126710BLNR', '4M7Q2P19', '2022', 17800, 'Dubai', 'Andorra', 200, 240, 'Invoice',
    [['Packing/Creating shipment', 196, 'Dubai office · safe room'], ['In route to delivery address', 190, 'Dubai office'], ['In route to delivery address', 170, 'Dubai DXB → Barcelona BCN'], ['In route to delivery address', 122, 'Andorra la Vella'], ['Delivered', 118, 'Av. Meritxell 44', '', 'R. Costa']], { awb: '7788 1234 5501' });
  ship(alvarez, 'Rolex Daytona 126500LN', '126500LN', '9D1K5R33', '2024', 31500, 'Dubai', 'Lisbon', 130, 180, 'Wallet',
    [['Packing/Creating shipment', 127, 'Dubai office · safe room'], ['In route to delivery address', 122, 'Dubai office'], ['In route to delivery address', 110, 'Dubai DXB → Lisbon LIS'], ['In route to delivery address', 78, 'Lisbon'], ['Delivered', 74, 'Rua Augusta 120', '', 'M. Alvarez']], { awb: '7788 1234 5522' });
  ship(khan, 'Omega Speedmaster 310.30.42', '310.30.42.50.01.001', '77204518', '2021', 6900, 'Dubai', 'London', 82, null, '',
    [['Packing/Creating shipment', 78, 'Dubai office · safe room']], { missing: ['Green Tag', 'Tool'], condition: 'Worn', conditionNote: 'Light marks on the bracelet.' });
  ship(weber, 'AP Royal Oak 15510ST', '15510ST.OO.1320ST.06', 'LM4471Q', '2023', 48000, 'Geneva', 'Dubai', 76, 210, 'Card',
    [['Packing/Creating shipment', 72, 'Geneva office'], ['In route to delivery address', 66, 'Geneva office'], ['In route to delivery address', 50, 'Geneva GVA → Dubai DXB'], ['In route to delivery address', 3, 'Dubai Marina · courier van 2']], { courier: 'Malca-Amit', awb: 'MA 4410 2281', eta: 'Expected today, before 18:00' });
  ship(costa, 'Patek Philippe Nautilus 5711/1A', '5711/1A-010', '7302918', '2019', 112000, 'Dubai', 'Andorra', 58, 240, 'Invoice',
    [['Packing/Creating shipment', 54, 'Dubai office · safe room'], ['In route to delivery address', 50, 'Dubai office'], ['In route to delivery address', 40, 'Dubai DXB → Barcelona BCN'], ['In route to delivery address', 20, 'Barcelona customs', 'Customs asked for the original invoice. We have sent it and expect release within a day.']], { awb: '7788 1234 5540' });
  ship(alvarez, 'Rolex Submariner 126610LN', '126610LN', '7K2R4T81', '2023 · card dated 14 Mar 2023', 14500, 'Dubai', 'Lisbon', 58, 180, 'Wallet',
    [['Packing/Creating shipment', 55, 'Dubai office · safe room'], ['In route to delivery address', 50, 'Dubai office', 'AWB issued, insured to 15,000.'], ['In route to delivery address', 41, 'Dubai DXB → Lisbon LIS'], ['In route to delivery address', 11, 'Lisbon hub']], { missing: ['White Tag'], condition: 'Scratches', conditionNote: 'Scratch on the clasp, photographed.', awb: '7788 1234 5566', eta: 'Expected tomorrow, before 13:00' });
  ship(moreau, 'Cartier Santos WSSA0018', 'WSSA0018', '5510XA7Q', '2022', 7400, 'Hong Kong', 'Dubai', 30, null, '', []);
  ship(alvarez, 'Cartier Tank Must WSTA0041', 'WSTA0041', '88213GH', '2024', 3400, 'Dubai', 'Lisbon', 4, null, '', [], { eta: 'Packing today · courier booked for tomorrow' });

  // One collection, three watches: one shipment number, a watch number for each piece.
  const box = D.createShipment({
    client_id: weber.id, origin: 'Dubai', destination: 'Geneva', collected_at: ago(26),
    collected_from: 'Client \u00b7 Dubai Marina', collected_note: 'Three watches handed over together, checked one by one.',
    addr_note: 'Signature required', eta_note: 'Expected Friday, before 16:00',
    watches: [
      { brand: 'Rolex', watch: 'Submariner 126610LN', reference: '126610LN', serial: '2K8M4A17', watch_date: '2023', value: 14500,
        insurance: 'Insured to 15,000', accessories: acc('Rolex'), condition: 'Unworn', condition_note: 'Stickers still on the case back.' },
      { brand: 'Cartier', watch: 'Santos WSSA0018', reference: 'WSSA0018', serial: '88412093', watch_date: '2022', value: 5200,
        insurance: 'Insured to 6,000', accessories: acc('Cartier', 'Tool'), condition: 'Worn', condition_note: 'Worn, no marks.' },
      { brand: 'Audemars Piguet', watch: 'Royal Oak 15510ST', reference: '15510ST.OO.1320ST.06', serial: 'TB7741X', watch_date: '2021',
        value: 3300, insurance: 'Insured to 4,000', accessories: acc('Audemars Piguet', 'Booklet Box'), condition: 'Scratches',
        condition_note: 'Hairlines on the bezel.' }
    ]
  }, 'R. Silva');
  D.addEvent(box, { status: 'Inspecting', location: 'Dubai office \u00b7 inspection bench', note: 'Checking the three watches in.' }, staff.name, ago(24));
  D.addEvent(box, { status: 'Packing/Creating shipment', location: 'Dubai office \u00b7 safe room', note: 'All three packed in one case.' }, staff.name, ago(22));
  D.addEvent(box, { status: 'In route to delivery address', location: 'Dubai office' }, staff.name, ago(18));
  db.prepare('UPDATE shipments SET cost = ?, paid_from = ?, courier = ?, awb = ? WHERE id = ?')
    .run(420, 'Card', 'Malca-Amit', 'MA 4410 9930', box);

  const top = db.prepare('INSERT INTO topups(client_id, amount, note, by_name, created_at) VALUES(?,?,?,?,?)');
  top.run(alvarez.id, 800, 'Bank transfer', 'Admin (owner)', ago(300));
};
