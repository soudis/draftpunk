import type { ToolSet } from 'ai'
import { z } from 'zod'
import { editSvg, extractSvg, fitSvg, generate, outlineSvg } from '@schlor/generator'
import { browserConfigured } from './browser'
import { MAX_HTML, renderGraphic } from './graphic'
import { potraceAvailable, tracePicture } from './picture-trace'
import { editRaster, OPERATIONS, pictureForModel, visibleBounds, type PictureOp } from './picture-edit'
import { detectPicture, noteMadeFrom, readPicture, readPictureBytes, stemFromFilename, storePicture, type PictureKind, type PictureRecord } from './pictures'
import { screenshotMarker, ScreenshotStore } from './screenshots'
import { defineTool, fail } from './tool-kit'
import type { ToolOptions } from './tools'

const MAX_STEPS = 12
const MAX_SVG_CHARS = 200_000

const percent = (text: string) => z.number().optional().describe(text)

const operation = z.object({
  op: z.enum(OPERATIONS),
  x: percent('crop: left edge. Percent of the picture, or pixels when unit is px.'),
  y: percent('crop: top edge.'),
  width: percent('crop: width. resize: pixels.'),
  height: percent('crop: height. resize: pixels.'),
  unit: z.enum(['percent', 'px']).optional().describe('crop: percent (default) or px.'),
  fit: z.enum(['cover', 'contain', 'inside', 'fill']).optional().describe('resize: cover (default, crops to fill), contain (adds a margin), inside (keeps all, never larger), fill (stretches).'),
  color: z.string().optional().describe('make_transparent: the colour to remove, #rrggbb, or auto for the colour at the top left corner (default #ffffff). tint, background: the colour.'),
  tolerance: percent('make_transparent: how far from the colour still counts, 0 to 60 (default 12).'),
  feather: percent('make_transparent: softness of the edge, 0 to 30 (default 8).'),
  contiguous: z.boolean().optional().describe('make_transparent: true (default) removes only the part joined to the edge, so the white inside a letter stays. false removes the colour everywhere.'),
  degrees: percent('rotate: -360 to 360.'),
  axis: z.enum(['horizontal', 'vertical']).optional().describe('flip: horizontal mirrors left to right.'),
  shape: z.enum(['circle', 'rounded']).optional().describe('mask: circle (cuts the largest centred circle, default) or rounded corners.'),
  radius: percent('mask rounded: corner radius, percent of the shorter side (default 12).'),
  sigma: percent('blur: strength 0.3 to 100 (default 3).'),
  brightness: percent('adjust: 1 is unchanged, 1.2 brighter.'),
  saturation: percent('adjust: 1 is unchanged, 0 is gray.'),
  hue: percent('adjust: degrees to turn the hue.'),
  contrast: percent('adjust: 1 is unchanged, 1.3 more contrast.'),
  top: percent('pad: pixels added above.'),
  right: percent('pad: pixels added right.'),
  bottom: percent('pad: pixels added below.'),
  left: percent('pad: pixels added left.'),
  background: z.string().optional().describe('pad, resize contain, rotate: the colour of the new area, #rrggbb or transparent (default).'),
  threshold: percent('trim: how different a border may be and still be trimmed, 0 to 100 (default 10).'),
})

const svgEdit = z.object({
  op: z.enum(['recolor', 'remove', 'set', 'viewbox']),
  from: z.string().optional().describe('recolor: the colour to replace, #rrggbb, rgb(..) or a name; * for every colour.'),
  to: z.string().optional().describe('recolor: the new colour, #rrggbb.'),
  select: z.array(z.string()).optional().describe('Elements: @12, @12-20, #id, .class or a tag such as path. recolor and set: leave out for the whole drawing (set: the svg element).'),
  attr: z.string().optional().describe('set: fill, stroke, stroke-width, opacity, fill-opacity, stroke-opacity, transform, width, height, viewBox, preserveAspectRatio, class, id, display or visibility.'),
  value: z.string().optional().describe('set: the new value.'),
  x: z.number().optional().describe('viewbox: left, in the drawing\'s own units.'),
  y: z.number().optional().describe('viewbox: top.'),
  width: z.number().optional().describe('viewbox: width.'),
  height: z.number().optional().describe('viewbox: height.'),
})

