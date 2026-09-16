import Link from "next/link";

import { TableSessionBadge } from "@/components/table/table-session-badge";
import { customerNavigationItems, type CustomerNavigationKey } from "@/lib/customer-navigation";

type PrimaryNavProps = {
  active?: CustomerNavigationKey;
  canEditTable?: boolean;
};

export function PrimaryNav({ active, canEditTable = false }: PrimaryNavProps) {
  return (
    <>
      <TableSessionBadge canEdit={canEditTable} />
      <nav className="primary-strip" aria-label="주요 메뉴">
        {customerNavigationItems.map((item) => (
          <Link
            key={item.key}
            className={[
              "primary-pill",
              item.key === "special-requests" ? "primary-pill-special" : "",
              item.key === active ? "active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            href={item.href}
          >
            {item.badgeLabel}
          </Link>
        ))}
      </nav>
    </>
  );
}
