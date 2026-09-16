import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import RootLayout from "./layout";

describe("RootLayout", () => {
  it("renders the application name and content", () => {
    render(
      <RootLayout>
        <main>content</main>
      </RootLayout>,
    );

    expect(screen.getByText("content")).toBeInTheDocument();
  });
});
