/**
 * `SearchSelectField` — the control that replaced a `<select>` built out of one
 * page of a 20-per-page endpoint.
 *
 * The defect it exists for was not "the list is ugly": `app/dispatch/propose`
 * could not nominate a tenant's twenty-first soul, and nothing on screen said
 * so. A search box that filters the same twenty rows on the client is the same
 * bug with a text input on top, so the tests that matter here are about WHERE
 * the filtering happens, not about whether a popup opens.
 */
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { SearchSelectField } from "@/src/components/ui/SearchSelectField";
import type { SelectOption } from "@/src/components/ui/Field";

function Harness({
  options,
  loading = false,
  moreText,
  onSearch,
}: {
  options: SelectOption[];
  loading?: boolean;
  moreText?: string;
  onSearch?: (_text: string) => void;
}) {
  const [text, setText] = useState("");
  const [value, setValue] = useState("");
  return (
    <>
      <SearchSelectField
        id="soul"
        name="soul_id"
        label="灵魂"
        value={value}
        onValueChange={setValue}
        options={options}
        searchText={text}
        onSearchTextChange={(next) => {
          setText(next);
          onSearch?.(next);
        }}
        loading={loading}
        loadingText="LOADING"
        emptyText="EMPTY"
        moreText={moreText}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

const hidden = () => document.querySelector('input[name="soul_id"]') as HTMLInputElement;
const options = () => Array.from(document.querySelectorAll('[role="option"]'));

async function type(text: string) {
  fireEvent.change(screen.getByLabelText("灵魂"), { target: { value: text } });
  await waitFor(() => {}, { timeout: 60 });
}

describe("the list belongs to the server", () => {
  it("renders a row the query does not match", async () => {
    // THE CENTRAL PIN. The server searches more than the label — other fields,
    // its own collation — so a row it returned may not contain the query as a
    // substring of what is displayed. Any client-side filter drops that row and
    // shows the user a narrower answer than the one the server gave, which is
    // the original defect in a new place. `filter={null}` is what stops it, and
    // removing it makes exactly this assertion fail.
    render(<Harness options={[{ value: "s9", label: "孟婆 (ALIVE)" }]} />);
    await type("zzz-no-substring-match");
    expect(options().map((o) => o.textContent)).toEqual(["孟婆 (ALIVE)"]);
  });

  it("renders every row it is handed, in the server's order", async () => {
    const rows = [
      { value: "c", label: "丙" },
      { value: "a", label: "甲" },
      { value: "b", label: "乙" },
    ];
    render(<Harness options={rows} />);
    await type("x");
    // Order too: the server sorts, and re-sorting here would silently override
    // an `ordering` the caller asked for.
    expect(options().map((o) => o.textContent)).toEqual(["丙", "甲", "乙"]);
  });

  it("asks the caller to search, rather than searching itself", async () => {
    const onSearch = jest.fn();
    render(<Harness options={[]} onSearch={onSearch} />);
    await type("孟");
    expect(onSearch).toHaveBeenCalledWith("孟");
  });
});

describe("pending is not the same as empty", () => {
  it("says it is loading, and does not say there is nothing", async () => {
    // `de66a5f` closed eight pages that drew "请求失败" as "there is nothing
    // here". In a picker it is worse: the reflex is to retype a query that was
    // already right.
    render(<Harness options={[]} loading />);
    await type("孟");
    expect(screen.getByText("LOADING")).toBeInTheDocument();
    expect(screen.queryByText("EMPTY")).not.toBeInTheDocument();
  });

  it("says there is nothing only once the answer has arrived", async () => {
    render(<Harness options={[]} />);
    await type("孟");
    expect(screen.getByText("EMPTY")).toBeInTheDocument();
    expect(screen.queryByText("LOADING")).not.toBeInTheDocument();
  });

  it("shows the slice notice only when one is given", async () => {
    const { unmount } = render(<Harness options={[{ value: "a", label: "甲" }]} />);
    await type("甲");
    expect(screen.queryByText(/20 \/ 900/)).not.toBeInTheDocument();
    unmount();

    render(<Harness options={[{ value: "a", label: "甲" }]} moreText="20 / 900" />);
    await type("甲");
    expect(screen.getByText("20 / 900")).toBeInTheDocument();
  });
});

describe("the value the form submits", () => {
  it("travels as an id, not as the label the user reads", async () => {
    render(<Harness options={[{ value: "s1", label: "孟婆 (ALIVE)" }]} />);
    await type("孟");
    fireEvent.click(options()[0]);
    await waitFor(() => {}, { timeout: 60 });

    expect(screen.getByTestId("value")).toHaveTextContent("s1");
    expect(hidden().value).toBe("s1");
    // And the input names the choice, so the field is not a mystery id.
    expect((screen.getByLabelText("灵魂") as HTMLInputElement).value).toBe("孟婆 (ALIVE)");
  });

  it("is cleared when the text stops naming it", async () => {
    // Otherwise the form submits a soul the field is no longer showing — the
    // one failure here that a user cannot see before pressing submit.
    render(<Harness options={[{ value: "s1", label: "孟婆 (ALIVE)" }]} />);
    await type("孟");
    fireEvent.click(options()[0]);
    await waitFor(() => {}, { timeout: 60 });
    expect(hidden().value).toBe("s1");

    await type("王");
    expect(hidden().value).toBe("");
    expect(screen.getByTestId("value")).toHaveTextContent("");
  });

  it("keeps naming a selection whose row the next search no longer returns", async () => {
    // Pick from one result set, then let the options change under it. The id is
    // still submitted, so the field must still name it rather than go blank.
    const { rerender } = render(<Harness options={[{ value: "s1", label: "孟婆 (ALIVE)" }]} />);
    await type("孟");
    fireEvent.click(options()[0]);
    await waitFor(() => {}, { timeout: 60 });

    rerender(<Harness options={[{ value: "s2", label: "王二 (DEAD)" }]} />);
    expect(hidden().value).toBe("s1");
    expect((screen.getByLabelText("灵魂") as HTMLInputElement).value).toBe("孟婆 (ALIVE)");
  });

  it("still clears the id when the text changes after the options moved on", async () => {
    // THE ONE THAT DISTINGUISHES holding the chosen option in state from
    // looking it up in `options`. Every other assertion in this file passes
    // either way — measured, by deriving `selected` from `options` and watching
    // all eleven stay green.
    //
    // The two only diverge here: the row has left `options`, so a lookup yields
    // null, so the "typing replaces a selection" guard never runs and the form
    // keeps submitting 孟婆 while the field reads 王. That is the one failure in
    // this component a user cannot see before pressing submit.
    const { rerender } = render(<Harness options={[{ value: "s1", label: "孟婆 (ALIVE)" }]} />);
    await type("孟");
    fireEvent.click(options()[0]);
    await waitFor(() => {}, { timeout: 60 });
    expect(hidden().value).toBe("s1");

    rerender(<Harness options={[{ value: "s2", label: "王二 (DEAD)" }]} />);
    await type("王");
    expect(hidden().value).toBe("");
  });
});

describe("keyboard", () => {
  it("selects the highlighted row with Enter", async () => {
    render(<Harness options={[{ value: "s1", label: "孟婆" }, { value: "s2", label: "王二" }]} />);
    const input = screen.getByLabelText("灵魂");
    await type("x");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {}, { timeout: 60 });
    expect(hidden().value).toBe("s2");
  });

  it("is a combobox, and says whether its list is showing", async () => {
    render(<Harness options={[{ value: "s1", label: "孟婆" }]} />);
    const input = screen.getByLabelText("灵魂");
    expect(input).toHaveAttribute("role", "combobox");
    expect(input).toHaveAttribute("aria-expanded", "false");
    await type("孟");
    expect(input).toHaveAttribute("aria-expanded", "true");
  });
});
