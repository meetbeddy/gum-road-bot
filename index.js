const puppeteer = require('puppeteer');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

class Logger {
    constructor(logFile, successFile, failedFile) {
        this.logFile = logFile;
        this.successFile = successFile;
        this.failedFile = failedFile;
        this.initializeLogFiles();
    }

    initializeLogFiles() {
        const timestamp = new Date().toISOString();
        const logDir = path.dirname(this.logFile);

        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        fs.writeFileSync(this.logFile, `=== Gumroad Bulk Signup Log - ${timestamp} ===\n`);
        fs.writeFileSync(this.successFile, `=== Successful Signups - ${timestamp} ===\n`);
        fs.writeFileSync(this.failedFile, `=== Failed Signups - ${timestamp} ===\n`);
    }

    log(message) {
        const timestamp = new Date().toLocaleString();
        const logMessage = `[${timestamp}] ${message}\n`;
        console.log(message);
        fs.appendFileSync(this.logFile, logMessage);
    }

    logSuccess(email, details = '') {
        const message = `SUCCESS: ${email} ${details}`;
        this.log(message);
        fs.appendFileSync(this.successFile, `${email}\n`);
    }

    logFailure(email, error, details = '') {
        const message = `FAILED: ${email} - ${error} ${details}`;
        this.log(message);
        fs.appendFileSync(this.failedFile, `${email} - ${error}\n`);
    }
}

class EmailReader {
    static readFromFile(filePath) {
        try {
            const ext = path.extname(filePath).toLowerCase();

            if (ext === '.csv') {
                return this.readFromCSV(filePath);
            } else {
                return this.readFromExcel(filePath);
            }
        } catch (error) {
            console.error(`Error reading file ${filePath}: ${error.message}`);
            return [];
        }
    }

    static readFromExcel(filePath) {
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet);

        const emailColumns = ['email', 'Email', 'EMAIL', 'emails', 'Emails', 'EMAILS'];
        let emailColumn = emailColumns.find(col =>
            data.length > 0 && data[0].hasOwnProperty(col)
        ) || Object.keys(data[0])[0];

        const emails = data
            .map(row => row[emailColumn])
            .filter(email => email && email.includes('@'));

        console.log(`Found ${emails.length} valid emails in ${filePath}`);
        return emails;
    }

    static readFromCSV(filePath) {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());
        const emails = [];

        for (const line of lines) {
            const parts = line.split(',');
            for (const part of parts) {
                const trimmed = part.trim().replace(/['"]/g, '');
                if (trimmed.includes('@')) {
                    emails.push(trimmed);
                    break;
                }
            }
        }

        console.log(`Found ${emails.length} valid emails in CSV ${filePath}`);
        return emails;
    }
}

class RecaptchaSolver {
    constructor(logger) {
        this.logger = logger;
        this.timeout = 45000;
        this.recaptchaSelectors = [
            'iframe[src*="recaptcha"]',
            'iframe[name^="a-"][src^="https://www.google.com/recaptcha"]',
            '.g-recaptcha',
            '#recaptcha',
            '[data-sitekey]',
            '.recaptcha-checkbox-border',
            '.rc-anchor'
        ];
    }

    async solve(page) {
        try {
            this.logger.log('Checking for reCAPTCHA...');
            await this.sleep(2000);

            const recaptchaFrame = await this.findRecaptchaFrame(page);
            if (!recaptchaFrame) {
                this.logger.log('No reCAPTCHA detected');
                return true;
            }

            this.logger.log('reCAPTCHA found, attempting to solve...');

            const checkboxClicked = await this.clickCheckbox(recaptchaFrame);
            if (!checkboxClicked) {
                throw new Error('Could not click reCAPTCHA checkbox');
            }

            await this.sleep(5000);

            const isVerified = await this.checkVerification(recaptchaFrame);
            if (isVerified) {
                this.logger.log('reCAPTCHA verified automatically');
                return true;
            }

            const challengeFrame = await this.findChallengeFrame(page);
            if (challengeFrame) {
                this.logger.log('Challenge detected, attempting to solve...');
                await this.solveChallenge(challengeFrame);
            }

            return true;

        } catch (error) {
            this.logger.log(`reCAPTCHA handling failed: ${error.message}`);
            this.logger.log('Waiting for manual intervention...');
            await this.sleep(30000);
            return false;
        }
    }

