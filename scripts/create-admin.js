require('dotenv').config();

const { createAdmin } = require('../src/services/adminService');
const { ping } = require('../src/db');

async function main() {
  const username = process.argv[2] || process.env.ADMIN_USERNAME;
  const password = process.argv[3] || process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    console.log('Usage: node scripts/create-admin.js <username> <password>');
    console.log('   or: ADMIN_USERNAME=... ADMIN_PASSWORD=... node scripts/create-admin.js');
    process.exit(1);
  }

  await ping();
  const admin = await createAdmin(username, password);
  console.log('Admin created:', admin);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
