import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// base-ui's Popover positioner crashes the jsdom worker, so the primitive is
// replaced with a minimal controlled stand-in. Real popover behaviour
// (positioning, Esc, focus) is covered by the e2e spec.
vi.mock("@/components/ui/popover", async () => {
  const React = await import("react");
  const Ctx = React.createContext<{ open: boolean; set: (open: boolean) => void }>({
    open: false,
    set: () => {},
  });
  return {
    Popover: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      children: React.ReactNode;
    }) => <Ctx.Provider value={{ open, set: onOpenChange }}>{children}</Ctx.Provider>,
    PopoverTrigger: ({ children, ...props }: React.ComponentProps<"button">) => {
      const { open, set } = React.useContext(Ctx);
      return (
        <button type="button" onClick={() => set(!open)} {...props}>
          {children}
        </button>
      );
    },
    PopoverContent: ({ children }: { children: React.ReactNode }) => {
      const { open } = React.useContext(Ctx);
      return open ? <div role="dialog">{children}</div> : null;
    },
  };
});

import i18n from "@/i18n/client";

import { MonthPicker } from "./MonthPicker";

function renderPicker(month = "2026-09", onChange = vi.fn()) {
  render(<MonthPicker month={month} label="2026년 9월" language="ko" onChange={onChange} />);
  return onChange;
}

describe("MonthPicker", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("ko");
  });
  afterEach(() => cleanup());

  it("월 라벨 버튼을 누르면 선택 연도의 12개월 그리드가 열린다", async () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: /2026년 9월/ }));
    await screen.findByText("2026년");
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(11);
    expect(screen.getByRole("button", { pressed: true }).textContent).toContain("9");
  });

  it("월을 누르면 onChange(YYYY-MM)를 호출하고 닫는다", async () => {
    const onChange = renderPicker();
    fireEvent.click(screen.getByRole("button", { name: /2026년 9월/ }));
    await screen.findByText("2026년");
    fireEvent.click(screen.getAllByRole("button", { pressed: false })[2]);
    expect(onChange).toHaveBeenCalledWith("2026-03");
    await waitFor(() => expect(screen.queryByText("2026년")).toBeNull());
  });

  it("연도 화살표는 표시 연도만 바꾸고 선택은 바꾸지 않는다", async () => {
    const onChange = renderPicker();
    fireEvent.click(screen.getByRole("button", { name: /2026년 9월/ }));
    await screen.findByText("2026년");
    fireEvent.click(screen.getByRole("button", { name: "이전 연도" }));
    expect(screen.getByText("2025년")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { pressed: true })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "다음 연도" }));
    fireEvent.click(screen.getByRole("button", { name: "다음 연도" }));
    fireEvent.click(screen.getAllByRole("button", { pressed: false })[11]);
    expect(onChange).toHaveBeenCalledWith("2027-12");
  });

  it("다시 열면 표시 연도가 선택된 월의 연도로 돌아간다", async () => {
    renderPicker();
    const trigger = screen.getByRole("button", { name: /2026년 9월/ });
    fireEvent.click(trigger);
    await screen.findByText("2026년");
    fireEvent.click(screen.getByRole("button", { name: "이전 연도" }));
    expect(screen.getByText("2025년")).toBeTruthy();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.queryByText("2025년")).toBeNull());
    fireEvent.click(trigger);
    await screen.findByText("2026년");
  });
});
