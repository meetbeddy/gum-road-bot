/**
 * Handles CAPTCHA solving using different methods (Buster, NoCaptcha AI, Manual)
 * Supports multiple CAPTCHA detection strategies and automated solving
 */
class CaptchaHandler {
    /**
     * Initialize the CAPTCHA handler with configuration and dependencies
     * @param {Object} config - Configuration object containing CAPTCHA solver settings
     * @param {string} config.captchaSolver - Type of solver ('buster', 'nocaptcha', 'manual')
     * @param {number} config.timeout - Default timeout for operations
     * @param {Object} config.nocaptchaSettings - NoCaptcha AI specific settings
     * @param {Logger} logger - Logger instance for outputting messages
     * @param {Function} sleepFn - Sleep function for delays
     */
    constructor(config, logger, sleepFn) {
        this.config = config;
        this.logger = logger;
        this.sleep = sleepFn;
    }

    /**
     * Main entry point for handling reCAPTCHA on a page
     * Detects CAPTCHA presence and attempts to solve using configured method
     * @param {puppeteer.Page} page - Puppeteer page instance
     * @returns {Promise<boolean>} True if CAPTCHA was handled successfully or not present
     */
    async handleRecaptcha(page) {
        try {
            this.logger.log('Checking for reCAPTCHA...');
            await this.sleep(1000);

            // Define common selectors for detecting reCAPTCHA elements
            const recaptchaSelectors = [
                'iframe[src*="recaptcha"]',                                    // Generic reCAPTCHA iframe
                'iframe[name^="a-"][src^="https://www.google.com/recaptcha"]', // Specific Google reCAPTCHA iframe
                '.g-recaptcha',                                                // reCAPTCHA container div
                '.rc-anchor'                                                   // reCAPTCHA anchor element
            ];

            // Check if reCAPTCHA is present on the page
            const recaptchaFound = await this.detectRecaptcha(page, recaptchaSelectors);
            if (!recaptchaFound) {
                this.logger.log('No reCAPTCHA detected');
                return true;
            }

            // Attempt to solve the detected reCAPTCHA
            return await this.solveRecaptcha(page);
        } catch (error) {
            this.logger.log(`reCAPTCHA handling failed: ${error.message}`);

            // Fallback to manual solving if configured
            if (this.config.captchaSolver === 'manual') {
                this.logger.log('Manual CAPTCHA solving required. Waiting 60 seconds...');
                await this.sleep(60000);
                return true;
            }
            return false;
        }
    }

    /**
     * Detect if reCAPTCHA is present and visible on the page
     * @param {puppeteer.Page} page - Puppeteer page instance
     * @param {string[]} selectors - Array of CSS selectors to check for reCAPTCHA
     * @returns {Promise<boolean>} True if visible reCAPTCHA is found
     */
    async detectRecaptcha(page, selectors) {
        for (const selector of selectors) {
            try {
                const element = await page.$(selector);
                if (element) {
                    // Check if the element is actually visible (not hidden by CSS)
                    const isVisible = await element.evaluate(el => {
                        const style = window.getComputedStyle(el);
                        return style.display !== 'none' &&
                            style.visibility !== 'hidden' &&
                            el.offsetHeight > 0;
                    });

                    if (isVisible) {
                        this.logger.log(`reCAPTCHA detected with selector: ${selector}`);
                        return true;
                    }
                }
            } catch {
                // Continue checking other selectors if this one fails
                continue;
            }
        }
        return false;
    }

