const puppeteer = require('puppeteer');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

class GumroadBulkSignup {
    constructor(options = {}) {
        this.config = this.initializeConfig(options);
        this.initializeLogging();
        this.validateCaptchaSolver();
    }

    // Configuration Management
    initializeConfig(options) {
        const defaults = {
            productUrl: 'https://brightlaunch.gumroad.com/l/livetraining',
            actionDelay: 3000,
            headless: true,
            timeout: 45000,
            captchaSolver: 'buster',
            busterExtensionPath: './buster-extension',
            nocaptchaExtensionPath: './nocaptcha-extension',
            nocaptchaApiKey: null,
            nocaptchaSettings: {
                autoSolve: true,
                maxWaitTime: 120000,
                retryAttempts: 3,
            },
            logFile: 'logs/signup_log.txt',
            successFile: 'logs/successful_signups.txt',
            failedFile: 'logs/failed_signups.txt'
        };

        return {
            ...defaults,
            ...options,
            nocaptchaSettings: {
                ...defaults.nocaptchaSettings,
                ...(options.nocaptchaSettings || {})
            }
        };
    }

    // Logging System
    initializeLogging() {
        const createLogFile = (filePath, header) => {
            const logDir = path.dirname(filePath);
            if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
            fs.writeFileSync(filePath, header);
        };

        const timestamp = new Date().toISOString();
        const header = `=== Gumroad Bulk Signup - ${timestamp} ===\n`;

        createLogFile(this.config.logFile, header);
        createLogFile(this.config.successFile, header);
        createLogFile(this.config.failedFile, header);
    }

    log(message) {
        const timestamp = new Date().toLocaleString();
        const logMessage = `[${timestamp}] ${message}`;
        console.log(logMessage);
        fs.appendFileSync(this.config.logFile, `${logMessage}\n`);
    }

    logSuccess(email, details = '') {
        const message = `SUCCESS: ${email} ${details}`;
        this.log(message);
        fs.appendFileSync(this.config.successFile, `${email}\n`);
    }

    logFailure(email, error, details = '') {
        const message = `FAILED: ${email} - ${error} ${details}`;
        this.log(message);
        fs.appendFileSync(this.config.failedFile, `${email} - ${error}\n`);
    }

    // CAPTCHA Solver Configuration
    validateCaptchaSolver() {
        const { captchaSolver, nocaptchaApiKey } = this.config;
        const validSolvers = ['buster', 'nocaptcha', 'manual'];

        if (!validSolvers.includes(captchaSolver)) {
            this.log(`Warning: Invalid CAPTCHA solver '${captchaSolver}'. Defaulting to 'buster'`);
            this.config.captchaSolver = 'buster';
        }

        if (captchaSolver === 'nocaptcha' && !nocaptchaApiKey) {
            this.log('Warning: NoCaptcha AI requires an API key. Falling back to manual CAPTCHA solving.');
            this.config.captchaSolver = 'manual';
        }

        if (captchaSolver !== 'manual') {
            this.validateCaptchaExtension();
        }
    }

    validateCaptchaExtension() {
        const { captchaSolver, busterExtensionPath, nocaptchaExtensionPath } = this.config;
        const extensionPath = captchaSolver === 'buster' ? busterExtensionPath : nocaptchaExtensionPath;

        if (!fs.existsSync(extensionPath)) {
            this.log(`Warning: ${captchaSolver} extension not found at ${extensionPath}. Falling back to manual.`);
            this.config.captchaSolver = 'manual';
        } else {
            this.log(`Using ${captchaSolver} CAPTCHA solver from: ${extensionPath}`);
        }
    }

    // NoCaptcha Extension Management
    async configureNoCaptchaExtension() {
        if (this.config.captchaSolver !== 'nocaptcha') return;

        const configPath = path.join(this.config.nocaptchaExtensionPath, 'defaultConfig.json');
        try {
            this.log('Configuring NoCaptcha AI extension...');

            if (!fs.existsSync(configPath)) {
                this.log(`Warning: NoCaptcha config file not found at ${configPath}`);
                return;
            }

            const config = this.updateNoCaptchaConfig(configPath);
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            this.log('NoCaptcha AI extension configured successfully');
        } catch (error) {
            this.log(`Error configuring NoCaptcha extension: ${error.message}`);
            throw error;
        }
    }

