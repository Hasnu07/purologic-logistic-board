// `npm run demo`: runs the board on port 3100 with sample data kept apart from your real data.
const path = require('path');
process.env.DATA_DIR = path.join(__dirname, '..', 'data-demo');
process.env.PORT = process.env.PORT || '3100';
const D = require('../src/db');
if (!D.userCount()) require('./seed')();
require('../server');
