import { launchBrowser } from './browser.mjs';

try {
  const { browser } = await launchBrowser(process.argv[2]);
  await browser.close();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