    async findRecaptchaFrame(page) {
        const frames = await page.frames();
        return frames.find(frame => {
            const url = frame.url();
            return url.includes('recaptcha') &&
                (url.includes('anchor') || url.includes('checkbox'));
        });
    }

    async findChallengeFrame(page) {
        const frames = await page.frames();
        return frames.find(frame => {
            const url = frame.url();
            return url.includes('recaptcha') &&
                (url.includes('bframe') || url.includes('challenge'));
        });
    }

    async clickCheckbox(recaptchaFrame) {
        const checkboxSelectors = [
            '.recaptcha-checkbox-border',
            '.rc-anchor-checkbox',
            '#recaptcha-anchor',
            '[role="checkbox"]'
        ];

        for (const selector of checkboxSelectors) {
            try {
                await recaptchaFrame.waitForSelector(selector, {
                    timeout: 10000,
                    visible: true
                });
                await recaptchaFrame.click(selector);
                this.logger.log(`Checkbox clicked using selector: ${selector}`);
                return true;
            } catch (e) {
                continue;
            }
        }
        return false;
    }

    async checkVerification(recaptchaFrame) {
        const verificationSelectors = [
            '.recaptcha-checkbox-checked',
            '.rc-anchor-checkbox-checked',
            '[aria-checked="true"]'
        ];

        for (const selector of verificationSelectors) {
            try {
                const element = await recaptchaFrame.$(selector);
                if (element) {
                    this.logger.log('reCAPTCHA verification confirmed');
                    return true;
                }
            } catch (e) {
                continue;
            }
        }
        return false;
    }

    async solveChallenge(challengeFrame) {
        try {
            await challengeFrame.waitForSelector(
                '.rc-imageselect-instructions, .rc-audiochallenge-instructions, .rc-footer',
                { timeout: 10000 }
            );
            await this.sleep(2000);

            const audioSwitched = await this.switchToAudioChallenge(challengeFrame);
            if (audioSwitched) {
                await this.solveAudioChallenge(challengeFrame);
            }

            await this.submitChallenge(challengeFrame);
        } catch (error) {
            this.logger.log(`Challenge solving error: ${error.message}`);
        }
    }

    async switchToAudioChallenge(challengeFrame) {
        const audioButtonSelectors = [
            '#recaptcha-audio-button',
            '.rc-button-audio',
            'button[title="Get an audio challenge"]'
        ];

        for (const selector of audioButtonSelectors) {
            try {
                const audioButton = await challengeFrame.$(selector);
                if (audioButton) {
                    const isClickable = await audioButton.evaluate(el => {
                        const style = window.getComputedStyle(el);
                        return style.display !== 'none' &&
                            style.visibility !== 'hidden' &&
                            !el.disabled;
                    });

                    if (isClickable) {
                        await challengeFrame.click(selector);
                        this.logger.log('Switched to audio challenge');
                        await this.sleep(3000);
                        return true;
                    }
                }
            } catch (e) {
                continue;
            }
        }
        return false;
    }

    async solveAudioChallenge(challengeFrame) {
        this.logger.log('Attempting to solve audio challenge...');
        await this.sleep(15000); // Wait for potential Buster extension
    }

