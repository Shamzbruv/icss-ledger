const bcrypt = require('bcryptjs');

const password = process.argv[2];

if (!password) {
    console.error('Usage: node tools/hash.js "YourPassword"');
    process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
console.log('Password:', password);
console.log('Hash:', hash);
console.log('\nAdd this to your .env file:');
console.log(`ADMIN_PASS_HASH=${hash}`);