function kindOf(bytes: Uint8Array): PictureKind {
  const kind = detectPicture(bytes)
  if (!kind) fail('That file is not a JPEG, PNG, WebP, GIF, or SVG.')
  return kind
}

const nameFor = (record: PictureRecord, name: string | undefined, suffix: string) => stemFromFilename(name?.trim() || `${record.file.replace(/\.[^.]+$/, '').replaceAll('/', '-')}-${suffix}`)

export function pictureTools(root: string, options: ToolOptions = {}): ToolSet {
  const screenshots = options.screenshots ?? new ScreenshotStore()

  const open = (file: string) => {
    const record = readPicture(root, file)
    const { bytes } = readPictureBytes(root, record.file)
    return { record, bytes, kind: kindOf(bytes) }
  }
  const openSvg = (file: string) => {
    const found = open(file)
    if (found.kind !== 'svg') fail(`${found.record.address} is not an SVG. Use look_at_picture and edit_picture for a ${found.kind.toUpperCase()}, or trace_picture to make an SVG of it.`)
    return { ...found, text: new TextDecoder().decode(found.bytes) }
  }
  /** The picture in front of the model for the next step, when it can look. */
  const show = async (bytes: Uint8Array, kind: PictureKind, grid = false, region?: { x: number; y: number; width: number; height: number }): Promise<{ marker: string; line: string }> => {
    const seen = await pictureForModel(bytes, kind, { grid, region })
    const line = `${seen.width} × ${seen.height} px, ${seen.transparent ? 'with see-through parts' : 'no see-through parts'}.${seen.note ? ` ${seen.note}` : ''}`
    return { marker: options.vision ? ` ${screenshotMarker(screenshots.add(seen.jpeg))}` : '', line }
  }
  const keep = (bytes: Uint8Array, name: string, replace: boolean | undefined, description: string | undefined, from: PictureRecord) => {
    const saved = storePicture(root, { bytes, filename: name, replace: replace === true, description: description ?? '' })
    noteMadeFrom(root, saved.file, from.file)
    generate(root)
    return saved
  }

  return {
    look_at_picture: defineTool('look_at_picture', {
      description:
        'Look at a stored picture and measure it. You see the picture once, in the next step. With grid true (the default) it has a grid of lines every 10 %, and the numbers on its edges are percent of the whole picture, so you can name a place for edit_picture without counting pixels: x from the left, y from the top. To look closer, pass region (percent) for the part to enlarge; the numbers then still count the whole picture. A see-through picture is shown on a chequered ground. Always look before you crop.',
      input: z.object({
        file: z.string().describe('Required. Address or file name, such as /media/hof.jpg.'),
        grid: z.boolean().optional().describe('Optional. Draw the grid. Default true.'),
        region: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional().describe('Optional. A part to enlarge, in percent of the whole picture.'),
      }),
      execute: async ({ file, grid, region }) => {
        const { record, bytes, kind } = open(file)
        const shown = await show(bytes, kind, grid !== false, region)
        const note = options.vision ? '' : ' This model cannot look at pictures, so describe_pictures or the sizes are all there is.'
        return `${record.address}: ${kind.toUpperCase()}, ${shown.line}${note}${shown.marker}`
      },
    }),
    edit_picture: defineTool('edit_picture', {
      description:
        `Change a picture with a list of steps, done in order, and save the result as a new picture; the original stays. Steps: crop (x, y, width, height in percent of the picture), resize (width and/or height in pixels, fit), trim (cuts a plain border), rotate (degrees), flip (axis), make_transparent (color, tolerance, feather, contiguous), mask (shape circle or rounded, radius), grayscale, tint (color), adjust (brightness, saturation, hue, contrast), blur (sigma), sharpen, pad (top, right, bottom, left in pixels, background), background (color: fills see-through parts). At most ${MAX_STEPS} steps. Use look_at_picture first to find where things are, then look at the result. An SVG is drawn first, so the result is a PNG: to keep a vector, use svg_extract or svg_edit. The result is a PNG when it has see-through parts, else it keeps the picture's format.`,
      input: z.object({
        file: z.string().describe('Required. Address or file name of the picture to change.'),
        steps: z.array(operation).min(1).max(MAX_STEPS).describe('Required. The steps, in order. Each names its op and the fields that op uses.'),
        name: z.string().optional().describe('Optional. A name for the new picture, in lowercase words. Default the old name and -edit.'),
        format: z.enum(['png', 'jpeg', 'webp']).optional().describe('Optional. Force the format. JPEG cannot keep see-through parts.'),
        replace: z.boolean().optional().describe('Optional. Overwrite a picture of that name. Only when the person asks.'),
        description: z.string().optional().describe('Optional. What the new picture shows, in a few words (it becomes its alt text).'),
      }),
      execute: async ({ file, steps, name, format, replace, description }) => {
        const { record, bytes, kind } = open(file)
        const made = await editRaster(bytes, kind, steps as PictureOp[], format)
        const saved = keep(made.bytes, nameFor(record, name, 'edit'), replace, description, record)
        const shown = await show(made.bytes, made.format, false)
        return `Saved ${saved.address}, made from ${record.address} by ${steps.map((step) => step.op).join(', ')}. ${shown.line}${shown.marker}`
      },
    }),
    svg_outline: defineTool('svg_outline', {
      description:
        'List the elements of a stored SVG as a tree. Every element has a number (@12) that svg_extract and svg_edit take as a selector, with its id, class, colours and size. A group of many alike elements shows the first few; pass under (such as @1) to list inside one. Use it to find the part to extract.',
      input: z.object({
        file: z.string().describe('Required. Address or file name of an SVG.'),
        under: z.string().optional().describe('Optional. An element to list inside of: @12, #id or .class.'),
      }),
      execute: ({ file, under }) => {
        const { text, record } = openSvg(file)
        return `${record.address}\n${outlineSvg(text, { under })}`
      },
    }),
    svg_extract: defineTool('svg_extract', {
      description:
        'Make a new SVG of chosen parts of a stored SVG. It keeps the groups the parts sit in (with their transforms and clips) and the gradients, patterns and clips they use, drops the rest, and fits the view box to what is drawn, plus a margin. The original stays. Find the numbers with svg_outline; you see the result in the next step.',
      input: z.object({
        file: z.string().describe('Required. Address or file name of an SVG.'),
        select: z.array(z.string()).min(1).max(60).describe('Required. Elements to keep: @12, @12-20 (a range of numbers), #id, .class or a tag such as path.'),
        name: z.string().optional().describe('Optional. A name for the new SVG. Default the old name and -part.'),
        margin: z.number().min(0).max(50).optional().describe('Optional. Space around the part, percent of its longest side. Default 3.'),
        replace: z.boolean().optional().describe('Optional. Overwrite a picture of that name. Only when the person asks.'),
        description: z.string().optional().describe('Optional. What the new picture shows, in a few words.'),
      }),
      execute: async ({ file, select, name, margin, replace, description }) => {
        const { record, text } = openSvg(file)
        const part = extractSvg(text, select)
        const bounds = await visibleBounds(part.svg)
        if (!bounds) fail('The part you chose draws nothing inside the picture: it may be invisible, empty or outside the view box. Look at svg_outline again.')
        const space = (Math.max(bounds.width, bounds.height) * (margin ?? 3)) / 100
        const fitted = fitSvg(part.svg, { x: bounds.x - space, y: bounds.y - space, width: bounds.width + 2 * space, height: bounds.height + 2 * space })
        const saved = keep(new TextEncoder().encode(fitted), nameFor(record, name, 'part'), replace, description, record)
        const shown = await show(new TextEncoder().encode(fitted), 'svg', false)
        return `Saved ${saved.address}, ${part.kept} elements kept from ${record.address}. ${shown.line}${shown.marker}`
      },
    }),
    svg_edit: defineTool('svg_edit', {
      description: `Change a stored SVG and save the result as a new SVG; the original stays. Steps, in order: recolor (from a colour or *, to a colour, select to limit it), remove (select), set (attr and value on select, or on the whole drawing), viewbox (x, y, width, height, in the drawing's own units, to show another part). At most ${MAX_STEPS} steps. Each step says what it changed.`,
      input: z.object({
        file: z.string().describe('Required. Address or file name of an SVG.'),
        steps: z.array(svgEdit).min(1).max(MAX_STEPS).describe('Required. The steps, in order.'),
        name: z.string().optional().describe('Optional. A name for the new SVG. Default the old name and -edit.'),
        replace: z.boolean().optional().describe('Optional. Overwrite a picture of that name. Only when the person asks.'),
        description: z.string().optional().describe('Optional. What the new picture shows, in a few words.'),
      }),
      execute: async ({ file, steps, name, replace, description }) => {
        const { record, text } = openSvg(file)
        const result = editSvg(text, steps)
        const bytes = new TextEncoder().encode(result.svg)
        const saved = keep(bytes, nameFor(record, name, 'edit'), replace, description, record)
        const shown = await show(bytes, 'svg', false)
        return `Saved ${saved.address} from ${record.address}.\n${result.notes.join('\n')}\n${shown.line}${shown.marker}`
      },
    }),
    write_svg: defineTool('write_svg', {
      description:
        'Save an SVG you write as a picture of the site, and see it drawn in the next step. Good for icons, dividers, patterns, simple flat illustrations and shapes. Give it a viewBox (such as "0 0 100 100") and no width or height. Use only shapes, paths, gradients, clips, masks and styles: no script, no external address, no picture from another host. Avoid text: a picture cannot use the site fonts, so write words as page text, or make the graphic with render_graphic. Anything the site may not hold is removed and the result says so. At most 200 KB.',
      input: z.object({
        svg: z.string().describe('Required. The whole SVG, starting with <svg and a viewBox.'),
        name: z.string().describe('Required. A name for the picture, in lowercase words with hyphens.'),
        description: z.string().optional().describe('Optional. What the picture shows, in a few words (it becomes its alt text).'),
        replace: z.boolean().optional().describe('Optional. Overwrite a picture of that name. Only when the person asks.'),
      }),
      execute: async ({ svg, name, description, replace }) => {
        if (svg.length > MAX_SVG_CHARS) fail(`That SVG is ${Math.round(svg.length / 1000)} KB. Keep it under 200 KB: fewer points, simpler shapes.`)
        const bytes = new TextEncoder().encode(svg)
        if (!/\bviewBox\s*=/.test(svg)) fail('Give the SVG a viewBox, such as viewBox="0 0 100 100", so that it can be shown at any size.')
        const saved = storePicture(root, { bytes, filename: stemFromFilename(name), replace: replace === true, description: description ?? '' })
        const stored = readPictureBytes(root, saved.file)
        const bounds = await visibleBounds(new TextDecoder().decode(stored.bytes))
        if (!bounds) {
          fail(`Saved ${saved.address}, but it draws nothing. Check that the shapes lie inside the viewBox and have a fill or a stroke, then write it again with replace true.`)
        }
        generate(root)
        const shown = await show(stored.bytes, 'svg', false)
        const cleaned = new TextDecoder().decode(stored.bytes).length < svg.length * 0.9 ? ' Some parts the site does not allow were removed.' : ''
        const text = /<text\b/i.test(svg) ? ' It has text: a picture draws it in a system font, not in the site fonts.' : ''
        return `Saved ${saved.address}. ${shown.line}${cleaned}${text}${shown.marker}`
      },
    }),
    trace_picture: defineTool('trace_picture', {
      description:
        'Turn a stored picture into an SVG of flat shapes and save it as a new picture; the original stays. Good for a logo, an icon, a signature or a drawing that has to stay sharp at any size; a photograph traces into a mess. mode silhouette (default) makes one shape in one colour: the dark part of the picture, or, when the picture has see-through parts, its outline (details inside the outline are lost: for a logo with windows or lettering use mode colors). color is the shape colour, #rrggbb, or auto for the picture\'s own. threshold (1 to 99, default 50) is how dark counts as ink; invert traces the light part instead. mode colors makes up to 6 flat colours (colors 2 to 6), layer over layer, and drops the background colour unless keep_background is true. despeckle (pixels, default 4) drops specks; smooth (0 to 1.3, default 1) rounds corners, 0 keeps them sharp. You see the result in the next step: if it is rough, trace again with another threshold or despeckle.',
      input: z.object({
        file: z.string().describe('Required. Address or file name of the picture to trace.'),
        mode: z.enum(['silhouette', 'colors']).optional(),
        threshold: z.number().optional().describe('Optional. silhouette: 1 to 99.'),
        color: z.string().optional().describe('Optional. silhouette: #rrggbb or auto.'),
        colors: z.number().int().optional().describe('Optional. colors: 2 to 6.'),
        despeckle: z.number().optional().describe('Optional. Specks up to this many pixels are dropped.'),
        smooth: z.number().optional().describe('Optional. 0 to 1.34.'),
        invert: z.boolean().optional().describe('Optional. Trace the light part.'),
        keep_background: z.boolean().optional().describe('Optional. colors: keep the background colour as a shape.'),
        name: z.string().optional().describe('Optional. A name for the new SVG. Default the old name and -trace.'),
        replace: z.boolean().optional().describe('Optional. Overwrite a picture of that name. Only when the person asks.'),
        description: z.string().optional().describe('Optional. What the new picture shows, in a few words.'),
      }),
      execute: async ({ file, mode, threshold, color, colors, despeckle, smooth, invert, keep_background, name, replace, description }) => {
        if (!(await potraceAvailable())) fail('potrace is not installed here, so tracing is not available. The Docker image has it.')
        const { record, bytes, kind } = open(file)
        const traced = await tracePicture(bytes, kind, { mode, threshold, color, colors, despeckle, smooth, invert, keepBackground: keep_background })
        const out = new TextEncoder().encode(traced.svg)
        const saved = keep(out, nameFor(record, name, 'trace'), replace, description, record)
        const shown = await show(out, 'svg', false)
        const heavy = traced.bytes > 150_000 ? ' It is large: raise despeckle, lower colors, or trace a simpler picture.' : ''
        return `Saved ${saved.address}, traced from ${record.address}: ${traced.paths} paths in ${traced.layers} ${traced.layers === 1 ? 'layer' : 'layers'}, ${Math.max(1, Math.round(traced.bytes / 1000))} KB, colours ${traced.colors.join(', ')}.${heavy}${traced.hint ? ` ${traced.hint}` : ''} ${shown.line}${shown.marker}`
      },
    }),
    ...(browserConfigured()
      ? {
          render_graphic: defineTool('render_graphic', {
            description: `Make a picture from HTML and CSS and save it as a picture of the site: a share card, a banner, a poster, words over a picture, a badge. A browser draws it on a canvas of width × height CSS pixels. The page has the site's fonts (use font-family: var(--font-serif) or the family name from fonts.yml) and colours as CSS variables with the token names: var(--color-primary), var(--color-page), var(--color-on-primary), var(--radius-card). The site's pictures are at /media/…, such as <img src="/media/hof.jpg">. Nothing else loads: no script runs, and no picture, font or stylesheet from another address. Give the elements sizes in px and position: absolute where it helps, so that nothing overflows the canvas. html is the body content, or a whole document. Leave the background alone unless you want one; transparent true keeps the canvas see-through (PNG or WebP). scale 2 makes a sharper picture at twice the pixels. You see the result in the next step: check that the text fits and reads well, and draw it again if not. At most ${MAX_HTML / 1000} KB of HTML, 4096 px on a side.`,
            input: z.object({
              html: z.string().describe('Required. The HTML, with its CSS in a <style> element or style attributes.'),
              width: z.number().int().describe('Required. Canvas width in CSS pixels, at least 16.'),
              height: z.number().int().describe('Required. Canvas height in CSS pixels, at least 16.'),
              name: z.string().describe('Required. A name for the picture, in lowercase words with hyphens.'),
              scale: z.number().int().optional().describe('Optional. 1 (default) or 2.'),
              format: z.enum(['png', 'jpeg', 'webp']).optional().describe('Optional. png (default), jpeg or webp.'),
              transparent: z.boolean().optional().describe('Optional. Keep the canvas see-through.'),
              description: z.string().optional().describe('Optional. What the picture shows, in a few words (it becomes its alt text). Say what its text says.'),
              replace: z.boolean().optional().describe('Optional. Overwrite a picture of that name. Only when the person asks.'),
            }),
            execute: async ({ html, width, height, name, scale, format, transparent, description, replace }) => {
              const drawn = await renderGraphic(root, { html, width, height, scale, format, transparent })
              const saved = storePicture(root, { bytes: drawn.bytes, filename: stemFromFilename(name), replace: replace === true, description: description ?? '' })
              generate(root)
              const shown = await show(drawn.bytes, drawn.format, false)
              return `Saved ${saved.address}. ${shown.line}${shown.marker}`
            },
          }),
        }
      : {}),
  }
}

