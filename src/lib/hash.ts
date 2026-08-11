/**
 * SHA-256 of the imported file bytes. This is the identity of an *exact edition*
 * of a document: re-importing the same file must reuse the existing document (so
 * anchors keep resolving), while a different scan of the same book must not
 * silently inherit anchors that point at different coordinates.
 */
export async function sha256(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
