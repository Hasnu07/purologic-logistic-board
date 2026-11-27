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

  const acc = (...missing) => ['Original box', 'Warranty card', 'Extra links', 'Hang tag', 'Travel pouch', 'Booklets'].map((label) => ({ label, ok: !missing.includes(label) }));
  // [client, watch, reference, serial, date, value, from, to, collectedHoursAgo, cost, paid, courier, awb, steps...]
  const ship = (client, watch, reference, serial, watch_date, value, origin, destination, collected, cost, paid, steps, extra = {}) => {
    const id = D.createShipment({
      client_id: client.id, watch, reference, serial, watch_date, value, origin, destination,
      insurance: 'Covered to ' + Math.ceil(value / 5000) * 5000, accessories: acc(...(extra.missing || [])),
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
    [['Packed', 196, 'Dubai office · safe room'], ['Handed to courier', 190, 'Dubai office'], ['In transit', 170, 'Dubai DXB → Barcelona BCN'], ['Out for delivery', 122, 'Andorra la Vella'], ['Delivered', 118, 'Av. Meritxell 44', '', 'R. Costa']], { awb: '7788 1234 5501' });
  ship(alvarez, 'Rolex Daytona 126500LN', '126500LN', '9D1K5R33', '2024', 31500, 'Dubai', 'Lisbon', 130, 180, 'Wallet',
    [['Packed', 127, 'Dubai office · safe room'], ['Handed to courier', 122, 'Dubai office'], ['In transit', 110, 'Dubai DXB → Lisbon LIS'], ['Out for delivery', 78, 'Lisbon'], ['Delivered', 74, 'Rua Augusta 120', '', 'M. Alvarez']], { awb: '7788 1234 5522' });
  ship(khan, 'Omega Speedmaster 310.30.42', '310.30.42.50.01.001', '77204518', '2021', 6900, 'Dubai', 'London', 82, null, '',
    [['Packed', 78, 'Dubai office · safe room']], { missing: ['Hang tag', 'Travel pouch'] });
  ship(weber, 'AP Royal Oak 15510ST', '15510ST.OO.1320ST.06', 'LM4471Q', '2023', 48000, 'Geneva', 'Dubai', 76, 210, 'Card',
    [['Packed', 72, 'Geneva office'], ['Handed to courier', 66, 'Geneva office'], ['In transit', 50, 'Geneva GVA → Dubai DXB'], ['Out for delivery', 3, 'Dubai Marina · courier van 2']], { courier: 'Malca-Amit', awb: 'MA 4410 2281', eta: 'Expected today, before 18:00' });
  ship(costa, 'Patek Philippe Nautilus 5711/1A', '5711/1A-010', '7302918', '2019', 112000, 'Dubai', 'Andorra', 58, 240, 'Invoice',
    [['Packed', 54, 'Dubai office · safe room'], ['Handed to courier', 50, 'Dubai office'], ['In transit', 40, 'Dubai DXB → Barcelona BCN'], ['Customs hold', 20, 'Barcelona customs', 'Customs asked for the original invoice. We have sent it and expect release within a day.']], { awb: '7788 1234 5540' });
  ship(alvarez, 'Rolex Submariner 126610LN', '126610LN', '7K2R4T81', '2023 · card dated 14 Mar 2023', 14500, 'Dubai', 'Lisbon', 58, 180, 'Wallet',
    [['Packed', 55, 'Dubai office · safe room'], ['Handed to courier', 50, 'Dubai office', 'AWB issued, insured to 15,000.'], ['In transit', 41, 'Dubai DXB → Lisbon LIS'], ['In transit', 11, 'Lisbon hub']], { missing: ['Hang tag'], awb: '7788 1234 5566', eta: 'Expected tomorrow, before 13:00' });
  ship(moreau, 'Cartier Santos WSSA0018', 'WSSA0018', '5510XA7Q', '2022', 7400, 'Hong Kong', 'Dubai', 30, null, '', []);
  ship(alvarez, 'Cartier Tank Must WSTA0041', 'WSTA0041', '88213GH', '2024', 3400, 'Dubai', 'Lisbon', 4, null, '', [], { eta: 'Packing today · courier booked for tomorrow' });

  const top = db.prepare('INSERT INTO topups(client_id, amount, note, by_name, created_at) VALUES(?,?,?,?,?)');
  top.run(alvarez.id, 800, 'Bank transfer', 'Admin (owner)', ago(300));
};
