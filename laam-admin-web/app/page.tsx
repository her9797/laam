import { redirect } from "next/navigation";

/**
 * The app has no content of its own at `/` — every operator screen lives
 * under the `(admin)` route group. A server-side redirect is enough here
 * because the destination needs no client state to decide: an authenticated
 * visitor lands on the dashboard, and an anonymous one is bounced onward to
 * `/login` by `proxy.ts`'s session gate (`/` -> `/dashboard` -> `/login`).
 */
export default function Home() {
  redirect("/dashboard");
}
