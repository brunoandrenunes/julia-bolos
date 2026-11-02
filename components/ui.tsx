import Link from "next/link";
import clsx from "clsx";

// Peças visuais usadas em todas as telas.

type IconName =
  | "home"
  | "cart"
  | "box"
  | "wallet"
  | "chart"
  | "logout"
  | "plus"
  | "alert"
  | "check"
  | "info"
  | "download"
  | "trash"
  | "x"
  | "list"
  | "copy"
  | "tag";

const ICON_PATHS: Record<IconName, string> = {
  home: "M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9",
  cart: "M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L20.5 8H6.2M9 20.5h.01M17 20.5h.01",
  box: "M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8",
  wallet: "M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2Zm14 7h.01",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11",
  plus: "M12 5v14M5 12h14",
  alert: "M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  check: "M20 6 9 17l-5-5",
  info: "M12 16v-4M12 8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  download: "M12 4v12M7 11l5 5 5-5M4 20h16",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  x: "M18 6 6 18M6 6l12 12",
  list: "M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  tag: "M3 12V4h8l10 10-8 8L3 12ZM7.5 8h.01",
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

export function PageHead({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {children ? <div className="page-head-actions">{children}</div> : null}
    </header>
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  flush = false,
  className,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={clsx("card", className)}>
      {title ? (
        <div className="card-head">
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="page-head-actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className={clsx("card-body", flush && "tight")}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  note,
  tone,
  highlight = false,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "pos" | "neg";
  highlight?: boolean;
}) {
  return (
    <div className={clsx("stat", highlight && "highlight")}>
      <div className="stat-label">{label}</div>
      <div className={clsx("stat-value", !highlight && tone)}>{value}</div>
      {note ? <div className="stat-note">{note}</div> : null}
    </div>
  );
}

export function Tabs({
  tabs,
  active,
}: {
  tabs: { key: string; label: string; href: string; count?: number }[];
  active: string;
}) {
  return (
    <nav className="tabs" aria-label="Seções">
      {tabs.map((tab) => (
        <Link key={tab.key} href={tab.href} className={tab.key === active ? "active" : ""}>
          {tab.label}
          {tab.count !== undefined ? <span className="count">{tab.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

export function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "success" | "warning" | "danger" | "info" | "brand";
}) {
  return <span className={clsx("badge", tone)}>{children}</span>;
}

export function Alert({
  tone,
  title,
  children,
  action,
}: {
  tone: "success" | "warning" | "danger" | "info";
  title?: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const icon: IconName = tone === "success" ? "check" : tone === "info" ? "info" : "alert";
  return (
    <div className={clsx("alert", tone)} role={tone === "danger" ? "alert" : "status"}>
      <Icon name={icon} />
      <div className="alert-body">
        {title ? <strong>{title}</strong> : null}
        {children}
      </div>
      {action ? <div className="alert-action">{action}</div> : null}
    </div>
  );
}

// Mensagens que as ações devolvem pela URL (?error= / ?notice=).
export function Flash({ error, notice }: { error?: string; notice?: string }) {
  if (error) return <Alert tone="danger" title="Não foi possível concluir">{error}</Alert>;
  if (notice) return <Alert tone="success">{notice}</Alert>;
  return null;
}

// Formulário que fica recolhido até clicar em "+ Novo ...".
export function Drawer({
  title,
  hint,
  open = false,
  children,
}: {
  title: string;
  hint?: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="drawer" open={open}>
      <summary>
        <span>
          {title}
          {hint ? <span className="summary-hint"> · {hint}</span> : null}
        </span>
        <span className="plus">
          <Icon name="plus" size={16} />
        </span>
      </summary>
      <div className="card-body">{children}</div>
    </details>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function PeriodHidden({ year, month, aba }: { year: number; month: number; aba?: string }) {
  return (
    <>
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />
      {aba ? <input type="hidden" name="aba" value={aba} /> : null}
    </>
  );
}
