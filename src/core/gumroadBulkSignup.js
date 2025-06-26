const ConfigManager = require('../config/configManager');
const Logger = require('../logger/logger');
const EmailReader = require('../email/emailReader');
const BrowserManager = require('../browser/browserManager');
const CaptchaHandler = require('../captcha/captchaHandler');
const FormHandler = require('../form/formHandler');

/**
 * Main class for Gumroad bulk signup functionality
 */
class GumroadBulkSignup {
    /**
     * @param {Object} options - Configuration options
     */
    constructor(options = {}) {
        this.configManager = new ConfigManager(options);
        this.config = this.configManager.getConfig();

        this.logger = new Logger(this.config);
        this.emailReader = new EmailReader(this.logger);
        this.browserManager = new BrowserManager(this.config, this.logger);
        this.captchaHandler = new CaptchaHandler(this.config, this.logger, this.sleep.bind(this));
        this.formHandler = new FormHandler(this.config, this.logger, this.sleep.bind(this));
    }

    /**
     * Perform bulk signup for emails in a file
     * @param {string} emailSourcePath - Path to file containing emails
     * @param {Object} options - Batch options
     */
    async bulkSignup(emailSourcePath, options = {}) {
        const batchSize = options.batchSize || 2;
        const batchDelay = options.batchDelay || 20000;

        const emails = this.emailReader.readEmailsFromFile(emailSourcePath);
        if (emails.length === 0) {
            this.logger.log('No emails found to process');
            return;
        }

        this.logger.log(`Starting bulk signup for ${emails.length} emails using ${this.config.captchaSolver} CAPTCHA solver`);

        const browser = await this.browserManager.createBrowser();
        let successCount = 0;
        let failureCount = 0;

        try {
            for (let i = 0; i < emails.length; i += batchSize) {
                const batch = emails.slice(i, i + batchSize);
                this.logger.log(`Processing batch ${Math.floor(i / batchSize) + 1}: ${batch.length} emails`);

                const promises = batch.map(async (email) => {
                    const page = await browser.newPage();
                    await this.browserManager.setupPage(page);

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

                this.logger.log(`Batch completed. Totals: ${successCount} successful, ${failureCount} failed`);

                if (i + batchSize < emails.length) {
                    this.logger.log(`Waiting ${batchDelay / 1000} seconds before next batch...`);
                    await this.sleep(batchDelay);
                }
            }

            this.logger.log(`Final results: ${successCount} successful, ${failureCount} failed out of ${emails.length} total`);
        } finally {
            await browser.close();
        }
    }

    /**
     * Signup a single email
     * @param {puppeteer.Page} page 
     * @param {string} email 
     * @returns {Promise<boolean>} True if signup was successful
     */
    async signupSingleEmail(page, email) {
        try {
            this.logger.log(`Starting signup for: ${email}`);

            // Navigate to product page
            await page.goto(this.config.productUrl, {
                waitUntil: 'networkidle2',
                timeout: this.config.timeout
            });

            await this.sleep(this.config.actionDelay);

            // Fill form
            await this.formHandler.fillProductForm(page, email);

            // Submit form
            await this.sleep(2000);
            const submitResult = await this.formHandler.submitForm(page);
            if (!submitResult) {
                throw new Error('Could not submit form');
            }

            // Handle any CAPTCHA
            const solved = await this.captchaHandler.handleRecaptcha(page);


            this.logger.log(`was captcha solving successful?: ${solved}`);

            // Check for success
            await this.sleep(2000);
            const success = await this.formHandler.checkForSuccess(page);

            if (success && solved) {
                this.logger.logSuccess(email, `- Signup completed successfully using ${this.config.captchaSolver}`);
                return true;
            } else {
                this.logger.logFailure(email, error.message);
                throw new Error('No success confirmation found');

            }
        } catch (error) {
            this.logger.logFailure(email, error.message);
            return false;
        }
    }

    /**
     * Sleep helper
     * @param {number} ms - Milliseconds to sleep
     * @returns {Promise<void>}
     */
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = GumroadBulkSignup;