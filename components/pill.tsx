import clsx from "clsx";

export function Pill({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  return <span className={clsx("pill", tone !== "default" && tone)}>{children}</span>;
}
