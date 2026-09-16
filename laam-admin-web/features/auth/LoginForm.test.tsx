import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock }),
}));

import { LoginForm } from "./LoginForm";

describe("LoginForm", () => {
  beforeEach(() => {
    replaceMock.mockClear();
    refreshMock.mockClear();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it("navigates to /dashboard after a successful login", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText("관리자 비밀번호"), {
      target: { value: "correct-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/dashboard"));
  });

  it("shows an alert with the error message when login fails", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "비밀번호가 올바르지 않습니다." }), {
        status: 401,
      }),
    );

    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText("관리자 비밀번호"), {
      target: { value: "wrong-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("비밀번호가 올바르지 않습니다.");
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
