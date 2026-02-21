require('dotenv').config();
const { runDueClientCarePulses } = require('../src/services/clientCarePulseService');

async function main() {
    console.log('Starting Client Care Pulse Automation...');
    try {
        await runDueClientCarePulses();
        console.log('Automation finished successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Automation failed:', error);
        process.exit(1);
    }
}

main();
