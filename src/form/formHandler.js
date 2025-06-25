/**
 * Handles form interactions on Gumroad
 */
class FormHandler {
    /**
     * @param {Object} config 
     * @param {Logger} logger 
     * @param {Function} sleepFn 
     */
    constructor(config, logger, sleepFn) {
        this.config = config;
        this.logger = logger;
        this.sleep = sleepFn;
    }

    /**
     * Fill the product form
     * @param {puppeteer.Page} page 
     * @param {string} email 
     */
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
        this.logger.log('Waiting for checkout page...');
        await this.sleep(5000);

        // Fill email
        await this.fillEmail(page, email);
        await this.sleep(2000);

        // Set tip to 0
        await this.setTip(page, '0');
    }

    /**
     * Set the price input field
     * @param {puppeteer.Page} page 
     * @param {string} price 
     */
    async setPrice(page, price) {
        const priceInput = await page.$('input[inputMode="decimal"]');
        if (priceInput) {
            await priceInput.focus();
            await priceInput.click({ clickCount: 3 });
            await priceInput.type(price);
            this.logger.log(`Set price to: ${price}`);
        } else {
            this.logger.log('Warning: Could not find price input field');
        }
    }

    /**
     * Click the "I want this!" button
     * @param {puppeteer.Page} page 
     * @returns {boolean} Success status
     */
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
                        this.logger.log('Clicked "I want this!" button');
                        return true;
                    }
                }
            } catch {
                continue;
            }
        }
        return false;
    }

    /**
     * Fill the email input field
     * @param {puppeteer.Page} page 
     * @param {string} email 
     */
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
                    this.logger.log('Email entered successfully');
                    return true;
                }
            } catch {
                continue;
            }
        }
        throw new Error('Could not find email input field');
    }

    /**
     * Set the tip amount
     * @param {puppeteer.Page} page 
     * @param {string} amount 
     */
    async setTip(page, amount) {
        const tipInput = await page.$('input[aria-label="Tip"]');
        if (tipInput) {
            await tipInput.focus();
            await tipInput.click({ clickCount: 3 });
            await tipInput.type(amount);
            this.logger.log(`Set tip to: ${amount}`);
        } else {
            this.logger.log('Warning: Could not find tip field');
        }
    }

    /**
     * Submit the form
     * @param {puppeteer.Page} page 
     * @returns {boolean} Success status
     */
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
                    this.logger.log(`Form submitted using button: ${text.trim()}`);
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
                        this.logger.log(`Form submitted using: ${selector}`);
                        return true;
                    }
                }
            } catch {
                continue;
            }
        }

        return false;
    }

    /**
     * Check if button text indicates a submit button
     * @param {string} text 
     * @returns {boolean}
     */
    isSubmitButtonText(text) {
        const submitTexts = ['get', 'complete', 'purchase', 'checkout', 'submit'];
        return submitTexts.some(submitText =>
            text.toLowerCase().includes(submitText)
        );
    }

    /**
     * Check for success indicators on the page
     * @param {puppeteer.Page} page 
     * @returns {boolean} Success status
     */
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
            this.logger.log('Error detected in page content');
            return false;
        }

        // Check for success
        const isSuccess = successIndicators.some(indicator =>
            currentUrl.includes(indicator) || pageContent.includes(indicator)
        );

        this.logger.log(`Current URL: ${currentUrl}`);
        return isSuccess;
    }

    /**
     * Wait for an element to appear on the page
     * @param {puppeteer.Page} page 
     * @param {string} selector 
     * @param {number} timeout 
     * @returns {boolean} Element found status
     */
    async waitForElement(page, selector, timeout = this.config.timeout) {
        try {
            await page.waitForSelector(selector, { timeout, visible: true });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Complete the entire form submission process
     * @param {puppeteer.Page} page 
     * @param {string} email 
     * @returns {boolean} Success status
     */
    async completeFormSubmission(page, email) {
        try {
            // Fill the form
            await this.fillProductForm(page, email);

            // Submit the form
            await this.sleep(2000);
            const submitResult = await this.submitForm(page);
            if (!submitResult) {
                throw new Error('Could not submit form');
            }

            // Check for success
            await this.sleep(2000);
            const success = await this.checkForSuccess(page);

            if (success) {
                this.logger.log(`Form submission completed successfully for: ${email}`);
                return true;
            } else {
                throw new Error('No success confirmation found');
            }

        } catch (error) {
            this.logger.log(`Form submission failed for ${email}: ${error.message}`);
            return false;
        }
    }
}

module.exports = FormHandler;