"use client";

import * as React from "react";
import { Combobox } from "@base-ui/react/combobox";

import { Field, type SelectOption } from "@/src/components/ui/Field";

/**
 * A picker for a list too long to put in a `<select>`.
 *
 * WHY IT EXISTS. `app/dispatch/propose` built its soul `<select>` out of
 * `soulsApi.list({ page: 1 })` — one page, and DRF's `PAGE_SIZE` is 20. A
 * tenant's twenty-first soul could not be nominated for a dispatch at all, and
 * the control gave no sign that it was showing a slice: no pagination, no
 * search, no count. It is the same defect `cfe9f99` closed for the dispatch and
 * cross-judgments tables, in the one shape that scan missed, because a
 * truncated `<select>` looks exactly like a complete one.
 *
 * THE FILTERING IS THE SERVER'S — `filter={null}`, which is Base UI's explicit
 * "do not filter" escape hatch. That is the whole point: the reason this
 * control exists is that the client never holds the full collection, so a
 * client-side filter would narrow the twenty rows it happens to have and
 * present the result as the answer — the original bug wearing a search box.
 * `options` is whatever the server just returned for `search`, rendered
 * verbatim.
 *
 * `Combobox`, NOT `Autocomplete`. Base UI ships both, and `Autocomplete` is the
 * wrapper for the client-side-filtering case: it drops `openOnInputClick` and
 * `onOpenChange` from its props, and under `mode="none"` — the only mode that
 * leaves the list alone — its popup never opens on typing at all. Measured in
 * jsdom before switching: typing left `aria-expanded="false"` with zero options
 * rendered, and only ArrowDown opened it. A search box that shows nothing until
 * you press an arrow key is not a search box.
 *
 * THE SELECTED ITEM OUTLIVES THE SEARCH THAT FOUND IT. Type "孟", pick a soul,
 * then type "王": the server returns a different page and the chosen soul is no
 * longer in `options`. The value is still submitted, so the field must still
 * know it. The whole option object is held in state rather than looked up in
 * `options`, because a lookup returns undefined exactly when the user has
 * navigated away from their own choice — the field would forget a selection the
 * form still carries.
 *
 * EMPTY IS NOT THE SAME AS PENDING. `loading` renders its own row. An
 * in-flight request that draws "no matches" is `de66a5f` again — a request
 * state painted as an answer — and here it is worse than on a page, because
 * the reflex is to retype the query that was already correct.
 */
export interface SearchSelectFieldProps {
  id: string;
  name: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  /** The current selection, as the value that will be submitted. `""` is none. */
  value: string;
  onValueChange: (value: string) => void;
  /** The server's answer for `searchText`. Rendered verbatim; never filtered here. */
  options: SelectOption[];
  /** Raw query text. Owned by the caller so it can debounce before fetching. */
  searchText: string;
  onSearchTextChange: (text: string) => void;
  loading?: boolean;
  placeholder?: string;
  loadingText: string;
  emptyText: string;
  /** Shown under the list when the server has more rows than it returned. */
  moreText?: string;
}

