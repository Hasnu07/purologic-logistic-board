# PuroLogic · Logistic Board

Watch shipment portal. Admins run the board; clients sign in and follow their own watches.

## Run it

```
npm install
npm start          # http://localhost:3000 — your real board
npm run demo       # http://localhost:3100 — sample data, kept separately in ./data-demo
```

The first time you open the real board it asks you to create the owner admin account.
Demo sign-ins are listed at the top of `scripts/seed.js`.

Needs Node.js 22.13 or newer. No separate database to install.

## How it works

| Role    | Can do |
|---------|--------|
| Admin   | Everything: shipments, costs, users, wallet top-ups, settings |
| Staff   | Create and edit shipments, post tracking updates, add photos and documents, print |
| Courier | View the board and post tracking updates |
| Client  | See only their own watches: tracking, watch info, costs, wallet, documents |

- **Adding a client:** Users → Add a user. The client gets a unique number (`CL-0001`) and a temporary
  password, shown to you once. They must choose their own password at first sign-in.
- **New shipment:** issues a unique watch number (`WT-00001`) and shipment number (`SH-0001`). Numbers are never reused.
- **Tracking:** each update posted in the Update portal is visible to the client immediately, with the time spent at every stage.
- **Costs:** entered manually by an admin. Costs marked "Paid from: Wallet" are deducted from the client's wallet.
- **Collection requests:** a client can ask for a collection from My shipments; it appears on the admin overview, where you turn it into a shipment.
- **Update portal:** a phone-sized page for couriers and staff to find a watch by number and post its next status.
- **Reports:** time at each stage, by courier, and shipments per day. The shipments list exports to CSV.
- **Print:** one A4 page per shipment — address label on top, watch sheet below.
- **Multi login:** an account can be signed in on several devices; admins can end any session in Users.

## Your data

Everything lives in the `data` folder: `purologic.db` (the database) and `uploads` (photos and documents).
**Back up that folder regularly** — copy it somewhere safe while the app is stopped.

## Live site

Hosted on Fly.io as app `purologic-board` (Frankfurt): https://purologic-board.fly.dev
The code lives in a private GitHub repository. Every change pushed to the `main` branch is published to the live site
automatically (see `.github/workflows/deploy.yml`); data on the server is kept. To publish by hand: `fly deploy --ha=false`.
Settings are in `fly.toml`. It must stay on a single machine, because the database is one file on the `data` volume.

## Putting it online elsewhere

Clients can only reach the board once it runs on a server with a public address.
Run it behind HTTPS (a reverse proxy such as Caddy or nginx, or a host that provides HTTPS) and set:

- `PORT` — port to listen on
- `DATA_DIR` — where to keep the database and uploads (must be on a persistent disk)
- `TRUST_PROXY=1` — when behind an HTTPS proxy, so sign-in cookies are marked secure
