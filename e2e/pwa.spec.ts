import { expect, test } from './support/fixtures.ts'

test('Chrome recognizes the app as installable with valid standalone metadata and icons', async ({
  page,
  context,
}) => {
  await page.goto('/login')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'crossorigin',
    'use-credentials',
  )
  const cdp = await context.newCDPSession(page)
  const manifest = await cdp.send('Page.getAppManifest')
  expect(manifest.errors).toEqual([])
  expect(manifest.url).toContain('/manifest.webmanifest')
  await expect(async () => {
    expect((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors).toEqual([])
  }).toPass({ timeout: 10_000 })
  const response = await context.request.get('/manifest.webmanifest')
  expect(response.headers()['content-type']).toContain('application/manifest+json')
  const metadata = (await response.json()) as {
    id: string
    name: string
    start_url: string
    scope: string
    display: string
    icons: { src: string; sizes: string; type: string }[]
  }
  expect(metadata).toMatchObject({
    id: '/',
    name: 'Facilities Kanban',
    start_url: '/',
    scope: '/',
    display: 'standalone',
  })
  expect(metadata.icons.map((icon) => icon.sizes)).toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  )
  for (const icon of metadata.icons) {
    const image = await context.request.get(icon.src)
    expect(image.headers()['content-type']).toContain('image/png')
    const png = await image.body()
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    // PNG IHDR dimensions must match the sizes advertised to Chrome.
    expect(`${String(png.readUInt32BE(16))}x${String(png.readUInt32BE(20))}`).toBe(icon.sizes)
  }
})
