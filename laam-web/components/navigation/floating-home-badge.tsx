import Link from "next/link";

type FloatingHomeBadgeProps = {
  active?: boolean;
};

export function FloatingHomeBadge({ active = false }: FloatingHomeBadgeProps) {
  const badgeInner = (
    <>
      <span className="floating-home-core">
        <svg
          className="floating-home-icon"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M4.75 10.5L12 4.75L19.25 10.5V18.25C19.25 18.6642 18.9142 19 18.5 19H14.5V14.25H9.5V19H5.5C5.08579 19 4.75 18.6642 4.75 18.25V10.5Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="sr-only">홈</span>
    </>
  );

  if (active) {
    return (
      <div className="floating-home-badge active" aria-current="page">
        {badgeInner}
      </div>
    );
  }

  return (
    <Link className="floating-home-badge" href="/">
      {badgeInner}
    </Link>
  );
}
