import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "@/i18n/client";

import { Pagination } from "./Pagination";

afterEach(cleanup);

describe("Pagination", () => {
  it("shows every page when the page count is five or fewer", () => {
    render(
      <Pagination page={2} pageSize={20} total={45} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} />,
    );

    expect(screen.getAllByRole("button", { name: /^\d+페이지$/ }).map((button) => button.textContent)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(screen.getByRole("button", { name: "2페이지" })).toHaveAttribute("aria-current", "page");
  });

  it("shows five consecutive pages centered on the current page, with no ellipsis", () => {
    render(
      <Pagination page={5} pageSize={10} total={100} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} />,
    );

    expect(screen.getAllByRole("button", { name: /^\d+페이지$/ }).map((button) => button.textContent)).toEqual([
      "3",
      "4",
      "5",
      "6",
      "7",
    ]);
    // The first/last-page buttons already express "there is more on either
    // side", so the ellipsis markers only cost width.
    expect(screen.queryByText("…")).not.toBeInTheDocument();
  });

  it("keeps five pages visible at the beginning and end", () => {
    const { rerender } = render(
      <Pagination page={2} pageSize={10} total={100} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} />,
    );

    expect(screen.getAllByRole("button", { name: /^\d+페이지$/ }).map((button) => button.textContent)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
    expect(screen.queryByText("…")).not.toBeInTheDocument();

    rerender(
      <Pagination page={9} pageSize={10} total={100} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} />,
    );

    expect(screen.getAllByRole("button", { name: /^\d+페이지$/ }).map((button) => button.textContent)).toEqual([
      "6",
      "7",
      "8",
      "9",
      "10",
    ]);
    expect(screen.queryByText("…")).not.toBeInTheDocument();
  });

  it("moves directly to the first, numbered, and last page", () => {
    const onPageChange = vi.fn();
    render(
      <Pagination page={5} pageSize={10} total={100} onPageChange={onPageChange} onPageSizeChange={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "첫 페이지" }));
    fireEvent.click(screen.getByRole("button", { name: "6페이지" }));
    fireEvent.click(screen.getByRole("button", { name: "마지막 페이지" }));

    expect(onPageChange.mock.calls).toEqual([[1], [6], [10]]);
  });

  it("disables the previous button on the first page", () => {
    render(
      <Pagination page={1} pageSize={20} total={45} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "이전" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "첫 페이지" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "다음" })).not.toBeDisabled();
  });

  it("disables the next button on the last page", () => {
    render(
      <Pagination page={3} pageSize={20} total={45} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "마지막 페이지" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "이전" })).not.toBeDisabled();
  });

  it("calls onPageChange with the adjacent page number", () => {
    const onPageChange = vi.fn();
    render(
      <Pagination
        page={2}
        pageSize={20}
        total={45}
        onPageChange={onPageChange}
        onPageSizeChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    expect(onPageChange).toHaveBeenCalledWith(3);

    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("treats an empty result as a single page with no next", () => {
    render(
      <Pagination page={1} pageSize={20} total={0} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "1페이지" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
  });

  it("shows a page size select with 10/20/30 options, reflecting the current page size", () => {
    render(
      <Pagination page={1} pageSize={20} total={45} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} />,
    );

    const select = screen.getByRole("combobox", { name: "페이지당 개수" }) as HTMLSelectElement;
    expect(select).toHaveValue("20");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "10",
      "20",
      "30",
    ]);
  });

  it("calls onPageSizeChange with the chosen size when the select value changes", () => {
    const onPageSizeChange = vi.fn();
    render(
      <Pagination
        page={1}
        pageSize={10}
        total={45}
        onPageChange={vi.fn()}
        onPageSizeChange={onPageSizeChange}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "페이지당 개수" }), { target: { value: "30" } });

    expect(onPageSizeChange).toHaveBeenCalledWith(30);
  });
});
