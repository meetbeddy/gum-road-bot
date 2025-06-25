const fs = require('fs');
const path = require('path');

/**
 * Manages configuration settings for Gumroad bulk signup
 */
class ConfigManager {
    /**
     * @param {Object} options - User-provided options
     */
    constructor(options = {}) {
        this.defaultConfig = {
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
                retryAttempts: 3
            },
            logFile: 'logs/signup_log.txt',
            successFile: 'logs/successful_signups.txt',
            failedFile: 'logs/failed_signups.txt'
        };

        this.config = this.mergeConfigs(options);
    }

    /**
     * Merge user options with defaults
     * @param {Object} userOptions 
     * @returns {Object} Merged configuration
     */
    mergeConfigs(userOptions) {
        const config = { ...this.defaultConfig, ...userOptions };

        // Deep merge for nocaptchaSettings
        config.nocaptchaSettings = {
            ...this.defaultConfig.nocaptchaSettings,
            ...(userOptions.nocaptchaSettings || {})
        };

        return config;
    }

    /**
     * Validate the configuration
     * @throws {Error} If configuration is invalid
     */
    validate() {
        this.validateCaptchaSolver();
        this.ensureLogDirectoryExists();
    }

    validateCaptchaSolver() {
        const validSolvers = ['buster', 'nocaptcha', 'manual'];
        if (!validSolvers.includes(this.config.captchaSolver)) {
            throw new Error(`Invalid CAPTCHA solver '${this.config.captchaSolver}'. Must be one of: ${validSolvers.join(', ')}`);
        }

        if (this.config.captchaSolver === 'nocaptcha' && !this.config.nocaptchaApiKey) {
            throw new Error('NoCaptcha AI requires an API key. Please provide nocaptchaApiKey in options.');
        }
    }

    ensureLogDirectoryExists() {
        const logDir = path.dirname(this.config.logFile);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    }

    getConfig() {
        return this.config;
    }
}

module.exports = ConfigManager;