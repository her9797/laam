"use client";

import {
  RiCheckLine,
  RiComputerLine,
  RiMoonLine,
  RiSunLine,
} from "@remixicon/react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";

import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import type { Theme } from "./theme";
import { useTheme } from "./ThemeProvider";

const THEME_OPTIONS: readonly Theme[] = ["light", "dark", "system"];

const THEME_LABEL_KEYS: Record<Theme, string> = {
  light: "themeLight",
  dark: "themeDark",
  system: "themeSystem",
};

const THEME_ICONS: Record<Theme, ComponentType<{ className?: string }>> = {
  light: RiSunLine,
  dark: RiMoonLine,
  system: RiComputerLine,
};

export function ThemeMenu() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const TriggerIcon = THEME_ICONS[theme];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: "outline", size: "icon-sm" }))}
        aria-label={`${t("theme")}: ${t(THEME_LABEL_KEYS[theme])}`}
      >
        <TriggerIcon className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("theme")}</DropdownMenuLabel>
          {THEME_OPTIONS.map((option) => {
            const OptionIcon = THEME_ICONS[option];
            return (
              <DropdownMenuItem key={option} onClick={() => setTheme(option)}>
                <OptionIcon className="size-4" aria-hidden="true" />
                <span className="flex-1">{t(THEME_LABEL_KEYS[option])}</span>
                <RiCheckLine
                  className={cn("size-4", theme !== option && "invisible")}
                  aria-hidden="true"
                />
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
