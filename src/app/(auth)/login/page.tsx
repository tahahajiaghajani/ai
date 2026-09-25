import { LoginForm } from "./login-form";

export const metadata = { title: "ورود" };

export default async function LoginPage(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  const disabled = sp.disabled === "1";
  return <LoginForm next={next} disabled={disabled} />;
}
