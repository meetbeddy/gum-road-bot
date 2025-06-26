class CaptchaHandler {
    constructor(config, logger, sleepFn) {
        this.config = config;
        this.logger = logger;
        this.sleep = sleepFn;
    }

    async handleRecaptcha(page) {
        try {
            this.logger.log('Checking for reCAPTCHA...');
            await this.sleep(1000);

            const recaptchaSelectors = [
                'iframe[src*="recaptcha"]',
                'iframe[name^="a-"][src^="https://www.google.com/recaptcha"]',
                '.g-recaptcha',
                '.rc-anchor'
            ];

            const recaptchaFound = await this.detectRecaptcha(page, recaptchaSelectors);
            if (!recaptchaFound) {
                this.logger.log('No reCAPTCHA detected');
                return true;
            }

            return await this.solveRecaptcha(page);
        } catch (error) {
            this.logger.log(`reCAPTCHA handling failed: ${error.message}`);

            if (this.config.captchaSolver === 'manual') {
                this.logger.log('Manual CAPTCHA solving required. Waiting 60 seconds...');
                await this.sleep(60000);
                return true;
            }
            return false;
        }
    }

    async detectRecaptcha(page, selectors) {
        for (const selector of selectors) {
            try {
                const element = await page.$(selector);
                if (element) {
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
                continue;
            }
        }
        return false;
    }

    async solveRecaptcha(page) {
        this.logger.log(`reCAPTCHA found, attempting to solve with ${this.config.captchaSolver}...`);
        await this.sleep(2000);

        const frames = await page.frames();

        const recaptchaFrame = frames.find(frame => {
            const url = frame.url();
            return url.includes('recaptcha') && (url.includes('anchor') || url.includes('checkbox'));
        });

        if (!recaptchaFrame) {
            this.logger.log('⚠️ reCAPTCHA checkbox frame not found – continuing process (possibly no CAPTCHA needed)');
            return true;
        }

        await this.sleep(1000);

        const challengeFrame = frames.find(frame => {
            const url = frame.url();
            return url.includes('recaptcha') && (url.includes('bframe') || url.includes('challenge'));
        });

        if (challengeFrame) {
            this.logger.log(`Challenge detected, attempting to solve with ${this.config.captchaSolver}...`);

            let solved = false;

            switch (this.config.captchaSolver) {
                case 'buster':
                    solved = await this.solveCaptchaWithBuster(page);
                    break;
                case 'nocaptcha':
                    solved = await this.solveCaptchaWithNoCaptcha(challengeFrame, page);
                    break;
                case 'manual':
                    this.logger.log('Manual solving required. Please solve the CAPTCHA manually.');
                    await this.sleep(60000);
                    solved = true;
                    break;
            }

            this.logger.log(`CAPTCHA SOLVED STATUS: ${solved}`);
            return solved;

            // if (solved) {
            //     await this.sleep(500);
            //     return await this.checkRecaptchaVerified(recaptchaFrame);
            // }
        }

        return true;
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
                this.logger.log(`Checkbox clicked using selector: ${selector}`);
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
                    this.logger.log('reCAPTCHA verification confirmed');
                    return true;
                }
            } catch {
                continue;
            }
        }
        return false;
    }

    async solveCaptchaWithBuster(page) {
        try {
            this.logger.log('Waiting for Buster extension...');

            const elementHandle = await page.waitForSelector('iframe[src*="bframe"]');
            const challengeFrame = await elementHandle.contentFrame();

            if (!challengeFrame) {
                throw new Error('Could not get challenge iframe');
            }

            await challengeFrame.waitForSelector('.rc-footer', { timeout: 15000 });

            const solverButton = await this.waitForBusterButton(challengeFrame);

            if (solverButton) {
                await solverButton.click();
                this.logger.log('Clicked Buster button');
                await this.sleep(2000);
                return await this.verifyChallengeSolution(challengeFrame);
            }

            return false;
        } catch (error) {
            this.logger.log(`Buster solving error: ${error.message}`);
            return false;
        }
    }

    async waitForBusterButton(challengeFrame, maxAttempts = 15) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            await this.sleep(2000);

            try {
                await challengeFrame.waitForSelector('.rc-footer', { timeout: 5000 });

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

                const helpButtonHolder = await challengeFrame.$('.button-holder.help-button-holder');
                if (helpButtonHolder) {
                    const isModified = await helpButtonHolder.evaluate(el => {
                        if (el.shadowRoot) return true;
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

    async solveCaptchaWithNoCaptcha(challengeFrame, page) {
        try {
            this.logger.log('NoCaptcha AI should auto-solve the challenge...');

            const maxWaitTime = this.config.nocaptchaSettings.maxWaitTime;
            const startTime = Date.now();
            let attempts = 0;
            const maxAttempts = this.config.nocaptchaSettings.retryAttempts;

            while (attempts < maxAttempts && (Date.now() - startTime) < maxWaitTime) {
                attempts++;
                this.logger.log(`Waiting for NoCaptcha AI to solve... (${attempts}/${maxAttempts})`);
                await this.sleep(10000);

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

    async checkNoCaptchaSolved(challengeFrame, page) {
        try {
            const challengeFrames = await page.frames();
            const activeChallenge = challengeFrames.find(frame => {
                const url = frame.url();
                return url.includes('recaptcha') && url.includes('bframe');
            });

            if (!activeChallenge) {
                return true;
            }

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
                    this.logger.log('Clicked verify button');
                    await this.sleep(2000);
                    return true;
                }
            }
            return true;
        } catch (error) {
            this.logger.log(`Verify check failed: ${error.message}`);
            return false;
        }
    }
}

module.exports = CaptchaHandler;