export function SearchSelectField({
  id,
  name,
  label,
  description,
  error,
  required,
  disabled,
  className,
  value,
  onValueChange,
  options,
  searchText,
  onSearchTextChange,
  loading = false,
  placeholder,
  loadingText,
  emptyText,
  moreText,
}: SearchSelectFieldProps) {
  const [selected, setSelected] = React.useState<SelectOption | null>(null);
  const [open, setOpen] = React.useState(false);

  /**
   * The label Base UI is about to echo back into the input after a selection.
   *
   * Picking a row writes that row's label into the input, which arrives here as
   * an `onInputValueChange` indistinguishable from typing — so the "typing
   * opens the list" rule below reopened the popup the selection had just
   * closed. A ref rather than state because both callbacks run in one commit
   * and a state write would not be visible to the second.
   *
   * MEASURED IN A BROWSER, NOT IN JSDOM. Under jsdom the two callbacks land in
   * the order that happens to close the popup, so the whole defect is invisible
   * to the suite: `searchSelectIsServerFiltered.test.ts` cannot guard this line
   * and does not pretend to. It was found by driving the real thing at
   * /zz-probe and reading `stillOpen: true` back out of the DOM.
   */
  const echoAfterSelect = React.useRef<string | null>(null);

  // A reset from outside — the form clearing after a successful submit — has to
  // clear the remembered option too, or the input keeps naming a soul that is
  // no longer the field's value.
  React.useEffect(() => {
    if (value === "") setSelected(null);
  }, [value]);

  return (
    <Field
      id={id}
      label={label}
      description={description}
      error={error}
      required={required}
      className={className}
    >
      {(control) => (
        <Combobox.Root
          items={options}
          // The escape hatch, and the reason this component exists. Base UI's
          // default filter would run over the page the server just returned.
          filter={null}
          value={selected}
          onValueChange={(next: SelectOption | null) => {
            echoAfterSelect.current = next ? next.label : null;
            setSelected(next);
            onValueChange(next ? next.value : "");
            // Picking is the end of the search. Closed here rather than left to
            // the library for the reason `open` is driven at all — see below.
            setOpen(false);
          }}
          inputValue={searchText}
          onInputValueChange={(next) => {
            // The library writing a just-picked label back, not the user typing.
            // The text still has to propagate — it is what the input displays —
            // but none of the "a search is underway" consequences apply.
            const isEcho = next === echoAfterSelect.current;
            echoAfterSelect.current = null;
            if (isEcho) {
              onSearchTextChange(next);
              return;
            }
            // Typing replaces a selection: the id must not survive text that no
            // longer names it, or the form submits a soul the field is not
            // showing.
            if (selected && next !== selected.label) {
              setSelected(null);
              onValueChange("");
            }
            onSearchTextChange(next);
            // OPENING IS OURS TO DO. Base UI never fires `onOpenChange` for
            // typing here: with `filter={null}` it has no filtering to react to,
            // so it has no reason of its own to reveal a list. `onOpenChange` is
            // still wired, because the closes the library DOES drive — Escape,
            // a click outside — are ones we want; this only adds the open.
            if (next !== "") setOpen(true);
          }}
          open={open}
          onOpenChange={setOpen}
        >
          {/* The real value. Base UI's input carries the *text*; the form reads
              `name`, so the id travels in a hidden input rather than being
              parsed back out of a label. */}
          <input type="hidden" name={name} value={value} />

          <Combobox.Input
            {...control}
            disabled={disabled}
            placeholder={placeholder}
            // Returning to a field that already has text should show the
            // matches again rather than require a keystroke that changes the
            // query the user had already got right.
            onFocus={() => {
              if (searchText !== "" && !selected) setOpen(true);
            }}
            className="w-full bg-[hsl(var(--color-surface-1))] border px-3 py-2 text-03 text-[hsl(var(--color-ink))] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--color-accent))] disabled:opacity-50 border-hairline focus-visible:border-[hsl(var(--color-accent))] aria-[invalid=true]:border-[hsl(var(--color-status-error))]"
          />

          <Combobox.Portal>
            <Combobox.Positioner sideOffset={4} className="z-dialog w-[var(--anchor-width)]">
              <Combobox.Popup className="max-h-64 overflow-y-auto bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] py-1 transition duration-150 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0">
                {loading ? (
                  <p className="px-3 py-2 text-02 text-[hsl(var(--color-ink-subtle))]" role="status">
                    {loadingText}
                  </p>
                ) : (
                  <>
                    {/* Our own row, not `Combobox.Empty`. That part renders on
                        "the filter matched nothing", and with `filter={null}`
                        there is no filter, so it never renders at all — an
                        empty list would have drawn an empty box. `options` is
                        the server's whole answer here, so its length IS the
                        question being asked. */}
                    {options.length === 0 ? (
                      <p className="px-3 py-2 text-02 text-[hsl(var(--color-ink-subtle))]">
                        {emptyText}
                      </p>
                    ) : null}
                    <Combobox.List>
                      {(option: SelectOption) => (
                        <Combobox.Item
                          key={option.value}
                          value={option}
                          className="px-3 py-2 text-03 text-[hsl(var(--color-ink))] cursor-pointer data-highlighted:bg-[hsl(var(--color-surface-3))] data-selected:text-[hsl(var(--color-accent-ink))]"
                        >
                          {option.label}
                        </Combobox.Item>
                      )}
                    </Combobox.List>
                    {/* Says the list is a slice, which the old `<select>` never
                        did. Without it "keep typing" is advice the user has no
                        reason to take. */}
                    {moreText ? (
                      <p className="px-3 py-2 text-01 text-[hsl(var(--color-ink-tertiary))] border-t border-[hsl(var(--color-hairline))]">
                        {moreText}
                      </p>
                    ) : null}
                  </>
                )}
              </Combobox.Popup>
            </Combobox.Positioner>
          </Combobox.Portal>
        </Combobox.Root>
      )}
    </Field>
  );
}
