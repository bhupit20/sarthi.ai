// End-to-end: the real Electron app on a (virtual) display, the real audio
// pipeline (voice detector + Whisper) on a recorded voice, and stand-in AI
// replies. Run: npm run e2e   (on Linux: xvfb-run -a npm run e2e)
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const out = resolve('e2e-out');
mkdirSync(out, { recursive: true });

// The speech model is fetched once with Node (which uses the network proxy),
// then served to the app locally.
const models = join(out, 'models');
if (!existsSync(join(models, 'onnx-community/whisper-base.en/config.json'))) {
  console.log('downloading the speech model for the test…');
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { pipeline, env } from '@huggingface/transformers';
    env.cacheDir = ${JSON.stringify(models)};
    await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base.en', { dtype: 'q8' });
  `], { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
}

let failed = false;
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failed = true;
};

const app = await electron.launch({
  executablePath: resolve('node_modules/electron/dist/electron'),
  args: [resolve('.'), '--no-sandbox'],
  env: {
    ...process.env,
    SARTHI_TEST: '1',
    SARTHI_USER_DATA: mkdtempSync(join(tmpdir(), 'sarthi-')),
    SARTHI_TEST_CALL_AUDIO: resolve('tests/fixtures/jfk-16k.wav'),
    SARTHI_TEST_MODELS: models,
  },
});

const errors = [];
const byUrl = async (part) => {
  for (let i = 0; i < 50; i++) {
    const w = app.windows().find((p) => p.url().includes(part));
    if (w) return w;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no window ${part}`);
};
const shot = async (name) => {
  const png = await app.evaluate(async ({ BrowserWindow }, part) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes(part));
    return (await w.webContents.capturePage()).toPNG().toString('base64');
  }, name.startsWith('copilot') ? 'copilot' : 'dashboard');
  writeFileSync(join(out, `${name}.png`), Buffer.from(png, 'base64'));
};
const sizeWindow = (part, width, height) =>
  app.evaluate(({ BrowserWindow }, [p, w, h]) => {
    const win = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes(p));
    win.setMinimumSize(300, 300);
    win.setSize(w, h);
  }, [part, width, height]);
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

