import { readWebsite } from './read-website'

export async function readSite(
  input: string,
  fetchPage?: Parameters<typeof readWebsite>[1],
  resolve?: Parameters<typeof readWebsite>[2],
): Promise<string> {
  return readWebsite(input, fetchPage, resolve)
}
