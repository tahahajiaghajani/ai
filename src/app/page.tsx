import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.profile.status !== "active") redirect("/pending");
  redirect(user.isAdmin ? "/dashboard" : "/portal");
}
