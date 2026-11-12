import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
/** Stop the actual origin server. This exercises offline cache fallback without
 * WebKit's context.setOffline navigation error masking the application's behavior. */
test('reopens and edits the saved solid after its HTTP server has stopped', async ({ page }) => {
  const root = resolve('dist'); let stopped = false;
  const server = createServer(async (req, res) => {
    try {
      const path = resolve(root, '.' + (new URL(req.url!, 'http://localhost').pathname === '/' ? '/index.html' : new URL(req.url!, 'http://localhost').pathname));
      if (!path.startsWith(root + '/')) { res.writeHead(403); res.end(); return; }
      const data = await readFile(path); const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
      res.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
      // Match real static servers' cross-origin request variance: module script
      // requests and service-worker precache requests send different headers.
      res.setHeader('Vary', 'Origin'); res.setHeader('Cache-Control', 'no-cache'); res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const port = (server.address() as { port: number }).port; const origin = `http://127.0.0.1:${port}`;
  try {
    await page.goto(origin); await expect(page.locator('#cad-root')).toHaveAttribute('data-state', 'ready');
    await page.getByRole('button', { name: 'Box', exact: true }).click(); await expect(page.locator('#cad-root')).toHaveAttribute('data-state', 'ready');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise<void>(r => navigator.serviceWorker.addEventListener('controllerchange', () => r(), { once: true })); });
    server.closeAllConnections(); await new Promise<void>((r, j) => server.close(e => e ? j(e) : r())); stopped = true;
    await expect(fetch(origin)).rejects.toThrow(); // Node has no service worker: the server really is unavailable.
    await page.reload(); await expect(page.locator('#cad-root')).toHaveAttribute('data-state', 'ready'); await expect(page.locator('[data-testid="object-name"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Sphere', exact: true }).click(); await expect(page.locator('#cad-root')).toHaveAttribute('data-state', 'ready'); await expect(page.locator('[data-testid="object-name"]')).toHaveCount(2);
  } finally { if (!stopped) { server.closeAllConnections(); server.close(); } }
});
