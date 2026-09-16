import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AppProviders } from "./AppProviders";

describe("AppProviders", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders its children", () => {
    render(
      <AppProviders>
        <div>content</div>
      </AppProviders>,
    );

    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("mounts the toast viewport so any descendant can call toast.add()", () => {
    render(
      <AppProviders>
        <div>content</div>
      </AppProviders>,
    );

    expect(document.querySelector('[data-slot="toast-viewport"]')).not.toBeNull();
  });
});
