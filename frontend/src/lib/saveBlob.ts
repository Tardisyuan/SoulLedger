/**
 * Hand a downloaded body (an axios `responseType: "blob"` response) to the
 * browser as a file. The `download` attribute names the file; the server's
 * Content-Disposition only matters to someone calling the endpoint directly.
 */
export function saveBlob(data: BlobPart, filename: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
