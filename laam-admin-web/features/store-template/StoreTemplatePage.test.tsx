import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppData } from "@/features/bootstrap/model";
import { bootstrapKeys } from "@/features/bootstrap/queries";

vi.mock("@/lib/api/fetch-json", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/fetch-json")>(
    "@/lib/api/fetch-json",
  );
  return { ...actual, fetchJson: vi.fn() };
});

import { FetchJsonError, fetchJson } from "@/lib/api/fetch-json";

import { StoreTemplatePage } from "./StoreTemplatePage";

function appDataWith(customerTemplate?: string): AppData {
  return {
    store: {
      name: "가게",
      subtitle: "",
      address: "",
      songRequestCopy: "",
      requestCopy: "",
      eventCopy: "",
      ...(customerTemplate === undefined ? {} : { customerTemplate }),
    },
    categories: [],
    items: [],
    requestGuides: [],
    notices: [],
  };
}

type Route = (body: unknown) => Promise<unknown>;

/** Routes `fetchJson` by `"METHOD path"`; an unmocked request fails the test loudly. */
function routeRequests(routes: Record<string, Route>) {
  vi.mocked(fetchJson).mockImplementation(((input: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${input}`;
    const respond = routes[key];
    if (!respond) {
      throw new Error(`unexpected request: ${key}`);
    }
    return respond(init?.body ? JSON.parse(String(init.body)) : undefined);
  }) as typeof fetchJson);
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <StoreTemplatePage />
    </QueryClientProvider>,
  );
  return queryClient;
}

function card(name: string) {
  return screen.getByRole("radio", { name: new RegExp(name) });
}

function fakeWindow() {
  return { opener: {} as unknown, location: { href: "" }, close: vi.fn() };
}

beforeEach(() => {
  vi.mocked(fetchJson).mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StoreTemplatePage", () => {
  it("renders the three templates as radios and marks the current one", async () => {
    routeRequests({ "GET /api/bootstrap": async () => appDataWith("notebook") });

    renderPage();

    const group = await screen.findByRole("radiogroup");
    expect(within(group).getAllByRole("radio")).toHaveLength(3);
    expect(card("기본\\(다크\\)")).not.toBeChecked();
    expect(card("공책")).toBeChecked();
    expect(card("칠판")).not.toBeChecked();
    expect(screen.getAllByText("현재 적용 중")).toHaveLength(1);
    expect(screen.getByText("현재 적용 중").closest("label")).toHaveTextContent("공책");
  });

  it("treats a missing value as classic", async () => {
    routeRequests({ "GET /api/bootstrap": async () => appDataWith(undefined) });

    renderPage();

    expect(await screen.findByRole("radiogroup")).toBeInTheDocument();
    expect(card("기본\\(다크\\)")).toBeChecked();
    expect(screen.getByText("현재 적용 중").closest("label")).toHaveTextContent("기본(다크)");
  });

  it("shows an unknown-template notice and marks no card current for an unrecognized value", async () => {
    routeRequests({ "GET /api/bootstrap": async () => appDataWith("retro") });

    renderPage();

    expect(await screen.findByText(/알 수 없는 템플릿/)).toBeInTheDocument();
    expect(screen.queryByText("현재 적용 중")).toBeNull();
  });

  it("disables apply while the selection equals the current template", async () => {
    routeRequests({ "GET /api/bootstrap": async () => appDataWith("classic") });

    renderPage();

    const apply = await screen.findByRole("button", { name: "적용" });
    expect(apply).toBeDisabled();
    fireEvent.click(card("공책"));
    expect(apply).toBeEnabled();
  });

  it("applies the selection, writes the response into the bootstrap cache and shows a success message", async () => {
    const patch = vi.fn(async () => appDataWith("notebook"));
    routeRequests({
      "GET /api/bootstrap": async () => appDataWith("classic"),
      "PATCH /api/admin/store-template": patch,
    });

    const queryClient = renderPage();

    fireEvent.click(await screen.findByRole("radio", { name: /공책/ }));
    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    expect(await screen.findByRole("status")).toHaveTextContent("손님 화면 템플릿을 적용했어요.");
    expect(patch).toHaveBeenCalledWith({ template: "notebook" });
    expect(queryClient.getQueryData<AppData>(bootstrapKeys.all)?.store.customerTemplate).toBe(
      "notebook",
    );
    expect(screen.getByText("현재 적용 중").closest("label")).toHaveTextContent("공책");
    expect(screen.getByRole("button", { name: "적용" })).toBeDisabled();
  });

  it("keeps the selection and shows the error when apply fails", async () => {
    routeRequests({
      "GET /api/bootstrap": async () => appDataWith("classic"),
      "PATCH /api/admin/store-template": async () => {
        throw new FetchJsonError(400, "invalid template");
      },
    });

    renderPage();

    fireEvent.click(await screen.findByRole("radio", { name: /칠판/ }));
    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("invalid template");
    expect(card("칠판")).toBeChecked();
    expect(screen.getByText("현재 적용 중").closest("label")).toHaveTextContent("기본(다크)");
  });

  it("opens a tab synchronously and points it at the preview URL for the selected template", async () => {
    const tab = fakeWindow();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    const preview = vi.fn(async () => ({ url: "https://menu.example.com/?preview=signed" }));
    routeRequests({
      "GET /api/bootstrap": async () => appDataWith("classic"),
      "POST /api/admin/store-template/preview": preview,
    });

    renderPage();

    fireEvent.click(await screen.findByRole("radio", { name: /칠판/ }));
    fireEvent.click(screen.getByRole("button", { name: "미리보기" }));

    // Opened inside the click handler itself, before the request resolves.
    expect(openSpy).toHaveBeenCalledWith("", "_blank");
    expect(tab.opener).toBeNull();
    await waitFor(() => expect(tab.location.href).toBe("https://menu.example.com/?preview=signed"));
    expect(preview).toHaveBeenCalledWith({ template: "chalkboard" });
    expect(tab.close).not.toHaveBeenCalled();
  });

  it("closes the opened tab and shows the error when preview fails", async () => {
    const tab = fakeWindow();
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    routeRequests({
      "GET /api/bootstrap": async () => appDataWith("classic"),
      "POST /api/admin/store-template/preview": async () => {
        throw new FetchJsonError(500, "qr config missing");
      },
    });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "미리보기" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("qr config missing");
    expect(tab.close).toHaveBeenCalledTimes(1);
    expect(tab.location.href).toBe("");
  });
});
