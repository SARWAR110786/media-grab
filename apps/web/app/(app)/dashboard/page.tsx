import { redirect } from "next/navigation";

/** The dashboard was merged into the home page. */
export default function DashboardPage() {
  redirect("/");
}
