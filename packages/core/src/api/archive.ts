import axios from "axios";

/**
 * The archive columns the detail serializers of Soul / Judgment / Disposition send
 * (backend/apps/core/archive.py ARCHIVE_FIELDS). Optional: list serializers omit them.
 */
export interface ArchiveFields {
  is_archived?: boolean;
  archived_at?: string | null;
  archived_by_name?: string | null;
  archive_reason?: string;
}

/**
 * 409 of DELETE /souls|judgment|disposition/{id}/ with `archivable: true`: the record
 * cannot be deleted but can be archived. Any other 409 is an ordinary failure.
 */
export function isArchivableConflict(error: unknown): boolean {
  return (
    axios.isAxiosError(error) &&
    error.response?.status === 409 &&
    (error.response.data as { archivable?: unknown } | undefined)?.archivable === true
  );
}
