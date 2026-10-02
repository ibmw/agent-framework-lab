import { type DragEvent, useId, useState } from "react";
import { MEDIA_TYPES } from "../lib/fieldRules";
import {
  fieldLabelClasses,
  mediaBrowseClasses,
  mediaDropZoneClasses,
  mediaThumbnailClasses,
} from "../lib/ui";
import { ActionStatus } from "./ActionStatus";

/**
 * A product's *Image* field (ADR 0076): a zone a file is dropped on, over a visually hidden
 * `<input type="file">` reached by its *Browse…* label, so the keyboard and a screen reader open
 * the operating system's picker. Both are the platform's own — the drag events and the file
 * input — and nothing here uploads: the card is handed the file and says how it went in
 * `status`, which is drawn under the zone in `ActionStatus`.
 *
 * `fixed` is an entry being edited: its image is shown and is not what changes, so the zone
 * takes no file and offers no *Browse…*.
 */
export function MediaDropZone({
  label,
  hint,
  chosen,
  fixed,
  uploading,
  status,
  refused,
  invalid,
  describedBy,
  onFile,
}: {
  label: string;
  hint: string;
  /** The image the form holds, or none yet. */
  chosen: { url: string; fileName: string } | null;
  fixed: boolean;
  uploading: boolean;
  /** "Uploading…", "{file name} uploaded", or the lab's refusal in its own words, or nothing. */
  status: string;
  /** `status` is a refusal, which the file input is then described by. */
  refused: boolean;
  /** The form refuses for want of an image, said in the line `describedBy` names. */
  invalid: boolean;
  describedBy?: string;
  onFile: (file: File) => void;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const noteId = `${id}-note`;
  const statusId = `${id}-status`;
  const [dragging, setDragging] = useState(false);
  const takes = !fixed && !uploading;

  function over(event: DragEvent<HTMLFieldSetElement>) {
    if (!takes) {
      return;
    }
    event.preventDefault();
    setDragging(true);
  }

  function drop(event: DragEvent<HTMLFieldSetElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer?.files?.[0];
    if (takes && file !== undefined) {
      onFile(file);
    }
  }

  return (
    <div className={`${fieldLabelClasses} col-span-full`}>
      <span id={labelId}>{label}</span>
      {/* The zone is named by the field's label, so a reader landing in it hears "Image". A
          fieldset rather than a div with a group role; `min-w-0` because a fieldset is
          `min-inline-size: min-content` by default. */}
      <fieldset
        aria-labelledby={labelId}
        aria-describedby={hintId}
        data-dragging={dragging || undefined}
        className={`min-w-0 ${mediaDropZoneClasses(dragging)}`}
        onDragEnter={over}
        onDragOver={over}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
      >
        {chosen === null ? (
          <span>Drop an image here</span>
        ) : (
          <>
            {/* The file name beside it says what it is; the image adds nothing to read. */}
            <img src={chosen.url} alt="" className={mediaThumbnailClasses} />
            <span className="min-w-0 font-semibold text-admin-ink [overflow-wrap:anywhere]">
              {chosen.fileName}
            </span>
          </>
        )}
        {fixed ? null : (
          <span className="ml-auto flex items-center">
            <input
              id={id}
              type="file"
              accept={MEDIA_TYPES.join(",")}
              className="peer sr-only"
              // Not `disabled` while an upload runs: that would drop the focus of a reader who
              // chose the file from here. It says it is unavailable and takes no file instead.
              aria-disabled={uploading || undefined}
              aria-invalid={invalid || undefined}
              aria-describedby={
                [
                  hintId,
                  uploading ? noteId : null,
                  refused ? statusId : null,
                  invalid ? describedBy : null,
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              onClick={(event) => {
                if (uploading) {
                  event.preventDefault();
                }
              }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Emptied, so choosing the same file again after a refusal is a change too.
                event.target.value = "";
                if (file !== undefined && !uploading) {
                  onFile(file);
                }
              }}
            />
            <label htmlFor={id} className={mediaBrowseClasses}>
              Browse…
            </label>
          </span>
        )}
      </fieldset>
      <p id={hintId} className="font-normal text-admin-muted">
        {hint}
      </p>
      <ActionStatus
        label={`${label} upload`}
        report={{ rows: [], summary: status, running: uploading }}
        note="The image is the shop's once it uploads, whether or not this entry is added."
        noteId={noteId}
        regionId={statusId}
      />
    </div>
  );
}
