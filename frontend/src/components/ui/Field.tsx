"use client";

import { useId } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * The one form field.
 *
 * WHAT IT REPLACES. 92 form controls (61 `<input>`, 24 `<select>`, 7
 * `<textarea>`) carrying 42 mutually distinct `className` strings. Three
 * things about that set are worth naming, because they are defects and not
 * merely inconsistency:
 *
 * 1. THE ERROR STATE BARELY EXISTS. Of the 92 controls, exactly two — both in
 *    `src/components/ui/Modal.tsx` — render an error at all. Everywhere else a
 *    rejected value comes back as a toast, or as nothing, with no
 *    `aria-invalid`, no `aria-describedby`, and no mark on the field that was
 *    wrong. A user with three fields and one server-side rejection is told that
 *    *something* failed.
 *
 * 2. THE TWO THAT DO USE THE PALETTE, NOT THE TOKEN. Modal writes
 *    `border-red-500` and `text-red-500`. `--color-status-error` exists, it is
 *    re-measured per theme (`0 84% 62%` dark, `0 78% 44%` light — the light
 *    value is darker specifically so error text clears AA on a light canvas),
 *    and `red-500` follows neither theme. This component uses the token:
 *    error text on surface-1 measures 5.25:1 dark and comfortably over AA
 *    light.
 *
 * 3. `focus:` WHERE `focus-visible:` WAS MEANT. 62 of the 92 write
 *    `focus:border-...`, which fires on mouse clicks too, so every click paints
 *    an accent border that the user did not ask for and cannot dismiss without
 *    clicking elsewhere.
 *
 *    Switching to `focus-visible:` is not a downgrade for text inputs, which is
 *    the objection you would expect. The selector's own heuristic makes an
 *    explicit exception for elements that expect text entry: a mouse click into
 *    an `<input type="text">` or a `<textarea>` DOES match `:focus-visible`.
 *    What stops matching is the mouse click on a `<select>` or a button — which
 *    is exactly the case where the extra border was noise. So text fields keep
 *    their focus border on click, selects lose it on click and keep it on Tab,
 *    and that is the correct behaviour in both cases.
 *
 *    Note this is only the *border*. The focus RING comes from the global
 *    `:focus-visible` rule at `app/globals.css:459` (with its companion
 *    `input,textarea,select:focus-visible { outline-offset: 0 }` immediately
 *    below, which exists so the ring and the accent border do not read as a
 *    double outline). Nothing here writes `outline-hidden`, so nothing here has
 *    to fight it.
 *
 * ── THE PLACEHOLDER SPELLING, WRITTEN DOWN ONCE ────────────────────────────
 *
 * `src/components/workflow/WorkflowEditor.tsx:488` contains:
 *
 *     placeholder:[hsl(var(--color-ink-subtle))]
 *
 * That class produces **no CSS**. `placeholder:` is a variant, and what follows
 * a variant has to be a utility. `[hsl(...)]` is not one: Tailwind's
 * arbitrary-*property* form requires `[property:value]`, e.g.
 * `text-[hsl(...)]`, and a bare bracketed value has no property to set. So
 * Tailwind matches nothing, emits nothing, and that input's placeholder renders
 * at the inherited text colour — full-strength ink, indistinguishable from a
 * real value. It fails silently: no build error, no type error, no visual diff
 * anyone would flag without looking for it.
 *
 * The correct spelling — used below, and the one every migrated call site
 * should end up with — is:
 *
 *     placeholder:text-[hsl(var(--color-ink-subtle))]
 *
 * (The `placeholder-[hsl(...)]` form that Modal.tsx uses is the deprecated
 * Tailwind v2 `placeholderColor` utility. It still emits CSS in v3, so it is
 * not the same bug — it is merely the old spelling.)
 */

/**
 * The control skin, shared by input / select / textarea so the three cannot
 * drift apart the way the 42 signatures did.
 *
 * Padding is the same 4/8/12/16 ladder `Button` uses, so a field and the button
 * beside it line up: sm 8/4, md 12/8, lg 16/12.
 */
export const fieldControl = cva(
  [
    "block w-full border bg-[hsl(var(--color-surface-1))] text-[hsl(var(--color-ink))]",
    "placeholder:text-[hsl(var(--color-ink-subtle))]",
    "transition-[border-color] duration-state",
    // Disabled on every control, not 29% of them.
    "disabled:opacity-50 disabled:cursor-not-allowed",
  ],
  {
    variants: {
      size: {
        sm: "px-2 py-1 text-02",
        md: "px-3 py-2 text-03",
        lg: "px-4 py-3 text-04",
      },
      invalid: {
        // `focus-visible:`, not `focus:` — see the note above.
        false: "border-[hsl(var(--color-hairline))] focus-visible:border-[hsl(var(--color-accent))]",
        // An invalid field keeps its error border through focus. Letting focus
        // repaint it accent would mean the field stops looking wrong at exactly
        // the moment the user goes to fix it.
        true: "border-[hsl(var(--color-status-error))] focus-visible:border-[hsl(var(--color-status-error))]",
      },
    },
    defaultVariants: { size: "md", invalid: false },
  }
);

