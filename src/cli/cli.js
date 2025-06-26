
const fs = require('fs');
const path = require('path');
const GumroadBulkSignup = require('../core/gumRoadBulkSignup');

/**
 * Parse command line arguments
 * @returns {Object} Parsed options
 */
function parseArgs() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        showHelp();
        process.exit(0);
    }

    const emailFile = args[0];
    let resolvedPath = path.resolve(process.cwd(), emailFile);
    if (!fs.existsSync(resolvedPath)) {
        const fallback = path.resolve(process.cwd(), 'email-lists', emailFile);
        if (fs.existsSync(fallback)) {
            resolvedPath = fallback;
        } else {
            console.error(`❌ Error: File "${emailFile}" not found in current or "email/" directory.`);
            process.exit(1);
        }
    }
    return {
        emailFile: resolvedPath,
        options: {
            headless: !args.includes('--no-headless'),
            productUrl: getArgValue('--product-url') || 'https://gumroad.com/l/your-product',
            delay: parseInt(getArgValue('--delay')) || 3000,
            captchaSolver: getArgValue('--captcha-solver') || 'buster',
            busterExtensionPath: getArgValue('--buster-path') || './buster-extension',
            nocaptchaExtensionPath: getArgValue('--nocaptcha-path') || './nocaptcha-extension',
            nocaptchaApiKey: getArgValue('--nocaptcha-api-key')
        },
        bulkOptions: {
            batchSize: parseInt(getArgValue('--batch-size')) || 2,
            batchDelay: parseInt(getArgValue('--batch-delay')) || 5000
        }
    };

    function getArgValue(argName) {
        const index = args.indexOf(argName);
        return index !== -1 && args[index + 1] ? args[index + 1] : null;
    }

    function showHelp() {
        console.log(`
Usage: node gumroad-bulk-signup.js <email-file> [options]

Arguments:
  email-file              Name of the email file (e.g., emails.xlsx). 
                          File will be searched in current directory or 'email/' folder.

Options:
  --headless             Run in headless mode (default: true)
  --product-url <url>  URL of the Gumroad product page (default: https://gumroad.com/l/your-product)
  --delay <ms>           Delay between actions in ms (default: 3000)
  --batch-size <num>     Number of simultaneous signups (default: 2)
  --batch-delay <ms>     Delay between batches in ms (default: 20000)
  --captcha-solver <type> CAPTCHA solver: 'buster' or 'nocaptcha' (default: buster)
  --buster-path <path>   Path to Buster extension (default: ./buster-extension)
  --nocaptcha-path <path> Path to NoCaptcha AI extension (default: ./nocaptcha-extension)
  --nocaptcha-api-key <key> API key for NoCaptcha AI solver

Examples:
  node src/cli/cli.js emails.xlsx
  node src/cli/cli.js emails.csv --captcha-solver nocaptcha
  node src/cli/cli.js emails.xlsx --captcha-solver buster --batch-size 1
  node src/cli/cli.js emails.xlsx --nocaptcha-path ./my-nocaptcha-extension --nocaptcha-api-key keyvalue123riiejd
  node src/cli/cli.js emails.xlsx --no-headless --captcha-solver buster --product-url https://dwellsoft.gumroad.com/l/USPOTraining 
        `);
    }
}

async function main() {
    try {
        const { emailFile, options, bulkOptions } = parseArgs();
        const signup = new GumroadBulkSignup(options);
        await signup.bulkSignup(emailFile, bulkOptions);
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { parseArgs };