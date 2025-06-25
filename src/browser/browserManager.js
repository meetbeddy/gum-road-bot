const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

/**
 * Manages browser lifecycle and setup
 */
class BrowserManager {
    /**
     * @param {Object} config 
     * @param {Logger} logger 
     */
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
    }

    /**
     * Create a new browser instance
     * @returns {Promise<puppeteer.Browser>}
     */
    async createBrowser() {
        const args = this.getBrowserArgs();
        this.logger.log(`Launching browser (headless: ${this.config.headless})`);

        return await puppeteer.launch({
            headless: this.config.headless,
            args,
            defaultViewport: { width: 1366, height: 768 }
        });
    }

    getBrowserArgs() {
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

        if (this.config.captchaSolver !== 'manual') {
            const extensionPath = this.getExtensionPath();
            if (extensionPath) {
                args.push(`--disable-extensions-except=${extensionPath}`);
                args.push(`--load-extension=${extensionPath}`);
            }
        }

        return args;
    }

    getExtensionPath() {
        const extensionPath = this.config.captchaSolver === 'buster'
            ? this.config.busterExtensionPath
            : this.config.nocaptchaExtensionPath;

        if (!fs.existsSync(extensionPath)) {
            this.logger.log(`Warning: ${this.config.captchaSolver} extension not found at ${extensionPath}`);
            return null;
        }

        return path.resolve(extensionPath);
    }

    /**
     * Configure a new page
     * @param {puppeteer.Page} page 
     */
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
}

module.exports = BrowserManager;