import type { Page } from 'playwright-core'

// Runs inside the page. These are strings, not functions, so a build step cannot rewrite them.
const VISIBLE = `(el) => {
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.right <= 0) return false
  if (getComputedStyle(el).visibility !== 'visible') return false
  // Opacity does not inherit, but it hides everything inside: the product up the tree is what a reader sees.
  let opacity = 1
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (style.display === 'none') return false
    opacity *= parseFloat(style.opacity)
  }
  return opacity > 0.05
}`

// Finds the links of a navigation that are not shown, and for each the entry that is shown in the same group:
// the one a person would hover to reach it. Each pair is marked on the elements so that the check can find them again.
const SCAN = `(() => {
  const visible = ${VISIBLE}
  const label = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40)
  const groups = new Map()
  let next = 0
  for (const nav of document.querySelectorAll('nav, [role="navigation"]')) {
    if (nav.closest('footer')) continue
    if (!visible(nav) && !nav.querySelector('a[href]')) continue
    for (const link of nav.querySelectorAll('a[href]')) {
      if (visible(link)) continue
      // The entry to hover is the shown link, button or summary in the smallest group around the hidden link.
      // The group is below the navigation itself: a hidden link next to shown ones is not a sub-entry.
      let group = link.parentElement
      let trigger = null
      while (group && group !== nav) {
        trigger = [...group.querySelectorAll('a[href], button, summary')].find((el) => el !== link && !link.contains(el) && visible(el)) || null
        if (trigger) break
        group = group.parentElement
      }
      if (!trigger) continue
      let id = trigger.getAttribute('data-menu-trigger')
      if (!id) {
        id = String(next++)
        trigger.setAttribute('data-menu-trigger', id)
        groups.set(id, { trigger: label(trigger), tag: trigger.tagName.toLowerCase(), links: [] })
      }
      link.setAttribute('data-menu-hidden', id)
      groups.get(id).links.push(label(link))
    }
  }
  return [...groups.entries()].map(([id, group]) => ({ id, ...group }))
})()`

const SHOWN = (id: string) => `(() => {
  const visible = ${VISIBLE}
  return [...document.querySelectorAll('[data-menu-hidden="${id}"]')].some(visible)
})()`

export type MenuGroup = { id: string; trigger: string; tag: string; links: string[] }

/**
 * A menu with sub-entries: each entry that hides links is hovered, and then focused, and the links must show.
 * An entry that is a button or a summary may open on a click instead. The sentences are for the agent.
 */
export async function checkMenu(page: Page): Promise<string[]> {
  const groups = ((await page.evaluate(SCAN).catch(() => [])) as MenuGroup[]).slice(0, 12)
  const findings: string[] = []
  for (const group of groups) {
    const selector = `[data-menu-trigger="${group.id}"]`
    const shown = async () => {
      await page.waitForTimeout(300)
      return Boolean(await page.evaluate(SHOWN(group.id)).catch(() => false))
    }
    await page.hover(selector, { timeout: 2_000 }).catch(() => undefined)
    if (await shown()) {
      await page.mouse.move(0, 0)
      continue
    }
    await page.mouse.move(0, 0)
    await page.focus(selector, { timeout: 2_000 }).catch(() => undefined)
    const onFocus = await shown()
    await page.evaluate('document.activeElement && document.activeElement.blur()').catch(() => undefined)
    let onClick = false
    if (!onFocus && group.tag !== 'a') {
      await page.click(selector, { timeout: 2_000 }).catch(() => undefined)
      onClick = await shown()
    }
    const names = `${group.links.slice(0, 4).join(', ')}${group.links.length > 4 ? ` and ${group.links.length - 4} more` : ''}`
    if (onClick) continue
    if (onFocus) findings.push(`The sub-links of the menu entry “${group.trigger}” (${names}) open on keyboard focus but not when the entry is hovered. Open them on hover too.`)
    else findings.push(`The sub-links of the menu entry “${group.trigger}” (${names}) stay hidden when the entry is hovered or focused at desktop width. Show them on :hover and :focus-within, and as a list on a phone.`)
  }
  return findings
}
