const puppeteer = require('puppeteer');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

class GumroadBulkSignup {
    constructor(options = {}) {
        this.config = {
            productUrl: options.productUrl || 'https://brightlaunch.gumroad.com/l/livetraining',
            actionDelay: options.delay || 3000,
            headless: options.headless !== false,
            timeout: options.timeout || 45000,

            // CAPTCHA solver options
            captchaSolver: options.captchaSolver || 'buster', // 'buster', 'nocaptcha', or 'manual'
            busterExtensionPath: options.busterExtensionPath || './buster-extension',
            nocaptchaExtensionPath: options.nocaptchaExtensionPath || './nocaptcha-extension',

            // NoCaptcha AI specific configuration
            nocaptchaApiKey: options.nocaptchaApiKey || null,
            nocaptchaSettings: {
                autoSolve: options.nocaptchaAutoSolve !== false,
                maxWaitTime: options.nocaptchaMaxWait || 120000, // 2 minutes
                retryAttempts: options.nocaptchaRetryAttempts || 3,
                ...options.nocaptchaSettings
            },

            logFile: options.logFile || 'logs/signup_log.txt',
            successFile: options.successFile || 'logs/successful_signups.txt',
            failedFile: options.failedFile || 'logs/failed_signups.txt'
        };

        this.initializeLogging();
        this.validateCaptchaSolver();
    }

    // Validate CAPTCHA solver configuration
    validateCaptchaSolver() {
        const validSolvers = ['buster', 'nocaptcha', 'manual'];
        if (!validSolvers.includes(this.config.captchaSolver)) {
            this.log(`Warning: Invalid CAPTCHA solver '${this.config.captchaSolver}'. Defaulting to 'buster'`);
            this.config.captchaSolver = 'buster';
        }

        if (this.config.captchaSolver === 'nocaptcha') {
            if (!this.config.nocaptchaApiKey) {
                this.log('Warning: NoCaptcha AI requires an API key. Please provide nocaptchaApiKey in options.');
                this.log('Falling back to manual CAPTCHA solving.');
                this.config.captchaSolver = 'manual';
            } else {
                this.log('NoCaptcha AI configured with API key');
            }
        }

        if (this.config.captchaSolver !== 'manual') {
            const extensionPath = this.config.captchaSolver === 'buster'
                ? this.config.busterExtensionPath
                : this.config.nocaptchaExtensionPath;

            if (!fs.existsSync(extensionPath)) {
                this.log(`Warning: ${this.config.captchaSolver} extension not found at ${extensionPath}`);
                this.log('Falling back to manual CAPTCHA solving.');
                this.config.captchaSolver = 'manual';
            } else {
                this.log(`Using ${this.config.captchaSolver} CAPTCHA solver from: ${extensionPath}`);
            }
        }
    }

    // Initialize logging system
    initializeLogging() {
        const logDir = path.dirname(this.config.logFile);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        const timestamp = new Date().toISOString();
        const header = `=== Gumroad Bulk Signup - ${timestamp} ===\n`;

        fs.writeFileSync(this.config.logFile, header);
        fs.writeFileSync(this.config.successFile, header);
        fs.writeFileSync(this.config.failedFile, header);
    }

    // Logging methods
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

    // NoCaptcha configuration methods
    async configureNoCaptchaExtension() {
        if (this.config.captchaSolver !== 'nocaptcha' || !this.config.nocaptchaApiKey) {
            return;
        }

        const configPath = path.join(this.config.nocaptchaExtensionPath, 'defaultConfig.json');

        try {
            this.log('Configuring NoCaptcha AI extension...');

            // Check if config file exists
            if (!fs.existsSync(configPath)) {
                this.log(`Warning: NoCaptcha config file not found at ${configPath}`);
                return;
            }

            // Read existing config
            const configContent = fs.readFileSync(configPath, 'utf8');
            const config = JSON.parse(configContent);

            // Backup original config
            const backupPath = configPath + '.backup';
            if (!fs.existsSync(backupPath)) {
                fs.writeFileSync(backupPath, configContent);
                this.log('Created backup of original config');
            }

            // Update API key
            config.APIKEY = this.config.nocaptchaApiKey;

            // Ensure extension is enabled
            config.enabled = true;
            config.extensionEnabled = "true";

            // Ensure ReCaptcha is configured properly
            if (config.options && config.options.ReCaptcha) {
                config.options.ReCaptcha.active = true;
                config.options.ReCaptcha.autoSolve = true;
                config.options.ReCaptcha.alwaysSolve = true;
                config.options.ReCaptcha.support = true;
            }

            // Write updated config
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            this.log('NoCaptcha AI extension configured successfully');
            this.log(`API key set: ${this.config.nocaptchaApiKey.substring(0, 8)}...`);

        } catch (error) {
            this.log(`Error configuring NoCaptcha extension: ${error.message}`);
            throw error;
        }
    }

