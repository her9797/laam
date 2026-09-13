import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "@/i18n/client";

import { ListUpdatingRegion } from "./ListUpdatingRegion";

afterEach(cleanup);

describe("ListUpdatingRegion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exposes an indeterminate progressbar once a request has been open past the show delay", () => {
    render(
      <ListUpdatingRegion active stale={false}>
        <p>rows</p>
      </ListUpdatingRegion>,
    );

    act(() => {
      vi.advanceTimersByTime(200);
    });

    const bar = screen.getByRole("progressbar", { name: "목록을 업데이트하는 중" });
    // Indeterminate: the screen has no idea how far along the fetch is, so
    // it must not claim a value.
    expect(bar).not.toHaveAttribute("aria-valuenow");
  });

  it("exposes no progressbar once the list is idle", () => {
    render(
      <ListUpdatingRegion active={false} stale={false}>
        <p>rows</p>
      </ListUpdatingRegion>,
    );

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  // The whole point of this component is that it cannot cause the layout
  // shift it reports on: the track stays mounted whether or not the bar is
  // running, so turning the bar on never reflows the rows below it.
  it("keeps the bar's track mounted while idle so appearing cannot shift the layout", () => {
    const { container } = render(
      <ListUpdatingRegion active={false} stale={false}>
        <p>rows</p>
      </ListUpdatingRegion>,
    );

    expect(container.querySelector('[data-slot="list-progress-track"]')).toBeInTheDocument();
  });

  // The track must sit outside normal flow (absolute), not merely stay
  // mounted — an in-flow track adds vertical rhythm space of its own even
  // while idle, which is what pushed this region 10px further from
  // `ListTotalCount` than every other list screen.
  it("keeps the progress track out of layout flow so it cannot add vertical rhythm space", () => {
    const { container } = render(
      <ListUpdatingRegion active={false} stale={false}>
        <p>rows</p>
      </ListUpdatingRegion>,
    );

    expect(container.querySelector('[data-slot="list-progress-track"]')).toHaveClass("absolute");
  });

  it("keeps the rows mounted and marks them busy while a stale page is on screen", () => {
    render(
      <ListUpdatingRegion active stale>
        <p>rows</p>
      </ListUpdatingRegion>,
    );

    expect(screen.getByText("rows")).toBeInTheDocument();
    expect(screen.getByText("rows").closest("[aria-busy]")).toHaveAttribute("aria-busy", "true");
  });

  // A window-focus refetch or a Realtime broadcast opens a request against
  // the page already on screen. That earns the bar, but dimming rows the
  // operator is reading would make the table blink for no reason.
  it("shows the bar without marking the rows busy during a background refetch", () => {
    render(
      <ListUpdatingRegion active stale={false}>
        <p>rows</p>
      </ListUpdatingRegion>,
    );

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByText("rows").closest("[aria-busy]")).toHaveAttribute("aria-busy", "false");
  });

  // The bar already communicates "updating" — dimming the rows on top of it
  // is a duplicate signal, and it drags `muted-foreground` text below WCAG
  // contrast while it's on.
  it("does not dim the rows when stale, since the bar already signals updating", () => {
    const { container } = render(
      <ListUpdatingRegion active={false} stale>
        <p>rows</p>
      </ListUpdatingRegion>,
    );

    expect(container.querySelector(".opacity-60")).not.toBeInTheDocument();
  });
});

describe("ListUpdatingRegion bar timing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // A cached page revisit or a focus refetch that resolves in a few ms must
  // never flash the bar — that's the blink this change exists to remove.
  it("does not show the bar for a request that resolves within the 200ms show delay", () => {
    const { rerender } = render(
      <ListUpdatingRegion active stale={false}>
        <p>rows</p>
      </ListUpdatingRegion>,
    );

    act(() => {
      vi.advanceTimersByTime(150);
    });
    rerender(
      <ListUpdatingRegion active={false} stale={false}>
        <p>rows</p>
      </ListUpdatingRegion>,
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("waits 200ms before showing the bar", () => {
    render(
      <ListUpdatingRegion active stale={false}>
        <p>rows</p>
      </ListUpdatingRegion>,
    );

    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("keeps a shown bar up for at least 400ms after the request finishes", () => {
    const { rerender } = render(
      <ListUpdatingRegion active stale={false}>
        <p>rows</p>
      </ListUpdatingRegion>,
    );

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    rerender(
      <ListUpdatingRegion active={false} stale={false}>
        <p>rows</p>
      </ListUpdatingRegion>,
    );

    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
