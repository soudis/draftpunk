// Pictures of a page, kept in memory for the request that took them. A tool result only carries
// the id; the harness puts the picture in front of the model for the next step, and nothing else.
export class ScreenshotStore {
  private items = new Map<string, { data: Buffer; mediaType: string }>()
  private counter = 0

  add(data: Buffer, mediaType = 'image/jpeg'): string {
    this.counter += 1
    const id = `s${this.counter}`
    this.items.set(id, { data, mediaType })
    return id
  }

  get(id: string): { data: Buffer; mediaType: string } | undefined {
    return this.items.get(id)
  }
}

export function screenshotMarker(id: string): string {
  return `[screenshot:${id}]`
}

export function screenshotIds(text: string): string[] {
  return [...text.matchAll(/\[screenshot:(s\d+)\]/g)].map((match) => match[1])
}