    async submitChallenge(challengeFrame) {
        const verifySelectors = [
            '#recaptcha-verify-button',
            '.rc-button-default',
            'button[title="Verify"]'
        ];

        for (const selector of verifySelectors) {
            try {
                const verifyButton = await challengeFrame.$(selector);
                if (verifyButton) {
                    await challengeFrame.click(selector);
                    this.logger.log(`Clicked verify button: ${selector}`);
                    await this.sleep(3000);
                    return true;
                }
            } catch (e) {
                continue;
            }
        }
        return false;
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

class FormHandler {
    constructor(logger, config) {
        this.logger = logger;
        this.config = config;
        this.fakeNames = ['John Smith', 'Jane Doe', 'Mike Johnson', 'Sarah Wilson', 'David Brown'];
    }

    async fillPriceField(page) {
        const priceInput = await page.$('input[inputMode="decimal"]');
        if (priceInput) {
            await priceInput.focus();
            await priceInput.click({ clickCount: 3 });
            await priceInput.type('0');
            this.logger.log('Entered price: 0');
            return true;
        }
        this.logger.log('Warning: Could not find price input field');
        return false;
    }

    async clickWantThisButton(page) {
        const buttonSelectors = [
            'a[href*="checkout"]',
            '.accent.button',
            'button:has-text("I want this!")'
        ];

        for (const selector of buttonSelectors) {
            try {
                const actualSelector = selector.replace(':has-text("I want this!")', '');
                const elements = await page.$$(actualSelector);

                for (const element of elements) {
                    const text = await page.evaluate(el => el.textContent, element);
                    const isVisible = await element.isIntersectingViewport();

                    if (isVisible && (text.includes('I want this') || selector.includes('checkout'))) {
                        await element.click();
                        this.logger.log(`Clicked "I want this!" button`);
                        return true;
                    }
                }
            } catch (e) {
                continue;
            }
        }
        return false;
    }

    async fillEmailField(page, email) {
        const emailSelectors = [
            'input[type="email"]',
            'input[name="email"]',
            'input[placeholder*="email" i]',
            'input[autocomplete="email"]'
        ];

        for (const selector of emailSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 10000, visible: true });
                const emailInput = await page.$(selector);
                await emailInput.focus();
                await emailInput.click({ clickCount: 3 });
                await emailInput.type(email);
                this.logger.log(`Entered email using selector: ${selector}`);
                return true;
            } catch (e) {
                continue;
            }
        }
        return false;
    }

    async setTipToZero(page) {
        const tipInput = await page.$('input[aria-label="Tip"]');
        if (tipInput) {
            await tipInput.focus();
            await tipInput.click({ clickCount: 3 });
            await tipInput.type('0');
            this.logger.log('Set tip to 0');
            return true;
        }
        this.logger.log('Warning: Could not find tip field');
        return false;
    }

    async fillRequiredFields(page) {
        const fakeName = this.fakeNames[Math.floor(Math.random() * this.fakeNames.length)];

        // Fill name fields
        const nameSelectors = [
            'input[name*="name" i]',
            'input[placeholder*="name" i]',
            '#name, #first_name, #last_name'
        ];

        for (const selector of nameSelectors) {
            try {
                const nameInput = await page.$(selector);
                if (nameInput) {
                    await nameInput.focus();
                    await nameInput.type(fakeName);
                    await this.sleep(500);
                }
            } catch (e) {
                continue;
            }
        }

        // Fill country if present
        try {
            const countrySelect = await page.$('select[name*="country" i], #country');
            if (countrySelect) {
                await countrySelect.select('US');
            }
        } catch (e) {
            // Continue if country field not found
        }
    }

    async submitForm(page) {
        const submitSelectors = [
            'button:has-text("Get")',
            'button:has-text("Complete")',
            'button:has-text("Purchase")',
            'button[type="submit"]',
            'input[type="submit"]'
        ];

        for (const selector of submitSelectors) {
            try {
                const actualSelector = selector.replace(/:has-text\("[^"]*"\)/, '');

                if (actualSelector === 'button') {
                    const buttons = await page.$$('button');
                    for (const button of buttons) {
                        const text = await page.evaluate(el => el.textContent, button);
                        const isVisible = await button.isIntersectingViewport();
                        const isEnabled = await page.evaluate(el => !el.disabled, button);

                        if (isVisible && isEnabled && this.isSubmitButtonText(text)) {
                            await button.click();
                            this.logger.log(`Submitted form using button: ${text.trim()}`);
                            return true;
                        }
                    }
                } else {
                    const element = await page.$(actualSelector);
                    if (element) {
                        const isEnabled = await page.evaluate(el => !el.disabled, element);
                        if (isEnabled) {
                            await element.click();
                            this.logger.log(`Submitted form using selector: ${actualSelector}`);
                            return true;
                        }
                    }
                }
            } catch (e) {
                continue;
            }
        }
        return false;
    }

    isSubmitButtonText(text) {
        const submitKeywords = ['get', 'complete', 'purchase', 'checkout', 'submit'];
        return submitKeywords.some(keyword =>
            text.toLowerCase().includes(keyword)
        );
    }

    async checkForSuccess(page) {
        const currentUrl = page.url();
        const pageContent = await page.evaluate(() =>
            document.body.innerText.toLowerCase()
        );

        const successIndicators = [
            'success', 'complete', 'thank', 'confirmation',
            'download', 'purchased', 'receipt', 'order'
        ];

        const errorIndicators = [
            'error', 'failed', 'invalid', 'try again', 'problem'
        ];

        const hasError = errorIndicators.some(indicator =>
            currentUrl.includes(indicator) || pageContent.includes(indicator)
        );

        if (hasError) {
            this.logger.log('Error detected in page content or URL');
            return false;
        }

        const isSuccess = successIndicators.some(indicator =>
            currentUrl.includes(indicator) || pageContent.includes(indicator)
        );

        return isSuccess;
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

class GumroadBulkSignup {
    constructor(options = {}) {
        this.config = {
            productUrl: 'https://brightlaunch.gumroad.com/l/livetraining',
            actionDelay: options.delay || 3000,
            headless: options.headless !== undefined ? options.headless : false,
            timeout: options.timeout || 45000,
            busterExtensionPath: options.busterExtensionPath || './buster-extension'
        };

        this.logger = new Logger(
            options.logFile || 'logs/signup_log.txt',
            options.successFile || 'logs/successful_signups.txt',
            options.failedFile || 'logs/failed_signups.txt'
        );

        this.recaptchaSolver = new RecaptchaSolver(this.logger);
        this.formHandler = new FormHandler(this.logger, this.config);
    }

    async createBrowser() {
        const browserArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--disable-blink-features=AutomationControlled',
            '--no-first-run',
            '--disable-default-apps'
        ];

        if (fs.existsSync(this.config.busterExtensionPath)) {
            const extensionPath = path.resolve(this.config.busterExtensionPath);
            browserArgs.push(`--disable-extensions-except=${extensionPath}`);
            browserArgs.push(`--load-extension=${extensionPath}`);
            this.logger.log('Buster extension loaded from: ' + extensionPath);
        } else {
            this.logger.log('Warning: Buster extension not found at ' + this.config.busterExtensionPath);
        }

        return await puppeteer.launch({
            headless: this.config.headless,
            args: browserArgs,
            defaultViewport: { width: 1366, height: 768 }
        });
    }

    async signupSingleEmail(page, email) {
        try {
            this.logger.log(`Starting signup for: ${email}`);

            // Navigate to product page
            await page.goto(this.config.productUrl, {
                waitUntil: 'networkidle2',
                timeout: this.config.timeout
            });
            await this.sleep(this.config.actionDelay);

            // Fill form steps
            await this.formHandler.fillPriceField(page);
            await this.sleep(1000);

            if (!await this.formHandler.clickWantThisButton(page)) {
                throw new Error('Could not find "I want this!" button');
            }

            // Wait for checkout page
            this.logger.log('Waiting for checkout page to load...');
            await this.sleep(5000);

            if (!await this.formHandler.fillEmailField(page, email)) {
                throw new Error('Could not find email input field');
            }

            await this.sleep(9000);
            await this.formHandler.setTipToZero(page);
            await this.formHandler.fillRequiredFields(page);

            // Submit form
            await this.sleep(2000);
            if (!await this.formHandler.submitForm(page)) {
                throw new Error('Could not submit form');
            }

            // Handle reCAPTCHA after submission
            this.logger.log('Checking for post-submission reCAPTCHA...');
            await this.recaptchaSolver.solve(page);

            // Check for success
            await this.sleep(8000);
            const success = await this.formHandler.checkForSuccess(page);

            if (success) {
                this.logger.logSuccess(email, '- Signup completed successfully');
                return true;
            } else {
                throw new Error('No success confirmation found');
            }

        } catch (error) {
            await page.screenshot({
                path: `logs/debug_${Date.now()}_error.png`
            });
            this.logger.logFailure(email, error.message);
            return false;
        }
    }

    async bulkSignup(emailSourcePath, options = {}) {
        const batchSize = options.batchSize || 2;
        const batchDelay = options.batchDelay || 20000;

        const emails = EmailReader.readFromFile(emailSourcePath);

        if (emails.length === 0) {
            this.logger.log('No emails found to process');
            return;
        }

        this.logger.log(`Starting bulk signup for ${emails.length} emails`);

        const browser = await this.createBrowser();

        try {
            let successCount = 0;
            let failureCount = 0;

            for (let i = 0; i < emails.length; i += batchSize) {
                const batch = emails.slice(i, i + batchSize);
                this.logger.log(`Processing batch ${Math.floor(i / batchSize) + 1}: ${batch.length} emails`);

                const promises = batch.map(async (email) => {
                    const page = await browser.newPage();
                    await this.configurePage(page);

                    try {
                        const result = await this.signupSingleEmail(page, email);
                        if (result) successCount++;
                        else failureCount++;
                        return { email, success: result };
                    } finally {
                        await page.close();
                    }
                });

                await Promise.allSettled(promises);

                this.logger.log(`Batch completed. Running totals: ${successCount} successful, ${failureCount} failed`);

                if (i + batchSize < emails.length) {
                    this.logger.log(`Waiting ${batchDelay / 1000} seconds before next batch...`);
                    await this.sleep(batchDelay);
                }
            }

            this.logger.log(`Final results: ${successCount} successful signups, ${failureCount} failures out of ${emails.length} total emails`);

        } finally {
            await browser.close();
        }
    }

    async configurePage(page) {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1366, height: 768 });

        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
            });
        });
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log(`
Usage: node gumroad-bulk-signup.js <email-file> [options]

Arguments:
  email-file    Path to Excel (.xlsx) or CSV file containing emails

Options:
  --headless              Run in headless mode (default: false)
  --delay <ms>           Delay between actions in ms (default: 3000)
  --batch-size <num>     Number of simultaneous signups (default: 2)
  --batch-delay <ms>     Delay between batches in ms (default: 20000)
  --buster-path <path>   Path to Buster extension (default: ./buster-extension)

Examples:
  node gumroad-bulk-signup.js emails.xlsx
  node gumroad-bulk-signup.js emails.csv --headless --batch-size 1
        `);
        return;
    }

    const emailFile = args[0];

    const getArgValue = (argName) => {
        const index = args.indexOf(argName);
        return index !== -1 && args[index + 1] ? args[index + 1] : null;
    };

    const options = {
        headless: args.includes('--headless'),
        delay: parseInt(getArgValue('--delay')) || 3000,
        busterExtensionPath: getArgValue('--buster-path') || './buster-extension'
    };

    const bulkOptions = {
        batchSize: parseInt(getArgValue('--batch-size')) || 2,
        batchDelay: parseInt(getArgValue('--batch-delay')) || 20000
    };

    if (!fs.existsSync(emailFile)) {
        console.error(`Error: File ${emailFile} not found`);
        return;
    }

    const signup = new GumroadBulkSignup(options);
    await signup.bulkSignup(emailFile, bulkOptions);
}

module.exports = GumroadBulkSignup;

if (require.main === module) {
    main().catch(console.error);
}