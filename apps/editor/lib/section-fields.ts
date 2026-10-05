const SHAPE_SHOWS: Record<string, string> = {
  title: 'the page title and date',
  prose: 'the body',
  hero: 'hero with kicker, lede, and image',
  cards: 'cards items with href, title, text, and image',
  band: 'band with title, text, href, and label, and stays hidden without band.title',
  pictures: 'images items with src and caption',
  email: 'email as an address',
  'picture-groups': 'groups items with src, href, and label',
  'link-groups': 'groups links with href, label, and image',
  news: 'site news, not a page field',
  upcoming: 'site events, not a page field',
}

const SHAPE_KEYS: Record<string, string[]> = {
  hero: ['hero'],
  cards: ['cards'],
  band: ['band'],
  pictures: ['images'],
  email: ['email'],
  'picture-groups': ['groups'],
  'link-groups': ['groups'],
}

export function sectionListNote(shapes: string[], templatePath: string | null): string {
  const lines = shapes.map((shape) => `${shape} shows ${SHAPE_SHOWS[shape] ?? 'a shape the kit does not draw'}`)
  const shown = `This section list shows:\n${lines.join('\n')}`
  if (!templatePath) return shown
  return `${shown}\nThe private template ${templatePath} is what renders.`
}

export function unusedFieldNote(shapes: string[], fields: Record<string, unknown>): string {
  const shown = new Set(shapes.flatMap((shape) => SHAPE_KEYS[shape] ?? []))
  const unused = Object.keys(fields).filter((key) => !shown.has(key))
  if (unused.length === 0) return ''
  return unused
    .map((key) => {
      const aimed = aim(key, shapes)
      if (aimed) return `${key} is not shown. Use ${aimed}.`
      const list = [...shown]
      if (list.length === 0) return `${key} is not shown. This layout shows the title and the body.`
      return `${key} is not shown. This layout shows ${list.join(' and ')}.`
    })
    .join(' ')
}

function aim(key: string, shapes: string[]): string | null {
  if (shapes.includes('pictures') && key !== 'images' && /picture|image/i.test(key)) return 'images for the pictures section'
  if (shapes.includes('email') && key !== 'email' && /email/i.test(key)) return 'email for the email section'
  if (shapes.includes('hero') && key !== 'hero' && /hero|kicker|lede/i.test(key)) return 'hero for the hero section'
  if (shapes.includes('cards') && key !== 'cards' && /card/i.test(key)) return 'cards for the cards section'
  if (shapes.includes('band') && key !== 'band' && /band/i.test(key)) return 'band for the band section'
  if ((shapes.includes('picture-groups') || shapes.includes('link-groups')) && key !== 'groups' && /group/i.test(key)) {
    return 'groups'
  }
  return null
}
