# PuroLogic Logistic Board

Watch shipment portal: admins run the board, clients follow their own watches. See README.md for roles and features.

## Stack

- Node.js 22.13+ with Express 5, EJS templates, and the built-in `node:sqlite` database. No build step, no ORM.
- `server.js` wires the app. `src/db.js` holds the schema and shared queries, `src/routes/` the pages, `src/format.js` the helpers every view can call.
- `views/partials/top.ejs`, `mid.ejs`, `bottom.ejs` are the page frame: left content, then the right-hand aside.
- All styling is in `public/app.css` (design tokens at the top). Fonts are self-hosted in `public/fonts`.

## Run and check

- `npm run demo` starts on http://localhost:3100 with sample data in `./data-demo`. Demo sign-ins are at the top of `scripts/seed.js`.
- `npm start` runs against real local data in `./data` on port 3000.
- There is no test suite. After a change, load the affected pages as each role (admin, staff, courier, client).

## Rules that matter

- A client must only ever see their own shipments, photos and documents. Every client route filters by `req.user.id`; `src/routes/files.js` checks ownership.
- Unique numbers (client, watch, shipment) come from `nextNumber()` in `src/db.js` and are never reused or edited.
- Only admins set costs and manage users. Couriers can only view and post tracking updates.
- Schema changes must be additive (`CREATE TABLE IF NOT EXISTS`, new columns with defaults): the live database is upgraded in place on start.

## Live site

- Hosted on Fly.io as `purologic-board`: https://purologic-board.fly.dev. Pushing to `main` publishes it automatically through GitHub Actions, so work on a branch and merge only what is ready.
- It must stay on one machine: the database is a single file on the `data` volume. Never delete or recreate that volume.
- `data/`, `data-demo/` and `test-accounts.txt` are never committed.