export type FieldSize = NonNullable<VariantProps<typeof fieldControl>["size"]>;
export const FIELD_SIZES: FieldSize[] = ["sm", "md", "lg"];

interface FieldShellOwnProps {
  label: React.ReactNode;
  /** Long-form help. Always rendered when present, error or not. */
  description?: React.ReactNode;
  /** Truthy switches the whole field into the error state. */
  error?: string | null;
  required?: boolean;
  className?: string;
}

/** What `Field` hands its render-prop child; spread it straight onto a control. */
export interface FieldControlProps {
  id: string;
  "aria-invalid": boolean | undefined;
  "aria-describedby": string | undefined;
  "aria-required": boolean | undefined;
}

export interface FieldProps extends FieldShellOwnProps {
  /** Optional caller-supplied id; one is generated when absent. */
  id?: string;
  children: (control: FieldControlProps) => React.ReactNode;
}

/**
 * Label + control + description + error, wired together.
 *
 * The wiring is the reason this is a component and not a class string. Getting
 * `htmlFor`/`id` right, pointing `aria-describedby` at *both* the description
 * and the error when both exist, and putting `role="alert"` on the error so it
 * is announced when it appears — that is four things to remember per field,
 * 92 times, and the evidence says they were remembered twice.
 */
export function Field({
  id,
  label,
  description,
  error,
  required,
  className,
  children,
}: FieldProps) {
  const generated = useId();
  const controlId = id ?? `field-${generated}`;
  const descriptionId = `${controlId}-description`;
  const errorId = `${controlId}-error`;
  const invalid = Boolean(error);

  // Both, in reading order, when both are present. A field that has help text
  // AND an error should announce the help then the error, not one of them.
  const describedBy =
    [description ? descriptionId : null, invalid ? errorId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label
        htmlFor={controlId}
        className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]"
      >
        {label}
        {required ? (
          // `aria-hidden` because `aria-required` on the control is what
          // actually carries this to assistive tech; the asterisk is for eyes.
          <span aria-hidden="true" className="ml-1 text-[hsl(var(--color-status-error))]">
            *
          </span>
        ) : null}
      </label>

      {children({
        id: controlId,
        "aria-invalid": invalid || undefined,
        "aria-describedby": describedBy,
        "aria-required": required || undefined,
      })}

      {description ? (
        <span id={descriptionId} className="text-02 text-[hsl(var(--color-ink-tertiary))]">
          {description}
        </span>
      ) : null}

      {invalid ? (
        // `role="alert"` and not a plain span: this text appears after a
        // submit, i.e. after focus has already moved on, so it has to announce
        // itself rather than wait to be navigated to.
        <span id={errorId} role="alert" className="text-02 text-[hsl(var(--color-status-error))]">
          {error}
        </span>
      ) : null}
    </div>
  );
}

type ControlSizeProp = { size?: FieldSize };

export type TextFieldProps = FieldShellOwnProps &
  ControlSizeProp &
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "className">;

export function TextField({
  label,
  description,
  error,
  required,
  className,
  size = "md",
  ...input
}: TextFieldProps) {
  return (
    <Field
      id={input.id}
      label={label}
      description={description}
      error={error}
      required={required}
      className={className}
    >
      {(control) => (
        <input {...control} {...input} className={fieldControl({ size, invalid: Boolean(error) })} />
      )}
    </Field>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export type SelectFieldProps = FieldShellOwnProps &
  ControlSizeProp & {
    options: SelectOption[];
  } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size" | "className" | "children">;

export function SelectField({
  label,
  description,
  error,
  required,
  className,
  size = "md",
  options,
  ...select
}: SelectFieldProps) {
  return (
    <Field
      id={select.id}
      label={label}
      description={description}
      error={error}
      required={required}
      className={className}
    >
      {(control) => (
        <select {...control} {...select} className={fieldControl({ size, invalid: Boolean(error) })}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export type TextAreaFieldProps = FieldShellOwnProps &
  ControlSizeProp &
  Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "className">;

export function TextAreaField({
  label,
  description,
  error,
  required,
  className,
  size = "md",
  ...textarea
}: TextAreaFieldProps) {
  return (
    <Field
      id={textarea.id}
      label={label}
      description={description}
      error={error}
      required={required}
      className={className}
    >
      {(control) => (
        <textarea
          {...control}
          {...textarea}
          className={cn(fieldControl({ size, invalid: Boolean(error) }), "resize-y")}
        />
      )}
    </Field>
  );
}