    async restoreNoCaptchaConfig() {
        if (this.config.captchaSolver !== 'nocaptcha') {
            return;
        }

        const configPath = path.join(this.config.nocaptchaExtensionPath, 'defaultConfig.json');
        const backupPath = configPath + '.backup';

        try {
            if (fs.existsSync(backupPath)) {
                const backupContent = fs.readFileSync(backupPath, 'utf8');
                fs.writeFileSync(configPath, backupContent);
                this.log('Restored original NoCaptcha config');
            }
        } catch (error) {
            this.log(`Warning: Could not restore original config: ${error.message}`);
        }
    }

    // Email reading methods
    readEmailsFromFile(filePath) {
        try {
            if (filePath.endsWith('.csv')) {
                return this.readEmailsFromCSV(filePath);
            }

            const workbook = xlsx.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const data = xlsx.utils.sheet_to_json(worksheet);

            const emailColumn = this.findEmailColumn(data);
            const emails = data
                .map(row => row[emailColumn])
                .filter(email => email && email.includes('@'));

            this.log(`Found ${emails.length} valid emails in ${filePath}`);
            return emails;
        } catch (error) {
            this.log(`Error reading file ${filePath}: ${error.message}`);
            return [];
        }
    }

    readEmailsFromCSV(filePath) {
        try {
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

            this.log(`Found ${emails.length} valid emails in CSV ${filePath}`);
            return emails;
        } catch (error) {
            this.log(`Error reading CSV ${filePath}: ${error.message}`);
            return [];
        }
    }

    findEmailColumn(data) {
        if (!data.length) return null;

        const emailColumns = ['email', 'Email', 'EMAIL', 'emails', 'Emails', 'EMAILS'];

        for (const col of emailColumns) {
            if (data[0].hasOwnProperty(col)) {
                return col;
            }
        }

        const firstColumn = Object.keys(data[0])[0];
        this.log(`Warning: No standard email column found. Using: ${firstColumn}`);
        return firstColumn;
    }

    // Utility methods
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

    // Browser setup
    async createBrowser() {
        // Configure NoCaptcha extension before launching browser
        await this.configureNoCaptchaExtension();

        const args = [
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

        // Add appropriate CAPTCHA solver extension
        if (this.config.captchaSolver !== 'manual') {
            const extensionPath = this.config.captchaSolver === 'buster'
                ? this.config.busterExtensionPath
                : this.config.nocaptchaExtensionPath;

            if (fs.existsSync(extensionPath)) {
                const resolvedPath = path.resolve(extensionPath);
                args.push(`--disable-extensions-except=${resolvedPath}`);
                args.push(`--load-extension=${resolvedPath}`);
                this.log(`${this.config.captchaSolver} extension loaded from: ${resolvedPath}`);
            }
        }

        const browser = await puppeteer.launch({
            headless: this.config.headless,
            args,
            defaultViewport: { width: 1366, height: 768 }
        });

        return browser;
    }

    async setupPage(page) {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1366, height: 768 });

