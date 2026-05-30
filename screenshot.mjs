import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 1440, height: 900 });

const BASE = 'http://localhost:3002';

// landing
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/screenshots/01_landing.png' });
console.log('landing done');

// enter app
await page.click('button:has-text("Launch Dashboard")');
await page.waitForTimeout(900);
await page.screenshot({ path: '/tmp/screenshots/02_dashboard.png' });
console.log('dashboard done');

// competitors - wait for load
await page.click('button:has-text("Competitors")');
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/screenshots/03_competitors.png' });
console.log('competitors done');

// accounts
await page.click('button:has-text("Accounts")');
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/screenshots/04_accounts.png' });
console.log('accounts done');

// alerts
await page.click('button:has-text("Alerts")');
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/screenshots/05_alerts.png' });
console.log('alerts done');

// settings
await page.click('button:has-text("Settings")');
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/screenshots/06_settings.png' });
console.log('settings done');

await browser.close();
console.log('ALL DONE');
