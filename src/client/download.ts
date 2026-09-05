/**
 * Blob download helper shared by the export surfaces: creates an object URL,
 * clicks an attached anchor (attached so Firefox fires `download` on it), and
 * revokes the URL after the click. The anchor is removed in the same task.
 * @module dsh-zotero/client/download
 */

/** Download one text payload as a file with the given name and MIME type. */
export function downloadBlob(text: string, fileName: string, mime: string): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  // Detached anchors never fire `download` in some Firefox builds; attach,
  // click, and remove in the same task.
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // The blob URL must not outlive the click.
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}