    /**
     * Coordinate the reCAPTCHA solving process
     * Finds relevant frames and delegates to appropriate solver
     * @param {puppeteer.Page} page - Puppeteer page instance
     * @returns {Promise<boolean>} True if solving was successful
     */
    async solveRecaptcha(page) {
        this.logger.log(`reCAPTCHA found, attempting to solve with ${this.config.captchaSolver}...`);
        await this.sleep(2000);

        // Get all frames on the page to find reCAPTCHA-related ones
        const frames = await page.frames();

        // Find the checkbox/anchor frame (contains the "I'm not a robot" checkbox)
        const recaptchaFrame = frames.find(frame => {
            const url = frame.url();
            return url.includes('recaptcha') && (url.includes('anchor') || url.includes('checkbox'));
        });

        if (!recaptchaFrame) {
            this.logger.log('⚠️ reCAPTCHA checkbox frame not found – continuing process (possibly no CAPTCHA needed)');
            return true;
        }

        await this.sleep(1000);

        // Find the challenge frame (contains the actual challenge like image selection)
        const challengeFrame = frames.find(frame => {
            const url = frame.url();
            return url.includes('recaptcha') && (url.includes('bframe') || url.includes('challenge'));
        });

        if (challengeFrame) {
            this.logger.log(`Challenge detected, attempting to solve with ${this.config.captchaSolver}...`);

            let solved = false;

            // Delegate to appropriate solver based on configuration
            switch (this.config.captchaSolver) {
                case 'buster':
                    solved = await this.solveCaptchaWithBuster(page);
                    break;
                case 'nocaptcha':
                    solved = await this.solveCaptchaWithNoCaptcha(challengeFrame, page);
                    break;
                case 'manual':
                    this.logger.log('Manual solving required. Please solve the CAPTCHA manually.');
                    await this.sleep(60000); // Wait 60 seconds for manual solving
                    solved = true;
                    break;
            }

            if (solved) {
                await this.sleep(500);
                return await this.checkRecaptchaVerified(recaptchaFrame);
            }
        }

        return true;
    }

    /**
     * Click the reCAPTCHA checkbox using various selector strategies
     * @param {puppeteer.Frame} frame - The reCAPTCHA frame containing the checkbox
     * @returns {Promise<boolean>} True if checkbox was successfully clicked
     */
    async clickRecaptchaCheckbox(frame) {
        // Common selectors for the reCAPTCHA checkbox
        const checkboxSelectors = [
            '.recaptcha-checkbox-border',  // Border element of checkbox
            '.rc-anchor-checkbox',         // Main checkbox element
            '#recaptcha-anchor',          // Anchor element with ID
            '[role="checkbox"]'           // Generic checkbox role
        ];

        for (const selector of checkboxSelectors) {
            try {
                await frame.waitForSelector(selector, { timeout: 10000, visible: true });
                await frame.click(selector);
                this.logger.log(`Checkbox clicked using selector: ${selector}`);
                return true;
            } catch {
                continue; // Try next selector if this one fails
            }
        }
        return false;
    }

    /**
     * Check if reCAPTCHA has been successfully verified
     * @param {puppeteer.Frame} frame - The reCAPTCHA frame to check
     * @returns {Promise<boolean>} True if verification is confirmed
     */
    async checkRecaptchaVerified(frame) {
        // Selectors that indicate successful verification
        const verificationSelectors = [
            '.recaptcha-checkbox-checked',  // Checked state class
            '.rc-anchor-checkbox-checked',  // Alternative checked class
            '[aria-checked="true"]'         // Aria attribute indicating checked state
        ];

        for (const selector of verificationSelectors) {
            try {
                const element = await frame.$(selector);
                if (element) {
                    this.logger.log('reCAPTCHA verification confirmed');
                    return true;
                }
            } catch {
                continue;
            }
        }
        return false;
    }

    /**
     * Solve CAPTCHA using the Buster browser extension
     * Buster uses audio CAPTCHA solving and computer vision
     * @param {puppeteer.Page} page - Puppeteer page instance
     * @returns {Promise<boolean>} True if Buster successfully solved the CAPTCHA
     */
    async solveCaptchaWithBuster(page) {
        try {
            this.logger.log('Waiting for Buster extension...');

            // Wait for the challenge iframe (bframe) to appear on the main page
            const elementHandle = await page.waitForSelector('iframe[src*="bframe"]');

            // Get the frame content from the iframe element
            const challengeFrame = await elementHandle.contentFrame();

            if (!challengeFrame) {
                throw new Error('Could not get challenge iframe');
            }

            // Wait for the footer element to load (indicates frame is ready)
            await challengeFrame.waitForSelector('.rc-footer', { timeout: 15000 });

            // Wait for Buster to inject its solver button
            const solverButton = await this.waitForBusterButton(challengeFrame);

            if (solverButton) {
                await solverButton.click();
                this.logger.log('Clicked Buster button');
                await this.sleep(2000); // Wait for Buster to process
                return await this.verifyChallengeSolution(challengeFrame);
            }

            return false;
        } catch (error) {
            this.logger.log(`Buster solving error: ${error.message}`);
            return false;
        }
    }