        // Remove webdriver detection
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
            });
        });
    }

    // CAPTCHA handling
    async handleCaptcha(page) {
        try {
            this.log('🔍 Scanning for active CAPTCHA...');
            await this.sleep(2000);

            const activeCaptcha = await this.detectVisibleCaptcha(page);
            if (!activeCaptcha) {
                this.log('✅ No visible CAPTCHA found');
                return true;
            }

            const { type, frame } = activeCaptcha;
            this.log(`🎯 Active CAPTCHA detected: ${type}`);

            return await this.solveCaptcha(type, frame, page);
        } catch (error) {
            this.log(`❌ CAPTCHA handling failed: ${error.message}`);
            if (this.config.captchaSolver === 'manual') {
                this.log('Manual CAPTCHA solving required. Waiting 60 seconds...');
                await this.sleep(60000);
                return true;
            }
            return false;
        }
    }


    async detectVisibleCaptcha(page) {
        const frames = await page.frames();

        function getCaptchaType(url) {
            const hostname = (new URL(url)).hostname;

            if (hostname.includes('hcaptcha.com')) {
                if (url.includes('checkbox')) return 'hcaptcha-checkbox';
                if (url.includes('challenge') || url.includes('frame')) return 'hcaptcha-challenge';
                return 'hcaptcha';
            }

            if (hostname.includes('recaptcha.net') || hostname.includes('google.com')) {
                if (url.includes('anchor') || url.includes('checkbox')) return 'recaptcha-checkbox';
                if (url.includes('bframe') || url.includes('challenge')) return 'recaptcha-challenge';
                return 'recaptcha';
            }

            if (hostname.includes('challenges.cloudflare.com') || url.includes('cdn-cgi/challenge-platform')) {
                return 'turnstile';
            }

            return null;
        }


        for (const frame of frames) {
            const url = frame.url();
            const type = getCaptchaType(url);
            if (!type) continue;

            const visible = await frame.evaluate(() => {
                const el = document.body;
                const style = window.getComputedStyle(el);
                return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0;
            }).catch(() => false);

            if (visible) {
                this.log(`[VISIBLE CAPTCHA DETECTED] Type: ${type} | URL: ${url}`);
                return { type, frame };
            }
        }

        return null;
    }

    async solveCaptcha(type, frame, page) {
        this.log(`🤖 Solving CAPTCHA of type: ${type} using ${this.config.captchaSolver}...`);

        // Final solve
        switch (this.config.captchaSolver) {
            case 'buster':
                return await this.solveCaptchaWithBuster(frame);

            case 'nocaptcha':
                return await this.solveCaptchaWithNoCaptcha(frame, page);

            case 'manual':
                this.log('Manual CAPTCHA solving required. Waiting 60 seconds...');
                await this.sleep(60000);
                return true;

            default:
                this.log(`⚠️ No solving strategy implemented for: ${type}`);
                return false;
        }
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

    async checkRecaptchaVerified(frame) {
        const verificationSelectors = [
            '.recaptcha-checkbox-checked',
            '.rc-anchor-checkbox-checked',
            '[aria-checked="true"]'
        ];

        for (const selector of verificationSelectors) {
            try {
                const element = await frame.$(selector);
                if (element) {
                    this.log('reCAPTCHA verification confirmed');
                    return true;
                }
            } catch {
                continue;
            }
        }
        return false;
    }

    // Buster CAPTCHA solver
    async solveCaptchaWithBuster(challengeFrame) {
        try {
            await this.saveChallengeFrameHTML(challengeFrame);

            this.log('Waiting for Buster extension...');
            await challengeFrame.waitForSelector('.rc-footer', { timeout: 15000 });

            // Wait for Buster to inject solver button
            const solverButton = await this.waitForBusterButton(challengeFrame);

            if (solverButton) {
                await solverButton.click();
                this.log('Clicked Buster button');
                await this.sleep(25000); // Wait for Buster to solve
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

            try {
                const solverButton = await challengeFrame.$('#solver-button');
                if (solverButton) {
                    const isVisible = await solverButton.evaluate(el => {
                        const style = window.getComputedStyle(el);
                        return style.display !== 'none' && el.offsetHeight > 0;
                    });

                    if (isVisible) {
                        this.log(`Solver button found after ${attempt} attempts`);
                        return solverButton;
                    }
                }
            } catch {
                // Continue waiting
            }

            this.log(`Attempt ${attempt}/${maxAttempts}: Waiting for solver button...`);
        }

        this.log('Solver button not found after waiting');
        return null;
    }

    async saveChallengeFrameHTML(challengeFrame) {
        try {
            const htmlContent = await challengeFrame.content();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `challenge-frame-${timestamp}.html`;
            const filepath = path.join(__dirname, 'captcha-frames', filename);

            // Create directory if it doesn't exist (synchronous)
            if (!fs.existsSync(path.dirname(filepath))) {
                fs.mkdirSync(path.dirname(filepath), { recursive: true });
            }

            // Save HTML content to file (synchronous)
            fs.writeFileSync(filepath, htmlContent, 'utf8');

            this.log(`Challenge frame HTML saved to: ${filepath}`);
        } catch (error) {
            this.log(`Failed to save challenge frame HTML: ${error.message}`);
        }
    }

    // Simplified NoCaptcha AI solver
    async solveCaptchaWithNoCaptcha(challengeFrame, page) {
        try {
            this.log('NoCaptcha AI should auto-solve the challenge...');

            // Since we configured the extension to auto-solve, just wait for it to work
            const maxWaitTime = this.config.nocaptchaSettings.maxWaitTime;
            const startTime = Date.now();
            let attempts = 0;
            const maxAttempts = this.config.nocaptchaSettings.retryAttempts;

            while (attempts < maxAttempts && (Date.now() - startTime) < maxWaitTime) {
                attempts++;
                this.log(`Waiting for NoCaptcha AI to solve... (${attempts}/${maxAttempts})`);

                // Wait for some time before checking
                await this.sleep(10000);

                // Check if solved
                const isSolved = await this.checkNoCaptchaSolved(challengeFrame, page);
                if (isSolved) {
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

    async checkNoCaptchaSolved(challengeFrame, page) {
        try {
            // Check if challenge frame is gone (solved)
            const challengeFrames = await page.frames();
            const activeChallenge = challengeFrames.find(frame => {
                const url = frame.url();
                return url.includes('recaptcha') && url.includes('bframe');
            });

            if (!activeChallenge) {
                return true;
            }

            // Check for solved indicators in the challenge frame
            const solvedIndicators = [
                '.rc-anchor-checkbox-checked',
                '[aria-checked="true"]',
                '.recaptcha-checkbox-checked'
            ];

            for (const selector of solvedIndicators) {
                try {
                    const element = await challengeFrame.$(selector);
                    if (element) {
                        return true;
                    }
                } catch {
                    continue;
                }
            }

            return false;
        } catch (error) {
            return false;
        }
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
                    return true;
                }
            }
            return true;
        } catch (error) {
            this.log(`Verify check failed: ${error.message}`);
            return false;
        }
    }

    // Form handling methods
    async fillProductForm(page, email) {
        // Enter price (0)
        await this.setPrice(page, '0');
        await this.sleep(1000);

        // Click "I want this!" button
        const iwantThisClicked = await this.clickIWantThisButton(page);
        if (!iwantThisClicked) {
            throw new Error('Could not find "I want this!" button');
        }

        // Wait for checkout page
        this.log('Waiting for checkout page...');
        await this.sleep(5000);

        // Fill email
        await this.fillEmail(page, email);
        await this.sleep(2000);

        // Set tip to 0
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
        const buttonSelectors = [
            'a[href*="checkout"]',
            '.accent.button'
        ];

        for (const selector of buttonSelectors) {
            try {
                const elements = await page.$$(selector);
                for (const element of elements) {
                    const text = await element.evaluate(el => el.textContent);
                    const isVisible = await element.isIntersectingViewport();

                    if (isVisible) {
                        await element.click();
                        this.log('Clicked "I want this!" button');
                        return true;
                    }
                }
            } catch {
                continue;
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
            try {
                if (await this.waitForElement(page, selector, 10000)) {
                    const emailInput = await page.$(selector);
                    await emailInput.focus();
                    await emailInput.click({ clickCount: 3 });
                    await emailInput.type(email);
                    this.log('Email entered successfully');
                    return true;
                }
            } catch {
                continue;
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

        // Try specific buttons with text
        const buttons = await page.$$('button');
        for (const button of buttons) {
            try {
                const text = await button.evaluate(el => el.textContent);
                const isVisible = await button.isIntersectingViewport();
                const isEnabled = await button.evaluate(el => !el.disabled);

                if (isVisible && isEnabled && this.isSubmitButtonText(text)) {
                    await button.click();
                    this.log(`Form submitted using button: ${text.trim()}`);
                    return true;
                }
            } catch {
                continue;
            }
        }

        // Try selector-based approach
        for (const selector of submitSelectors) {
            try {
                if (await this.waitForElement(page, selector, 5000)) {
                    const submitBtn = await page.$(selector);
                    const isEnabled = await submitBtn.evaluate(el => !el.disabled);

                    if (isEnabled) {
                        await submitBtn.click();
                        this.log(`Form submitted using: ${selector}`);
                        return true;
                    }
                }
            } catch {
                continue;
            }
        }

        return false;
    }

    isSubmitButtonText(text) {
        const submitTexts = ['get', 'complete', 'purchase', 'checkout', 'submit'];
        return submitTexts.some(submitText =>
            text.toLowerCase().includes(submitText)
        );
    }

    async checkForSuccess(page) {
        const currentUrl = page.url();
        const pageContent = await page.evaluate(() => document.body.innerText.toLowerCase());

        const successIndicators = [
            'success', 'complete', 'thank', 'confirmation',
            'download', 'purchased', 'receipt', 'congratulations'
        ];

        const errorIndicators = [
            'error', 'failed', 'invalid', 'try again', 'problem'
        ];

        // Check for errors first
        const hasError = errorIndicators.some(indicator =>
            currentUrl.includes(indicator) || pageContent.includes(indicator)
        );

        if (hasError) {
            this.log('Error detected in page content');
            return false;
        }

        // Check for success
        const isSuccess = successIndicators.some(indicator =>
            currentUrl.includes(indicator) || pageContent.includes(indicator)
        );

        this.log(`Current URL: ${currentUrl}`);
        return isSuccess;
    }

    // Main signup method
    async signupSingleEmail(page, email) {
        try {
            this.log(`Starting signup for: ${email}`);

            // Navigate to product page
            await page.goto(this.config.productUrl, {
                waitUntil: 'networkidle2',
                timeout: this.config.timeout
            });

            await this.sleep(this.config.actionDelay);

            // Fill form
            await this.fillProductForm(page, email);

            // Submit form
            await this.sleep(2000);
            const submitResult = await this.submitForm(page);
            if (!submitResult) {
                throw new Error('Could not submit form');
            }

            // Handle any CAPTCHA
            await this.handleCaptcha(page);

            // Check for success
            await this.sleep(8000);
            const success = await this.checkForSuccess(page);

            if (success) {
                this.logSuccess(email, `- Signup completed successfully using ${this.config.captchaSolver}`);
                return true;
            } else {
                throw new Error('No success confirmation found');
            }

        } catch (error) {
            this.logFailure(email, error.message);
            return false;
        }
    }
    // Bulk signup method
    async bulkSignup(emailSourcePath, options = {}) {
        const batchSize = options.batchSize || 2;
        const batchDelay = options.batchDelay || 20000;

        const emails = this.readEmailsFromFile(emailSourcePath);
        if (emails.length === 0) {
            this.log('No emails found to process');
            return;
        }

        this.log(`Starting bulk signup for ${emails.length} emails using ${this.config.captchaSolver} CAPTCHA solver`);

        const browser = await this.createBrowser();
        let successCount = 0;
        let failureCount = 0;

        try {
            for (let i = 0; i < emails.length; i += batchSize) {
                const batch = emails.slice(i, i + batchSize);
                this.log(`Processing batch ${Math.floor(i / batchSize) + 1}: ${batch.length} emails`);

                const promises = batch.map(async (email) => {
                    const page = await browser.newPage();
                    await this.setupPage(page);

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
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log(`
Usage: node gumroad-bulk-signup.js <email-file> [options]

Arguments:
  email-file              Path to Excel (.xlsx) or CSV file containing emails

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
  node index.js emails.xlsx
  node index.js emails.csv --captcha-solver nocaptcha
  node index.js emails.xlsx --captcha-solver buster --batch-size 1
  node index.js emails.xlsx --nocaptcha-path ./my-nocaptcha-extension
        `);
        return;
    }

    const emailFile = args[0];
    if (!fs.existsSync(emailFile)) {
        console.error(`Error: File ${emailFile} not found`);
        return;
    }

    // Parse arguments
    const getArgValue = (argName) => {
        const index = args.indexOf(argName);
        return index !== -1 && args[index + 1] ? args[index + 1] : null;
    };

    const options = {
        headless: !args.includes('--no-headless'),
        productUrl: getArgValue('--product-url') || 'https://gumroad.com/l/your-product',
        delay: parseInt(getArgValue('--delay')) || 3000,
        captchaSolver: getArgValue('--captcha-solver') || 'buster',
        busterExtensionPath: getArgValue('--buster-path') || './buster-extension',
        nocaptchaExtensionPath: getArgValue('--nocaptcha-path') || './nocaptcha-extension',
        nocaptchaApiKey: getArgValue('--nocaptcha-api-key')
    };

    const bulkOptions = {
        batchSize: parseInt(getArgValue('--batch-size')) || 2,
        batchDelay: parseInt(getArgValue('--batch-delay')) || 20000
    };

    const signup = new GumroadBulkSignup(options);
    await signup.bulkSignup(emailFile, bulkOptions);
}

module.exports = GumroadBulkSignup;

if (require.main === module) {
    main().catch(console.error);
}