    updateNoCaptchaConfig(configPath) {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configContent);

        // Backup original config
        const backupPath = configPath + '.backup';
        if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, configContent);

        // Update config
        return {
            ...config,
            APIKEY: this.config.nocaptchaApiKey,
            enabled: true,
            extensionEnabled: "true",
            options: {
                ...(config.options || {}),
                ReCaptcha: {
                    active: true,
                    autoSolve: true,
                    alwaysSolve: true,
                    support: true,
                    ...(config.options?.ReCaptcha || {})
                }
            }
        };
    }

    // Email Processing
    readEmailsFromFile(filePath) {
        try {
            return filePath.endsWith('.csv')
                ? this.readEmailsFromCSV(filePath)
                : this.readEmailsFromExcel(filePath);
        } catch (error) {
            this.log(`Error reading file ${filePath}: ${error.message}`);
            return [];
        }
    }

    readEmailsFromExcel(filePath) {
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet);

        const emailColumn = this.findEmailColumn(data);
        const emails = data
            .map(row => row[emailColumn])
            .filter(email => email?.includes('@'));

        this.log(`Found ${emails.length} valid emails in ${filePath}`);
        return emails;
    }

    readEmailsFromCSV(filePath) {
        const content = fs.readFileSync(filePath, 'utf8');
        const emails = content
            .split('\n')
            .filter(line => line.trim())
            .flatMap(line =>
                line.split(',')
                    .map(part => part.trim().replace(/['"]/g, ''))
                    .find(part => part.includes('@')) || []
            )
            .filter(Boolean);

        this.log(`Found ${emails.length} valid emails in CSV ${filePath}`);
        return emails;
    }

    findEmailColumn(data) {
        if (!data.length) return null;

        const emailColumns = ['email', 'Email', 'EMAIL', 'emails', 'Emails', 'EMAILS'];
        const foundColumn = emailColumns.find(col => data[0].hasOwnProperty(col));

        if (!foundColumn) {
            const firstColumn = Object.keys(data[0])[0];
            this.log(`Warning: No standard email column found. Using: ${firstColumn}`);
            return firstColumn;
        }

        return foundColumn;
    }

    // Browser Management
    async createBrowser() {
        await this.configureNoCaptchaExtension();

        const browser = await puppeteer.launch({
            headless: this.config.headless,
            args: this.getBrowserArgs(),
            defaultViewport: { width: 1366, height: 768 }
        });

        return browser;
    }

    getBrowserArgs() {
        const baseArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--disable-blink-features=AutomationControlled',
            '--no-first-run',
            '--disable-default-apps',
            '--disable-extensions-file-access-check',
            '--enable-extension-activity-logging',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--allow-running-insecure-content'
        ];

        if (this.config.captchaSolver !== 'manual') {
            const extensionPath = path.resolve(
                this.config.captchaSolver === 'buster'
                    ? this.config.busterExtensionPath
                    : this.config.nocaptchaExtensionPath
            );

            if (fs.existsSync(extensionPath)) {
                baseArgs.push(
                    `--disable-extensions-except=${extensionPath}`,
                    `--load-extension=${extensionPath}`
                );
            }
        }

        return baseArgs;
    }

    async setupPage(page) {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1366, height: 768 });

        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
            });
        });
    }

    // CAPTCHA Handling
    async handleRecaptcha(page) {
        try {
            this.log('Checking for reCAPTCHA...');
            await this.sleep(2000);

            const recaptchaFound = await this.detectRecaptcha(page);
            if (!recaptchaFound) {
                this.log('No reCAPTCHA detected');
                return true;
            }

            return await this.solveRecaptcha(page);
        } catch (error) {
            this.log(`reCAPTCHA handling failed: ${error.message}`);
            if (this.config.captchaSolver === 'manual') {
                this.log('Manual CAPTCHA solving required. Waiting 60 seconds...');
                await this.sleep(60000);
                return true;
            }
            return false;
        }
    }

    async detectRecaptcha(page) {
        const recaptchaSelectors = [
            'iframe[src*="recaptcha"]',
            'iframe[name^="a-"][src^="https://www.google.com/recaptcha"]',
            '.g-recaptcha',
            '.rc-anchor'
        ];

        for (const selector of recaptchaSelectors) {
            const element = await page.$(selector);
            if (element && await this.isElementVisible(element)) {
                this.log(`reCAPTCHA detected with selector: ${selector}`);
                return true;
            }
        }
        return false;
    }

    async isElementVisible(element) {
        return element.evaluate(el => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                el.offsetHeight > 0;
        });
    }

    async solveRecaptcha(page) {
        this.log(`reCAPTCHA found, attempting to solve with ${this.config.captchaSolver}...`);
        await this.sleep(3000);

        const frames = await page.frames();
        const recaptchaFrame = frames.find(frame =>
            frame.url().includes('recaptcha') &&
            (frame.url().includes('anchor') || frame.url().includes('checkbox'))
        );

        if (!recaptchaFrame) throw new Error('Could not find reCAPTCHA frame');

        await this.clickRecaptchaCheckbox(recaptchaFrame);
        await this.sleep(5000);

        if (await this.isRecaptchaVerified(recaptchaFrame)) {
            this.log('reCAPTCHA verified automatically');
            return true;
        }

        return this.handleRecaptchaChallenge(page, recaptchaFrame);
    }

    async handleRecaptchaChallenge(page, recaptchaFrame) {
        const challengeFrame = (await page.frames()).find(frame =>
            frame.url().includes('recaptcha') &&
            (frame.url().includes('bframe') || frame.url().includes('challenge'))
        );

        if (!challengeFrame) return true;

        this.log(`Challenge detected, attempting to solve with ${this.config.captchaSolver}...`);

        const solverMap = {
            buster: () => this.solveCaptchaWithBuster(challengeFrame),
            nocaptcha: () => this.solveCaptchaWithNoCaptcha(challengeFrame, page),
            manual: async () => {
                this.log('Manual solving required. Please solve the CAPTCHA manually.');
                await this.sleep(60000);
                return true;
            }
        };

        const solved = await solverMap[this.config.captchaSolver]();
        if (solved) {
            await this.sleep(3000);
            return await this.isRecaptchaVerified(recaptchaFrame);
        }

        return false;
    }

    async clickRecaptchaCheckbox(frame) {
        const checkboxSelectors = [
            '.recaptcha-checkbox-border',
            '.rc-anchor-checkbox',
            '#recaptcha-anchor',
            '[role="checkbox"]'
        ];

        for (const selector of checkboxSelectors) {
            try {
                await frame.waitForSelector(selector, { timeout: 10000, visible: true });
                await frame.click(selector);
                this.log(`Checkbox clicked using selector: ${selector}`);
                return true;
            } catch {
                continue;
            }
        }
        return false;
    }

    async isRecaptchaVerified(frame) {
        const verificationSelectors = [
            '.recaptcha-checkbox-checked',
            '.rc-anchor-checkbox-checked',
            '[aria-checked="true"]'
        ];

        for (const selector of verificationSelectors) {
            if (await frame.$(selector)) {
                this.log('reCAPTCHA verification confirmed');
                return true;
            }
        }
        return false;
    }

    // CAPTCHA Solvers
    async solveCaptchaWithBuster(challengeFrame) {
        try {
            await challengeFrame.waitForSelector('.rc-footer', { timeout: 15000 });
            const solverButton = await this.waitForBusterButton(challengeFrame);

            if (solverButton) {
                await solverButton.click();
                this.log('Clicked Buster button');
                await this.sleep(25000);
                return await this.verifyChallengeSolution(challengeFrame);
            }

            return false;
        } catch (error) {
            this.log(`Buster solving error: ${error.message}`);
            return false;
        }
    }

    async waitForBusterButton(challengeFrame, maxAttempts = 10) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            await this.sleep(5000);
            const solverButton = await challengeFrame.$('#solver-button');

            if (solverButton && await this.isElementVisible(solverButton)) {
                this.log(`Solver button found after ${attempt} attempts`);
                return solverButton;
            }

            this.log(`Attempt ${attempt}/${maxAttempts}: Waiting for solver button...`);
        }

        this.log('Solver button not found after waiting');
        return null;
    }

    async solveCaptchaWithNoCaptcha(challengeFrame, page) {
        try {
            this.log('NoCaptcha AI should auto-solve the challenge...');

            const { maxWaitTime, retryAttempts } = this.config.nocaptchaSettings;
            const startTime = Date.now();

            for (let attempt = 1; attempt <= retryAttempts && (Date.now() - startTime) < maxWaitTime; attempt++) {
                this.log(`Waiting for NoCaptcha AI to solve... (${attempt}/${retryAttempts})`);
                await this.sleep(10000);

                if (await this.isNoCaptchaSolved(challengeFrame, page)) {
                    this.log('NoCaptcha AI successfully solved the challenge');
                    return await this.verifyChallengeSolution(challengeFrame);
                }
            }

            this.log('NoCaptcha AI solving timed out');
            return false;
        } catch (error) {
            this.log(`NoCaptcha AI solving error: ${error.message}`);
            return false;
        }
    }

    async isNoCaptchaSolved(challengeFrame, page) {
        const challengeFrames = await page.frames();
        const hasActiveChallenge = challengeFrames.some(frame =>
            frame.url().includes('recaptcha') && frame.url().includes('bframe')
        );

        if (!hasActiveChallenge) return true;

        const solvedIndicators = [
            '.rc-anchor-checkbox-checked',
            '[aria-checked="true"]',
            '.recaptcha-checkbox-checked'
        ];

        for (const selector of solvedIndicators) {
            if (await challengeFrame.$(selector)) return true;
        }

        return false;
    }

    async verifyChallengeSolution(challengeFrame) {
        try {
            await this.sleep(3000);
            const verifyButton = await challengeFrame.$('#recaptcha-verify-button');

            if (verifyButton) {
                const buttonText = await verifyButton.evaluate(el => el.textContent?.trim());
                const isEnabled = await verifyButton.evaluate(el => !el.disabled);

                if (buttonText !== 'Skip' || isEnabled) {
                    await verifyButton.click();
                    this.log('Clicked verify button');
                    await this.sleep(3000);
                }
            }
            return true;
        } catch (error) {
            this.log(`Verify check failed: ${error.message}`);
            return false;
        }
    }

    // Form Handling
    async fillProductForm(page, email) {
        await this.setPrice(page, '0');
        await this.sleep(1000);

        if (!await this.clickIWantThisButton(page)) {
            throw new Error('Could not find "I want this!" button');
        }

        this.log('Waiting for checkout page...');
        await this.sleep(5000);

        await this.fillEmail(page, email);
        await this.sleep(2000);
        await this.setTip(page, '0');
    }

    async setPrice(page, price) {
        const priceInput = await page.$('input[inputMode="decimal"]');
        if (priceInput) {
            await priceInput.focus();
            await priceInput.click({ clickCount: 3 });
            await priceInput.type(price);
            this.log(`Set price to: ${price}`);
        } else {
            this.log('Warning: Could not find price input field');
        }
    }

    async clickIWantThisButton(page) {
        const buttonSelectors = ['a[href*="checkout"]', '.accent.button'];

        for (const selector of buttonSelectors) {
            const elements = await page.$$(selector);
            for (const element of elements) {
                const text = await element.evaluate(el => el.textContent);
                if (await element.isIntersectingViewport() && text.includes('I want this')) {
                    await element.click();
                    this.log('Clicked "I want this!" button');
                    return true;
                }
            }
        }
        return false;
    }

    async fillEmail(page, email) {
        const emailSelectors = [
            'input[type="email"]',
            'input[name="email"]',
            'input[placeholder*="email" i]'
        ];

        for (const selector of emailSelectors) {
            if (await this.waitForElement(page, selector, 10000)) {
                const emailInput = await page.$(selector);
                await emailInput.focus();
                await emailInput.click({ clickCount: 3 });
                await emailInput.type(email);
                this.log('Email entered successfully');
                return true;
            }
        }
        throw new Error('Could not find email input field');
    }

    async setTip(page, amount) {
        const tipInput = await page.$('input[aria-label="Tip"]');
        if (tipInput) {
            await tipInput.focus();
            await tipInput.click({ clickCount: 3 });
            await tipInput.type(amount);
            this.log(`Set tip to: ${amount}`);
        } else {
            this.log('Warning: Could not find tip field');
        }
    }

    async submitForm(page) {
        const submitSelectors = [
            'button[type="submit"]',
            'input[type="submit"]',
            '.submit-button'
        ];

        // Try buttons with submit-like text first
        const buttons = await page.$$('button');
        for (const button of buttons) {
            const text = await button.evaluate(el => el.textContent);
            const isVisible = await button.isIntersectingViewport();
            const isEnabled = await button.evaluate(el => !el.disabled);

            if (isVisible && isEnabled && this.isSubmitButtonText(text)) {
                await button.click();
                this.log(`Form submitted using button: ${text.trim()}`);
                return true;
            }
        }

        // Fall back to selector-based approach
        for (const selector of submitSelectors) {
            if (await this.waitForElement(page, selector, 5000)) {
                const submitBtn = await page.$(selector);
                if (await submitBtn.evaluate(el => !el.disabled)) {
                    await submitBtn.click();
                    this.log(`Form submitted using: ${selector}`);
                    return true;
                }
            }
        }

        return false;
    }

    isSubmitButtonText(text) {
        const submitTexts = ['get', 'complete', 'purchase', 'checkout', 'submit'];
        return submitTexts.some(submitText => text.toLowerCase().includes(submitText));
    }

    async checkForSuccess(page) {
        const currentUrl = page.url();
        const pageContent = await page.evaluate(() => document.body.innerText.toLowerCase());

        const errorIndicators = ['error', 'failed', 'invalid', 'try again', 'problem'];
        if (errorIndicators.some(indicator => currentUrl.includes(indicator) || pageContent.includes(indicator))) {
            this.log('Error detected in page content');
            return false;
        }

        const successIndicators = [
            'success', 'complete', 'thank', 'confirmation',
            'download', 'purchased', 'receipt', 'congratulations'
        ];

        const isSuccess = successIndicators.some(indicator =>
            currentUrl.includes(indicator) || pageContent.includes(indicator)
        );

        this.log(`Current URL: ${currentUrl}`);
        return isSuccess;
    }

    // Core Signup Process
    async signupSingleEmail(page, email) {
        try {
            this.log(`Starting signup for: ${email}`);

            await page.goto(this.config.productUrl, {
                waitUntil: 'networkidle2',
                timeout: this.config.timeout
            });

            await this.sleep(this.config.actionDelay);
            await this.fillProductForm(page, email);
            await this.sleep(2000);

            if (!await this.submitForm(page)) {
                throw new Error('Could not submit form');
            }

            await this.handleRecaptcha(page);
            await this.sleep(8000);

            if (await this.checkForSuccess(page)) {
                this.logSuccess(email, `- Signup completed successfully using ${this.config.captchaSolver}`);
                return true;
            }

            throw new Error('No success confirmation found');
        } catch (error) {
            this.logFailure(email, error.message);
            return false;
        }
    }

    async bulkSignup(emailSourcePath, options = {}) {
        const emails = this.readEmailsFromFile(emailSourcePath);
        if (emails.length === 0) {
            this.log('No emails found to process');
            return;
        }

        const { batchSize = 2, batchDelay = 20000 } = options;
        this.log(`Starting bulk signup for ${emails.length} emails using ${this.config.captchaSolver} CAPTCHA solver`);

        const browser = await this.createBrowser();
        let successCount = 0;
        let failureCount = 0;

        try {
            for (let i = 0; i < emails.length; i += batchSize) {
                const batch = emails.slice(i, i + batchSize);
                this.log(`Processing batch ${Math.floor(i / batchSize) + 1}: ${batch.length} emails`);

                const results = await Promise.allSettled(
                    batch.map(email => this.processSingleEmail(browser, email))
                );

                const batchSuccess = results.filter(r => r.value).length;
                const batchFailure = results.length - batchSuccess;

                successCount += batchSuccess;
                failureCount += batchFailure;

                this.log(`Batch completed. Totals: ${successCount} successful, ${failureCount} failed`);

                if (i + batchSize < emails.length) {
                    this.log(`Waiting ${batchDelay / 1000} seconds before next batch...`);
                    await this.sleep(batchDelay);
                }
            }

            this.log(`Final results: ${successCount} successful, ${failureCount} failed out of ${emails.length} total`);
        } finally {
            await browser.close();
        }
    }

    async processSingleEmail(browser, email) {
        const page = await browser.newPage();
        try {
            await this.setupPage(page);
            const result = await this.signupSingleEmail(page, email);
            return result;
        } finally {
            await page.close();
        }
    }

    // Utility Methods
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async waitForElement(page, selector, timeout = this.config.timeout) {
        try {
            await page.waitForSelector(selector, { timeout, visible: true });
            return true;
        } catch {
            return false;
        }
    }
}