    /**
     * Wait for Buster extension to inject its solver button
     * Uses multiple detection methods with retry logic
     * @param {puppeteer.Frame} challengeFrame - The challenge frame containing the CAPTCHA
     * @param {number} maxAttempts - Maximum number of attempts to find the button
     * @returns {Promise<puppeteer.ElementHandle|null>} Button element or null if not found
     */
    async waitForBusterButton(challengeFrame, maxAttempts = 15) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            await this.sleep(2000);

            try {
                // Ensure the footer is loaded before checking for Buster
                await challengeFrame.waitForSelector('.rc-footer', { timeout: 5000 });

                // Method 1: Try to access the shadow root directly
                // Buster injects content into shadow DOM of help button
                const busterButton = await challengeFrame.evaluate(() => {
                    const helpButtonHolder = document.querySelector('.button-holder.help-button-holder');
                    if (helpButtonHolder && helpButtonHolder.shadowRoot) {
                        const solverButton = helpButtonHolder.shadowRoot.querySelector('#solver-button');
                        if (solverButton) {
                            return solverButton;
                        }
                    }
                    return null;
                });

                if (busterButton) {
                    this.logger.log(`Buster button found in shadow root after ${attempt} attempts`);
                    return busterButton;
                }

                // Method 2: Check if help-button-holder has been modified by Buster
                const helpButtonHolder = await challengeFrame.$('.button-holder.help-button-holder');
                if (helpButtonHolder) {
                    // Check if the element has a shadow root or has been modified
                    const isModified = await helpButtonHolder.evaluate(el => {
                        // Check if shadow root exists
                        if (el.shadowRoot) {
                            return true;
                        }

                        // Check if the element has been modified (Buster sometimes adds content)
                        const hasContent = el.innerHTML.trim().length > 0;
                        const hasTabIndex = el.hasAttribute('tabindex');
                        const hasTitle = el.title && el.title.toLowerCase().includes('solve');

                        return hasContent || hasTabIndex || hasTitle;
                    });

                    if (isModified) {
                        this.logger.log(`Buster button detected in help-button-holder after ${attempt} attempts`);
                        return helpButtonHolder;
                    }
                }

                // Method 3: Fallback - look for any button with solver-related attributes
                const fallbackButton = await challengeFrame.$('#solver-button, button[id*="solver"], button[title*="solve"]');
                if (fallbackButton) {
                    const isVisible = await fallbackButton.evaluate(el => {
                        const rect = el.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0;
                    });

                    if (isVisible) {
                        this.logger.log(`Buster button found via fallback method after ${attempt} attempts`);
                        return fallbackButton;
                    }
                }

                this.logger.log(`Attempt ${attempt}/${maxAttempts}: Buster button not found`);

                // Debug logging every 5 attempts to help troubleshoot
                if (attempt % 5 === 0) {
                    try {
                        const debugInfo = await challengeFrame.evaluate(() => {
                            const helpHolder = document.querySelector('.button-holder.help-button-holder');
                            return {
                                helpHolderExists: !!helpHolder,
                                helpHolderHTML: helpHolder ? helpHolder.outerHTML.substring(0, 200) : 'N/A',
                                hasShadowRoot: helpHolder ? !!helpHolder.shadowRoot : false,
                                tabIndex: helpHolder ? helpHolder.getAttribute('tabindex') : 'N/A'
                            };
                        });
                        this.logger.log(`Debug info (attempt ${attempt}):`, JSON.stringify(debugInfo, null, 2));
                    } catch (debugError) {
                        this.logger.log(`Debug error: ${debugError.message}`);
                    }
                }

            } catch (error) {
                this.logger.log(`Error in attempt ${attempt}: ${error.message}`);
            }
        }

        this.logger.log('Buster button not found after all attempts');
        return null;
    }

    /**
     * Solve CAPTCHA using NoCaptcha AI extension
     * NoCaptcha AI automatically solves challenges when configured properly
     * @param {puppeteer.Frame} challengeFrame - The challenge frame
     * @param {puppeteer.Page} page - The main page
     * @returns {Promise<boolean>} True if NoCaptcha AI successfully solved
     */
    async solveCaptchaWithNoCaptcha(challengeFrame, page) {
        try {
            this.logger.log('NoCaptcha AI should auto-solve the challenge...');

            // Since we configured the extension to auto-solve, wait for it to work
            const maxWaitTime = this.config.nocaptchaSettings.maxWaitTime;
            const startTime = Date.now();
            let attempts = 0;
            const maxAttempts = this.config.nocaptchaSettings.retryAttempts;

            while (attempts < maxAttempts && (Date.now() - startTime) < maxWaitTime) {
                attempts++;
                this.logger.log(`Waiting for NoCaptcha AI to solve... (${attempts}/${maxAttempts})`);

                // Wait before checking (give NoCaptcha time to work)
                await this.sleep(10000);

                // Check if the challenge has been solved
                const isSolved = await this.checkNoCaptchaSolved(challengeFrame, page);
                if (isSolved) {
                    this.logger.log('NoCaptcha AI successfully solved the challenge');
                    return await this.verifyChallengeSolution(challengeFrame);
                }
            }

            this.logger.log('NoCaptcha AI solving timed out');
            return false;

        } catch (error) {
            this.logger.log(`NoCaptcha AI solving error: ${error.message}`);
            return false;
        }
    }

    /**
     * Check if NoCaptcha AI has solved the challenge
     * @param {puppeteer.Frame} challengeFrame - The challenge frame
     * @param {puppeteer.Page} page - The main page
     * @returns {Promise<boolean>} True if challenge appears to be solved
     */
    async checkNoCaptchaSolved(challengeFrame, page) {
        try {
            // Check if challenge frame is gone (indicates solving)
            const challengeFrames = await page.frames();
            const activeChallenge = challengeFrames.find(frame => {
                const url = frame.url();
                return url.includes('recaptcha') && url.includes('bframe');
            });

            if (!activeChallenge) {
                return true; // Challenge frame disappeared = solved
            }

            // Check for solved indicators in the challenge frame
            const solvedIndicators = [
                '.rc-anchor-checkbox-checked',  // Checkbox marked as checked
                '[aria-checked="true"]',        // Aria attribute indicating checked
                '.recaptcha-checkbox-checked'   // Alternative checked class
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

    /**
     * Verify that the challenge has been solved and click verify if needed
     * @param {puppeteer.Frame} challengeFrame - The challenge frame
     * @returns {Promise<boolean>} True if verification was successful
     */
    async verifyChallengeSolution(challengeFrame) {
        try {
            await this.sleep(3000); // Wait for UI to update

            // Look for the verify button
            const verifyButton = await challengeFrame.$('#recaptcha-verify-button');
            if (verifyButton) {
                const buttonText = await verifyButton.evaluate(el => el.textContent?.trim());
                const isEnabled = await verifyButton.evaluate(el => !el.disabled);

                // Click verify button if it's not "Skip" or if it's enabled
                if (buttonText !== 'Skip' || isEnabled) {
                    await verifyButton.click();
                    this.logger.log('Clicked verify button');
                    await this.sleep(2000);
                    return true;
                }
            }
            return true; // No verify button needed or verification complete
        } catch (error) {
            this.logger.log(`Verify check failed: ${error.message}`);
            return false;
        }
    }
}

module.exports = CaptchaHandler;