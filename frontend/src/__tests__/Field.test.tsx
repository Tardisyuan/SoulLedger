import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import {
  Field,
  TextField,
  SelectField,
  TextAreaField,
  fieldControl,
  FIELD_SIZES,
  type FieldSize,
} from "@/src/components/ui/Field";

const SOURCE = readFileSync(
  path.join(__dirname, "..", "components", "ui", "Field.tsx"),
  "utf8"
);
/** Comments stripped — this file documents the spellings it forbids. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const OPTIONS = [
  { value: "CHINESE", label: "中国" },
  { value: "GREEK", label: "希腊" },
];

/** All three controls, so "unified" below means all of them and not the input. */
const CONTROLS: Array<[string, (props: Record<string, unknown>) => React.ReactElement]> = [
  ["input", (p) => <TextField label="Name" {...p} />],
  ["select", (p) => <SelectField label="Civ" options={OPTIONS} {...p} />],
  ["textarea", (p) => <TextAreaField label="Reason" {...p} />],
];

function control(): HTMLElement {
  // One query that finds whichever of the three is on screen. `getByLabelText`
  // is the point: it only resolves if label/control wiring is actually correct,
  // so every test below is implicitly an accessibility test.
  return screen.getByLabelText(/Name|Civ|Reason/);
}