// CLI Interface
async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) return showUsage();

    const emailFile = args[0];
    if (!fs.existsSync(emailFile)) {
        console.error(`Error: File ${emailFile} not found`);
        return;
    }

    const options = parseCliOptions(args);
    const signup = new GumroadBulkSignup(options);
    await signup.bulkSignup(emailFile, {
        batchSize: options.batchSize,
        batchDelay: options.batchDelay
    });
}

function showUsage() {
    console.log(`
Usage: node gumroad-bulk-signup.js <email-file> [options]

Arguments:
  email-file              Path to Excel (.xlsx) or CSV file containing emails

Options:
  --headless             Run in headless mode (default: true)
  --delay <ms>           Delay between actions in ms (default: 3000)
  --batch-size <num>     Number of simultaneous signups (default: 2)
  --batch-delay <ms>     Delay between batches in ms (default: 20000)
  --captcha-solver <type> CAPTCHA solver: 'buster' or 'nocaptcha' (default: buster)
  --buster-path <path>   Path to Buster extension (default: ./buster-extension)
  --nocaptcha-path <path> Path to NoCaptcha AI extension (default: ./nocaptcha-extension)
  --nocaptcha-api-key <key> API key for NoCaptcha AI solver

Examples:
  node index.js emails.xlsx
  node index.js emails.csv --captcha-solver nocaptcha
  node index.js emails.xlsx --captcha-solver buster --batch-size 1
  node index.js emails.xlsx --nocaptcha-path ./my-nocaptcha-extension
    `);
}

function parseCliOptions(args) {
    const getArgValue = (argName) => {
        const index = args.indexOf(argName);
        return index !== -1 && args[index + 1] ? args[index + 1] : null;
    };

    return {
        headless: !args.includes('--no-headless'),
        delay: parseInt(getArgValue('--delay')) || 3000,
        batchSize: parseInt(getArgValue('--batch-size')) || 2,
        batchDelay: parseInt(getArgValue('--batch-delay')) || 20000,
        captchaSolver: getArgValue('--captcha-solver') || 'buster',
        busterExtensionPath: getArgValue('--buster-path') || './buster-extension',
        nocaptchaExtensionPath: getArgValue('--nocaptcha-path') || './nocaptcha-extension',
        nocaptchaApiKey: getArgValue('--nocaptcha-api-key')
    };
}

module.exports = GumroadBulkSignup;

if (require.main === module) {
    main().catch(console.error);
}