try {
  const dash = await byUrl('dashboard');
  const copilot = await byUrl('copilot');
  for (const p of [dash, copilot]) {
    p.on('pageerror', (e) => errors.push(String(e)));
    p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  }
  dash.setDefaultTimeout(15000);
  copilot.setDefaultTimeout(15000);
  await dash.getByRole('heading', { name: /Good (morning|afternoon|evening)/ }).waitFor();
  check(true, 'dashboard opens on Home');

  const flags = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({ url: w.webContents.getURL(), onTop: w.isAlwaysOnTop() })),
  );
  check(flags.find((f) => f.url.includes('copilot'))?.onTop === true, 'copilot window floats above other apps');

  // Settings: save a key (stand-in AI in tests) and only listen to the call.
  await dash.getByRole('button', { name: 'Settings' }).click();
  await dash.getByLabel('NVIDIA API key').fill('test-key');
  await dash.getByLabel('NVIDIA API key').press('Enter');
  await dash.getByText('Saved in your Keychain.').first().waitFor();
  check((await dash.getByLabel('NVIDIA API key').inputValue()) === '', 'a saved key is not shown again');
  check((await dash.getByLabel('Live replies provider').inputValue()) === 'nvidia', 'the first key is used for live replies');
  await dash.getByLabel(/Listen to my microphone/).uncheck();
  await dash.getByLabel('About me').fill('I build Shopify stores. A standard store is $900.');
  await sizeWindow('dashboard', 1280, 820);
  await shot('settings-1280');
  check(await fits(dash), 'Settings fits 1280px');

  // Start a session: the recording plays as the client.
  await dash.getByRole('button', { name: 'Home' }).click();
  await dash.getByLabel('Who is the call with?').selectOption('__new__');
  await dash.getByLabel('New client name').fill('Acme Co');
  await dash.getByRole('button', { name: 'Start listening' }).click();
  await dash.getByRole('heading', { name: 'Live with Acme Co' }).waitFor();
  check(true, 'a session starts for a new client');

  const started = Date.now();
  await dash.locator('.client-said').filter({ hasText: /ask not what your country can do for you/i }).waitFor({ timeout: 120000 });
  check(true, `the client's words were heard and transcribed on the computer (${Math.round((Date.now() - started) / 1000)} s incl. model load)`);
  const said = await dash.locator('.client-said').innerText();
  console.log('     heard:', JSON.stringify(said));
  await dash.getByText('Sure, I can have it ready by Friday.').waitFor();
  check(true, 'replies appear automatically on the Live page');

  // The copilot mirrors the session.
  await copilot.getByText('Sure, I can have it ready by Friday.').waitFor();
  check(true, 'the copilot shows the same replies');
  await copilot.getByRole('button', { name: /Suggest now/ }).click();
  await copilot.getByText('Writing…').first().waitFor({ timeout: 5000 }).catch(() => {});
  await copilot.getByText('Sure, I can have it ready by Friday.').waitFor();
  check(true, 'Suggest now from the copilot asks again');
  await copilot.getByLabel('Your answer in Hindi or English').fill('हाँ, शुक्रवार तक दे दूंगा');
  await copilot.getByLabel('Your answer in Hindi or English').press('Enter');
  await copilot.getByText('We can deliver it by Friday, with two free revisions.').waitFor();
  check(true, 'a Hindi answer typed in the copilot comes back in English');

  for (const width of [320, 400]) {
    await sizeWindow('copilot', width, 660);
    await copilot.waitForTimeout(200);
    const ok = await fits(copilot);
    if (!ok) {
      console.log('     too wide:', await copilot.evaluate(() => [...document.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
        .slice(0, 6).map((el) => `${el.tagName}.${el.className} ${Math.round(el.getBoundingClientRect().right)}`)));
    }
    check(ok, `copilot fits ${width}px without sideways scrolling`);
  }
  await shot('copilot-live');
  for (const width of [900, 1280]) {
    await sizeWindow('dashboard', width, 820);
    await dash.waitForTimeout(200);
    check(await fits(dash), `Live page fits ${width}px without sideways scrolling`);
  }
  await shot('live-1280');

  // End the session from the copilot.
  await copilot.getByRole('button', { name: 'End meeting' }).click();
  await dash.getByRole('heading', { name: 'Session saved' }).waitFor({ timeout: 30000 });
  check(await dash.getByText('First version by Friday').isVisible(), 'the summary is shown after the session');
  check(await dash.getByText('I can have it ready by Friday.').isVisible(), 'phrases to practise are shown');
  await shot('saved-1280');
  await dash.getByRole('button', { name: 'Done' }).click();

  await dash.getByRole('button', { name: 'Clients', exact: true }).click();
  await dash.getByRole('button', { name: /Acme Co/ }).waitFor();
  check(await dash.getByText(/1 meeting/).isVisible(), 'the client keeps the session');
  await shot('clients-1280');
  await dash.getByRole('button', { name: 'Home', exact: true }).click();
  await dash.getByText('Recent sessions').waitFor();
  await dash.waitForTimeout(500);
  await shot('home-1280');
  for (const width of [900, 1280]) {
    await sizeWindow('dashboard', width, 820);
    await dash.waitForTimeout(200);
    check(await fits(dash), `Home fits ${width}px without sideways scrolling`);
  }
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (error) {
  console.log('FAIL', String(error.message ?? error).split('\n')[0]);
  failed = true;
  await shot('failure-dashboard').catch(() => {});
  await shot('copilot-failure').catch(() => {});
  console.log('page errors:', errors.slice(0, 5));
} finally {
  await app.close();
}
process.exit(failed ? 1 : 0);
