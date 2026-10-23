import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { initSite, readSiteConfig } from '@schlor/generator'
import { designContentRefusal } from './layout-guard'
import { toolsFor } from './tools'

const call = { toolCallId: 'asset', messages: [] as never[] }

function site() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-assets-'))
  initSite(root)
  fs.writeFileSync(path.join(root, 'media', 'logo-320.webp'), 'webp')
  return root
}

test('set_asset gives the site a named picture, shows it in the header, and removes it again', async () => {
  const root = site()
  const tools = toolsFor('edit', root)
  const result = String(await tools.set_asset.execute!({ name: 'logo', picture: '/media/logo-320.webp' }, call))
  assert.match(result, /Set asset logo to \/media\/logo-320\.webp/)
  assert.match(result, /\{\{ assets\.logo \}\}/)
  assert.deepEqual(readSiteConfig(root).assets, { logo: '/media/logo-320.webp' })
  assert.match(fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8'), /<img[^>]+src="\/media\/logo-320\.webp"/)
  assert.match(fs.readFileSync(path.join(root, 'design', 'site.yml'), 'utf8'), /name:/)
  assert.match(String(await tools.set_asset.execute!({ name: 'logo' }, call)), /Removed asset logo/)
  assert.deepEqual(readSiteConfig(root).assets, {})
  assert.equal(fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8').includes('logo-320'), false)
})

test('set_asset refuses a picture that is not in the site, a bad name, and an asset that is not there', async () => {
  const root = site()
  const tools = toolsFor('edit', root)
  await assert.rejects(() => tools.set_asset.execute!({ name: 'logo', picture: '/media/fehlt.png' }, call), /not in this site\. Save the picture with save_picture first/)
  await assert.rejects(() => tools.set_asset.execute!({ name: 'Big Logo', picture: '/media/logo-320.webp' }, call), /name must be lowercase/)
  await assert.rejects(() => tools.set_asset.execute!({ name: 'logo' }, call), /There is no asset logo/)
})

test('the guard says where a picture of the whole site goes', () => {
  const refusal = designContentRefusal('shell.njk', '<img src="/media/logo.png" alt="">', [])
  assert.match(refusal ?? '', /site asset/)
  assert.match(refusal ?? '', /set_asset/)
  assert.match(refusal ?? '', /\{\{ assets\.name \}\}/)
  assert.equal(designContentRefusal('shell.njk', '<img src="{{ assets.logo }}" alt="{{ name }}">', []), null)
  assert.equal(designContentRefusal('styles.css', '.hero { background-image: var(--asset-pattern); }', []), null)
})

test('check_design names an asset whose picture is gone', async () => {
  const root = site()
  const tools = toolsFor('edit', root)
  await tools.set_asset.execute!({ name: 'logo', picture: '/media/logo-320.webp' }, call)
  fs.rmSync(path.join(root, 'media', 'logo-320.webp'))
  assert.match(String(await tools.check_design.execute!({}, call)), /design\/site\.yml assets\.logo: \/media\/logo-320\.webp is not in this site/)
})
