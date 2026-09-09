import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const out = new URL('../audit-artifacts/hardening/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const errors = [];
try {
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
 await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
 const page = await context.newPage();
 page.on('pageerror', error => errors.push(error.message));
 for (const width of [1024, 1280, 1440]) {
  await page.setViewportSize({ width, height: 1000 });
  for (const [route, ready] of [['operations', '.operations-rules-link'], ['campaigns/automations', '.automation-hub-table']]) {
   await page.goto(`http://127.0.0.1:5187/${route}`);
   await page.locator(ready).waitFor();
   await expect(page.getByText('Envíos pausados por el equipo', {exact:true})).toBeVisible();
   await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
   await page.screenshot({ path: `${out}/${route.replaceAll('/', '-')}-${width}.png`, fullPage: true });
  }
 }
 await expect(page.getByRole('button', {name:'Nueva campaña',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Configurar Recuperación de carritos',exact:true}).click();
 await expect(page).toHaveURL(/campaigns\/abandoned-carts/);
 for (const route of ['operations', 'campaigns/automations']) {
  await page.goto(`http://127.0.0.1:5187/${route}`);
  await expect(page.getByText('Envíos pausados por el equipo', {exact:true})).toBeVisible();
  if (!await page.locator('html').evaluate(e=>e.classList.contains('dark'))) await page.getByRole('button',{name:/modo oscuro/i}).click();
  // Wait for the theme's CSS transitions before taking the reference image.
  await page.waitForTimeout(700);
  if (route === 'operations') await expect(page.locator('.operations-rules-link button')).toHaveCSS('background-color','rgb(23, 27, 35)');
  await page.screenshot({ path: `${out}/${route.replaceAll('/', '-')}-dark.png`, fullPage: true });
 }
 await context.route('**/api/campaigns/abandoned-cart-automation/settings', route => route.fulfill({status:503,json:{error:'Demo unavailable'}}));
 await page.goto('http://127.0.0.1:5187/campaigns/automations');
 await expect(page.getByRole('button',{name:'Reintentar Recuperación de carritos'})).toBeVisible({timeout:20000});
 await expect(page.getByRole('row').filter({hasText:'Recuperación de carritos'}).getByText('Sin verificar',{exact:true})).toHaveCount(2);
 await expect(page.getByRole('button',{name:'Configurar Recordatorios de pago'})).toBeEnabled();
 await page.screenshot({path:`${out}/automations-error.png`,fullPage:true});
 await page.goto('http://127.0.0.1:5187/campaigns/results?campaign=does-not-exist&period=30');
 await expect(page.getByRole('heading',{name:'No pudimos abrir esa campaña'})).toBeVisible();
 await expect(page).toHaveURL(/campaign=does-not-exist/);
 await page.getByRole('button',{name:'90 días',exact:true}).click();
 await expect(page).toHaveURL(/period=90/);
 await expect(page).toHaveURL(/campaign=does-not-exist/);
 await page.reload();
 await expect(page.getByRole('button',{name:'90 días',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByText('Historial · últimos 90 días',{exact:true})).toBeVisible();
 await context.route('**/api/campaigns/stats?*',route=>route.fulfill({status:200,json:{sentRecipientsCount:0,deliveredRecipientsCount:0,purchasedRecipients:0,attributedRevenue:0,attributedCurrency:'ARS'}}));
 await page.goto('http://127.0.0.1:5187/campaigns/results');
 await expect(page.getByText('0 de 0 enviados',{exact:true})).toBeVisible();
 await expect(page.locator('.campaign-os-result-summary').getByText('0',{exact:true})).toBeVisible();
 await page.screenshot({path:`${out}/results-zero.png`,fullPage:true});
 await page.goto('http://127.0.0.1:5187/analytics');
 await page.getByRole('button',{name:'7 días',exact:true}).click();
 await expect(page.getByRole('button',{name:'7 días',exact:true})).toHaveAttribute('aria-pressed','true');
 const readRow=page.locator('.analytics-v2-progress-row').filter({has:page.getByText('Leídos',{exact:true})});
 const label=await readRow.locator('.analytics-v2-progress-track').getAttribute('aria-label');
 const helper=await readRow.locator('small').innerText();
 if (!helper.includes(label.replace('Leídos: ',''))) throw new Error('Read percentage denominator mismatch');
 const guest=await browser.newContext({viewport:{width:1440,height:1000}});
 await guest.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.hostname!=='127.0.0.1')return route.abort();
  if(url.pathname==='/api/auth/me')return route.fulfill({status:200,json:{user:null}});
  if(url.pathname==='/api/auth/login')return route.fulfill({status:503,json:{error:'API no disponible (demo)'}});
  return route.continue();
 });
 const login=await guest.newPage();
 await login.goto('http://127.0.0.1:5187/login');
 await login.getByLabel('Email',{exact:true}).fill('cliente-demo@example.com');
 await login.getByLabel('Contraseña',{exact:true}).fill('Only-demo-not-a-real-password');
 await login.locator('form').getByRole('button',{name:'Ingresar',exact:true}).click();
 await expect(login.locator('#login-error')).toBeVisible();
 await expect(login.locator('#login-email')).toHaveAttribute('aria-invalid','false');
 await expect(login.locator('#login-password')).toHaveAttribute('aria-invalid','false');
 await login.screenshot({path:`${out}/login-api-error.png`,fullPage:true});
 if (errors.length) throw new Error(errors.join('\n'));
 console.log('PASS: selected campaign preserved, filters survive reload, zero metrics, read denominators, API failure does not invalidate credentials.');
 console.log('PASS: 3 desktop widths, light/dark, paused state, isolated read errors, correct configuration route; no JS errors.');
} finally { await browser.close(); }
