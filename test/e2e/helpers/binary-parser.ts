import type { Response } from 'superagent';

/**
 * superagent parser that buffers a response body as a raw Buffer, for
 * asserting on binary responses (e.g. the rendered MP4) in supertest.
 */
export function binaryParser(res: Response, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

export function isValidMp4(buffer: Buffer): boolean {
  // The 'ftyp' box always appears at byte offset 4 in a valid MP4 file.
  return buffer.length > 12 && buffer.toString('ascii', 4, 8) === 'ftyp';
}
