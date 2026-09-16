"use client";

import { RiCheckLine, RiTranslate2 } from "@remixicon/react";
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

const LANGUAGE_OPTIONS = [
  { value: "ko", labelKey: "languageKorean" },
  { value: "en", labelKey: "languageEnglish" },
] as const;

export function LanguageMenu() {
  const { t, i18n } = useTranslation();
  const currentLanguage = i18n.resolvedLanguage ?? i18n.language ?? "ko";
  const currentOption =
    LANGUAGE_OPTIONS.find((option) => option.value === currentLanguage) ??
    LANGUAGE_OPTIONS[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: "outline", size: "icon-sm" }))}
        aria-label={`${t("language")}: ${t(currentOption.labelKey)}`}
      >
        <RiTranslate2 className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("language")}</DropdownMenuLabel>
          {LANGUAGE_OPTIONS.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onClick={() => {
                void i18n.changeLanguage(option.value);
              }}
            >
              <span className="flex-1">{t(option.labelKey)}</span>
              <RiCheckLine
                className={cn(
                  "size-4",
                  currentLanguage !== option.value && "invisible",
                )}
                aria-hidden="true"
              />
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