describe("the error state exists at all, on every control", () => {
  /**
   * Of 92 form controls in the repo, exactly two render an error — both in
   * Modal.tsx. Everywhere else a rejected value comes back as a toast or as
   * nothing: no `aria-invalid`, no `aria-describedby`, no mark on the field
   * that was wrong.
   */
  it.each(CONTROLS)("%s shows the message", (_name, make) => {
    render(make({ error: "太长了" }));
    expect(screen.getByRole("alert")).toHaveTextContent("太长了");
  });

  it.each(CONTROLS)("%s marks itself invalid", (_name, make) => {
    render(make({ error: "太长了" }));
    expect(control()).toHaveAttribute("aria-invalid", "true");
  });

  it.each(CONTROLS)("%s points at the message it is described by", (_name, make) => {
    render(make({ error: "太长了" }));
    const describedBy = control().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent("太长了");
  });

  it.each(CONTROLS)("%s is clean when there is no error", (_name, make) => {
    // Absence, asserted. A control permanently `aria-invalid="false"` is not
    // the same as one that reports validity, and `aria-describedby=""` pointing
    // at nothing is a live bug that renders identically.
    render(make({}));
    expect(control()).not.toHaveAttribute("aria-invalid");
    expect(control()).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("announces the error rather than waiting to be navigated to", () => {
    // The message appears after a submit, i.e. after focus has already moved
    // on. A plain <span> would be silent.
    render(<TextField label="Name" error="太长了" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("describes by BOTH the description and the error when both are present", () => {
    render(<TextField label="Name" description="真名,不是谥号" error="太长了" />);
    const ids = control().getAttribute("aria-describedby")!.split(/\s+/);
    expect(ids).toHaveLength(2);
    expect(document.getElementById(ids[0])).toHaveTextContent("真名,不是谥号");
    expect(document.getElementById(ids[1])).toHaveTextContent("太长了");
  });

  it("uses the status token, not the red-500 palette Modal reached for", () => {
    // `--color-status-error` is re-measured per theme (0 84% 62% dark,
    // 0 78% 44% light — the light value darker precisely so error text clears
    // AA on a light canvas). `red-500` follows neither.
    render(<TextField label="Name" error="太长了" />);
    expect(screen.getByRole("alert").className).toContain(
      "text-[hsl(var(--color-status-error))]"
    );
    expect(CODE).not.toMatch(/\b(?:text|border|bg)-red-\d/);
  });

  it("keeps the error border through focus instead of repainting it accent", () => {
    // Otherwise the field stops looking wrong at exactly the moment the user
    // goes to fix it.
    const invalid = fieldControl({ invalid: true });
    expect(invalid).toContain("border-[hsl(var(--color-status-error))]");
    expect(invalid).toContain("focus-visible:border-[hsl(var(--color-status-error))]");
    expect(invalid).not.toContain("focus-visible:border-[hsl(var(--color-accent))]");
  });
});

describe("focus-visible, not focus", () => {
  /**
   * 62 of the 92 controls write `focus:border-...`, which fires on mouse
   * clicks too. `:focus-visible` still matches a mouse click into a text input
   * (the selector's heuristic makes an explicit exception for elements
   * expecting text entry), so text fields lose nothing; what stops firing is
   * the click on a `<select>`, which is where the extra border was noise.
   */
  it("writes no bare focus: variant anywhere in the file", () => {
    // `focus:` and not `focus-visible:` — the regex has to exclude the hyphen
    // or it matches the thing we want.
    expect(CODE).not.toMatch(/\bfocus:(?!-)/);
    expect(CODE).toMatch(/focus-visible:/);
  });

  it.each(FIELD_SIZES)("%s uses focus-visible for its focus border", (size) => {
    const classes = fieldControl({ size }).split(/\s+/);
    expect(classes).toContain("focus-visible:border-[hsl(var(--color-accent))]");
    expect(classes.filter((c) => /^focus:/.test(c))).toEqual([]);
  });

  it("writes no outline-none, leaving the global ring alone", () => {
    // app/globals.css:459 is `:focus-visible { outline: ... !important }`, and
    // the rule immediately below it sets outline-offset: 0 for input/select/
    // textarea so the ring and the accent border are not read as a double
    // outline. A component participates by doing nothing.
    expect(CODE).not.toMatch(/\boutline-none\b/);
    expect(CODE).not.toMatch(/\bfocus(-visible)?:ring/);
  });
});

describe("the placeholder spelling is written down correctly, once", () => {
  /**
   * `src/components/workflow/WorkflowEditor.tsx:488` contains
   * `placeholder:[hsl(var(--color-ink-subtle))]`, which produces NO CSS:
   * `placeholder:` is a variant, and Tailwind's arbitrary-property form needs
   * `[property:value]`, so a bare bracketed value has no property to set. That
   * input's placeholder therefore renders at full-strength inherited ink,
   * indistinguishable from a real value — with no build error, no type error
   * and no failing test. That file is not ours to edit; this is the reference
   * spelling the migration should copy.
   */
  it("uses placeholder:text-, the form that emits a declaration", () => {
    expect(fieldControl({}).split(/\s+/)).toContain(
      "placeholder:text-[hsl(var(--color-ink-subtle))]"
    );
  });

  it("never emits the malformed variant-with-no-utility form", () => {
    // Guarding the exact shape, not just "contains placeholder": the defect is
    // `placeholder:` followed straight by `[`, with no utility name between.
    expect(CODE).not.toMatch(/placeholder:\[/);
    for (const size of FIELD_SIZES) {
      expect(fieldControl({ size })).not.toMatch(/placeholder:\[/);
    }
  });

  it("reaches the rendered control, not just the class string", () => {
    render(<TextField label="Name" placeholder="孟婆" />);
    expect(control().className).toContain("placeholder:text-[hsl(var(--color-ink-subtle))]");
  });
});

describe("label wiring and shape", () => {
  it.each(CONTROLS)("%s is reachable by its label", (_name, make) => {
    // If htmlFor/id were wrong this throws, and so does every test above.
    render(make({}));
    expect(control()).toBeInTheDocument();
  });

  it("generates distinct ids for two fields with the same label", () => {
    render(
      <>
        <TextField label="Name" />
        <TextField label="Name" />
      </>
    );
    const [a, b] = screen.getAllByLabelText("Name");
    expect(a.id).not.toBe("");
    expect(a.id).not.toBe(b.id);
  });

  it("honours a caller-supplied id", () => {
    render(<TextField label="Name" id="soul-name" />);
    expect(control()).toHaveAttribute("id", "soul-name");
  });

  it("marks required on the control, not only with an asterisk", () => {
    render(<TextField label="Name" required />);
    expect(control()).toHaveAttribute("aria-required", "true");
    // The asterisk is for eyes; aria-required is what reaches assistive tech.
    expect(screen.getByText("*")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders the description when there is no error", () => {
    render(<TextField label="Name" description="真名,不是谥号" />);
    expect(screen.getByText("真名,不是谥号")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders select options", () => {
    render(<SelectField label="Civ" options={OPTIONS} />);
    expect(screen.getByRole("option", { name: "希腊" })).toBeInTheDocument();
  });

  it("exposes the raw Field for controls it does not wrap", () => {
    render(
      <Field label="Custom" error="bad">
        {(c) => <input {...c} type="color" />}
      </Field>
    );
    expect(screen.getByLabelText("Custom")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("padding lands on the same ladder Button uses", () => {
  it("emits exactly three pairs, all on the 4/8/12/16 grid", () => {
    const pairs = FIELD_SIZES.map((size: FieldSize) =>
      fieldControl({ size })
        .split(/\s+/)
        .filter((c) => /^p[xy]-/.test(c))
        .sort()
        .join(" ")
    );
    expect(pairs).toEqual(["px-2 py-1", "px-3 py-2", "px-4 py-3"]);
  });

  it("carries the type scale beside the ink colour", () => {
    // Same `cn()` collision that cost Button its `text-black`; the control
    // string has `text-ink` and `text-0N` in it.
    const md = fieldControl({ size: "md" }).split(/\s+/);
    expect(md).toContain("text-03");
    expect(md).toContain("text-ink");
  });

  it("styles disabled on every size, not 29% of them", () => {
    for (const size of FIELD_SIZES) {
      expect(fieldControl({ size })).toContain("disabled:opacity-50");
    }
  });
});
